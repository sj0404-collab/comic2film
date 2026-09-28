/* Обнаружение речевых пузырей (облачков) в странице комикса через YOLO ONNX.
 * Поддерживает несколько версий YOLO (v8 nano/s/m/l/x, кастомные URL).
 * Модели кэшируются в IndexedDB под уникальными ключами 'model:bubbles:<modelId>'.
 * Инференс — onnxruntime-web (WASM).
 */

import { idbGet, idbSet, idbDel } from './store.js';

/* Реестр известных моделей. Каждая модель: { id, name, url, size, nPred, imgsz }
 * nPred = 4 bbox + nc classes + maskCoeffs (YOLOv8-seg nc=1 → 4+1+32=37)
 * Для nano/s/m/l/x структура одинакова, отличается только веса.
 * Кастомная модель — пользователь задаёт URL, мы предполагаем стандартный v8-seg.
 */
export const YOLO_MODELS = {
  'yolov8m-seg-bubble': {
    id: 'yolov8m-seg-bubble',
    name: 'YOLOv8m-seg (kitsumed/speech-bubble)',
    url: 'https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble/resolve/main/model_dynamic.onnx',
    size: 108982949,
    nPred: 37,
    imgsz: 640,
  },
};

const ORT_SRC = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';

let _ort = null;
let _currentModelId = 'yolov8m-seg-bubble';

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

async function ensureOrt() {
  if (_ort) return _ort;
  if (!window.ort) {
    await loadScript(ORT_SRC);
    window.ort.env = window.ort.env || {};
    window.ort.env.wasm = window.ort.env.wasm || {};
    window.ort.env.wasm.wasmPaths = ORT_WASM;
  }
  _ort = window.ort;
  return _ort;
}

function modelKey(modelId) {
  return 'model:bubbles:' + modelId;
}
/* Размер модели храним отдельной записью: иначе проверка «скачана ли» читала
 * из IndexedDB все 108 МБ только ради byteLength. */
function metaKey(modelId) {
  return modelKey(modelId) + ':meta';
}

export function setYoloModel(modelId) {
  if (YOLO_MODELS[modelId] || modelId === 'custom') {
    if (_currentModelId !== modelId) invalidateSession();
    _currentModelId = modelId;
  }
}

export function getYoloModel() {
  return _currentModelId;
}

export function getModelInfo(modelId) {
  return YOLO_MODELS[modelId] || null;
}

/** Статус скачанной модели (текущей) — без чтения самих 108 МБ. */
export async function bubbleModelStatus() {
  const id = _currentModelId;
  try {
    const meta = await idbGet(metaKey(id));
    if (meta && meta.bytes) return { ready: true, bytes: meta.bytes, modelId: id };
    // метазаписи нет (старые установки) — проверяем сами байты один раз
    const b = await idbGet(modelKey(id));
    if (b && b.byteLength) {
      await idbSet(metaKey(id), { bytes: b.byteLength, at: Date.now() });
      return { ready: true, bytes: b.byteLength, modelId: id };
    }
    return { ready: false, bytes: 0, modelId: id };
  } catch (e) { return { ready: false, bytes: 0, modelId: id }; }
}

export function bubbleModelTargetBytes(modelId = _currentModelId) {
  const m = YOLO_MODELS[modelId];
  return m ? m.size : 0;
}

/** Удалить локальную копию текущей модели. */
export async function bubbleModelClear() {
  invalidateSession();
  await idbDel(modelKey(_currentModelId));
  await idbDel(metaKey(_currentModelId));
}

/* Сессия ONNX кэшируется: раньше на каждую страницу заново читались 108 МБ
 * из IndexedDB и создавался новый InferenceSession (на 100 страницах это
 * 10.8 ГБ чтения и минуты на пересборку сессии). */
let _session = null;
let _sessionId = null;

function invalidateSession() { _session = null; _sessionId = null; }

/** Скачать байты модели (или взять уже скачанные). */
async function modelBytes(modelId, onProgress) {
  const cached = await idbGet(modelKey(modelId));
  if (cached && cached.byteLength) return cached;
  const model = YOLO_MODELS[modelId];
  if (!model || !model.url) throw new Error('модель ' + modelId + ': не задан URL');
  const r = await fetch(model.url);
  if (!r.ok) throw new Error('модель ' + modelId + ': HTTP ' + r.status);
  const total = +r.headers.get('content-length') || 0;
  const rd = r.body.getReader();
  const chunks = [];
  let got = 0;
  while (true) {
    const { done, value } = await rd.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total && onProgress) onProgress(got / total);
  }
  const bytes = new Uint8Array(got);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.length; }
  await idbSet(modelKey(modelId), bytes);
  await idbSet(metaKey(modelId), { bytes, version: Date.now() });
  return bytes;
}

