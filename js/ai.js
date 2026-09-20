/* ИИ-провайдеры: Pollinations (бесплатно, без ключа), Google Gemini (ключ,
 * есть бесплатный уровень), свой OpenAI-совместимый. Плюс функции «роли»
 * и «перевод» для сценария. */

export const POLLIMAGES = 'https://text.pollinations.ai';

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

/** chat — единая точка вызова.
 * settings: {ai:'pollinations'|'gemini'|'custom', key, aiurl, aimodel, aiGap}
 * messages: [{role, content}] — content может быть строкой или массивом частей.
 * opts: {json:bool, minGap:ms}
 */
export async function chat(settings, messages, opts = {}) {
  const model = settings.aimodel || 'openai';
  const gap = opts.minGap ?? settings.aiGap ?? 2500;
  if (settings.ai === 'gemini') return chatGemini(settings, messages, opts);
  if (settings.ai === 'custom') return chatCustom(settings, messages, opts);
  return chatPollinations(model, messages, { json: opts.json, gap });
}

async function chatPollinations(model, messages, { json = false, gap = 2500 } = {}) {
  const url = POLLIMAGES + '/openai';
  const body = { model, messages, temperature: settings_tmp(model, json) };
  if (json) body.response_format = { type: 'json_object' };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (await maybeCooldown(r, 15000)) { continue; }
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        throw new Error(`Pollinations ${r.status}: ${t.slice(0, 120)}`);
      }
      const j = await r.json();
      const out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
      if (json) { const parsed = parseJsonLoose(out); if (parsed) return parsed; }
      return out;
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(gap * (attempt + 1));
    }
  }
}

function settings_tmp(model, json) { return json ? 0.1 : 0.5; }

async function chatGemini(settings, messages) {
  const model = settings.aimodel || 'gemini-2.0-flash';
  const key = settings.key || '';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const parts = messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: parts }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}`);
  const j = await r.json();
  const t = j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  return t;
}

export async function chatGeminiVision(settings, imageDataURL, prompt) {
  const model = settings.aimodel || 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.key}`;
  const inline = imageDataURL.split(';base64,');
  const body = { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: inline[0].split(':')[1] || 'image/jpeg', data: inline[1] } }] }] };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini vision ${r.status}`);
  const j = await r.json();
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

async function chatCustom(settings, messages) {
  const url = settings.aiurl || '';
  if (!url) throw new Error('Не задан адрес OpenAI-совместимого API');
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(settings.key ? { Authorization: 'Bearer ' + settings.key } : {}) },
    body: JSON.stringify({ model: settings.aimodel || 'gpt-4o-mini', messages }),
  });
  if (!r.ok) throw new Error(`Custom ${r.status}`);
  const j = await r.json();
  return j.choices?.[0]?.message?.content || '';
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
  if (settings.ai === 'gemini') {
    out = await chatGeminiVision(settings, dataURL, prompt);
  } else {
    out = await chatPollinations(settings.aimodel || 'openai', [
      { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: dataURL } }] },
    ], { gap: settings.aiGap ?? 4000 });
  }
  const arr = parseJsonLoose(out);
  if (Array.isArray(arr)) return arr.filter(s => s && String(s).trim());
  return String(out).split('\n').map(s => s.trim()).filter(Boolean);
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