#!/usr/bin/env node
/* Zen-релей для VoiceComic.
 *
 * OpenCode Zen free tier («демо-режим», модели big-pickle, mimo-v2.5-free и
 * др.) пускает запросы БЕЗ ключа только при условии, что они «выглядят» как
 * запросы opencode-CLI: нужны identity-заголовки (User-Agent: opencode/<ver>,
 * x-opencode-session/request/client/project), stream:true, tool_choice:auto и
 * официальный набор builtin-тулов. Браузер не может подменить User-Agent, а у
 * zen нет CORS — поэтому для keyless-моделей из PWA/APK нужен этот релей.
 *
 * Понимает два эндпоинта zen (выбираются автоматически по модели):
 *   - /v1/chat/completions — oa-compat модели (big-pickle, mimo-*, nemotron-*,
 *     ling-*, space-bunny-free, deepseek-v4-flash-free);
 *   - /v1/responses       — Responses-модели (muse-spark-*-contributor-free;
 *     тулы конвертируются в Responses-формат и поднимается max_output_tokens);
 *   - jev-*               — это «система решений» структуры state+questions,
 *     не чат; релей возвращает понятную ошибку.
 * Оба пути сворачиваются в обычный JSON chat.completion, так что клиент
 * (non-stream) ничего не знает про SSE.
 *
 * Запуск:        node relay/zen-relay.mjs [порт]
 *                 (порт по умолчанию 8789; можно ZEN_RELAY_PORT=…)
 * Проверка:      curl -s localhost:8789/healthz
 * Пример:
 *   POST http://localhost:8789/v1/chat/completions
 *   { "model":"big-pickle","messages":[{"role":"user","content":"привет"}] }
 *   — демо-модели без ключа; платные — если прислать Authorization: Bearer <ключ Zen>.
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] || process.env.ZEN_RELAY_PORT || 8789);
const ZEN = 'https://opencode.ai/zen/v1';
const OPENCODE_VERSION = '1.18.31';
const TOOLS = JSON.parse(readFileSync(path.join(ROOT, 'builtin_tools.json'), 'utf8'));

const RESPONSES_MODELS = /muse-spark-\S*contributor-free/;
const JEV_MODELS = /^jev-/;

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function ocId(prefix) {
  const packed = Date.now() * 0x1000;
  let tail = '';
  for (const b of crypto.randomBytes(14)) tail += B62[b % 62];
  return prefix + packed.toString(16).padStart(12, '0').slice(-12) + tail;
}

const PROBE_MSG = { type: 'user', content: 'ping' };

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

function identityHeaders(req) {
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
  return h;
}

function mergeTools(clientTools) {
  if (Array.isArray(clientTools) && clientTools.length) return [...clientTools];
  return TOOLS;
}

function responsesTools() {
  return TOOLS.map((t) => ({
    type: 'function',
    name: t.function.name,
    description: t.function.description,
    parameters: t.function.parameters,
  }));
}

function sseFoldChat(raw) {
  let content = '';
  let finish_reason = 'stop';
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const o = JSON.parse(payload);
      const d = o.choices && o.choices[0];
      if (!d) continue;
      if (d.delta && d.delta.content) content += d.delta.content;
      if (d.finish_reason) finish_reason = d.finish_reason;
    } catch (_) { /* skip partial */ }
  }
  return { content, finish_reason };
}

function sseFoldResponses(raw) {
  let content = '';
  let status = 'completed';
  let stopped = false;
  for (const line of raw.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const payload = s.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const o = JSON.parse(payload);
      if (o.type === 'response.output_text.delta') content += o.delta || '';
      if (o.type === 'response.completed') { status = (o.response && o.response.status) || 'completed'; stopped = true; }
      if (o.type === 'response.failed') { status = 'failed'; stopped = true; }
    } catch (_) { /* skip partial */ }
  }
  return { content, status, stopped };
}

function completionJson(model, result) {
  return {
    id: 'chatcmpl-relay-' + Date.now(),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: result.content || '' },
      finish_reason: result.finish_reason || 'stop',
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

async function handleChat(req, res) {
  let body;
  try {
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
  } catch (e) {
    return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'Bad JSON body' } });
  }

  const model = body.model || '';
  if (typeof model !== 'string' || !model.trim()) {
    return sendJson(res, 400, { error: { type: 'invalid_request_error', message: 'model is required' } });
  }
  if (JEV_MODELS.test(model)) {
    return sendJson(res, 400, {
      error: { type: 'model_not_chat', message: `«${model}» (Jev) — это не чат-модель, а «система решений» (state+questions); в VoiceComic не используется.` },
    });
  }

  const h = identityHeaders(req);
  const isResponses = RESPONSES_MODELS.test(model);

  let out;
  let upstreamUrl;
  if (isResponses) {
    upstreamUrl = ZEN + '/responses';
    out = {
      ...body,
      model,
      stream: true,
      tools: responsesTools(),
      tool_choice: 'auto',
      // без запас по токенам muse-модели возвращают «incomplete»
      max_output_tokens: Math.max(body.max_output_tokens || 800, 800),
      input: Array.isArray(body.messages) && body.messages.length
        ? body.messages.map((m) => ({
            role: m.role || 'user',
            content: [{ type: 'input_text', text: textOf(m.content) }],
          }))
        : [{ role: 'user', content: [{ type: 'input_text', text: 'ping' }] }],
    };
    delete out.messages;
    delete out.max_tokens;
  } else {
    upstreamUrl = ZEN + '/chat/completions';
    out = {
      ...body,
      model,
      stream: true,
      tool_choice: body.tool_choice || 'auto',
      tools: mergeTools(body.tools),
      messages: (body.messages && body.messages.length) ? body.messages : [PROBE_MSG],
    };
    delete out.unused;
  }

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(out),
      signal: AbortSignal.timeout(90000),
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

  const result = isResponses ? sseFoldResponses(raw) : sseFoldChat(raw);
  return sendJson(res, 200, completionJson(model, result));
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (p && p.text != null ? p.text : '')).join('\n');
  }
  return String(content || '');
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, zen: ZEN, version: OPENCODE_VERSION, tools: TOOLS.length });
  }
  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    return handleChat(req, res);
  }
  return sendJson(res, 404, { error: { type: 'not_found', message: url.pathname } });
});

server.listen(PORT, () => {
  console.log('zen-relay on :' + PORT + ' → ' + ZEN);
  console.log('демо-модели без ключа:');
  console.log('  chat: big-pickle, mimo-v2.5-free, mimo-v2.6-flash-free, nemotron-3-ultra-free,');
  console.log('        nemotron-3.5-lightning-free, ling-3.0-flash-fin-free, space-bunny-free, deepseek-v4-flash-free');
  console.log('  responses: muse-spark-1.3-contributor-free, muse-spark-1.2-contributor-free');
  console.log('  jev-* — decision-модель, не чат (не поддерживается)');
});