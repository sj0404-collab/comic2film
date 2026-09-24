/* ИИ-провайдеры: Pollinations (бесплатно, без ключа), Google Gemini (ключ,
 * есть бесплатный уровень), свой OpenAI-совместимый. Плюс функции «роли»
 * и «перевод» для сценария. */
import { MODELS_DEV } from './models.dev.js';

export const POLLIMAGES = 'https://text.pollinations.ai';

/* ================================================================
 * Каталог провайдеров и моделей.
 * free:true — бесплатная тарифом; key:false — работает вообще без ключа.
 * Единственный провайдер без ключа — Pollinations (tier=anonymous).
 * ================================================================ */
export const CURATED_PROVIDERS = {
  pollinations: {
    name: 'Pollinations · без ключа', key: false, openai: true, vision: true,
    endpoint: POLLIMAGES + '/openai',
    models: [
      { id: 'openai-fast', free: true },
      { id: 'openai', free: true },
      { id: 'gpt-oss', free: true },
      { id: 'gpt-oss-20b', free: true },
      { id: 'ovh-reasoning', free: true },
    ],
  },
  openrouter: {
    name: 'OpenRouter · free/paid', key: true, openai: true, vision: true, orchestrator: true,
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    headers: { 'HTTP-Referer': 'https://github.com/sj0404-collab/comic2film', 'X-Title': 'VoiceComic' },
    models: [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', free: true, label: 'Llama 3.3 70B (free)' },
      { id: 'google/gemma-3-27b-it:free', free: true, label: 'Gemma 3 27B (free)' },
      { id: 'deepseek/deepseek-chat-v3-0324:free', free: true, label: 'DeepSeek V3 (free)' },
      { id: 'qwen/qwen3-30b-a3b:free', free: true, label: 'Qwen3 30B (free)' },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
      { id: 'anthropic/claude-3.7-sonnet', label: 'Claude 3.7 Sonnet' },
      { id: 'openai/gpt-5.2', label: 'GPT-5.2' },
      { id: 'google/gemini-2.5-flash', free: false, label: 'Gemini 2.5 Flash' },
    ],
  },
  opencode: {
    name: 'OpenCode Zen · реальный шлюз', key: true, openai: true, vision: true, orchestrator: true,
    endpoint: 'https://opencode.ai/zen/v1/chat/completions',
    models: [
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-pro', label: 'GPT-5.4 Pro' },
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-opus-4-5', label: 'Claude Opus 4.5' },
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash' },
      { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro' },
      { id: 'grok-4.7', label: 'Grok 4.7' },
      { id: 'deepseek-v4-flash-vision-exp', label: 'DeepSeek V4 Flash Vision' },
      { id: 'qwen3.6-plus-free', free: true, label: 'Qwen3.6 Plus (free)' },
      { id: 'kimi-k2.5-free', free: true, label: 'Kimi K2.5 (free)' },
      { id: 'glm-5-free', free: true, label: 'GLM-5 (free)' },
      { id: 'minimax-m2.5-free', free: true, label: 'MiniMax M2.5 (free)' },
      { id: 'deepseek-v4-flash-free', free: true, label: 'DeepSeek V4 Flash (free)' },
    ],
  },
  openai: {
    name: 'OpenAI', key: true, openai: true,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    models: [
      { id: 'gpt-5.2', label: 'GPT-5.2' }, { id: 'gpt-5.2-mini', label: 'GPT-5.2 mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' }, { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' },
      { id: 'o4-mini', label: 'o4-mini' }, { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
  },
  anthropic: {
    name: 'Anthropic Claude', key: true, openai: false, anthropic: true,
    endpoint: 'https://api.anthropic.com/v1/messages',
    models: [
      { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
      { id: 'claude-3-7-sonnet-20250219', label: 'Claude 3.7 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', label: 'Claude 3.5 Haiku' },
    ],
  },
  gemini: {
    name: 'Google Gemini', key: true, openai: false, gemini: true,
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ],
  },
  groq: {
    name: 'Groq (free tier)', key: true, openai: true,
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    models: [
      { id: 'llama-3.3-70b-versatile', free: true, label: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant', free: true, label: 'Llama 3.1 8B Instant' },
      { id: 'gemma2-9b-it', free: true, label: 'Gemma 2 9B' },
      { id: 'qwen-qwq-32b', free: true, label: 'Qwen QwQ 32B' },
    ],
  },
  deepseek: {
    name: 'DeepSeek', key: true, openai: true,
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek-V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek-R1' },
    ],
  },
  mistral: {
    name: 'Mistral AI', key: true, openai: true,
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    models: [
      { id: 'open-mistral-nemo', label: 'Mistral NeMo' },
      { id: 'mistral-small-latest', label: 'Mistral Small' },
      { id: 'mistral-large-latest', label: 'Mistral Large' },
    ],
  },
  together: {
    name: 'Together AI', key: true, openai: true,
    endpoint: 'https://api.together.xyz/v1/chat/completions',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B' },
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
    ],
  },
  xai: {
    name: 'xAI Grok', key: true, openai: true,
    endpoint: 'https://api.x.ai/v1/chat/completions',
    models: [
      { id: 'grok-3', label: 'Grok 3' },
      { id: 'grok-3-mini', label: 'Grok 3 mini' },
    ],
  },
  perplexity: {
    name: 'Perplexity', key: true, openai: true,
    endpoint: 'https://api.perplexity.ai/chat/completions',
    models: [
      { id: 'sonar-pro', label: 'Sonar Pro' },
      { id: 'sonar', label: 'Sonar' },
    ],
  },
  cerebras: {
    name: 'Cerebras', key: true, openai: true,
    endpoint: 'https://api.cerebras.ai/v1/chat/completions',
    models: [
      { id: 'llama-3.3-70b', free: true, label: 'Llama 3.3 70B (free tier)' },
      { id: 'llama-3.1-8b-instant', free: true, label: 'Llama 3.1 8B (free tier)' },
    ],
  },
  custom: {
    name: 'Свой OpenAI-совместимый API', key: true, openai: true,
    endpoint: '', models: [],
  },
  local: {
    name: 'Local (Ollama / OpenWebUI)', key: true, openai: true,
    endpoint: 'http://localhost:11434/api/chat',
    models: [
      { id: 'llama3.1:8b', label: 'Llama 3.1 8B', free: true },
      { id: 'mistral:7b', label: 'Mistral 7B', free: true },
      { id: 'phi3:medium', label: 'Phi-3 Medium', free: true },
      { id: 'gemma2:9b', label: 'Gemma 2 9B', free: true },
    ],
  },
};

/* Полный каталог opencode (models.dev) + рукодельные записи поверх.
 * Рукодельные модели первыми (у них удобные подписи и точные free-флаги),
 * затем ВСЕ модели из models.dev, которых нет вручную. */
function catalog() {
  const all = {};
  for (const [id, p] of Object.entries(CURATED_PROVIDERS)) {
    all[id] = { ...p, curated: true, models: (p.models || []).map((m) => ({ ...m })) };
  }
  for (const [id, d] of Object.entries(MODELS_DEV)) {
    const mdev = (d.models || []).map((arr) => {
      const m = { id: arr[0] };
      if (arr[1] === 1) m.free = true;
      if (arr[2]) m.label = arr[2];
      return m;
    });
    if (all[id]) {
      const have = new Set(all[id].models.map((m) => m.id));
      for (const m of mdev) if (!have.has(m.id)) all[id].models.push(m);
      if (d.vision && !all[id].vision) all[id].vision = true;
    } else if (d.endpoint) {
      all[id] = {
        name: d.name,
        key: true,
        openai: d.fmt === 'openai',
        anthropic: d.fmt === 'anthropic',
        curated: false,
        endpoint: d.endpoint,
        vision: d.vision === true,
        models: mdev,
      };
    }
  }
  return all;
}

export const PROVIDERS = catalog();
export { MODELS_DEV } from './models.dev.js';

/* Где брать API-ключ у официальных провайдеров (их реальные сайты). */
export const PROVIDER_KEY_URL = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/app/apikey',
  openrouter: 'https://openrouter.ai/settings/keys',
  opencode: 'https://opencode.ai/zen',
  groq: 'https://console.groq.com/keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  mistral: 'https://console.mistral.ai/api-keys',
  together: 'https://api.together.ai/settings/api-keys',
  xai: 'https://console.x.ai/',
  perplexity: 'https://www.perplexity.ai/settings/api',
  cerebras: 'https://console.cerebras.ai/api-keys',
  custom: '',
  local: '',
};

/* Ссылка на страницу, где взять ключ. Для каталога models.dev — сайт
 * провайдера из его endpoint (реальный домен). */
export function providerKeyUrl(pid) {
  const p = provider(pid);
  if (p.key !== true) return '';
  if (pid in PROVIDER_KEY_URL) return PROVIDER_KEY_URL[pid];
  try {
    return new URL(p.endpoint).origin + '/';
  } catch (e) {
    return '';
  }
}

export function isOrchestrator(pid) {
  return provider(pid).orchestrator === true;
}

export function provider(id) { return PROVIDERS[id] || PROVIDERS.custom; }

export function isFreeModel(pid, mid) {
  const m = (provider(pid).models || []).find((x) => x.id === mid);
  return !!(m && (m.free || provider(pid).key === false));
}

export function providerNeedsKey(pid) { return provider(pid).key === true; }

/* Категория модели: 'free' (без затрат; включает без-ключ) или 'paid'. */
export function modelKind(pid, mid) {
  const p = provider(pid);
  if (p.key === false) return 'free';
  const m = (p.models || []).find((x) => x.id === mid);
  return m && m.free === true ? 'free' : 'paid';
}

/* Метаданные модели для пикера/фильтров. */
const SMART_KEYS = /reason|rational|thinking|thinker|opus|sonnet|pro$|ultra|max$|flash-thinking|r1|r2|qwq|\bo1\b|\bo2\b|\bo3\b|\bo4\b|grok-3|grok-4|deepseek-v4|deepseek-r1|deepseek-chat|glm-5|kimi-k3|qwen3-(235|430|max)|premium|200b|230b|235b|250b|300b|397b|400b|405b|430b|500b|545b|600b|671b|750b|1\.5-trillion|trillion/i;
const DUMB_KEYS = /\bmini\b|\blite\b|\blight\b|\bsmall\b|\btiny\b|\bfast\b|\bflash\b|\bhaiku\b|\binstant\b|\bnano\b|\bmicro\b|\bpico\b|\bsprint\b|\bcheap\b|\bquick\b|\bcompact\b|\bpixel\b|\b0\.\db\b|\b1\.5b\b|\b2b\b|\b3b\b|\b4b\b|\b7b\b|\b8b\b|\b9b\b|\b10b\b|\b12b\b|\b14b\b|\b18b\b|\b24b\b|\b27b\b|\b32b\b|\b33b\b|\b34b\b|\b35b\b|\b40b-a3b\b|\b56b-a3b\b|\b76b-a3b\b|\bgpt-oss-20b\b/i;

/* «Умные или глупые» по объёму/классу: числительные «70B» и выше считаем
 * умными, компактные имена (mini/flash/haiku/nano/…b) — быстрыми/глупыми. */
export function isSmartModel(pid, mid) {
  const p = provider(pid);
  const m = (p.models || []).find((x) => x.id === mid) || {};
  const s = (((m.label || '') + ' ' + mid) || '').toLowerCase();
  const numB = s.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (numB) return parseFloat(numB[1]) >= 32;
  if (DUMB_KEYS.test(s)) return false;
  if (SMART_KEYS.test(s)) return true;
  return true; // неопределённые каталоговые — считаем умными (оптимизм)
}

/* Метаданные модели для пикера/фильтров. */
export function modelMeta(pid, mid) {
  const p = provider(pid);
  const m = (p.models || []).find((x) => x.id === mid) || {};
  return {
    pid,
    mid,
    label: m.label || mid,
    providerName: (p.name || pid).split(' ·')[0],
    nokey: p.key === false,
    free: modelKind(pid, mid) === 'free',
    paid: modelKind(pid, mid) === 'paid',
    vision: p.vision === true,
    curated: p.curated === true,
    requiresKey: p.key === true,
    smart: isSmartModel(pid, mid),
    orchestrator: p.orchestrator === true,
  };
}

/* ================================================================
 * Живая проверка модели («отвечает ли реально»).
 * Статус кэшируется в MODEL_HEALTH на время сессии.
 * ================================================================ */
export const MODEL_HEALTH = new Map(); // `${pid}::${mid}` -> {ok,ms,err,ts}

export async function probeModel(settings, pid, mid) {
  const key = pid + '::' + mid;
  const s = { ...settings, ai: pid, aimodel: mid };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  const t0 = performance.now();
  try {
    await chat(s, [{ role: 'user', content: 'ping' }], { signal: ctl.signal, minGap: 0 });
    const res = { ok: true, ms: Math.round(performance.now() - t0), err: '', ts: Date.now() };
    MODEL_HEALTH.set(key, res);
    return res;
  } catch (e) {
    const res = { ok: false, ms: Math.round(performance.now() - t0), err: String((e && e.message) || e).slice(0, 140), ts: Date.now() };
    MODEL_HEALTH.set(key, res);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/* Умеет ли провайдер обрабатывать картинки (vision). */
export function providerHasVision(pid) {
  return provider(pid).vision === true;
}

/* Бесплатные модели Pollinations (tier=anonymous). Динамически обновляется. */
export const FREE_MODELS_FALLBACK = ['openai'];
export let FREE_MODELS = FREE_MODELS_FALLBACK.slice();

export async function refreshFreeModels() {
  try {
    const r = await fetch(POLLIMAGES + '/models');
    if (!r.ok) throw new Error('pollinations /models ' + r.status);
    const list = await r.json();
    const set = new Set();
    for (const m of Array.isArray(list) ? list : []) {
      if (m && m.tier === 'anonymous' && typeof m.name === 'string' && m.name) {
        set.add(m.name);
        for (const a of m.aliases || []) set.add(a);
      }
    }
    FREE_MODELS = set.size ? [...set] : FREE_MODELS_FALLBACK.slice();
  } catch (e) {
    FREE_MODELS = FREE_MODELS_FALLBACK.slice();
  }
  return FREE_MODELS.slice();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* Вытащить валидный JSON из ответа (иногда рядом текст) */
export function parseJsonLoose(s) {
  if (!s) return null;
  s = s.trim();
  try { return JSON.parse(s); } catch (e) { /* дальше ищем блок */ }
  const obj = s.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch (e) {} }
  const arr = s.match(/\[[\s\S]*\]/);
  if (arr) { try { return JSON.parse(arr[0]); } catch (e) {} }
  return null;
}

/* Проверка: надо ли подождать из-за лимитов Pollinations (429) */
async function maybeCooldown(res, cool) {
  if (res.status === 429) {
    await sleep(cool);
    return true;
  }
  return false;
}

/** chat — единая точка вызова для любого провайдера из каталога.
 * settings: {ai:'pollinations'|'openrouter'|'openai'|'anthropic'|'gemini'|..., key, aiurl, aimodel, aiGap}
 * messages: [{role, content}] — content может быть строкой или массивом частей.
 * opts: {json:bool, minGap:ms}
 */
export async function chat(settings, messages, opts = {}) {
  const p = provider(settings.ai);
  const model = settings.aimodel || (p.models[0] ? p.models[0].id : 'openai');
  settings = { ...settings, aimodel: model };
  if (p.gemini) return chatGemini(settings, messages, opts);
  if (p.anthropic) return chatAnthropic(settings, messages, opts);
  const endpoint = settings.ai === 'custom' ? (settings.aiurl || '') : p.endpoint;
  if (!endpoint) throw new Error('Свой провайдер: не задан адрес OpenAI-совместимого API');
  return openAICompat({
    name: (p.name || settings.ai).split(' ·')[0],
    endpoint,
    headers: p.headers || {},
    key: settings.key || '',
    model,
    messages: messagesWithImages(messages, opts.images),
    json: opts.json,
    gap: opts.minGap ?? settings.aiGap ?? 2500,
    signal: opts.signal,
  });
}

/* Превращает массив dataURL-картинок в OpenAI-совместимые parts */
function messagesWithImages(messages, images) {
  if (!images || !images.length) return messages;
  const img = images[0];
  const body = { type: 'image_url', image_url: { url: img && (img.dataURL || img) } };
  return messages.map(m => {
    if (m.role !== 'user') return m;
    if (typeof m.content === 'string') m.content = [{ type: 'text', text: m.content }];
    if (Array.isArray(m.content)) m.content = [...m.content, body];
    return m;
  });
}

/* Отправка картинки vision-провайдеру поверх текстового контекста */
export async function chatWithImage(settings, messages, imageDataURL) {
  settings = { ...settings, aimodel: settings.aimodel || provider(settings.ai).models[0]?.id || 'openai' };
  const p = provider(settings.ai);
  if (!p.vision) throw new Error('«' + (p.name || settings.ai) + '» не умеет смотреть изображения (выберите vision-провайдер)');
  const text = messages.filter(m => m.role !== 'system').map(m => (m.role === 'user' ? 'Пользователь: ' : 'ИИ: ') + m.content).join('\n');
  if (p.gemini) return chatGeminiVision(settings, imageDataURL, text);
  if (p.anthropic) return chatAnthropicVision(settings, imageDataURL, text);
  return openAICompat({
    name: (p.name || settings.ai).split(' ·')[0],
    endpoint: settings.ai === 'custom' ? (settings.aiurl || '') : p.endpoint,
    headers: p.headers || {},
    key: settings.key || '',
    model: settings.aimodel,
    messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: imageDataURL } }] }],
  });
}

