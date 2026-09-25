/* OCR: локальный Tesseract (точные боксы слов) или vision-ИИ.
 * Возвращает «пузыри» реплик с координатами. */

import { clusterBubbleWords, sortBubblesReadingOrder, loadImage, loadScript, uuid } from './util.js';
import { visionExtractLines } from './ai.js';
import { detectBubbles } from './yolo.js';

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let _worker = null;
let _workerLang = null;

async function ensureTesseractWorker(lang, logger) {
  if (!window.Tesseract) {
    await loadScript(TESSERACT_CDN).catch(() => {});
  }
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
 * settings: { ocr, bounce, aimodel, key, ai, aiGap }
 */
export async function ocrPage({ page, lang = 'rus', settings, onProgress }) {
  const canvas = await makeCanvas(page.url);
  onProgress(0.02);
  const langName = { rus: 'русский', eng: 'английский', chi_sim: 'китайский', jpn: 'японский', kor: 'корейский', spa: 'испанский', fra: 'французский', deu: 'немецкий', por: 'португальский' }[lang] || lang;

  // YOLO-детекция облачков -> OCR в каждом боксе отдельно.
  // Модель скачивается при первом использовании (прогресс внутри detectBubbles).
  if (settings.detect === 'yolo' || settings.bubbleDetect === 'yolo') {
    try {
      onProgress(0.05);
      const boxes = await detectBubbles(canvas, {
        onProgress: (n) => onProgress(0.05 + n * 0.4),
        onModel: () => onProgress(0.08, 'первое скачивание модели облачков (~108МБ)…'),
      });
      if (boxes.length) {
        const bubbles = [];
        let raw = '';
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i];
          onProgress(0.45 + (i / boxes.length) * 0.5, `OCR облачка ${i + 1}/${boxes.length}`);
          const text = await ocrRegion(canvas, b, settings, lang);
          if (!text) continue;
          bubbles.push({ x: b.x, y: b.y, w: b.w, h: b.h, text: text.trim() });
          raw += (raw ? '\n' : '') + text.trim();
        }
        onProgress(0.98);
        if (bubbles.length) return { bubbles, raw, w: canvas.width, h: canvas.height, boxes: true };
      }
    } catch (e) {
      onProgress(0.45);
      console.warn('yolo detect:', e.message);
      // падаем в обычный путь
    }
  }

  if (settings.ocr === 'tesseract' || !settings.ocr) {
    const worker = await ensureTesseractWorker(lang, onProgress);
    const { data } = await worker.recognize(canvas);
    onProgress(0.96);
    const bubbles = wordsToBubbles(data.words || [], canvas.width, canvas.height, {
      rtl: settings.rtl === true || lang === 'jpn' || lang === 'chi_sim' || lang === 'kor',
      vertical: lang === 'jpn',
    });
    return { bubbles, raw: data.text || '', w: canvas.width, h: canvas.height, boxes: true };
  }

  // vision-провайдер из каталога: OCR-селект = конкретный ИИ-провайдер.
  // Модель возвращает только строки, без координат. Раньше боксы выдумывались
  // равномерной сеткой 5×N, то есть Ken Burns зум и «пузырь» в монтаже ехали по
  // вымышленным точкам. Теперь координаты не выдумываются: помечаем реплики
  // как безбоксовые (page.bubblesHaveBoxes = false), и движок монтажа при
  // неизвестных координатах не рисует пузырь и не держит на нём зум.
  const dataURL = canvas.toDataURL('image/jpeg', 0.85);
  onProgress(0.2);
  const vsettings = { ...settings, ai: settings.ocr };
  const lines = await visionExtractLines(vsettings, dataURL, langName);
  onProgress(0.9);
  const W = canvas.width, H = canvas.height;
  const rows = Math.max(1, lines.length);
  const bubbles = lines.map((text, i) => ({
    id: uuid(), text, tr: '', roleId: '',
    x: null, y: null, w: null, h: null,
    // порядок строк для таймлайна: равномерно по высоте страницы
    order: i / rows,
  }));
  return { bubbles, raw: lines.join('\n'), w: W, h: H, boxes: false };
}

/* OCR внутри бокса облачка (b: {x,y,w,h} в пикселях канваса). */
async function ocrRegion(canvas, b, settings, lang) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b.w));
  c.height = Math.max(1, Math.round(b.h));
  c.getContext('2d').drawImage(canvas, b.x, b.y, c.width, c.height, 0, 0, c.width, c.height);
  if (settings.ocr === 'tesseract' || !settings.ocr) {
    const worker = await ensureTesseractWorker(lang, () => {});
    const { data } = await worker.recognize(c);
    return data.text || '';
  }
  const dataURL = c.toDataURL('image/jpeg', 0.9);
  const vsettings = { ...settings, ai: settings.ocr };
  const lines = await visionExtractLines(vsettings, dataURL,
    { rus: 'русский', eng: 'английский', chi_sim: 'китайский', jpn: 'японский', kor: 'корейский', spa: 'испанский', fra: 'французский', deu: 'немецкий', por: 'португальский' }[lang] || lang);
  return Array.isArray(lines) ? lines.join('\n') : String(lines || '');
}

export async function tesseractLanguages() {
  if (!window.Tesseract) return [];
  try {
    const ls = await Tesseract.initialize(); // словник языков
    return Object.keys(ls.loadedLangs || {}).sort();
  } catch (e) { return []; }
}