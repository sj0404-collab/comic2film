/* Движок монтажа: таймлайн, декодирование аудио, рендер кадров
 * (Ken Burns + реплики/субтитры), MediaRecorder (WebM) и ffmpeg.wasm
 * (MP4/GIF). Плюс экспорт аудио-дорожки. */

import {
  trimSilence, download, fmtDur, loadImage, fmtBytes,
} from './util.js';

/* ffmpeg.wasm без сборщика: только ESM-дистрибутив.
 * UMD-сборку (@ffmpeg/ffmpeg/dist/umd) использовать нельзя: её глобальное
 * имя — FFmpegWASM, а не FFmpeg, и её воркер создаётся через
 * new Worker(new URL(<publicPath>/814.ffmpeg.js)) на кросс-доменном CDN-URL,
 * что браузер запрещает (SecurityError). ESM-сборка экспортирует FFmpeg и
 * умеет classWorkerURL — воркер и ядро отдаём blob-URL (наследуют origin
 * страницы), а ядро обязательно ESM: в UMD-ядре нет `export default`, который
 * ждёт воркер, и загрузка падает с ERROR_IMPORT_FAILURE. */
const FF_ESM = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/index.js';
const FF_WORKER = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/dist/esm/worker.js';
const FF_CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm';

/* Параметры обрезки тишины — единый источник истины для рендера и для
 * измерения длительности озвучки (иначе таймлайн считает по полному блобу,
 * а звучит обрезанный кусок, и реплики расходятся с картинкой). */
export const TRIM = { threshold: 0.012, margin: 0.05, minDur: 0.25 };

export function estimateSpeakDur(text) {
  const t = String(text || '');
  if (!t.trim()) return 0;
  return Math.max(1.1, Math.min(14, t.length / 13 + 0.55)) + (/\s/.test(t) ? 0.15 : 0);
}

/* Длительность того, что реально прозвучит: блоб с обрезанной по краям
 * тишиной. Возвращает null, если декодировать не удалось. */
export async function measureTrimmedDuration(actx, blob) {
  try {
    const buf = await actx.decodeAudioData(await blob.arrayBuffer());
    const ch = buf.getChannelData(0);
    const { start, end } = trimSilence(ch, buf.sampleRate, TRIM);
    const dur = end > start ? (end - start) / buf.sampleRate : buf.duration;
    return dur > 0.05 ? Math.max(TRIM.minDur, dur) : null;
  } catch (e) {
    return null;
  }
}

/* Громкость роли. Слайдер пишет volumeNum (100 = единичная громкость),
 * а строка вида '+0%' теряла знак и превращалась в 0.9. Приоритет у числа,
 * строка — только для старых проектов. */
export function roleGain(role) {
  if (!role) return 1;
  let pct = null;
  if (typeof role.volumeNum === 'number' && isFinite(role.volumeNum)) {
    pct = role.volumeNum;
  } else {
    const m = /^\s*([+-]?\d+(?:\.\d+)?)\s*%\s*$/.exec(String(role.volume || ''));
    if (m) pct = 100 + parseFloat(m[1]);
  }
  if (pct == null) return 1;
  return Math.max(0, Math.min(2, pct / 100));
}

/* ================================================================
 * Таймлайн
 * ================================================================ */
export function buildTimeline(project) {
  const s = project.settings || {};
  const gap = (s.gap != null ? s.gap : 350) / 1000;
  const items = [];
  let t = 0;
  project.pages.forEach((page, pi) => {
    const bubbles = page.bubbles || [];
    if (!bubbles.length) {
      items.push({ page, pi, bubble: null, t, dur: 1.8, kind: 'idle' });
      t += 1.8;
      return;
    }
    t += 0.55; // заезд на страницу
    bubbles.forEach((b, bi) => {
      t += bi === 0 ? 0.25 : gap;
      // b.audio.duration уже измерена по обрезанному куску (measureTrimmedDuration),
      // поэтому рамка реплики совпадает с тем, что реально прозвучит.
      const dur = b.audio && b.audio.duration ? b.audio.duration : estimateSpeakDur(b.text);
      items.push({ page, pi, bubble: b, t, dur, kind: 'line' });
      t += dur;
      t += gap * 0.6;
    });
    t += 0.5; // стоп-кадр перед следующей страницей
  });
  const total = t + 0.9;
  return { items, total };
}

