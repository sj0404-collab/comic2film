/* Разбор исходников: картинки, PDF, ZIP/CBZ, RAR/CBR, аудио/видео. */

import { byNumName, isImageFile, extOf, IMAGE_EXT, loadScript, numKey, isArchiveFile, isPdfFile } from './util.js';

const PDFJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const JSZIP_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const UNRAR_BASE = 'https://cdn.jsdelivr.net/npm/node-unrar-js@2.0.2/esm/js/';

/* Жёсткий предел страниц: 700 — иначе рендер и хранилище встают колом. */
const MAX_PAGES = 700;

let _unrarPromise = null;

function ensurePdfjs() {
  const configure = (lib) => {
    try { lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) { /* старые версии */ }
    return lib;
  };
  if (window.pdfjsLib) return Promise.resolve(configure(window.pdfjsLib));
  return loadScript(PDFJS_CDN).then(() => {
    if (!window.pdfjsLib) throw new Error('Не удалось загрузить PDF-движок');
    return configure(window.pdfjsLib);
  });
}

async function ensureJsZip() {
  if (window.JSZip) return window.JSZip;
  await loadScript(JSZIP_CDN);
  if (!window.JSZip) throw new Error('Не удалось загрузить JSZip (нет сети?)');
  return window.JSZip;
}

async function ensureUnrar() {
  if (_unrarPromise) return _unrarPromise;
  _unrarPromise = (async () => {
    const [{ default: makeUnrar }, { ExtractorData }] = await Promise.all([
      import(/* @vite-ignore */ UNRAR_BASE + 'unrar.js'),
      import(/* @vite-ignore */ UNRAR_BASE + 'ExtractorData.js'),
    ]);
    const unrar = await makeUnrar();
    const createExtractorFromData = async ({ data, password = '' }) => {
      const ex = new ExtractorData(unrar, data, password);
      unrar.extractor = ex;
      return ex;
    };
    return { createExtractorFromData };
  })().catch(e => { _unrarPromise = null; throw e; });
  return _unrarPromise;
}

function toFile(blob, name) {
  return new File([blob], name, { type: blob.type || 'image/jpeg' });
}

/* --- Архивы ZIP/CBZ --- */
async function extractZip(file, { onProgress }) {
  const JSZipLib = await ensureJsZip();
  const zip = await JSZipLib.loadAsync(await file.arrayBuffer());
  const names = Object.keys(zip.files)
    .filter(n => !zip.files[n].dir && isImageFile({ name: n }))
    .sort(byNumName);
  const pages = [];
  for (let i = 0; i < names.length; i++) {
    onProgress && onProgress((i + 1) / Math.max(1, names.length), `Распаковка ${names[i]}`);
    const blob = await zip.files[names[i]].async('blob');
    pages.push(toFile(blob, names[i]));
    if (pages.length >= MAX_PAGES) break;
  }
  return pages;
}

/* --- Архивы RAR/CBR --- */
async function extractRar(file, { onProgress }) {
  const { createExtractorFromData } = await ensureUnrar();
  const state = await createExtractorFromData({ data: await file.arrayBuffer() });
  const list = state.getFileList();
  const names = [...list.fileHeaders]
    .filter(h => !h.flags.directory && IMAGE_EXT.includes(extOf(h.name)))
    .map(h => h.name)
    .sort(byNumName);
  const { files } = state.extract({ files: names });
  const pages = [];
  for (const item of files) {
    const { fileHeader, extraction } = item;
    const uint8 = extraction;
    if (extraction === 'skipped' || !uint8) continue;
    onProgress && onProgress(pages.length / Math.max(1, names.length), `Распаковка ${fileHeader.name}`);
    const blob = new Blob([uint8], { type: guessMime(fileHeader.name) });
    pages.push(toFile(blob, fileHeader.name));
    if (pages.length >= MAX_PAGES) break;
  }
  return pages;
}

function guessMime(name) {
  const e = extOf(name);
  if (e === 'png') return 'image/png';
  if (e === 'webp') return 'image/webp';
  if (e === 'gif') return 'image/gif';
  if (e === 'bmp') return 'image/bmp';
  if (e === 'avif') return 'image/avif';
  return 'image/jpeg';
}

/* --- PDF --- */
async function extractPdf(file, { onProgress }) {
  const pdfjs = await ensurePdfjs();
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  const maxDim = 1900;
  for (let i = 1; i <= doc.numPages && pages.length < MAX_PAGES; i++) {
    onProgress && onProgress(i / doc.numPages, `Растеризация страницы ${i}/${doc.numPages}`);
    const page = await doc.getPage(i);
    const v0 = page.getViewport({ scale: 1 });
    const scale = Math.min(maxDim / v0.width, maxDim / v0.height, 2.2);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise(r => canvas.toBlob(b => r(b), 'image/jpeg', 0.86));
    pages.push(toFile(blob, `page_${String(i).padStart(3, '0')}.jpg`));
  }
  return pages;
}

/* --- Разбор одного файла в страницы --- */
export async function extractPages(file, { onProgress } = {}) {
  onProgress && onProgress(0, 'Анализ файла…');
  const ext = extOf(file.name);
  if (isPdfFile(file)) return extractPdf(file, { onProgress });
  if (ext === 'zip' || ext === 'cbz') return extractZip(file, { onProgress });
  if (ext === 'rar' || ext === 'cbr') return extractRar(file, { onProgress });
  if (isImageFile(file)) {
    onProgress && onProgress(0.9, 'Загрузка картинки…');
    return [file];
  }
  // .tar/.7z стоят в ARCH_EXT, но распаковщика для них нет — раньше падало
  // с невнятным «Формат не поддерживается»
  if (isArchiveFile(file)) throw new Error('Архив ' + ext + ' не поддерживается: используйте ZIP/CBZ или RAR/CBR');
  throw new Error('Формат не поддерживается для страниц: ' + (ext || 'без расширения'));
}

/* ================================================================
 * Аудио: декодирование и нарезка по тишине
 * ================================================================ */
export async function decodeAudio(blob) {
  const u = URL.createObjectURL(blob);
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  try {
    const ab = await blob.arrayBuffer();
    const buf = await ac.decodeAudioData(ab);
    const ch = buf.numberOfChannels;
    const data = new Float32Array(buf.length);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) data[i] += d[i] / ch; }
    return { samples: data, sr: buf.sampleRate, url: u, duration: buf.duration };
  } catch (e) {
    URL.revokeObjectURL(u);
    throw new Error('Не удалось прочитать звук: ' + e.message);
  } finally {
    ac.close().catch(() => {});
  }
}

export async function clipsFromAudio(blob, { threshold = 0.02, minSilence = 0.32, minClip = 0.3, maxClip = 16, onProgress } = {}) {
  const { samples, sr, url, duration } = await decodeAudio(blob);
  const { sliceSegments, trimSilence } = await import('./util.js');
  // режем по тишине только «тело» записи, но смещения возвращаем в
  // координатах исходного сигнала, чтобы нарезка совпадала с samples
  const { start: tStart, end: tEnd } = trimSilence(samples, sr);
  const body = samples.subarray(tStart, tEnd);
  const segs = sliceSegments(body, sr, {
    threshold, minSilence, minClip, maxClip,
  }).map(s => ({ startS: s.startS + tStart / sr, endS: s.endS + tStart / sr }));
  onProgress && onProgress(1, 'Нарезка выполнена');
  return { url, duration, sr, segs, samples };
}

export { numKey };