/** Сессия для модели (создаётся один раз). */
async function getSession(ort, modelId, onProgress, onModel) {
  if (_session && _sessionId === modelId) return _session;
  const known = await bubbleModelStatus();
  let bytes;
  if (known.ready) {
    bytes = await idbGet(modelKey(modelId));
  } else {
    if (onModel) onModel();
    bytes = await modelBytes(modelId, onProgress);
  }
  _sessionId = modelId;
  _session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return _session;
}

/** Скачать модель (с прогрессом) и вернуть [InferenceSession, bytes]. */
export async function downloadBubbleModel(onProgress, modelId = _currentModelId) {
  const ort = await ensureOrt();
  const bytes = await modelBytes(modelId, onProgress);
  const ses = await getSession(ort, modelId, onProgress);
  return [ses, bytes];
}

const CONF = 0.25, IOU = 0.45;
let _nPred = 37, _imgsz = 640;

function updateModelParams(modelId) {
  const m = YOLO_MODELS[modelId];
  if (m) { _nPred = m.nPred; _imgsz = m.imgsz; }
}

/* letterbox: вписать canvas в target×target без искажений, норм 0..1, RGB */
function letterbox(img, target) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const ratio = Math.min(target / iw, target / ih);
  const nw = Math.max(1, Math.round(iw * ratio));
  const nh = Math.max(1, Math.round(ih * ratio));
  const dx = Math.round((target - nw) / 2);
  const dy = Math.round((target - nh) / 2);
  const c = document.createElement('canvas');
  c.width = target; c.height = target;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, target, target);
  ctx.drawImage(img, dx, dy, nw, nh);
  const data = ctx.getImageData(0, 0, target, target).data;
  const rgb = new Float32Array(3 * target * target);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i] / 255; rgb[j + 1] = data[i + 1] / 255; rgb[j + 2] = data[i + 2] / 255;
  }
  return { data: rgb, ratio, dx, dy };
}

/* Декод output0 [1,N_PRED,N] -> [{x,y,w,h,conf}] в координатах исходного канваса */
function decode(pred, ratio, dx, dy, W, H) {
  const N = pred.length / _nPred;
  const out = [];
  for (let j = 0; j < N; j++) {
    const sc = pred[4 * N + j];
    if (sc < CONF) continue;
    const cx = pred[0 * N + j], cy = pred[1 * N + j], w = pred[2 * N + j], h = pred[3 * N + j];
    const x1 = (cx - w / 2 - dx) / ratio;
    const y1 = (cy - h / 2 - dy) / ratio;
    const x2 = (cx + w / 2 - dx) / ratio;
    const y2 = (cy + h / 2 - dy) / ratio;
    out.push({
      x: Math.max(0, x1), y: Math.max(0, y1),
      w: Math.min(W, x2) - Math.max(0, x1), h: Math.min(H, y2) - Math.max(0, y1),
      conf: sc,
    });
  }
  return out;
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const ua = a.w * a.h + b.w * b.h - inter;
  return ua ? inter / ua : 0;
}

function nms(dets) {
  dets.sort((a, b) => b.conf - a.conf);
  const keep = [];
  for (const d of dets) {
    if (d.w < 8 || d.h < 8) continue;
    if (keep.some((k) => iou(d, k) > IOU)) continue;
    keep.push(d);
  }
  return keep;
}

/**
 * Детекция облачков на странице.
 * img: HTMLImageElement/HTMLCanvasElement.
 * onProgress(0..1), onModel: () => {} — вызван при скачивании модели.
 * Возвращает [{x,y,w,h,conf}] в пикселях исходного изображения.
 */
export async function detectBubbles(img, { onProgress, onModel } = {}) {
  const ort = await ensureOrt();
  updateModelParams(_currentModelId);
  const ses = await getSession(ort, _currentModelId, onProgress, onModel);
  const { data, ratio, dx, dy } = letterbox(img, _imgsz);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const feeds = { images: new ort.Tensor('float32', data, [1, 3, _imgsz, _imgsz]) };
  const res = await ses.run(feeds);
  const pred = res.output0.data;
  const dets = decode(pred, ratio, dx, dy, W, H);
  return nms(dets);
}