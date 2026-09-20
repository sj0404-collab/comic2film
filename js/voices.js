/* Edge-TTS из браузера (WSS), каталог голосов, speechSynthesis-фолбэк. */

import {
  TRUSTED_CLIENT_TOKEN, nowEdgeString, secMsgGecValue, sha256HexBrowser, uuid,
  ssmlEscape, cleanMp3Frames,
} from './util.js';

const BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const CHROMIUM = '143.0.3650.75';

/* ================================================================
 * Каталог голосов (курируемый; полный список можно догрузить с Microsoft)
 * ================================================================ */
const V = (id, gender = 'm') => ({ id, lang: id.slice(0, 5), gender });
export const EDGE_VOICES = [

  // Русский
  V('ru-RU-DmitryNeural', 'm'), V('ru-RU-SvetlanaNeural', 'f'),
  V('ru-RU-DariyaNeural', 'f'), V('ru-RU-PavelNeural', 'm'),

  // English (US/GB/IN/AU/CA)
  V('en-US-ChristopherNeural', 'm'), V('en-US-JennyNeural', 'f'), V('en-US-GuyNeural', 'm'),
  V('en-US-AriaNeural', 'f'), V('en-US-EmmaMultilingualNeural', 'f'), V('en-US-AndrewNeural', 'm'),
  V('en-US-BrianNeural', 'm'), V('en-US-AmyNeural', 'f'), V('en-US-MichelleNeural', 'f'),
  V('en-US-RogerNeural', 'm'), V('en-US-SteffanNeural', 'm'), V('en-US-AnaNeural', 'f'),
  V('en-GB-SoniaNeural', 'f'), V('en-GB-RyanNeural', 'm'), V('en-GB-ThomasNeural', 'm'),
  V('en-GB-LibbyNeural', 'f'), V('en-GB-MaisieNeural', 'f'), V('en-GB-NoahNeural', 'm'),
  V('en-GB-OliverNeural', 'm'), V('en-GB-OliviaNeural', 'f'), V('en-AU-NatashaNeural', 'f'),
  V('en-AU-WilliamNeural', 'm'), V('en-CA-ClaraNeural', 'f'), V('en-CA-LiamNeural', 'm'),
  V('en-IN-NeerjaNeural', 'f'), V('en-IN-PrabhatNeural', 'm'), V('en-IE-EmilyNeural', 'f'),
  V('en-IE-ConnorNeural', 'm'), V('en-NZ-MollyNeural', 'f'), V('en-NZ-MitchellNeural', 'm'),

  // Українська
  V('uk-UA-PolinaNeural', 'f'), V('uk-UA-OstapNeural', 'm'),

  // Deutsch
  V('de-DE-KatjaNeural', 'f'), V('de-DE-ConradNeural', 'm'), V('de-DE-AmalaNeural', 'f'),
  V('de-DE-BerndNeural', 'm'), V('de-DE-ChristophNeural', 'm'), V('de-AT-IngridNeural', 'f'),
  V('de-AT-JonasNeural', 'm'), V('de-CH-LeniNeural', 'f'), V('de-CH-JanNeural', 'm'),

  // Français
  V('fr-FR-DeniseNeural', 'f'), V('fr-FR-HenriNeural', 'm'), V('fr-FR-EloiseNeural', 'f'),
  V('fr-FR-RemyNeural', 'm'), V('fr-CA-SylvieNeural', 'f'), V('fr-CA-JeanNeural', 'm'),

  // Español / mex
  V('es-ES-ElviraNeural', 'f'), V('es-ES-AlvaroNeural', 'm'), V('es-MX-DaliaNeural', 'f'),
  V('es-MX-JorgeNeural', 'm'), V('es-AR-ElenaNeural', 'f'), V('es-AR-TomasNeural', 'm'),

  // Italiano
  V('it-IT-ElsaNeural', 'f'), V('it-IT-IsabellaNeural', 'f'), V('it-IT-DiegoNeural', 'm'),

  // Português
  V('pt-BR-FranciscaNeural', 'f'), V('pt-BR-AntonioNeural', 'm'), V('pt-PT-RaquelNeural', 'f'),
  V('pt-PT-DuarteNeural', 'm'),

  // Polski
  V('pl-PL-ZofiaNeural', 'f'), V('pl-PL-MarekNeural', 'm'),

  // Türkçe
  V('tr-TR-EmelNeural', 'f'), V('tr-TR-AhmetNeural', 'm'),

  // العربية
  V('ar-SA-ZariyahNeural', 'f'), V('ar-SA-HamedNeural', 'm'), V('ar-EG-SalmaNeural', 'f'),

  // עברית
  V('he-IL-HilaNeural', 'f'), V('he-IL-AvriNeural', 'm'),

  // 日本語
  V('ja-JP-NanamiNeural', 'f'), V('ja-JP-KeitaNeural', 'm'),

  // 한국어
  V('ko-KR-SunHiNeural', 'f'), V('ko-KR-InJoonNeural', 'm'),

  // 中文
  V('zh-CN-XiaoxiaoNeural', 'f'), V('zh-CN-YunxiNeural', 'm'), V('zh-CN-YunyangNeural', 'm'),
  V('zh-CN-XiaoyiNeural', 'f'), V('zh-TW-HsiaoChenNeural', 'f'), V('zh-TW-YunJheNeural', 'm'),

  // हिन्दी
  V('hi-IN-SwaraNeural', 'f'), V('hi-IN-MadhurNeural', 'm'),

  // Nederlands, svenska, norsk, dansk, suomi, čeština, ελληνικά, magyar, română
  V('nl-NL-ColetteNeural', 'f'), V('nl-NL-FennaNeural', 'f'), V('nl-NL-MaartenNeural', 'm'),
  V('sv-SE-SofieNeural', 'f'), V('sv-SE-MattiasNeural', 'm'),
  V('nb-NO-PernilleNeural', 'f'), V('nb-NO-FinnNeural', 'm'),
  V('da-DK-ChristelNeural', 'f'), V('da-DK-JeppeNeural', 'm'),
  V('fi-FI-SelmaNeural', 'f'), V('fi-FI-HarriNeural', 'm'),
  V('cs-CZ-VlastaNeural', 'f'), V('cs-CZ-AntoninNeural', 'm'),
  V('el-GR-AthinaNeural', 'f'), V('el-GR-NestorasNeural', 'm'),
  V('hu-HU-NoemiNeural', 'f'), V('hu-HU-TamasNeural', 'm'),
  V('ro-RO-AlinaNeural', 'f'), V('ro-RO-EmilNeural', 'm'),
  V('vi-VN-HoaiMyNeural', 'f'), V('vi-VN-NamMinhNeural', 'm'),
  V('th-TH-PremwadeeNeural', 'f'), V('th-TH-NiwatNeural', 'm'),
  V('id-ID-GadisNeural', 'f'), V('id-ID-ArdiNeural', 'm'),
];