/* Универсальный вызов OpenAI-совместимых API (Pollinations/OpenRouter/OpenAI/
 * Groq/DeepSeek/Mistral/Together/xAI/Perplexity/Cerebras/custom) с ретраями
 * при 429 и парсингом JSON-ответа. */
async function openAICompat({ name, endpoint, headers = {}, key = '', model, messages, json = false, gap = 2500, signal }) {
  const body = { model, messages, temperature: settings_tmp(model, json) };
  if (json) body.response_format = { type: 'json_object' };
  const hd = { 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}), ...headers };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: hd, body: JSON.stringify(body), signal });
      if (await maybeCooldown(r, 15000)) continue;
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`${name} ${r.status}: ${t.slice(0, 180)}`);
      }
      const j = await r.json();
      let out = (j.choices && j.choices[0] && (j.choices[0].message || {}).content) || '';
      if (json) { const parsed = parseJsonLoose(typeof out === 'string' ? out : JSON.stringify(out)); if (parsed) return parsed; }
      return out;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt === 3) throw e;
      await sleep(gap * (attempt + 1));
    }
  }
}

function settings_tmp(model, json) { return json ? 0.1 : 0.5; }

async function chatGemini(settings, messages, opts = {}) {
  const model = settings.aimodel || 'gemini-2.0-flash';
  const key = settings.key || '';
  if (!key) throw new Error('Gemini: нужен API-ключ');
  const gap = opts.minGap ?? settings.aiGap ?? 2500;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const parts = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const img = opts.images && opts.images[0];
  if (img && parts.length) {
    const d = img.dataURL || img;
    const inl = d.split(';base64,');
    parts[parts.length - 1].parts.push({ inline_data: { mime_type: inl[0].split(':')[1] || 'image/jpeg', data: inl[1] } });
  }
  let attempt = 0;
  while (true) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: parts }), signal: opts.signal });
      if (await maybeCooldown(r, 15000)) continue;
      if (!r.ok) throw new Error(`Gemini ${r.status}`);
      const j = await r.json();
      return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt === 3) throw e;
      attempt++;
      await sleep(gap * attempt);
    }
  }
}