/* ================================================================
 * Аудио: декод + обрезка тишины, схема воспроизведения
 * ================================================================ */
async function decodeToBuffer(actx, blob) {
  const arr = await blob.arrayBuffer();
  const buf = await actx.decodeAudioData(arr.slice(0));
  return buf;
}

async function trimmedPlayRange(actx, blob) {
  const buf = await decodeToBuffer(actx, blob);
  const src = buf.getChannelData(0);
  const { start, end } = trimSilence(src, buf.sampleRate, TRIM);
  const off = start / buf.sampleRate;
  const dur = Math.max(TRIM.minDur, (end - start) / buf.sampleRate);
  return { buffer: buf, offset: off, dur };
}

async function makePartBuffer(actx, blob, useTrim) {
  if (!useTrim) { const buffer = await decodeToBuffer(actx, blob); return { buffer, offset: 0, dur: buffer.duration }; }
  return trimmedPlayRange(actx, blob);
}

/* Линейная передискретизация моно-канала между двумя частотами.
 * Нужно, т.к. Edge-TTS отдаёт 24 кГц, а дорожка микшируется в 44.1 кГц. */
export function resampleLinear(src, fromSr, toSr) {
  if (!(fromSr > 0 && toSr > 0) || fromSr === toSr) return src;
  const n = Math.max(0, Math.floor(src.length * toSr / fromSr));
  const out = new Float32Array(n);
  if (!src.length || !n) return out;
  const step = fromSr / toSr;
  for (let i = 0; i < n; i++) {
    const pos = i * step;
    const i0 = Math.min(Math.floor(pos), src.length - 1);
    const i1 = Math.min(src.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = src[i0] + (src[i1] - src[i0]) * frac;
  }
  return out;
}

/* ================================================================
 * Видео
 * ================================================================ */
const _imgCache = new Map();   // url -> HTMLImageElement (после загрузки)
const _imgLoading = new Map(); // url -> Promise<HTMLImageElement|null>

function pageImg(url) {
  if (_imgCache.has(url)) return _imgCache.get(url);
  if (!_imgLoading.has(url)) {
    _imgLoading.set(url, loadImage(url)
      .then(img => { _imgCache.set(url, img); return img; })
      .catch(() => null));
  }
  return _imgLoading.get(url);
}
function pageImgSync(url) { return _imgCache.get(url) || null; }

const smooth = (a) => a * a * (3 - 2 * a); // smoothstep

function cameraFor(item, clock, P, C, zoomMode) {
  const pw = P.w || 1, ph = P.h || 1;
  const W = C.w, H = C.h;
  const cover = Math.max(W / pw, H / ph);
  const cx = pw / 2, cy = ph / 2;
  const clampV = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  if (item.bubble && zoomMode !== 'none') {
    const b = item.bubble;
    const bC2x = b.x + b.w / 2, bC2y = b.y + b.h / 2;
    if (zoomMode === 'pan') {
      // панорама к реплике с зумом 1.15
      const crop = cover * 1.15;
      const vw = W / crop, vh = H / crop;
      const sx2 = clampV(bC2x - vw / 2, 0, Math.max(0, pw - vw));
      const sy2 = clampV(bC2y - vh / 2, 0, Math.max(0, ph - vh));
      return { sx: sx2, sy: sy2, sw: vw, sh: vh, zoom: crop };
    }
    const prog = item.dur > 0 ? smooth(Math.min(1, (clock - item.t) / item.dur)) : 0;
    const zoomFrom = cover * 1.2, zoomTo = cover * Math.max(1, Math.min(2.6, Math.max(W / (b.w * 1.3 + 1), H / (b.h * 1.3 + 1))));
    const crop = zoomFrom + (zoomTo - zoomFrom) * prog;
    const vw = W / crop, vh = H / crop;
    const sx = clampV(bC2x - vw / 2, 0, Math.max(0, pw - vw));
    const sy = clampV(bC2y - vh / 2, 0, Math.max(0, ph - vh));
    return { sx, sy, sw: vw, sh: vh, zoom: crop };
  }

  // idle / статично: панорама по странице
  const z = zoomMode === 'none' ? cover : cover * 1.12;
  const vw = W / z, vh = H / z;
  let sx = cx - vw / 2, sy = cy - vh / 2;
  if (zoomMode === 'pan' || zoomMode === 'smart') {
    // движение сверху вниз / слева направо по фазе
    const phase = item.t === undefined ? 0.5 : smooth(Math.min(1, Math.max(0, (clock - item.t) / (item.dur || 1))));
    if (ph > pw * 1.2 || ph > 1.2 * pw) { const r = Math.max(0, ph - vh); sy = clampV(((phase - 0.5) * 2) * r * 0.6 + cy - vh / 2, 0, r); }
    else { const r = Math.max(0, pw - vw); sx = clampV((phase - 0.5) * 2 * r * 0.8 + cx - vw / 2, 0, r); }
  }
  sx = clampV(sx, 0, Math.max(0, pw - vw));
  sy = clampV(sy, 0, Math.max(0, ph - vh));
  return { sx, sy, sw: vw, sh: vh, zoom: z };
}

function wrapLines(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = []; let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawCaption(ctx, item, cam, C, project, settings) {
  const mode = settings.caption || 'bubble';
  const biling = settings.biling || 'orig';
  const role = item.bubble && project.roles.find(r => r.id === item.bubble.roleId);
  const mainText = item.bubble ? item.bubble.text : '';
  const trText = item.bubble ? item.bubble.tr : '';

  if (mode === 'none') return;

  if (mode === 'bubble' && item.bubble) {
    // прямоугольник пузыря в координатах страницы → экран
    const px = item.bubble.x, py = item.bubble.y, pww = item.bubble.w, phh = item.bubble.h;
    const sxx = (px - cam.sx) * (C.w / cam.sw);
    const syy = (py - cam.sy) * (C.h / cam.sh);
    const ww = pww * (C.w / cam.sw);
    const hh = phh * (C.h / cam.sh);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = role ? role.color : '#555';
    ctx.lineWidth = Math.max(2, Math.min(6, C.w / 300));
    roundRect(ctx, sxx, syy, ww, hh, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.font = `600 ${Math.max(13, ww / 14)}px system-ui`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const pad = Math.max(4, ww * 0.04);
    const lines = wrapLines(ctx, mainText, ww - pad * 2);
    const maxLines = Math.floor((hh - pad * 2) / (ctx.measureText('М').width * 1.4));
    const shown = lines.slice(0, Math.max(1, maxLines)).join(' ');
    ctx.fillText(shown, sxx + pad, syy + pad, ww - pad * 2);
    if (role) {
      ctx.font = `700 ${Math.max(11, C.w / 130)}px system-ui`;
      ctx.fillStyle = role.color;
      ctx.fillText((role.emoji || '') + ' ' + role.name, sxx + pad, Math.max(2, syy - ctx.measureText('М').width * 1.3));
    }
    return;
  }

  // субтитры снизу. biling: 'orig' — только оригинал, 'origtr' — оригинал
  // + перевод, 'tr' — перевод (с оригиналом, если перевода нет).
  const show = biling === 'tr' ? (trText || mainText) : mainText;
  let second = '';
  if (biling === 'tr') second = trText ? mainText : '';
  else if (biling !== 'orig') second = trText;
  const lineH = Math.max(26, C.h * 0.055);
  const bandH = lineH * (second ? 2.1 : 1.25) + 26;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, C.h - bandH, C.w, bandH);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const fs = Math.max(18, C.h * 0.042);
  ctx.font = `700 ${fs}px system-ui`;
  ctx.fillStyle = '#fff';
  if (role) {
    ctx.fillStyle = role.color;
    ctx.fillText((role.emoji || '') + ' ' + role.name, C.w / 2, C.h - bandH + 14);
    ctx.fillStyle = '#fff';
  }
  ctx.fillText(show, C.w / 2, C.h - (second ? bandH * 0.62 : bandH * 0.55), C.w * 0.92);
  if (second) {
    ctx.font = `500 ${fs * 0.72}px system-ui`;
    ctx.fillStyle = '#cfd8e8';
    ctx.fillText(second, C.w / 2, C.h - lineH, C.w * 0.92);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ================================================================
 * Общая подготовка сессии: декод всех буферов, планирование, микс.
 * ================================================================ */
async function prepareSession(project, actx, onProgress) {
  const { items: timeline, total } = buildTimeline(project);
  const settings = project.settings || {};

  // декод всех буферов реплик
  const buffers = new Map();
  const audibles = timeline.filter(i => i.bubble && i.bubble.audio && i.bubble.audio.blob);
  for (let i = 0; i < audibles.length; i++) {
    const it = audibles[i];
    // клипы, нарезанные пользователем, уже без тишины (noTrim) — не режем их
    // ещё раз, иначе длительность в таймлайне (seg.duration) разойдётся со звуком
    const noTrim = it.bubble.audio.noTrim === true;
    try { buffers.set(it.bubble.id, await makePartBuffer(actx, it.bubble.audio.blob, !noTrim)); }
    catch (e) { buffers.set(it.bubble.id, null); }
    onProgress && onProgress((i / Math.max(1, audibles.length)) * 0.25, 'декодирование аудио');
  }

  const master = actx.createGain(); master.gain.value = 1;
  const dest = actx.createMediaStreamDestination();
  master.connect(dest);
  const started = actx.currentTime + 0.8;
  const scheduled = new Set();

  function scheduleItem(it) {
    if (!it.bubble || scheduled.has(it.bubble.id)) return;
    scheduled.add(it.bubble.id);
    const pb = buffers.get(it.bubble.id);
    if (!pb) return;
    const role = project.roles.find(r => r.id === it.bubble.roleId);
    const g = actx.createGain();
    g.gain.value = roleGain(role);
    const src = actx.createBufferSource();
    src.buffer = pb.buffer;
    src.connect(g); g.connect(master);
    src.start(started + it.t, pb.offset, Math.min(pb.dur, it.dur + 0.1));
  }

  // музыкальный фон
  return { timeline, total, buffers, master, dest, started, actx, scheduleItem, settings };
}

/* Проигрывание в canvas (предпросмотр). abortToken: Promise, резолв = стоп. */
async function previewSession(project, canvas, opts, onProgress, abortToken) {
  const { w, h } = opts;
  const ctx = canvas.getContext('2d');
  const actx = opts.actx || new AudioContext();
  if (actx.state === 'suspended') await actx.resume();
  const settings = project.settings || {};

  const { timeline, total, scheduleItem, master, started } = await prepareSession(
    project, actx,
    (p, m) => onProgress && onProgress(p * 0.5, m)
  );
  const musicSrc = await startMusic(actx, settings, master);

  let stopped = false, raf = 0;
  return new Promise((resolve, reject) => {
    if (abortToken) abortToken.then(() => { stopped = true; if (!raf) resolve({ stopped: true }); });

    // прогреев страниц
    for (const p of project.pages) pageImg(p.url);

    const onFrame = () => {
      const clock = actx.currentTime - started;
      scheduleAhead(timeline, clock, scheduleItem);
      const item = currentItem(timeline, clock);
      const page = item.page;
      const cam = cameraFor(item, clock, { w: page.w || 1, h: page.h || 1 }, { w, h }, settings.zoom || 'smart');
      const img = pageImgSync(page.url);
      if (img && img.complete) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, cam.sx, cam.sy, cam.sw, cam.sh, 0, 0, w, h);
      } else {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, w, h);
      }
      drawCaption(ctx, item, cam, { w, h }, project, settings);
      const pct = Math.min(1, clock / total);
      onProgress && onProgress(0.5 + pct * 0.5, `предпросмотр: ${fmtDur(clock)} / ${fmtDur(total)}`);
      if (!stopped && clock < total) raf = requestAnimationFrame(onFrame);
      else finish();
    };
    const finish = () => {
      if (stopped) { resolve({ stopped: true }); return; }
      stopped = true; cancelAnimationFrame(raf);
      try { if (musicSrc) musicSrc.stop(); } catch (e) {}
      resolve({ stopped: false });
    };
    onProgress && onProgress(0.02, 'старт');
    try { musicSrc && musicSrc.start(started); } catch (e) {}
    raf = requestAnimationFrame(onFrame);
  });
}

function scheduleAhead(timeline, clock, scheduleItem) {
  for (const it of timeline) if (it.bubble && it.t <= clock + 0.4) scheduleItem(it);
}

function currentItem(timeline, clock) {
  let item = timeline[0];
  for (const it of timeline) { if (it.t <= clock) item = it; else break; }
  return item;
}

async function startMusic(actx, settings, master) {
  if (!settings.musicBlob) return null;
  try {
    const buf = await decodeToBuffer(actx, settings.musicBlob);
    const s = actx.createBufferSource(); s.buffer = buf; s.loop = true;
    const g = actx.createGain(); g.gain.value = ((settings.mvol ?? 15) / 100) * 0.6;
    s.connect(g); g.connect(master);
    return s;
  } catch (e) { return null; }
}

function pickMime() {
  const tries = [
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9', 'video/webm',
  ];
  for (const t of tries) { try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) {} }
  return 'video/webm';
}

