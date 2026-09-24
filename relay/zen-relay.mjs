#!/usr/bin/env node
/* Zen-релей для VoiceComic.
 *
 * OpenCode Zen free tier («демо-режим», модели big-pickle, mimo-v2.5-free
 * и др.) пускает запросы БЕЗ ключа только при условии, что они «выглядят» как
 * запросы opencode-CLI: нужны identity-заголовки (User-Agent: opencode/<ver>,
 * x-opencode-session/request/client/project), stream:true, tool_choice:auto и
 * официальный набор builtin-тулов. Браузер не может подменить User-Agent, а у
 * zen нет CORS — поэтому для keyless-моделей из PWA/APK нужен этот релей.
 *
 * Запуск:        node relay/zen-relay.mjs [порт]
 *                 (порт по умолчанию 8789; можно ZEN_RELAY_PORT=…)
 * Проверка:      curl -s localhost:8789/healthz
 * Пример запроса (как прокси для OpenAI-эндпоинта):
 *   POST http://localhost:8789/v1/chat/completions
 *   Authorization: Bearer <ключ Zen>   ← опционально; без него работают
 *                                        только демо/free-модели
 *   { "model":"big-pickle","messages":[...] }
 * Релей добавляет stream:true + tools, шлёт на
 * https://opencode.ai/zen/v1/chat/completions с identity-заголовками и
 * сворачивает SSE в обычный JSON chat.completion.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.ZEN_RELAY_PORT || 8789);
const UPSTREAM_URL = 'https://opencode.ai/zen/v1/chat/completions';
const OPENCODE_VERSION = '1.18.31';
const TOOLS = JSON.parse(readFileSync(path.join(ROOT, 'builtin_tools.json'), 'utf8'));

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function ocId(prefix) {
  const packed = Date.now() * 0x1000;
  let tail = '';
  for (const b of crypto.randomBytes(14)) tail += B62[b % 62];
  return prefix + packed.toString(16).padStart(12, '0').slice(-12) + tail;
}

const PROBE_MSG = { type: 'user', content: 'ping' };

function sseFoldChunks(chunks) {
  const merged = [];
  for (const c of chunks) {
    if (!c) continue;
    const d = c.choices && c.choices[0];
    if (!d) continue;
    const step = merged[merged.length - 1];
    if (step && step.index === d.index) {
      step.delta.content = (step.delta.content || '') + ((d.delta && d.delta.content) || '');
      if (d.finish_reason) step.finish_reason = d.finish_reason;
    } else {
      merged.push(JSON.parse(JSON.stringify(d)));
    }
  }
  return merged;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch (e) {
    return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Bad JSON body' } });
  }

  const model = body.model || '';
  const modelOkay = typeof model === 'string' && model.trim().length > 0;
  if (!modelOkay) {
    return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'model is required' } });
  }

  // identity-заголовки «как у opencode CLI»: именно они гейтят free tier
  const h = {
    'Content-Type': 'application/json',
    'User-Agent': `opencode/${OPENCODE_VERSION}`,
    'x-opencode-client': 'cli',
    'x-opencode-project': 'global',
    'x-opencode-session': ocId('ses_'),
    'x-opencode-request': ocId('msg_'),
    Accept: 'application/json, text/event-stream',
  };
  if (req.headers.authorization) h.Authorization = req.headers.authorization;

  // «демо-режим» opencode требует stream + официальный набор тулов
  const out = {
    ...body,
    model,
    stream: true,
    tool_choice: body.tool_choice || 'auto',
    tools: mergeTools(body.tools),
    messages: (body.messages && body.messages.length) ? body.messages : [PROBE_MSG],
  };
  delete out.unused; // защита от лишнего мусора

  let upstream;
  try {
    upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(out),
      signal: AbortSignal.timeout(60000),
    });
  } catch (e) {
    return sendJson(res, 502, { error: { type: 'relay_error', message: 'Upstream unreachable: ' + e.message } });
  }

  const raw = await upstream.text();

  if (upstream.status !== 200) {
    const ct = (upstream.headers.get('content-type') || '').toLowerCase();
    let payload = { error: { type: 'upstream_error', message: `Zen HTTP ${upstream.status}` } };
    if (ct.includes('json')) {
      try { payload = JSON.parse(raw); } catch (_) { /* keep default */ }
    }
    return sendJson(res, upstream.status, payload);
  }

  // SSE → обычный JSON chat.completion (клиент использует non-stream запрос)
  const chunks = [];
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      chunks.push(JSON.parse(payload));
    } catch (_) { /* skip partial */ }
  }

  const merged = sseFoldChunks(chunks);
  let content = '';
  let finish_reason = 'stop';
  for (const d of merged) {
    content += (d.delta && d.delta.content) || '';
    if (d.finish_reason) finish_reason = d.finish_reason;
  }

  return sendJson(res, 200, {
    id: 'chatcmpl-relay-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: content || '' },
      finish_reason: finish_reason || 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function mergeTools(clientTools) {
  if (Array.isArray(clientTools) && clientTools.length) return [...clientTools];
  return TOOLS;
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, upstream: UPSTREAM_URL, version: OPENCODE_VERSION, tools: TOOLS.length });
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    return handleChat(req, res);
  }
  return sendJson(res, 404, { error: { type: 'not_found', message: url.pathname } });
});

server.listen(PORT, () => {
  console.log('zen-relay on :' + PORT + ' → ' + UPSTREAM_URL);
  console.log('демо-модели без ключа: big-pickle, mimo-v2.5-free, mimo-v2.6-flash-free,');
  console.log('  nemotron-3-ultra-free, nemotron-3.5-lightning-free, ling-3.0-flash-fin-free, space-bunny-free');
});