async function chatAnthropic(settings, messages, opts = {}) {
  const model = settings.aimodel || 'claude-sonnet-4-5';
  const key = settings.key || '';
  if (!key) throw new Error('Anthropic: нужен API-ключ');
  const welcome = provider(settings.ai);
  const endpoint = settings.ai === 'custom' ? (settings.aiurl || '') : welcome.endpoint;
  const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  let bodyMsgs = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const img = opts.images && opts.images[0];
  if (img && bodyMsgs.length) {
    const d = img.dataURL || img;
    const inl = d.split(';base64,');
    const mime = inl[0].split(':')[1] || 'image/jpeg';
    const content = typeof bodyMsgs[bodyMsgs.length - 1].content === 'string'
      ? [{ type: 'text', text: bodyMsgs[bodyMsgs.length - 1].content }]
      : bodyMsgs[bodyMsgs.length - 1].content;
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: inl[1] } });
    bodyMsgs[bodyMsgs.length - 1].content = content;
  }
  const body = { model, max_tokens: 4096, messages: bodyMsgs };
  if (sys) body.system = sys;
  const gap = opts.minGap ?? settings.aiGap ?? 2500;
  let attempt = 0;
  while (true) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
      if (await maybeCooldown(r, 15000)) continue;
      if (!r.ok) throw new Error(`Claude ${r.status}`);
      const j = await r.json();
      let out = (j.content || []).map(x => x.text).join('') || '';
      if (opts.json) { const parsed = parseJsonLoose(out); if (parsed) return parsed; }
      return out;
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      if (attempt === 3) throw e;
      attempt++;
      await sleep(gap * attempt);
    }
  }
}

