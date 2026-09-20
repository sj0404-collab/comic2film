/* OCR: локальный Tesseract (точные боксы слов) или vision-ИИ.
 * Возвращает «пузыри» реплик с координатами. */

import { clusterBubbleWords, sortBubblesReadingOrder, loadImage } from './util.js';
import { visionExtractLines } from './ai.js';

let _worker = null;
let _workerLang = null;

async function ensureTesseractWorker(lang, logger) {
  if (!window.Tesseract) throw new Error('Tesseract не загружен (нет сети?)');
  const langs = Array.isArray(lang) ? lang.join('+') : lang;
  if (_worker && _workerLang === langs) return _worker;
  if (_worker) { try { await _worker.terminate(); } catch (e) {} _worker = null; }
  _worker = await Tesseract.createWorker(langs, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        logger && logger(m.progress);
      }
    },
  });
  _workerLang = langs;
  return _worker;
}

function wordsToBubbles(words, pageW, pageH, { rtl = false, vertical = false } = {}) {
  const mapped = words
    .filter(w => w.text && String(w.text).trim())
    .map(w => ({
      x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0,
      text: w.text, conf: w.confidence,
    }));
  const bubbles = clusterBubbleWords(mapped, pageW, pageH);
  return sortBubblesReadingOrder(bubbles, { rtl, vertical });
}

async function makeCanvas(url, maxDim = 1600) {
  const img = await loadImage(url);
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight || 1));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** OCR одной страницы.
 * page: { url } — объекта с URL картинки.
 * settings: { ocr, aimodel, key, ai, aiGap }
 */
export async function ocrPage({ page, lang = 'rus', settings, onProgress }) {
  const canvas = await makeCanvas(page.url);
  onProgress(0.02);
  const langName = { rus: 'русский', eng: 'английский', chi_sim: 'китайский', jpn: 'японский', kor: 'корейский', spa: 'испанский', fra: 'французский', deu: 'немецкий', por: 'португальский' }[lang] || lang;

  if (settings.ocr === 'tesseract' || !settings.ocr) {
    const worker = await ensureTesseractWorker(lang, onProgress);
    const { data } = await worker.recognize(canvas);
    onProgress(0.96);
    const bubbles = wordsToBubbles(data.words || [], canvas.width, canvas.height, {
      rtl: settings.rtl === true || lang === 'jpn' || lang === 'chi_sim' || lang === 'kor',
      vertical: lang === 'jpn',
    });
    return { bubbles, raw: data.text || '', w: canvas.width, h: canvas.height };
  }

  // vision-провайдеры: точных боксов нет — раскладываем строки по полосам
  const dataURL = canvas.toDataURL('image/jpeg', 0.85);
  onProgress(0.2);
  const lines = await visionExtractLines(settings, dataURL, langName);
  onProgress(0.9);
  const W = canvas.width, H = canvas.height;
  const per = Math.max(1, Math.ceil(lines.length / 5));
  const bubbles = lines.map((text, i) => {
    const col = Math.floor(i / per), row = i % per;
    return {
      x: (col * W) / Math.ceil(lines.length / per) + 8, y: (row * (H / per)) + 6,
      w: W / Math.ceil(lines.length / per) - 16, h: H / per - 10, text,
    };
  });
  return { bubbles, raw: lines.join('\n'), w: W, h: H };
}

export async function tesseractLanguages() {
  if (!window.Tesseract) return [];
  try {
    const ls = await Tesseract.initialize(); // словник языков
    return Object.keys(ls.loadedLangs || {}).sort();
  } catch (e) { return []; }
}