export async function resolveCanvas(resSpec, project) {
  if (resSpec === 'auto') {
    const p = project.pages[0];
    const ratio = p && p.w ? p.h / p.w : 16 / 9;
    const h = 1080, w = Math.round(h / ratio);
    return { w: w - (w % 2), h };
  }
  const [w, h] = resSpec.split('x').map(n => parseInt(n, 10));
  return { w, h };
}

/* Предпросмотр: воспроизведение в canvas без записи.
 * abortToken — Promise, при резолве проигрывание останавливается.
 * Возвращает { stop(), done }.
 */
export function previewStart(project, canvas, opts, onProgress, abortToken) {
  const { w, h } = opts;
  canvas.width = w; canvas.height = h;
  const actx = new AudioContext();
  const run = previewSession(project, canvas, { w, h, actx }, onProgress, abortToken);
  return {
    stop: () => { actx.close().catch(() => {}); },
    done: run,
  };
}

/* ================================================================
 * Полная запись видео (WebM): единый AudioContext + canvas + dest.
 * Возвращает { blob, ext, mimeType, duration }.
 * ================================================================ */
export async function renderAndRecord(project, opts, onProgress) {
  const { w, h } = await resolveCanvas(opts.res, project);
  const fps = opts.fps || 30;
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const settings = project.settings || {};

  const actx = new AudioContext();
  // Без resume() suspended-контекст не двигает currentTime, clock не растёт,
  // цикл кадров не останавливается и MediaRecorder никогда не завершается.
  if (actx.state === 'suspended') { try { await actx.resume(); } catch (e) {} }
  if (actx.state === 'suspended') {
    try { await actx.close(); } catch (e) {}
    throw new Error('Браузер не дал запустить AudioContext (нужен жест пользователя — нажмите кнопку ещё раз)');
  }
  const { timeline, total, master, dest, started, scheduleItem } = await prepareSession(project, actx, onProgress);
  const musicSrc = await startMusic(actx, settings, master);

  const vstream = canvas.captureStream(fps);
  if (dest.stream.getAudioTracks().length) vstream.addTrack(dest.stream.getAudioTracks()[0]);
  const mimeType = pickMime();
  const rec = new MediaRecorder(vstream, { mimeType, videoBitsPerSecond: Math.min(16e6, w * h * fps * 0.14) });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  return new Promise((resolve) => {
    const doneP = new Promise((res) => rec.onstop = res);
    // Страховка: если что-то пойдёт не так (подвисший currentTime, потерянный
    // элемент таймлайна), рекордер всё равно остановится и промис завершится.
    const guard = setTimeout(() => { try { rec.stop(); } catch (e) {} }, (total + 20) * 1000);
    const startAll = () => {
      // предзагрузка страниц
      for (const p of project.pages) pageImg(p.url);
      rec.start(1000);
      const cctx = canvas.getContext('2d');
      let raf = 0;
      onProgress && onProgress(0.03, 'старт записи');
      try { musicSrc && musicSrc.start(started); } catch (e) {}

      const onFrame = () => {
        const clock = actx.currentTime - started;
        scheduleAhead(timeline, clock, scheduleItem);
        const item = currentItem(timeline, clock);
        // currentItem возвращает undefined только на пустом таймлайне; раньше
        // тут был return без остановки rec — запись висела вечно
        if (!item) { try { rec.stop(); } catch (e) {} return; }
        const page = item.page;
        const cam = cameraFor(item, clock, { w: page.w || 1, h: page.h || 1 }, { w, h }, settings.zoom || 'smart');
        const img = pageImgSync(page.url);
        if (img && img.complete) {
          cctx.fillStyle = '#000'; cctx.fillRect(0, 0, w, h);
          cctx.drawImage(img, cam.sx, cam.sy, cam.sw, cam.sh, 0, 0, w, h);
        } else {
          cctx.fillStyle = '#111'; cctx.fillRect(0, 0, w, h);
        }
        drawCaption(cctx, item, cam, { w, h }, project, settings);
        const pct = Math.min(1, clock / total);
        onProgress && onProgress(0.1 + pct * 0.85, `запись: ${fmtDur(clock)} / ${fmtDur(total)} • ${w}×${h}`);
        if (clock < total) raf = requestAnimationFrame(onFrame);
        else setTimeout(() => { try { rec.stop(); } catch (e) {} }, 120);
      };

      raf = requestAnimationFrame(onFrame);
      doneP.then(() => {
        clearTimeout(guard);
        cancelAnimationFrame(raf);
        try { musicSrc && musicSrc.stop(); } catch (e) {}
        const blob = new Blob(chunks, { type: mimeType });
        const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
        resolve({ blob, ext, mimeType, duration: total });
      });
    };
    setTimeout(() => { try { startAll(); } catch (e) { resolve({ error: e }); } }, 50);
  });
}

