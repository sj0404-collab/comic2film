/* ================================================================
 * VoiceComic util — чистые функции (без зависимостей) 
 * + браузерные помощники. Чистые функции тестируются в Node.
 * ================================================================ */

export const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
export const WIN_EPOCH_SEC = 11644473600; // 1601-01-01 UTC → unix

export function pad2(n) { return n < 10 ? '0' + n : '' + n; }

/* Дата в формате edge-tts для заголовка X-Timestamp:
 * "Tue, 20 Sep 2026 12:00:00 GMT+0000" (RFC 1123 + часовой пояс).
 * Раньше здесь терялась запятая и к SSML-сообщению добавлялся лишний "Z"
 * после скобок — два несовместимых формата в одном соединении. */
export function nowEdgeString(d) {
  return (d || new Date()).toUTCString().replace('GMT', 'GMT+0000');
}

/* Количество секунд от 1601-01-01 (Windows file time секунды) */
export function windowsSeconds(msNow) { return msNow / 1000 + WIN_EPOCH_SEC; }

/* Строка для Sec-MS-GEC: нижняя граница 5-минутного окна в 100нс тиках + токен */
export function secMsgGecValue(msNow) {
  let s = windowsSeconds(msNow);
  s -= s % 300;
  const ticks = s * 1e7; // 100ns
  return `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
}

/* SHA-256 hex uppercase (browser, async) */
export async function sha256HexBrowser(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export function uuid() {
  // typeof, а не прямая проверка: в окружениях без globalThis.crypto
  // (старый Node, небезопасный контекст) обращение к crypto бросало ReferenceError
  if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  const rnd = (n) => {
    const b = new Uint8Array(n);
    if (typeof crypto !== 'undefined' && crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (let i = 0; i < n; i++) b[i] = Math.floor(Math.random() * 256);
    return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  };
  return rnd(16);
}

/* Экранирование текста для SSML + удаление недопустимых символов (как в edge-tts) */
export function ssmlEscape(text) {
  let s = String(text == null ? '' : text);
  const out = [];
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0 && c <= 8) || (c >= 11 && c <= 12) || (c >= 14 && c <= 31)) out.push(' ');
    else out.push(ch);
  }
  s = out.join('');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* Числовая сортировка имён файлов:  page001, page2, page10 */
export function numKey(str) {
  return String(str).replace(/(\d+)/g, (m) => String(m.length).padStart(2, '0') + m);
}
export function byNumName(a, b) { return numKey(a) < numKey(b) ? -1 : numKey(a) > numKey(b) ? 1 : 0; }

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'jfif'];
export const ARCH_EXT = ['zip', 'cbz', 'rar', 'cbr', 'tar', '7z'];
export const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'webm', 'mp4', 'mka'];
export const VIDEO_EXT = ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v'];
const IMG_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif', 'image/x-citrix-jpeg']);

export function extOf(name) { return (String(name).split('.').pop() || '').toLowerCase(); }
export function isImageFile(f) {
  if (f.type && IMG_MIME.has(f.type)) return true;
  return IMAGE_EXT.includes(extOf(f.name));
}
export function isArchiveFile(f) { return ARCH_EXT.includes(extOf(f.name)); }
export function isPdfFile(f) { return f.type === 'application/pdf' || extOf(f.name) === 'pdf'; }
export function isAudioFile(f) {
  const e = extOf(f.name);
  if (VIDEO_EXT.includes(e) || e === 'mp3' || f.type && f.type.startsWith('video')) return true;
  if (f.type && f.type.startsWith('audio')) return true;
  return AUDIO_EXT.includes(e);
}
export function isVideoFile(f) { return f.type && f.type.startsWith('video') || VIDEO_EXT.includes(extOf(f.name)); }

export function fmtBytes(n) {
  if (!n) return '0 Б';
  const u = ['Б', 'КБ', 'МБ', 'ГБ']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(1) : n) + ' ' + u[i];
}
export function fmtDur(sec) {
  sec = Math.max(0, sec || 0);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ':' + pad2(s);
}

/* ================================================================
 * Кластеризация слов (из OCR) в «пузыри» реплик.
 * words: [{x,y,w,h,text}] — union-find по близости боксов.
 * ================================================================ */
export function clusterBubbleWords(words, pageW, pageH) {
  const n = words.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { parent[find(a)] = find(b); };

  const thrX = Math.max(14, pageW * 0.055);
  const thrY = Math.max(12, pageH * 0.028);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = words[i], b = words[j];
      const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w));
      const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
      if (gapX < thrX && gapY < thrY) union(i, j);
    }
  }

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const g = find(i);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(words[i]);
  }

  const bubbles = [];
  for (const ws of groups.values()) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of ws) {
      minX = Math.min(minX, w.x); minY = Math.min(minY, w.y);
      maxX = Math.max(maxX, w.x + w.w); maxY = Math.max(maxY, w.y + w.h);
    }
    const sorted = ws.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    bubbles.push({
      rect: [minX, minY, maxX - minX, maxY - minY],
      x: minX, y: minY, w: maxX - minX, h: maxY - minY,
      text: sorted.map(w => w.text).join(' ').replace(/\s+/g, ' ').trim(),
      words: sorted,
    });
  }
  return bubbles;
}

/* ================================================================
 * Порядок чтения пузырей: строковые полосы по Y, затем по X.
 * rtl=true — манга (справа налево). vertical=true — колонки.
 * ================================================================ */
export function sortBubblesReadingOrder(bubbles, { rtl = false, vertical = false, cols = 2 } = {}) {
  if (!bubbles.length) return [];
  const arr = bubbles.map((b, i) => ({ b, i }));
  const pageW = Math.max(...arr.map(a => a.b.x + a.b.w)) || 1;
  const pageH = Math.max(...arr.map(a => a.b.y + a.b.h)) || 1;

  if (vertical) {
    // колонки: разбиение по X
    const col = (_b) => Math.floor(_b.x / (pageW / cols));
    arr.sort((a, z) => {
      const ca = col(a.b), cz = col(z.b);
      if (ca !== cz) return rtl ? cz - ca : ca - cz;
      return (a.b.y - z.b.y) || (a.b.x - z.b.x);
    });
  } else {
    const bands = 6;
    const band = (_b) => Math.min(bands - 1, Math.floor((_b.y + _b.h / 2) / (pageH / bands)));
    arr.sort((a, z) => {
      const ba = band(a.b), bz = band(z.b);
      if (ba !== bz) return ba - bz;
      return rtl ? (z.b.x + z.b.w) - (a.b.x + a.b.w) : (a.b.x - z.b.x);
    });
  }
  return arr.map(a => a.b);
}

/* Пауза после реплики (мс) по пунктуации и длине */
export function estimatePauseMs(text) {
  const t = String(text || '');
  const last = t.trim().slice(-1);
  let p = 220;
  if (last === '?' || last === '!' || last === '…') p += 140;
  else if (last === '.' || last === ';') p += 70;
  p += Math.min(220, t.length * 7);
  return p;
}

/* ================================================================
 * Работа с аудиосэмплами (Float32Array, −1..1)
 * ================================================================ */
export function trimSilence(samples, sr, { threshold = 0.02, margin = 0.09, winMs = 10 } = {}) {
  if (!samples) return { start: 0, end: 0 };
  const n = samples.length;
  const win = Math.max(1, Math.floor(sr * winMs / 1000));
  const padSamples = Math.max(1, Math.floor(sr * margin)); // запас в отсчётах, не в байтах
  const peak = (from, to) => { let m = 0; for (let i = from; i < to && i < n; i++) { const v = Math.abs(samples[i]); if (v > m) m = v; } return m; };
  let start = -1;
  for (let i = 0; i < n; i += win) { if (peak(i, i + win) > threshold) { start = Math.max(0, i - padSamples); break; } }
  if (start < 0) return { start: 0, end: 0 }; // тишина целиком
  let end = n;
  for (let i = n - win; i >= 0; i -= win) { if (peak(i, i + win) > threshold) { end = Math.min(n, i + win + padSamples); break; } }
  return { start, end };
}

/* Нарезка аудио на фразы по тишине: RMS-окна + автомат */
export function sliceSegments(samples, sr, { threshold = 0.02, winMs = 40, minSilence = 0.3, minClip = 0.35, maxClip = 15 } = {}) {
  const n = samples.length;
  const win = Math.max(1, Math.floor(sr * winMs / 1000));
  const steps = Math.floor(n / win);
  const activity = new Uint8Array(steps);
  for (let k = 0; k < steps; k++) {
    let sum = 0;
    const base = k * win;
    for (let i = base; i < base + win && i < n; i++) { const v = samples[i]; sum += v * v; }
    activity[k] = (sum / win) > threshold * threshold ? 1 : 0;
  }
  const segs = [];
  let inClip = false, cStart = 0, cEnd = 0, silence = 0;
  const minSil = Math.max(1, Math.floor(minSilence / (winMs / 1000)));
  for (let k = 0; k <= steps; k++) {
    const act = k < steps ? activity[k] : 0;
    if (act) {
      if (!inClip) { inClip = true; cStart = k; }
      silence = 0; cEnd = k;
    } else if (inClip) {
      silence++;
      if (silence >= minSil) {
        const s = cStart * win / sr, e = Math.min(n, (cEnd + 1) * win) / sr;
        if (e - s >= minClip) segs.push({ startS: s, endS: Math.min(e, s + maxClip) });
        inClip = false;
      }
    }
  }
  // сигнал закончился «активным» — вытолкнуть последний сегмент
  if (inClip) {
    const s = cStart * win / sr, e = Math.min(n, (cEnd + 1) * win) / sr;
    if (e - s >= minClip) segs.push({ startS: s, endS: Math.min(e, s + maxClip) });
  }
  return segs;
}

export function downsample(samples, sr, target) {
  if (sr <= target) return samples;
  const step = sr / target;
  const out = new Float32Array(Math.floor(samples.length / step));
  for (let i = 0; i < out.length; i++) out[i] = samples[Math.floor(i * step)];
  return out;
}

/* ================================================================
 * MP3 frame walker: Edge-TTS присылает аудио чанками, каждый чанк
 * начинается со служебных байт. Вокаем фреймы MPEG1/2 LayerIII,
 * вырезая «мусор» между фреймами. Чистая функция.
 * ================================================================ */
const MP3_BR_V1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_BR_V2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_SR_V1 = [44100, 48000, 32000];
const MP3_SR_V2s = [22050, 24000, 16000];
const MP3_SR_V25 = [11025, 12000, 8000];

export function cleanMp3Frames(bytes) {
  const out = [];
  let i = 0;
  const n = bytes.length;
  while (i < n - 4) {
    if ((bytes[i] & 0xff) === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const h = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
      const ver = (h >> 19) & 3;      // 0=V2.5, 1=res, 2=V2, 3=V1
      const layer = (h >> 17) & 3;    // 1=Layer III
      const brI = (h >> 12) & 0xf;
      const srI = (h >> 10) & 3;
      const pad = (h >> 9) & 1;
      if ((ver === 3 || ver === 2 || ver === 0) && layer === 1 && brI !== 0 && brI !== 0xf && srI !== 3) {
        let br, sr;
        if (ver === 3) {
          br = MP3_BR_V1[brI];
          sr = MP3_SR_V1[srI];
        } else if (ver === 2) {
          br = MP3_BR_V2[brI];
          sr = MP3_SR_V2s[srI];
        } else { // ver === 0 (V2.5)
          br = MP3_BR_V2[brI];
          sr = MP3_SR_V25[srI];
        }
        const len = Math.floor((ver === 3 ? 144 : 72) * br * 1000 / sr) + pad;
        if (br && sr && len > 0 && i + len <= n) {
          out.push(bytes.subarray(i, i + len));
          i += len;
          continue;
        }
      }
    }
    i++;
  }
  const total = out.reduce((s, a) => s + a.length, 0);
  const res = new Uint8Array(total);
  let p = 0;
  for (const a of out) { res.set(a, p); p += a.length; }
  return res;
}

/* ================================================================
 * Браузерные помощники
 * ================================================================ */
export function isBrowser() { return typeof window !== 'undefined' && typeof document !== 'undefined'; }

export function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

export function dataURLToBlob(durl) {
  const [meta, b64] = durl.split(',');
  const mime = (meta.match(/data:(.*?)(;|$)/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

const _loaderPromises = new Map();

export function loadScript(src) {
  if (_loaderPromises.has(src)) return _loaderPromises.get(src);
  const p = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => res();
    s.onerror = () => { _loaderPromises.delete(src); rej(new Error('Не удалось загрузить: ' + src)); };
    document.head.appendChild(s);
  });
  _loaderPromises.set(src, p);
  return p;
}

export function loadCss(href) {
  if (_loaderPromises.has(href)) return _loaderPromises.get(href);
  const p = new Promise((res, rej) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = () => res();
    l.onerror = () => { _loaderPromises.delete(href); rej(new Error('Не удалось загрузить: ' + href)); };
    document.head.appendChild(l);
  });
  _loaderPromises.set(href, p);
  return p;
}

export function toast(msg, kind = '') {
  if (!isBrowser()) return;
  let el = document.getElementById('toast');
  el.textContent = msg;
  el.className = kind;
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), kind === 'err' ? 6000 : 2800);
}

export function throttle(fn, ms) {
  let last = 0, timer = null;
  return (...a) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...a); }
    else { clearTimeout(timer); timer = setTimeout(() => { last = Date.now(); fn(...a); }, ms - (now - last)); }
  };
}