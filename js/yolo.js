/* Обнаружение речевых пузырей (облачков) в странице комикса через YOLOv8 ONNX.
 * Модель: kitsumed/yolov8m_seg-speech-bubble (1 класс «speech bubble»), ~108МБ,
 * скачивается один раз и кэшируется в IndexedDB (slot 'model:bubbles').
 * Инференс — onnxruntime-web (WASM), модель раздаётся с huggingface.co постепенно.
 */

import { idbGet, idbSet, idbDel } from './store.js';

export const BUBBLE_MODEL_URL = 'https://huggingface.co/kitsumed/yolov8m_seg-speech-bubble/resolve/main/model_dynamic.onnx';
const ORT_SRC = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.js';
const ORT_WASM = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const MODEL_KEY = 'model:bubbles';
const N_PRED = 37;   // 4 bbox + 1 class + 32 mask-coeff (YOLOv8m-seg, nc=1)
const IMGSZ = 640;   // letterbox-размер инференса
const CONF = 0.25, IOU = 0.45;

let _ort = null;

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

/** Статус скачанной модели. */
export async function bubbleModelStatus() {
  try {
    const b = await idbGet(MODEL_KEY);
    return b ? { ready: true, bytes: b.byteLength } : { ready: false, bytes: 0 };
  } catch (e) { return { ready: false, bytes: 0 }; }
}

export function bubbleModelTargetBytes() { return 108982949; }

/** Удалить локальную копию. */
export async function bubbleModelClear() { await idbDel(MODEL_KEY); }

/** Скачать модель (с прогрессом) и вернуть [InferenceSession, bytes]. */
export async function downloadBubbleModel(onProgress) {
  const ort = await ensureOrt();
  const cached = await idbGet(MODEL_KEY);
  if (cached && cached.byteLength) {
    return [await ort.InferenceSession.create(cached, { executionProviders: ['wasm'] }), cached];
  }
  const r = await fetch(BUBBLE_MODEL_URL);
  if (!r.ok) throw new Error('модель bubbles: HTTP ' + r.status);
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
  await idbSet(MODEL_KEY, bytes);
  const ses = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  return [ses, bytes];
}

/* letterbox: вписать canvas в IMGSZ×IMGSZ без искажений, норм 0..1, RGB */
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

/* Декод output0 [1,37,N] -> [{x,y,w,h,conf}] в координатах исходного канваса */
function decode(pred, ratio, dx, dy, W, H) {
  const N = pred.length / N_PRED;
  const out = [];
  for (let j = 0; j < N; j++) {
    const sc = pred[4 * N + j];
    if (sc < CONF) continue;
    const cx = pred[0 * N + j], cy = pred[1 * N + j], w = pred[2 * N + j], h = pred[3 * N + j];
    // pred в пикселях letterbox-канваса -> исходные
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
    if (d.w < 8 || d.h < 8) continue; // слишком мелкие — артефакты
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
  const cached = await idbGet(MODEL_KEY);
  let ses, bytes = cached;
  if (bytes && bytes.byteLength) {
    ses = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] });
  } else {
    if (onModel) onModel();
    [ses] = await downloadBubbleModel(onProgress);
  }
  const { data, ratio, dx, dy } = letterbox(img, IMGSZ);
  const W = img.naturalWidth || img.width;
  const H = img.naturalHeight || img.height;
  const feeds = { images: new ort.Tensor('float32', data, [1, 3, IMGSZ, IMGSZ]) };
  const res = await ses.run(feeds);
  const pred = res.output0.data;
  const dets = decode(pred, ratio, dx, dy, W, H);
  return nms(dets);
}