export async function chatGeminiVision(settings, imageDataURL, prompt) {
  const key = settings.key || '';
  if (!key) throw new Error('Gemini: нужен API-ключ (Опции → ИИ-провайдер → ключ)');
  const model = settings.aimodel || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const inline = imageDataURL.split(';base64,');
  const body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: inline[0].split(':')[1] || 'image/jpeg', data: inline[1] } }] }] };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini vision ${r.status}`);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

/* ================================================================
 * Высокоуровневые помощники
 * ================================================================ */

/* OCR страницы через vision-провайдера (позиции без bbox, поэтому строки
 * раскладываем в «пузыри» по порядку). */
export async function visionExtractLines(settings, dataURL, langName) {
  const prompt =
    `Прочитай весь текст на этом изображении (${langName}). Это страница манги/комикса. ` +
    `Верни строго JSON массив строк в том порядке, в котором их нужно читать. ` +
    `Внутри double quotes. Не добавляй ничего кроме JSON.`;
  let out;
  const p = provider(settings.ai);
  if (p.gemini) {
    out = await chatGeminiVision(settings, dataURL, prompt);
  } else if (p.anthropic) {
    out = await chatAnthropicVision(settings, dataURL, prompt);
  } else {
    const parts = [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataURL } }];
    out = await openAICompat({
      name: (p.name || 'API').split(' ·')[0],
      endpoint: settings.ai === 'custom' ? (settings.aiurl || '') : p.endpoint,
      headers: p.headers || {},
      key: settings.key || '',
      model: settings.aimodel || 'openai',
      messages: [{ role: 'user', content: parts }],
      gap: settings.aiGap ?? 4000,
    });
  }
  const arr = parseJsonLoose(out);
  if (Array.isArray(arr)) return arr.filter(s => s && String(s).trim());
  return String(out).split('\n').map(s => s.trim()).filter(Boolean);
}

async function chatAnthropicVision(settings, dataURL, prompt) {
  const key = settings.key || '';
  if (!key) throw new Error('Claude: нужен API-ключ');
  const m = dataURL.match(/^data:([^;]+);base64,(.*)$/s);
  const parts = [{ type: 'text', text: prompt }];
  if (m) parts.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  else parts.push({ type: 'image', source: { type: 'url', url: dataURL } });
  const p = provider(settings.ai);
  const endpoint = settings.ai === 'custom' ? (settings.aiurl || '') : p.endpoint;
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: settings.aimodel || 'claude-sonnet-4-5', max_tokens: 4096, messages: [{ role: 'user', content: parts }] }),
  });
  if (!r.ok) throw new Error(`Claude vision ${r.status}`);
  const j = await r.json();
  return (j.content || []).map(x => x.text).join('') || '';
}

/* Раздать роли: вход — реплики [{idx, page, text}] */
export async function analyzeRoles(settings, lines) {
  const items = lines.map((l, idx) => ({ idx, text: l.text }));
  const sys = 'Ты — режиссёр озвучки манги/комикса. По репликам определи говорящих. ' +
    'Верни строго JSON без пояснений: {"characters":[{"name":"...","gender":"male|female|other"}], ' +
    '"lines":[{"idx":0,"character":"имя из characters"}]}. Если говорящий неясен — character: "Нарратор".';
  const out = await chat(settings, [
    { role: 'system', content: sys },
    { role: 'user', content: 'Реплики (JSON): ' + JSON.stringify(items) },
  ], { json: true, minGap: 6000 });
  const parsed = parseJsonLoose(typeof out === 'string' ? out : JSON.stringify(out));
  return parsed && parsed.lines ? { roles: parsed.characters || [], items: parsed.lines } : null;
}

/* Перевод реплик батчами */
export async function translateLines(settings, lines, toLang) {
  const out = new Array(lines.length);
  const B = 30;
  for (let i = 0; i < lines.length; i += B) {
    const batch = lines.slice(i, i + B).map((l, k) => ({ idx: i + k, text: l.text }));
    const sys = `Ты — профессиональный переводчик манги/комиксов. Переведи реплики на язык: ${toLang}. ` +
      `Сохрани смысл обращений/имён. Верни строго JSON: [{"idx":0,"text":"..."}]`;
    const outText = await chat(settings, [
      { role: 'system', content: sys },
      { role: 'user', content: 'Реплики: ' + JSON.stringify(batch) },
    ], { json: true, minGap: 4000 });
    const parsed = parseJsonLoose(typeof outText === 'string' ? outText : JSON.stringify(outText));
    if (!Array.isArray(parsed)) throw new Error('API вернул не JSON: ' + String(outText).slice(0, 120));
    for (const it of parsed) out[it.idx] = it.text;
    await sleep(300);
  }
  return out;
}