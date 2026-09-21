/* Генератор каталога провайдеров и моделей из models.dev (это данные, которые
 * использует opencode npm, см. @opencode-ai/models). Обновление: node tools/gen-models.mjs
 *
 * Включаем только то, что реально можно вызвать из браузера с API-ключом:
 *   - OpenAI-совместимые (endpoint = api + '/chat/completions');
 *   - Anthropic-совместимые (endpoint = api + '/messages').
 * Пропускаем провайдеров с локальными/шаблонными адресами и сложной авторизацией
 * (azure, amazon-bedrock, google-vertex, watsonx, sap, gitlab, cohere, ollama-cloud и т.п.).
 * Модели: только чат-модели (выходная модальность — текст); free:true из нулевой цены.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = 'https://models.dev/api.json';
const OUT = fileURLToPath(new URL('../js/models.dev.js', import.meta.url));

/* SDK-форматы, которые наш браузерный код реально умеет вызывать. */
const ANTHROPIC = '@ai-sdk/anthropic';
/* Провайдеры, где даже при наличии api нужна подпись/особые заголовки — мимо. */
const SKIP_NPM = /azure|amazon-bedrock|cohere|google-vertex|sap|watsonx|gitlab|cloudflare|-gateway|@ai-sdk\/gateway|vercel|merge-gateway/i;

const mode = process.argv[2] || 'fetch';
let data;
if (mode === 'local') {
  const { readFileSync } = await import('node:fs');
  data = JSON.parse(readFileSync(new URL('../models.api.json', import.meta.url), 'utf8'));
} else {
  const r = await fetch(SRC, { headers: { 'user-agent': 'voicecomic/gen-models' } });
  if (!r.ok) throw new Error('models.dev ' + r.status);
  data = await r.json();
}

const out = {};
let nprov = 0, nmod = 0;

for (const id of Object.keys(data)) {
  const p = data[id];
  const api = (p.api || '').replace(/\/+$/, '');
  const npm = p.npm || '';
  let fmt = 'openai';
  if (npm === ANTHROPIC) fmt = 'anthropic';
  else if (SKIP_NPM.test(npm)) continue;
  const suffix = fmt === 'anthropic' ? '/messages' : '/chat/completions';
  const endpoint = api.startsWith('https://') && !api.includes('${')
    ? (api.endsWith(suffix) ? api : api + suffix)
    : '';
  const models = [];
  let vision = false; // хоть одна модель принимает изображения (image либо аналог)
  for (const mid of Object.keys(p.models || {})) {
    const m = p.models[mid];
    const om = (m.modalities && m.modalities.output) || [];
    if (om.length && !om.includes('text')) continue;
    const im = (m.modalities && m.modalities.input) || [];
    if (!vision && im.includes('image')) vision = true;
    const cost = m.cost;
    const free = !!(cost && cost.input === 0 && cost.output === 0);
    const label = m.name && m.name !== mid ? m.name : undefined;
    models.push(label ? [mid, free ? 1 : 0, label] : [mid, free ? 1 : 0]);
  }
  if (!models.length) continue;
  out[id] = { name: p.name || id, key: true, fmt, endpoint, vision: vision || undefined, models };
  nprov++;
  nmod += models.length;
}

const js =
  '/* АВТО-ГЕНЕРАЦИЯ из https://models.dev/api.json (данные opencode npm).\n' +
  ' * Обновлять: node tools/gen-models.mjs. Не редактировать вручную.\n' +
  ' * Формат модели: [id, free(0|1), label?] */\n' +
  'export const MODELS_DEV = ' + JSON.stringify(out) + ';\n';

writeFileSync(OUT, js, 'utf8');
console.log('providers:', nprov, 'models:', nmod, 'bytes:', js.length);