const extra = new Map(); // путь — страна из полного списка сервера
export function registerFetchedVoices(list) {
  for (const v of list || []) {
    if (v.ShortName && /Neural$/.test(v.ShortName)) {
      extra.set(v.ShortName, { id: v.ShortName, lang: (v.Locale || v.ShortName.slice(0, 5)), gender: (v.Gender || '').toLowerCase().startsWith('f') ? 'f' : 'm' });
    }
  }
}
export function allVoices() {
  const known = new Set(EDGE_VOICES.map(v => v.id));
  const merged = EDGE_VOICES.slice();
  for (const [, v] of extra) if (!known.has(v.id)) merged.push(v);
  return merged;
}
export function voicesForLang(langPrefix) {
  const p = String(langPrefix || '').toLowerCase();
  return allVoices().filter(v => v.lang.toLowerCase().startsWith(p));
}
export function voiceById(id) { return allVoices().find(v => v.id === id) || null; }

/* Полный список с сервера Microsoft (работает без ключа) */
export async function fetchVoicesFromMicrosoft() {
  const token = await secMsToken();
  const url = `https://${BASE}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-${CHROMIUM}`;
  const r = await fetch(url, { headers: { 'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM.split('.')[0]}.0.0.0`, 'Accept-Language': 'en-US,en;q=0.9' } });
  if (!r.ok) throw new Error('voices/list ' + r.status);
  const list = await r.json();
  registerFetchedVoices(list);
  return list;
}

async function secMsToken() { return sha256HexBrowser(secMsgGecValue(Date.now())); }

/* ================================================================
 * Синтез Edge-TTS
 * ================================================================ */
function SSML(voice, text, { pitch = '+0Hz', rate = '+0%', volume = '+0%', style } = {}) {
  const esc = ssmlEscape(text);
  const p = `<prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>${esc}</prosody>`;
  if (style) {
    return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>` +
      `<voice name='${voice}'><mstts:express-as style='${style}' styledegree='1'>${p}</mstts:express-as></voice></speak>`;
  }
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>${p}</voice></speak>`;
}

export async function edgeTTSSynth(text, { voice = 'ru-RU-DmitryNeural', pitch = '+0Hz', rate = '+0%', volume = '+0%', style } = {}) {
  const requestId = uuid();
  const token = await secMsToken();
  const url = `wss://${BASE}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&ConnectionId=${requestId}&Sec-MS-GEC=${token}&Sec-MS-GEC-Version=1-${CHROMIUM}`;

  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(url); // БЕЗ subprotocol — иначе сервер отвечает 403
    } catch (e) { return reject(e); }
    ws.binaryType = 'arraybuffer';

    const chunks = [];
    const boundary = [];
    let timer = setTimeout(() => fail(new Error('Тайм-аут синтеза (проверьте интернет)')), 65000);
    let ended = false;

    function finish() {
      clearTimeout(timer);
      const combined = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let p = 0; for (const c of chunks) { combined.set(c, p); p += c.length; }
      const mp3 = cleanMp3Frames(combined);
      resolve({ blob: new Blob([mp3], { type: 'audio/mpeg' }), boundary });
      try { ws.close(); } catch (e) {}
    }
    function fail(err) {
      if (ended) return; ended = true;
      clearTimeout(timer);
      try { ws.close(); } catch (e) {}
      reject(err);
    }

    ws.onerror = () => fail(new Error('Edge-TTS: сеть недоступна или сервер не ответил'));
    ws.onopen = () => {
      ws.send(`X-Timestamp:${nowEdgeString()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`);
      ws.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${nowEdgeString()}Z\r\nPath:ssml\r\n\r\n` +
        SSML(voice, text, { pitch, rate, volume, style }));
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        const s = ev.data;
        if (s.includes('audio.metadata')) {
          const body = s.slice(s.indexOf('\r\n\r\n') + 4);
          try {
            for (const m of JSON.parse(body).Metadata) {
              if (m.Type === 'WordBoundary') {
                boundary.push({ offsetMs: m.Data.Offset / 10000, durMs: m.Data.Duration / 10000, text: m.Data.text.Text });
              }
            }
          } catch (e) {}
        }
        if (s.includes('Path:turn.end') && !ended) { ended = true; finish(); }
        if (/Path:response/.test(s) && s.includes('path>false')) fail(new Error('Edge-TTS отклонил запрос (неверный голос)'));
      } else if (ev.data instanceof ArrayBuffer) {
        const buf = new Uint8Array(ev.data);
        if (buf.length >= 2) {
          const hl = (buf[0] << 8) | buf[1];
          chunks.push(buf.subarray(2 + hl + 2));
        }
      } else if (ev.data instanceof Blob) {
        ev.data.arrayBuffer().then((ab) => {
          const buf = new Uint8Array(ab); chunks.push(buf.subarray(0));
        });
      }
    };
  });
}

/* Прокси-режим: свой сервер с edge-tts (POST JSON или GET query) */
export async function edgeTTSProxy(settings, text, opts) {
  const proxy = (settings.proxy || '').trim();
  if (!proxy) throw new Error('Укажите URL прокси Edge-TTS');
  const q = new URLSearchParams({ text, voice: opts.voice || 'ru-RU-DmitryNeural', ...(opts.rate ? { rate: opts.rate } : {}), ...(opts.pitch ? { pitch: opts.pitch } : {}), ...(opts.volume ? { volume: opts.volume } : {}) });
  try {
    const r1 = await fetch(proxy.includes('?') ? proxy + '&' + q.toString() : proxy + '?' + q.toString());
    if (r1.ok) { const ab = await r1.arrayBuffer(); return { blob: new Blob([ab], { type: r1.headers.get('content-type') || 'audio/mpeg' }), boundary: [] }; }
  } catch (e) {}
  const r2 = await fetch(proxy, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: opts.voice, pitch: opts.pitch, rate: opts.rate, volume: opts.volume }) });
  if (!r2.ok) throw new Error('Edge-прокси ' + r2.status);
  const ab = await r2.arrayBuffer();
  return { blob: new Blob([ab], { type: 'audio/mpeg' }), boundary: [] };
}

/* Диспетчер синтеза по настройкам */
export async function synthesizeLine(settings, text, opts) {
  const backend = (settings.voiceBackend || 'edge').trim();
  if (backend === 'edge-proxy') return edgeTTSProxy(settings, text, opts);
  if (backend === 'browser') {
    return { browser: true, play: () => browserSpeak(text, opts.voice) };
  }
  return edgeTTSSynth(text, opts);
}

export function browserSpeak(text, voiceName, { rate = 1, pitch = 1, volume = 1 } = {}) {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find(v => v.name === voiceName);
    if (v) u.voice = v;
    u.lang = voiceName ? voiceName.slice(0, 5) : 'ru-RU';
    u.rate = rate; u.pitch = pitch; u.volume = volume;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}