/* ================================================================
 * Только аудио-дорожка (WAV) + MP3 через ffmpeg
 * ================================================================ */
export async function renderAudioTrack(project, onProgress) {
  const actx = new AudioContext();
  const sr = 44100;
  const settings = project.settings || {};
  const { items, total } = buildTimeline(project);
  const buffers = new Map();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.bubble && it.bubble.audio && it.bubble.audio.blob) {
      const noTrim = it.bubble.audio.noTrim === true;
      try { buffers.set(it.bubble.id, await makePartBuffer(actx, it.bubble.audio.blob, !noTrim)); }
      catch (e) { buffers.set(it.bubble.id, null); }
    }
    onProgress && onProgress((i / Math.max(1, items.length)) * 0.5, 'декод аудио');
  }
  const frameCount = Math.ceil(total * sr);
  const out = new Float32Array(frameCount);
  const mixAdd = (buf, offsetSec, vol) => {
    let ch = buf.getChannelData(0);
    if (buf.sampleRate !== sr) ch = resampleLinear(ch, buf.sampleRate, sr);
    const i0 = Math.floor(offsetSec * sr);
    if (i0 >= frameCount) return;
    const n = Math.min(ch.length, frameCount - i0);
    for (let k = 0; k < n; k++) out[i0 + k] += ch[k] * vol;
  };
  for (const it of items) {
    const pb = buffers.get(it.bubble ? it.bubble.id : '');
    if (!pb) continue;
    const role = it.bubble && project.roles.find(r => r.id === it.bubble.roleId);
    mixAdd(pb.buffer, it.t + pb.offset, roleGain(role));
  }
  if (settings.musicBlob) {
    try {
      const m = await decodeToBuffer(actx, settings.musicBlob);
      const g = (settings.mvol ?? 15) / 100 * 0.6;
      // зациклить по длительности; при duration <= 0 шаг обязан быть > 0,
      // иначе pos не растёт и цикл не заканчивается никогда
      const step = m.duration > 0 ? m.duration : (total > 0 ? total : 1);
      let pos = 0, guard = 0;
      while (pos < total && guard++ < 10000) { mixAdd(m, pos, g); pos += step; }
    } catch (e) {}
  }

  // WAV 16bit mono
  const pcm = new Int16Array(out.length);
  for (let i = 0; i < out.length; i++) { const v = Math.max(-1, Math.min(1, out[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  const wav = encodeWav(pcm, sr);
  onProgress(0.95, 'готово');
  return { blob: new Blob([wav], { type: 'audio/wav' }), duration: total, wav };
}

function encodeWav(pcm, sr) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const d = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  ws(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) d.setInt16(44 + i * 2, pcm[i], true);
  return buf;
}

export async function wavToMp3(wavBlob, onLog) {
  return withFFmpeg(async () => {
    const ffmpeg = await loadFFmpeg(onLog);
    const input = new Uint8Array(await wavBlob.arrayBuffer());
    await ffmpeg.writeFile('voice.wav', input);
    await ffmpeg.exec(['-y', '-i', 'voice.wav', '-codec:a', 'libmp3lame', '-q:a', '4', 'voice.mp3']);
    const data = await ffmpeg.readFile('voice.mp3');
    await dropFFmpegFiles(ffmpeg, ['voice.wav', 'voice.mp3']);
    return { blob: new Blob([data], { type: 'audio/mpeg' }), name: 'voice.mp3' };
  });
}

export async function toMP4(webmBlob, onLog) {
  return withFFmpeg(async () => {
    const ffmpeg = await loadFFmpeg(onLog);
    const input = new Uint8Array(await webmBlob.arrayBuffer());
    await ffmpeg.writeFile('in.webm', input);
    await ffmpeg.exec(['-y', '-i', 'in.webm', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', 'out.mp4']);
    const data = await ffmpeg.readFile('out.mp4');
    await dropFFmpegFiles(ffmpeg, ['in.webm', 'out.mp4']);
    return { blob: new Blob([data], { type: 'video/mp4' }), name: 'video.mp4' };
  });
}

export async function toGIF(webmBlob, onLog) {
  return withFFmpeg(async () => {
    const ffmpeg = await loadFFmpeg(onLog);
    const input = new Uint8Array(await webmBlob.arrayBuffer());
    await ffmpeg.writeFile('in.webm', input);
    await ffmpeg.exec(['-y', '-i', 'in.webm', '-vf', 'fps=12,scale=480:-1:flags=lanczos', 'out.gif']);
    const data = await ffmpeg.readFile('out.gif');
    await dropFFmpegFiles(ffmpeg, ['in.webm', 'out.gif']);
    return { blob: new Blob([data], { type: 'image/gif' }), name: 'video.gif' };
  });
}

/* Снять файлы с ФС воркера: экземпляр переиспользуется между конвертациями,
 * а видео на 100 МБ иначе копится в памяти до перезагрузки страницы. */
async function dropFFmpegFiles(ffmpeg, names) {
  for (const n of names) { try { await ffmpeg.deleteFile(n); } catch (e) { /* нечего удалять */ } }
}

let _ffmpeg = null;
let _ffLog = null;
/* Один экземпляр на страницу: ядро ~32 МБ, каждая пересозданная копия —
 * это повторный парсинг wasm и лишние ~30 МБ памяти. */
async function loadFFmpeg(onLog) {
  _ffLog = onLog || null; // лог всегда идёт в последний вызвавший элемент
  if (_ffmpeg) return _ffmpeg;
  if (!loadFFmpeg._p) {
    loadFFmpeg._p = (async () => {
      const toBlobURL = async (url, mime) => {
        const r = await fetch(url);
        if (!r.ok) throw new Error('ffmpeg: ' + url.split('/').pop() + ' → HTTP ' + r.status);
        return URL.createObjectURL(new Blob([await r.blob()], { type: mime }));
      };
      _ffLog && _ffLog('загрузка ffmpeg-core (~32МБ)…');
      const { FFmpeg } = await import(/* @vite-ignore */ FF_ESM);
      if (typeof FFmpeg !== 'function') throw new Error('ffmpeg: в ESM-сборке нет экспорта FFmpeg');
      const ffmpeg = new FFmpeg();
      ffmpeg.on('log', ({ message }) => _ffLog && _ffLog(message));
      ffmpeg.on('progress', ({ progress }) => _ffLog && _ffLog('mux ' + Math.round(progress * 100) + '%'));
      await ffmpeg.load({
        classWorkerURL: await toBlobURL(FF_WORKER, 'text/javascript'),
        coreURL: await toBlobURL(FF_CORE_BASE + '/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL(FF_CORE_BASE + '/ffmpeg-core.wasm', 'application/wasm'),
      });
      return ffmpeg;
    })().catch((e) => { loadFFmpeg._p = null; throw e; });
  }
  _ffmpeg = await loadFFmpeg._p;
  return _ffmpeg;
}

/* Конвертации выполняются строго по очереди: у воркера одна ФС, и два
 * параллельных exec перемешивают in/out-файлы и портят результат. */
let _ffQueue = Promise.resolve();
function withFFmpeg(job) {
  const run = _ffQueue.then(() => job(), () => job());
  _ffQueue = run.then(() => {}, () => {});
  return run;
}

export { fmtBytes, download };