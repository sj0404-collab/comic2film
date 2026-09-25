/* Главный модуль: состояние проекта, табы, импорт, OCR, роли, TTS, рендер. */

import {
  toast, uuid, download, fmtDur, loadImage, loadScript, loadCss,
} from './util.js';
import { idbSet, idbGet, idbDel, KEY_PROJECT, KEY_SETTINGS } from './store.js';
import { analyzeRoles, translateLines, FREE_MODELS, refreshFreeModels, PROVIDERS, provider, providerHasVision, isFreeModel, modelMeta } from './ai.js';
import { openModelPicker, setSettingsGetter as modelsuiSetSettings } from './modelsui.js';
import { extractPages, clipsFromAudio } from './import.js';
import { ocrPage } from './ocr.js';
import { bubbleModelStatus, bubbleModelTargetBytes, downloadBubbleModel, bubbleModelClear, setYoloModel, getYoloModel, getModelInfo, YOLO_MODELS } from './yolo.js';
import { initChat, setChatSettings } from './chat.js';
import {
  synthesizeLine, voicesForLang, allVoices, fetchVoicesFromMicrosoft,
} from './voices.js';
import {
  renderAndRecord, renderAudioTrack, previewStart, resolveCanvas, toMP4, toGIF, wavToMp3,
} from './engine.js';

const $ = (id) => document.getElementById(id);

const LANG_LOCALE = {
  rus: 'ru', eng: 'en-US', chi_sim: 'zh-CN', jpn: 'ja-JP', kor: 'ko-KR',
  spa: 'es-ES', fra: 'fr-FR', deu: 'de-DE', por: 'pt-BR',
};
const ROLE_COLORS = ['#5b8cff', '#ff6b7a', '#3ecf9a', '#ffb454', '#c084fc', '#38bdf8', '#fb7185', '#a3e635', '#f472b6', '#60a5fa'];
const EMO_GENDER = { male: '🧔', female: '👩', other: '🤖' };
const TTS_STYLES = ['', 'cheerful', 'excited', 'angry', 'sad', 'whisper', 'shouting', 'terrified', 'unfriendly', 'gentle'];
const PROJECT_NAME = 'VoiceComic';
const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css';
const XTERM_JS = [
  'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js',
  'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js',
  'https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js',
];

/* ================================================================
 * Состояние
 * ================================================================ */
function defaultSettings() {
  return {
    ocr: 'tesseract', detect: 'yolo', lang: 'rus', trlang: 'ru',
    ai: 'pollinations', key: '', aiurl: '', aimodel: 'openai', aiGap: 2500,
    zenRelay: '',
    voiceBackend: 'edge', proxy: '',
    backendUrl: '', backendToken: '',
    gap: 350, res: '1080x1920', fps: 30, zoom: 'smart', caption: 'bubble', biling: 'orig',
    musicUrl: '', musicBlob: null, mvol: 15,
  };
}

function defaultRoles() {
  const lang = LANG_LOCALE[settings.lang] || 'ru';
  const pool = voicesForLang(lang);
  const pick = (i) => (pool[i] || allVoices()[i % allVoices().length]);
  return [
    { id: uuid(), name: 'Нарратор', emoji: '🎙', color: '#93a0b8', voice: pick(0).id, pitch: '+0Hz', rate: '+0%', volume: '+0%', style: '', type: 'edge', clipId: '' },
    { id: uuid(), name: 'Персонаж 1', emoji: '🧑', color: ROLE_COLORS[0], voice: pick(1).id, pitch: '+0Hz', rate: '+0%', volume: '+0%', style: '', type: 'edge', clipId: '' },
    { id: uuid(), name: 'Персонаж 2', emoji: '👩', color: ROLE_COLORS[1], voice: pick(2).id, pitch: '+0Hz', rate: '+0%', volume: '+0%', style: '', type: 'edge', clipId: '' },
  ];
}

function defaultProject() {
  return { kind: 'pages', pages: [], clips: [], roles: defaultRoles() };
}

let settings = defaultSettings();
let project = defaultProject();
let audioMgr = null;
let previewCtl = null;
let abortPreview = null;
let deferredPrompt = null;

/* ================================================================
 * Помощники
 * ================================================================ */
function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k === 'style') n.style.cssText = attrs[k];
    else if (k === 'dataset') Object.assign(n.dataset, attrs[k]);
    else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
}

function optEl(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function setProgress(p, text) {
  $('imp-progress-fill').style.width = Math.max(0, Math.min(100, Math.round((p || 0) * 100))) + '%';
  if (text) $('imp-progress-text').textContent = text;
}

function openModal(title, bodyClass = '') {
  $('modal-title').textContent = title;
  $('modal-body').className = bodyClass;
  $('modal').classList.remove('hidden');
  $('modal-body').replaceChildren();
}
function closeModal() {
  $('modal').classList.add('hidden');
  stopPreview();
  $('modal-body').replaceChildren();
}

function allBubbles() {
  const out = [];
  project.pages.forEach((p, pi) => {
    (p.bubbles || []).forEach((b) => out.push({ b, p, pi }));
  });
  return out;
}

function roleById(id) { return project.roles.find(r => r.id === id) || null; }

function defaultVoice() {
  const prefix = LANG_LOCALE[settings.lang] || 'ru';
  const pool = voicesForLang(prefix);
  return (pool[0] || allVoices()[0]).id;
}

function playUrl(url) {
  if (audioMgr) { try { audioMgr.pause(); } catch (e) {} }
  audioMgr = new Audio(url);
  audioMgr.play().catch(() => {});
}

/* Проигрывание Blob с автоочисткой object URL по окончании/ошибке */
function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const release = () => { audio.removeEventListener('ended', release); audio.removeEventListener('error', release); URL.revokeObjectURL(url); };
  audio.addEventListener('ended', release);
  audio.addEventListener('error', release);
  audio.play().catch(release);
}

/* автосохранение */
const autoSaveTimer = (() => {
  let t = null;
  return () => { clearTimeout(t); t = setTimeout(saveToDB, 600); };
})();
async function saveToDB() {
  try { await idbSet(KEY_SETTINGS, settings); } catch (e) {}
  try {
    const store = structuredClone(project);
    store.pages.forEach(p => delete p.url);
    await idbSet(KEY_PROJECT, store);
  } catch (e) {}
}

/* ================================================================
 * Импорт
 * ================================================================ */
async function handleFiles(files) {
  const list = [...files];
  if (!list.length) return;
  $('imp-progress').classList.remove('hidden');
  setProgress(0.02, 'Анализ файлов…');
  const isAudio = (f) => /^audio|^video/.test(f.type) || /\.(mp3|wav|ogg|m4a|aac|flac|opus|mp4|mkv|mov|avi|webm)$/i.test(f.name);
  const audioFiles = list.filter(isAudio);
  const pageFiles = list.filter(f => !audioFiles.includes(f));
  try {
    if (audioFiles.length && !pageFiles.length) await importAudio(audioFiles);
    else if (pageFiles.length) await importPages(pageFiles);
    else toast('Не получилось определить тип файлов', 'err');
  } catch (e) {
    toast(e.message || String(e), 'err');
  }
  $('imp-progress').classList.add('hidden');
  autoSaveTimer();
}

async function importPages(files) {
  project.kind = 'pages';
  project.pages = project.pages || [];
  const totalFiles = files.length;
  for (let f = 0; f < files.length; f++) {
    setProgress(f / totalFiles, `Разбор ${files[f].name}…`);
    const pages = await extractPages(files[f], { onProgress: (t, msg) => setProgress((f + t) / totalFiles, msg) });
    for (const page of pages) {
      const url = URL.createObjectURL(page);
      project.pages.push({ id: uuid(), url, file: page, filesize: page.size, w: 0, h: 0, bubbles: [] });
    }
  }
  await probeMetrics(project.pages);
  $('imp-kind-label').textContent = 'комикс / книга · страниц: ' + project.pages.length;
  showImpActions('pages');
  renderLib();
  toast('Добавлено страниц: ' + project.pages.length);
}

async function importAudio(files) {
  project.kind = 'clips';
  project.clips = project.clips || [];
  for (const file of files) {
    setProgress(0.15, `Декод ${file.name}…`);
    const { url, duration, sr, segs, samples } = await clipsFromAudio(file, {
      onProgress: (t) => setProgress(0.2 + t * 0.5, file.name),
    });
    setProgress(0.9, 'Нарезка по тишине…');
    const clipId = uuid();
    const segBlobs = segs.map((s) => ({
      startS: s.startS, endS: s.endS, duration: s.endS - s.startS,
      blob: samplesToWav(samples.subarray(Math.floor(s.startS * sr), Math.floor(s.endS * sr)), sr),
    }));
    project.clips.push({ id: clipId, name: file.name, url, duration, sr, count: segBlobs.length, segs: segBlobs });
  }
  $('imp-kind-label').textContent = 'аудио / голосовые нарезки · клипов: ' + project.clips.length;
  showImpActions('clips');
  renderLib();
  renderClipsGrid();
  toast('Звук нарезан на фразы');
}

function samplesToWav(samples, sr) {
  const n = samples.length;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, samples[i])); pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  const buf = new ArrayBuffer(44 + n * 2);
  const d = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); ws(8, 'WAVE');
  ws(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true);
  d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true);
  ws(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, pcm[i], true);
  return new Blob([buf], { type: 'audio/wav' });
}

async function probeMetrics(pages) {
  await Promise.all(pages.filter(p => !p.w).map(async (p) => {
    try {
      const img = await loadImage(p.url);
      p.w = img.naturalWidth || img.width || 1;
      p.h = img.naturalHeight || img.height || 1;
    } catch (e) { p.w = p.w || 1; p.h = p.h || 1; }
  }));
}

function showImpActions(kind) {
  const box = $('imp-actions');
  $('imp-modes').classList.remove('hidden');
  box.replaceChildren();
  if (kind === 'pages') {
    box.appendChild(el('button', { class: 'btn primary', onclick: () => ocrAll(true) }, ['🔎 Распознать весь текст']));
    box.appendChild(el('button', { class: 'btn', onclick: () => aiRoles() }, ['🎭 Раздать роли ИИ']));
  } else {
    box.appendChild(el('button', { class: 'btn', onclick: () => useFirstClipAsMusic() }, ['🎵 Сделать фоновой музыкой']));
  }
}

function useFirstClipAsMusic() {
  const clip = project.clips[0];
  if (!clip || !clip.segs.length) { toast('Нет нарезок', 'err'); return; }
  settings.musicBlob = clip.segs[0].blob;
  settings.musicUrl = URL.createObjectURL(settings.musicBlob);
  renderMusicLabel();
  toast('Клип добавлен фоновой музыкой');
}

function renderLib() {
  const mode = $('lib-mode-switch');
  const hasPages = !!project.pages.length;
  const hasClips = !!project.clips.length;
  mode.classList.remove('hidden');
  mode.querySelector('[data-mode=pages]').textContent = `Страницы (${project.pages.length})`;
  mode.querySelector('[data-mode=clips]').textContent = `Голосовые нарезки (${project.clips.length})`;
  if (hasPages) showPagesView();
  else if (hasClips) showClipsView();
  else {
    $('pages-grid').classList.remove('hidden');
    $('clips-list').classList.add('hidden');
    $('pages-empty').classList.remove('hidden');
  }
}

function showPagesView() {
  $('lib-mode-switch').querySelector('[data-mode=pages]').classList.add('active');
  $('lib-mode-switch').querySelector('[data-mode=clips]').classList.remove('active');
  $('pages-grid').classList.remove('hidden');
  $('clips-list').classList.add('hidden');
  $('pages-empty').classList.add('hidden');
  renderPagesGrid();
}
function showClipsView() {
  $('lib-mode-switch').querySelector('[data-mode=clips]').classList.add('active');
  $('lib-mode-switch').querySelector('[data-mode=pages]').classList.remove('active');
  $('pages-grid').classList.add('hidden');
  $('clips-list').classList.remove('hidden');
  $('pages-empty').classList.add('hidden');
  renderClipsList();
}

function renderPagesGrid() {
  const g = $('pages-grid');
  g.replaceChildren();
  $('pages-empty').classList.toggle('hidden', project.pages.length > 0);
  project.pages.forEach((p, i) => {
    const dot = el('div', { class: 'dot' + ((p.bubbles && p.bubbles.length) ? ' on' : '') });
    const rm = el('button', { class: 'rm', onclick: () => delPage(p.id) }, ['✕']);
    const wrap = el('div', { class: 'page', onclick: () => openPageEditor(p) }, [
      el('img', { src: p.url, alt: 'стр' }),
      el('span', { class: 'pn' }, [String(i + 1)]), dot, rm,
    ]);
    g.appendChild(wrap);
  });
}

function delPage(id) {
  const p = project.pages.find(x => x.id === id);
  if (p) URL.revokeObjectURL(p.url);
  project.pages = project.pages.filter(x => x.id !== id);
  renderPagesGrid(); renderScript(); scriptStatus(); autoSaveTimer();
}

function renderClipsList() {
  const list = $('clips-list');
  list.replaceChildren();
  const item = (c) => el('div', { class: 'item rowrow' }, [
    el('button', { class: 'btn mini', onclick: () => playUrl(c.url) }, ['▶']),
    el('div', { style: 'flex:1;min-width:0' }, [
      el('div', { html: c.name }),
      el('div', { class: 'muted' }, [`фраз: ${c.count} · ${fmtDur(c.duration)}`]),
    ]),
    el('button', { class: 'btn mini', onclick: () => useAsMusic(c) }, ['🎵']),
    el('button', { class: 'btn mini danger', onclick: () => delClip(c.id) }, ['✕']),
  ]);
  project.clips.forEach(c => list.appendChild(item(c)));
  renderClipsGrid();
}

/* Карточка «Нарезки голосов» на вкладке Голоса */
function renderClipsGrid() {
  const grid = $('clips-grid');
  if (!grid) return;
  grid.replaceChildren();
  project.clips.forEach(c => {
    grid.appendChild(el('div', { class: 'item rowrow' }, [
      el('button', { class: 'btn mini', onclick: () => playUrl(c.url) }, ['▶']),
      el('div', { style: 'flex:1;min-width:0' }, [
        el('div', { html: c.name }),
        el('div', { class: 'muted' }, [`фраз: ${c.count} · ${fmtDur(c.duration)}`]),
      ]),
      el('button', { class: 'btn mini', onclick: () => useAsMusic(c) }, ['🎵']),
      el('button', { class: 'btn mini danger', onclick: () => delClip(c.id) }, ['✕']),
    ]));
  });
}
function useAsMusic(clip) {
  if (!clip.segs.length) { toast('Нет фраз для музыки', 'err'); return; }
  settings.musicBlob = clip.segs[0].blob;
  settings.musicUrl = URL.createObjectURL(settings.musicBlob);
  renderMusicLabel();
  toast('Нарезанный клип → фоновая музыка');
}
function delClip(id) {
  project.clips = project.clips.filter(c => c.id !== id);
  renderClipsList();
}

/* ================================================================
 * OCR
 * ================================================================ */
async function ocrAll(goToScript) {
  const targets = project.pages;
  if (!targets.length) { toast('Нет страниц', 'err'); return; }
  $('imp-progress').classList.remove('hidden');
  const lang = settings.lang;
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    try {
      setProgress(i / targets.length, `OCR страницы ${i + 1}/${targets.length}…`);
      const res = await ocrPage({
        page: p, lang, settings,
        onProgress: (n) => setProgress(i / targets.length + n / targets.length, `OCR ${i + 1}/${targets.length}`),
      });
      p.bubbles = (res.bubbles || []).map(b => ({
        id: uuid(), text: b.text, tr: '', roleId: '', x: b.x, y: b.y, w: b.w, h: b.h,
      }));
      setProgress((i + 1) / targets.length, `стр. ${i + 1}: ${res.bubbles.length} реплик`);
    } catch (e) {
      console.error(e);
      toast('OCR: ' + e.message, 'err');
    }
  }
  $('imp-progress').classList.add('hidden');
  renderPagesGrid(); renderScript(); scriptStatus(); autoSaveTimer();
  if (goToScript) settab('script');
  toast('OCR завершён');
}

/* ================================================================
 * Роли / перевод / озвучка
 * ================================================================ */
async function aiRoles() {
  const bubbles = allBubbles();
  if (!bubbles.length) { toast('Сначала получите текст (OCR)', 'err'); return; }
  if (!bubbles.some(x => x.b.text.trim())) { toast('Реплики пусты', 'err'); return; }
  $('imp-progress').classList.remove('hidden');
  setProgress(0.1, 'ИИ думает о персонажах…');
  try {
    const lines = bubbles.map((x, idx) => ({ idx, page: x.pi, text: x.b.text || '' }));
    const r = await analyzeRoles(settings, lines);
    if (!r) throw new Error('ИИ не вернул роли');
    const genderMap = new Map((r.roles || []).map(x => [x.name, x.gender || 'other']));
    const roleIds = new Map();
    for (const rw of r.roles || []) {
      const name = (rw.name || '').trim() || 'Персонаж';
      let role = project.roles.find(x => x.name === name);
      if (!role) {
        const gender = genderMap.get(name) || 'other';
        const pool = voicesForLang(LANG_LOCALE[settings.lang] || 'ru');
        role = {
          id: uuid(), name, emoji: EMO_GENDER[gender] || '🧑',
          color: ROLE_COLORS[project.roles.length % ROLE_COLORS.length],
          voice: (pool.find(v => (v.gender || 'm') === (gender === 'male' ? 'm' : 'f')) || pool[0] || allVoices()[0]).id,
          pitch: '+0Hz', rate: '+0%', volume: '+0%', style: '', type: 'edge', clipId: '',
        };
        project.roles.push(role);
      }
      roleIds.set(name, role.id);
    }
    for (const it of (r.items || [])) {
      const bubble = bubbles[it.idx];
      if (bubble) bubble.b.roleId = roleIds.get(it.character) || roleIds.values().next().value || '';
    }
    renderRoles(); renderScript(); scriptStatus(); autoSaveTimer();
    toast('Роли раскиданы');
  } catch (e) {
    console.error(e);
    toast('Роли: ' + e.message, 'err');
  }
  $('imp-progress').classList.add('hidden');
}

async function translateAll() {
  const to = settings.trlang;
  if (to === 'donot') { toast('Перевод отключён в настройках', 'err'); return; }
  const bubbles = allBubbles().filter(x => x.b.text.trim());
  if (!bubbles.length) { toast('Нет реплик', 'err'); return; }
  $('imp-progress').classList.remove('hidden');
  setProgress(0.05, 'Перевод…');
  try {
    const target = { ru: 'русский', en: 'английский' }[to] || to;
    const out = await translateLines(settings, bubbles.map(x => ({ text: x.b.text })), target);
    bubbles.forEach((x, i) => { if (out[i] != null) x.b.tr = out[i]; });
    renderScript(); autoSaveTimer();
    toast('Переведено');
  } catch (e) {
    console.error(e);
    toast('Перевод: ' + e.message, 'err');
  }
  $('imp-progress').classList.add('hidden');
}

async function ttsAll() {
  if (settings.voiceBackend === 'browser') {
    toast('Браузерные голоса нельзя записать в видео — включите Edge-TTS', 'err');
    return;
  }
  const bubbles = allBubbles().filter(x => x.b.text.trim());
  if (!bubbles.length) { toast('Нет реплик для озвучки', 'err'); return; }
  $('imp-progress').classList.remove('hidden');
  for (let i = 0; i < bubbles.length; i++) {
    const { b } = bubbles[i];
    setProgress(i / bubbles.length, `Озвучка ${i + 1}/${bubbles.length}: ${b.text.slice(0, 40)}`);
    try {
      const role = roleById(b.roleId);
      if (role && role.type === 'clip' && role.clipId) {
        const clip = project.clips.find(c => c.id === role.clipId);
        if (clip && clip.segs.length) {
          const seg = clip.segs[i % clip.segs.length];
          b.audio = { blob: seg.blob, duration: seg.duration, noTrim: true };
          continue;
        }
      }
      const res = await synthesizeLine(settings, b.text, {
        voice: (role && role.voice) || defaultVoice(),
        pitch: (role && role.pitch) || '+0Hz',
        rate: (role && role.rate) || '+0%',
        volume: (role && role.volume) || '+0%',
        style: (role && role.style) || '',
      });
      if (res && res.blob) b.audio = { blob: res.blob, duration: 0 };
    } catch (e) {
      console.error(e);
      toast(`Ошибка озвучки #${i + 1}: ${e.message}`, 'err');
    }
  }
  for (const { b } of bubbles) {
    if (b.audio && b.audio.blob && !b.audio.duration) {
      try { b.audio.duration = await blobDuration(b.audio.blob); } catch (e) { b.audio.duration = 0; }
    }
  }
  setProgress(1, 'Готово');
  $('imp-progress').classList.add('hidden');
  renderScript(); autoSaveTimer();
  toast(`Озвучено реплик: ${allBubbles().filter(x => x.b.audio).length}/${bubbles.length}`);
}

function blobDuration(blob) {
  return new Promise((res, rej) => {
    const au = new Audio(URL.createObjectURL(blob));
    au.onloadedmetadata = () => { const d = au.duration || 0; URL.revokeObjectURL(au.src); res(d); };
    au.onerror = () => { URL.revokeObjectURL(au.src); rej(new Error('нет метаданных')); };
  });
}

function exportScript() {
  const rows = allBubbles().map(({ b, pi }) => ({
    page: pi + 1, role: (roleById(b.roleId) || {}).name || '', text: b.text || '', tr: b.tr || '', voiced: !!b.audio,
  }));
  const txt = rows.map(r => `[${r.page}] ${r.role ? r.role + ': ' : ''}${r.text}${r.tr ? ` (${r.tr})` : ''}`).join('\n');
  download(new Blob([txt], { type: 'text/plain;charset=utf-8' }), 'scenario.txt');
  download(new Blob([JSON.stringify({ projectName: PROJECT_NAME, rows }, null, 2)], { type: 'application/json' }), 'scenario.json');
}

/* ================================================================
 * Редактор пузырей (просмотр страницы)
 * ================================================================ */
function openPageEditor(page) {
  openModal('Страница ' + (project.pages.indexOf(page) + 1));
  const body = $('modal-body');
  const wrap = el('div', {}, []);
  (async () => {
    try {
      const img = await loadImage(page.url);
      const cvs = el('canvas');
      const cw = Math.min(520, img.naturalWidth || img.width || 600);
      const ch = Math.round(cw * ((img.naturalHeight || 900) / (img.naturalWidth || 600)));
      cvs.width = cw; cvs.height = ch;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0, cw, ch);
      const sx = cw / (page.w || cw), sy = ch / (page.h || ch);
      (page.bubbles || []).forEach((b, i) => {
        const role = roleById(b.roleId);
        ctx.strokeStyle = role ? role.color : '#ffb454';
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x * sx, b.y * sy, (b.w || 20) * sx, (b.h || 20) * sy);
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(b.x * sx, b.y * sy, 16, 16);
        ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.fillText(String(i + 1), b.x * sx + 3, b.y * sy + 13);
      });
      wrap.replaceChildren(cvs);
    } catch (e) { wrap.replaceChildren(el('div', { class: 'empty' }, ['Не удалось показать страницу'])); }
  })();
  body.appendChild(wrap);
  const list = el('div', { class: 'list', style: 'margin-top:10px' });
  (page.bubbles || []).forEach((b, i) => {
    const ta = el('textarea', { style: 'width:100%;min-height:52px;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:6px' });
    ta.value = b.text || '';
    ta.oninput = () => { b.text = ta.value; autoSaveTimer(); };
    const sel = roleSelect((id) => { b.roleId = id; renderScript(); autoSaveTimer(); }, b.roleId);
    const play = el('button', { class: 'btn mini', onclick: () => bubblePlay(b) }, [b.audio ? '▶' : '🗣']);
    const delB = el('button', { class: 'btn mini danger', onclick: () => { page.bubbles.splice(i, 1); closeModal(); openPageEditor(page); renderScript(); autoSaveTimer(); } }, ['✕']);
    list.appendChild(el('div', { class: 'item' }, [
      el('div', { class: 'row' }, [el('b', {}, [`${i + 1}.`]), sel, play, delB]),
      el('div', { style: 'margin-top:6px' }, [ta]),
    ]));
  });
  const addBtn = el('button', {
    class: 'btn mini', onclick: () => {
      page.bubbles.push({ id: uuid(), text: '', tr: '', roleId: '', x: 10, y: 10, w: 120, h: 40 });
      closeModal(); openPageEditor(page); renderScript(); autoSaveTimer();
    },
  }, ['＋ Пузырь']);
  body.appendChild(el('div', { class: 'list' }, [list, el('div', { style: 'margin-top:10px' }, [addBtn])]));
}

function roleSelect(handler, current) {
  const sel = el('select', { style: 'max-width:52%;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:4px' });
  sel.appendChild(el('option', { value: '' }, ['— роль —']));
  project.roles.forEach(r => sel.appendChild(el('option', { value: r.id }, [`${r.emoji} ${r.name}`])));
  sel.value = current || '';
  sel.onchange = () => handler(sel.value);
  return sel;
}

async function bubblePlay(b) {
  if (b.audio && b.audio.blob) { playBlob(b.audio.blob); return; }
  const role = roleById(b.roleId);
  try {
    const res = await synthesizeLine(settings, b.text || '', {
      voice: (role && role.voice) || defaultVoice(),
      pitch: (role && role.pitch) || '+0Hz', rate: (role && role.rate) || '+0%',
      volume: (role && role.volume) || '+0%', style: (role && role.style) || '',
    });
    if (res && res.blob) { b.audio = { blob: res.blob, duration: 0 }; playBlob(res.blob); toast('Реплика озвучена (Edge)'); autoSaveTimer(); }
    else if (res && res.browser) res.play?.(); 
    renderScript();
  } catch (e) { toast('Озвучка: ' + e.message, 'err'); }
}

/* ================================================================
 * Сценарий: список реплик
 * ================================================================ */
function renderScript() {
  const list = $('script-list');
  const byPage = $('script-pages');
  const empty = $('script-empty');
  const items = allBubbles();
  empty.classList.toggle('hidden', items.length > 0);

  list.replaceChildren();
  byPage.replaceChildren();
  items.forEach(({ b, pi }) => {
    const role = roleById(b.roleId);
    const sel = roleSelect((id) => { b.roleId = id; renderRoles(); renderScript(); autoSaveTimer(); }, b.roleId);
    const inp = el('input', { style: 'flex:1;min-width:0;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:6px 8px', value: b.text || '', placeholder: 'реплика…' });
    inp.oninput = () => { b.text = inp.value; autoSaveTimer(); };
    const play = el('button', {
      class: 'btn mini', title: b.audio ? 'прослушать' : 'озвучить', onclick: () => bubblePlay(b),
    }, [b.audio ? '▶' : '🗣']);
    const delB = el('button', {
      class: 'btn mini danger', onclick: () => { b.audio = null; renderScript(); autoSaveTimer(); },
    }, ['🗑']);
    const color = role ? role.color : '#ffb454';
    list.appendChild(el('div', { class: 'item' }, [
      el('div', { class: 'row' }, [
        el('span', { style: 'color:' + color + ';font-weight:700;min-width:34px' }, [String(pi + 1)]),
        inp, sel, play, delB,
      ]),
      el('div', { class: 'row muted', style: 'font-size:11px;margin-top:4px;gap:10px' }, [
        b.tr ? `перевод: ${b.tr}` : '', b.audio ? '🔊' : '',
      ]),
    ]));
  });
  // вид «по страницам»
  (project.pages || []).forEach((p, pi) => {
    const bubbles = p.bubbles || [];
    const card = el('div', { class: 'item' }, [
      el('b', {}, [`Страница ${pi + 1} · ${bubbles.length} реплик`]),
      ...bubbles.map((b, bi) => {
        const role = roleById(b.roleId);
        return el('div', {
          class: 'row', style: 'margin-top:6px;gap:8px;border-top:1px solid #2c3a5e;padding-top:6px',
        }, [
          el('span', { style: 'color:' + (role ? role.color : '#ffb454') }, [`${bi + 1}.`]),
          el('span', { style: 'flex:1' }, [b.text || '…']),
          el('button', { class: 'btn mini', onclick: () => bubblePlay(b) }, [b.audio ? '▶' : '🗣']),
        ]);
      }),
    ]);
    byPage.appendChild(card);
  });
}

function scriptStatus() {
  const items = allBubbles();
  const voiced = items.filter(x => x.b.audio).length;
  const withRole = items.filter(x => x.b.roleId).length;
  $('script-status').textContent =
    `Реплик: ${items.length} · с ролью: ${withRole} · озвучено: ${voiced}/${items.length} · страниц: ${project.pages.length}`;
}

/* ================================================================
 * Роли (труппа)
 * ================================================================ */
function renderRoles() {
  const list = $('roles-list');
  list.replaceChildren();
  project.roles.forEach(r => {
    const voiceSel = el('select', { style: 'flex:1;min-width:120px;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:4px' });
    const prefix = LANG_LOCALE[settings.lang] || 'ru';
    const voices = voicesForLang(prefix);
    const pool = voices.length ? voices : allVoices();
    if (!pool.some(v => v.id === r.voice)) pool.unshift(voiceByIdSafe(r.voice));
    pool.forEach(v => voiceSel.appendChild(el('option', { value: v.id }, [v.id])));
    voiceSel.value = r.voice;
    voiceSel.onchange = () => { r.voice = voiceSel.value; autoSaveTimer(); toast('Голос: ' + r.voice); };

    const nameInp = el('input', { style: 'flex:1;min-width:90px;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:5px 8px', value: r.name || '' });
    nameInp.oninput = () => { r.name = nameInp.value; autoSaveTimer(); };

    const emo = el('input', { style: 'width:44px;text-align:center;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:5px', value: r.emoji || '🧑' });
    emo.oninput = () => { r.emoji = emo.value; autoSaveTimer(); };

    const st = el('select', { style: 'background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:4px' });
    st.appendChild(el('option', { value: '' }, ['— стиль —']));
    TTS_STYLES.filter(s => s).forEach(s => st.appendChild(el('option', { value: s }, [s])));
    st.value = r.style || '';
    st.onchange = () => { r.style = st.value; autoSaveTimer(); };

    const typeSel = el('select', { style: 'background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:4px' });
    typeSel.appendChild(el('option', { value: 'edge' }, ['Edge-TTS']));
    typeSel.appendChild(el('option', { value: 'clip' }, ['Свой клип']));
    typeSel.value = r.type || 'edge';
    const clipSel = el('select', { style: 'flex:1;min-width:110px;background:#0f1420;border:1px solid #2c3a5e;color:#e8edf7;border-radius:8px;padding:4px' });
    clipSel.appendChild(el('option', { value: '' }, ['— клип —']));
    (project.clips || []).forEach(c => clipSel.appendChild(el('option', { value: c.id }, [c.name])));
    clipSel.value = r.clipId || '';
    clipSel.disabled = typeSel.value !== 'clip';
    typeSel.onchange = () => { r.type = typeSel.value; clipSel.disabled = typeSel.value !== 'clip'; autoSaveTimer(); };
    clipSel.onchange = () => { r.clipId = clipSel.value; autoSaveTimer(); };

    const pit = slider('-40', '40', '1', r.pitchNum != null ? r.pitchNum : 0, (v) => { r.pitchNum = +v; r.pitch = (+v > 0 ? '+' : '') + v + 'Hz'; autoSaveTimer(); }, 'Hz', label('Высота'));
    const rate = slider('-50', '100', '5', r.rateNum != null ? r.rateNum : 0, (v) => { r.rateNum = +v; r.rate = (+v > 0 ? '+' : '') + v + '%'; autoSaveTimer(); }, '%', label('Темп'));
    const vol = slider('10', '200', '5', r.volumeNum != null ? r.volumeNum : 100, (v) => { r.volumeNum = +v; r.volume = (+v - 100 > 0 ? '+' : '') + (v - 100) + '%'; autoSaveTimer(); }, '%', label('Громкость'));

    const delB = el('button', {
      class: 'btn mini danger', onclick: () => {
        project.roles = project.roles.filter(x => x.id !== r.id);
        (project.pages || []).forEach(p => (p.bubbles || []).forEach(b => { if (b.roleId === r.id) b.roleId = ''; }));
        renderRoles(); renderScript(); autoSaveTimer();
      },
    }, ['✕']);

    list.appendChild(el('div', { class: 'item' }, [
      el('div', { class: 'row wrap' }, [emo, nameInp, typeSel, clipSel, delB]),
      el('div', { class: 'row wrap', style: 'margin-top:6px' }, [voiceSel, st]),
      el('div', { class: 'row wrap', style: 'margin-top:6px' }, [pit, rate, vol]),
    ]));
  });
}

function label(t) { return el('span', { class: 'muted', style: 'font-size:11px;min-width:54px' }, [t]); }
function slider(min, max, step, value, onChange, suffix, lbl) {
  const inp = el('input', { type: 'range', min, max, step, value });
  const out = el('span', { class: 'muted' }, [String(value) + suffix]);
  inp.oninput = () => { onChange(inp.value); out.textContent = inp.value + suffix; };
  return el('div', { class: 'row', style: 'gap:8px;flex:1;min-width:150px' }, [lbl, inp, out]);
}

function voiceByIdSafe(id) {
  const v = allVoices().find(x => x.id === id);
  return v || { id: id || 'ru-RU-DmitryNeural', lang: 'ru-RU', gender: 'm' };
}

function addRole() {
  const pool = voicesForLang(LANG_LOCALE[settings.lang] || 'ru');
  project.roles.push({
    id: uuid(), name: 'Персонаж ' + (project.roles.length + 1), emoji: '🧑',
    color: ROLE_COLORS[project.roles.length % ROLE_COLORS.length],
    voice: (pool[project.roles.length] || allVoices()[project.roles.length % allVoices().length]).id,
    pitch: '+0Hz', rate: '+0%', volume: '+0%', style: '', type: 'edge', clipId: '',
  });
  renderRoles(); autoSaveTimer();
}

/* ================================================================
 * Монтаж: предпросмотр и рендер
 * ================================================================ */
function renderMusicLabel() {
  const elL = document.querySelector('#opt-mvol + span.muted');
  if (elL) elL.textContent = settings.mvol + '%';
}

async function doPreview() {
  if (!project.pages.length) { toast('Нет страниц', 'err'); return; }
  stopPreview();
  project.settings = settings;
  const { w, h } = await resolveCanvas(settings.res, project);
  openModal('Предпросмотр', 'cv');
  const body = $('modal-body');
  const canvas = el('canvas', { style: `width:100%;object-fit:contain;background:#000;max-height:62vh` });
  body.appendChild(canvas);
  const hints = el('div', { class: 'muted', style: 'text-align:center;padding:6px' }, ['▶ играет…']);
  body.appendChild(hints);
  let abortResolve = null;
  const abort = new Promise(r => { abortResolve = r; });
  abortPreview = abortResolve;
  try {
    const ctl = previewStart(project, canvas, { w, h }, (p, m) => {
      hints.textContent = '▶ ' + (m || '…');
      if (p >= 1) hints.textContent = '■ конец';
    }, abort);
    previewCtl = ctl;
    const res = await ctl.done;
    if (!(res && res.stopped)) hints.textContent = '■ конец';
  } catch (e) {
    hints.textContent = 'ошибка: ' + e.message;
  }
  previewCtl = null;
  abortPreview = null;
}

function stopPreview() {
  if (previewCtl) {
    try { previewCtl.stop(); } catch (e) {}
    previewCtl = null;
  }
  if (abortPreview) { abortPreview(); abortPreview = null; }
}

async function doRender() {
  if (!project.pages.length) { toast('Сначала добавьте страницы', 'err'); return; }
  project.settings = settings;
  const voiced = allBubbles().filter(x => x.b.audio).length;
  if (!voiced) { toast('Реплики не озвучены — нажмите «Озвучить все»', 'err'); }
  const card = $('render-status-card');
  card.classList.remove('hidden');
  const fill = $('render-fill');
  const log = $('render-log');
  fill.style.width = '0%'; log.textContent = ''; $('dl-link')?.classList.add('hidden');
  card.querySelectorAll('.render-extra').forEach((n) => n.remove());
  try {
    const out = await renderAndRecord(project, {
      res: settings.res, fps: settings.fps,
    }, (p, m) => {
      fill.style.width = Math.round(p * 100) + '%';
      if (m) { log.textContent = m; }
    });
    if (out.error) throw out.error;
    const name = 'voicecomic_' + Date.now() + '.' + out.ext;
    const a = $('dl-link');
    a.href = URL.createObjectURL(out.blob);
    a.download = name;
    a.textContent = '💾 Скачать ' + name + ' (' + fmtDur(out.duration) + ')';
    a.classList.remove('hidden');
    const wrap = el('div', { class: 'row wrap render-extra', style: 'margin-top:8px' }, [
      el('button', { class: 'btn mini', onclick: () => convMp4(out.blob, log) }, ['▶ MP4 (ffmpeg)']),
      el('button', { class: 'btn mini', onclick: () => convGif(out.blob, log) }, ['◆ GIF (ffmpeg)']),
    ]);
    card.appendChild(wrap);
    toast('Видео готово');
  } catch (e) {
    console.error(e);
    log.textContent = 'Ошибка: ' + (e.message || e);
    toast('Рендер: ' + e.message, 'err');
  }
}

async function convMp4(blob, log) {
  try {
    log.textContent = 'загрузка ffmpeg.wasm…';
    const r = await toMP4(blob, (m) => { log.textContent = m; });
    download(r.blob, 'voicecomic_' + Date.now() + '.mp4');
    toast('MP4 готов');
  } catch (e) { log.textContent = 'MP4: ' + e.message; toast('MP4: ' + e.message, 'err'); }
}
async function convGif(blob, log) {
  try {
    log.textContent = 'загрузка ffmpeg.wasm…';
    const r = await toGIF(blob, (m) => { log.textContent = m; });
    download(r.blob, 'voicecomic_' + Date.now() + '.gif');
    toast('GIF готов');
  } catch (e) { log.textContent = 'GIF: ' + e.message; toast('GIF: ' + e.message, 'err'); }
}

async function doAudioOnly() {
  if (!allBubbles().some(x => x.b.audio)) { toast('Сначала озвучьте реплики', 'err'); return; }
  project.settings = settings;
  const card = $('render-status-card');
  card.classList.remove('hidden');
  const fill = $('render-fill');
  const log = $('render-log');
  fill.style.width = '0%'; log.textContent = '';
  card.querySelectorAll('.render-extra').forEach((n) => n.remove());
  try {
    const out = await renderAudioTrack(project, (p, m) => { fill.style.width = Math.round(p * 100) + '%'; if (m) log.textContent = m; });
    download(out.blob, 'voicecomic_audio_' + Date.now() + '.wav');
    const mp3Btn = el('button', { class: 'btn mini render-extra', style: 'margin-top:8px', onclick: async () => { log.textContent = 'mp3…'; const r = await wavToMp3(out.blob, (m) => log.textContent = m); download(r.blob, 'voicecomic_audio_' + Date.now() + '.mp3'); } }, ['▶ MP3']);
    card.appendChild(mp3Btn);
    toast('Аудио-дорожка готова');
  } catch (e) { console.error(e); toast('Аудио: ' + e.message, 'err'); }
}

/* ================================================================
 * Настройки: поля и проект
 * ================================================================ */
function bindSettings() {
  populateProviderSelect();
  populateOcrSelect();
  bindSel('opt-ocr');
  bindSel('opt-detect');
  bindSel('opt-lang');
  bindSel('opt-trlang');
  bindSel('opt-ai');
  bindInp('opt-key');
  bindInp('opt-aiurl');
  bindInp('opt-zenrelay');
  setupModelUi();
  bindSel('opt-voicebackend');
  bindInp('opt-proxy');
  bindInp('opt-backend-url');
  bindInp('opt-backend-token');
  bindSel('opt-res');
  bindSel('opt-zoom');
  bindSel('opt-caption');
  bindSel('opt-biling');
  bindRange('opt-fps', 'opt-fps-v', (v) => settings.fps = +v, 'fps');
  bindRange('opt-gap', 'opt-gap-v', (v) => settings.gap = +v, (v) => (v / 1000).toFixed(2) + ' c');
  bindRange('opt-mvol', 'opt-mvol-v', (v) => settings.mvol = +v, (v) => v + '%');
  $('opt-music').addEventListener('change', (e) => {
    if (!e.target.files.length) return;
    const f = e.target.files[0];
    settings.musicBlob = f;
    settings.musicUrl = URL.createObjectURL(f);
    toast('Музыка: ' + f.name);
  });
}

function bindSel(id) {
  const elEl = $(id);
  const key = id.replace(/^opt-/, '');
  elEl.value = settings[key] != null ? settings[key] : '';
  elEl.addEventListener('change', () => {
    settings[key] = elEl.value;
    if (key === 'ai') {
      const p = provider(settings.ai);
      if (settings.aimodel && p.models && !p.models.some(m => m.id === settings.aimodel)) {
        settings.aimodel = p.models[0] ? p.models[0].id : 'openai';
      } else if (!settings.aimodel) {
        settings.aimodel = p.models[0] ? p.models[0].id : 'openai';
      }
      populateModelSelect();
    }
    if (key === 'ai' || key === 'ocr') syncProviderUi();
    autoSaveTimer();
  });
}

/* Провайдер в каталоге? */
function defaultModelFor(pid) {
  const p = provider(pid);
  return p.models[0] ? p.models[0].id : '';
}

function populateProviderSelect() {
  const sel = $('opt-ai');
  sel.replaceChildren();
  const entries = Object.entries(PROVIDERS);
  entries.sort((a, b) => {
    const ka = (a[1].curated ? 0 : 1), kb = (b[1].curated ? 0 : 1);
    if (ka !== kb) return ka - kb;
    const fa = (a[1].key === false ? 0 : 1), fb = (b[1].key === false ? 0 : 1);
    if (fa !== fb) return fa - fb;
    return a[1].name.localeCompare(b[1].name, 'ru');
  });
  entries.forEach(([id, p]) => {
    const tag = p.key === false ? ' 🆓 без ключа' : (p.curated ? ' 🔑' : ' · каталог');
    if (!p.models || !p.models.length) return;
    sel.appendChild(el('option', { value: id }, [p.name.includes('·') ? p.name : p.name + tag]));
  });
  if (!PROVIDERS[settings.ai]) settings.ai = 'pollinations';
  sel.value = settings.ai;
}

/* OCR-селект: Tesseract (всегда) + все vision-провайдеры каталога. */
function populateOcrSelect() {
  const sel = $('opt-ocr');
  const cur = sel.value || settings.ocr || 'tesseract';
  sel.replaceChildren();
  sel.appendChild(el('option', { value: 'tesseract' }, ['Tesseract (локально, без интернета)']));
  const vision = Object.entries(PROVIDERS)
    .filter(([id, p]) => providerHasVision(id))
    .sort((a, b) => {
      const ka = (a[1].curated ? 0 : 1), kb = (b[1].curated ? 0 : 1);
      if (ka !== kb) return ka - kb;
      const fa = (a[1].key === false ? 0 : 1), fb = (b[1].key === false ? 0 : 1);
      if (fa !== fb) return fa - fb;
      return a[1].name.localeCompare(b[1].name, 'ru');
    });
  let hasCur = 'tesseract' === cur;
  vision.forEach(([id, p]) => {
    sel.appendChild(el('option', { value: id }, [id + ' — ' + p.name.split(' ·')[0] + (p.key === false ? ' (без ключа)' : '')]));
    if (id === cur) hasCur = true;
  });
  sel.value = hasCur ? cur : 'tesseract';
}

/* Селект моделей: кнопка-пикер + поле свободного ввода. */
function setupModelUi() {
  const custom = $('opt-aimodel-custom');
  modelsuiSetSettings(() => settings);
  renderModelCurrent();
  custom.dataset.typed = '0';
  $('btnPickModel').addEventListener('click', () => {
    openModelPicker({
      settings,
      onSelect: (pid, mid) => {
        settings.ai = pid;
        settings.aimodel = mid;
        $('opt-ai').value = pid;
        $('opt-aimodel-custom').value = mid;
        $('opt-aimodel-custom').dataset.typed = '0';
        syncProviderUi();
        renderModelCurrent();
        populateOcrSelect();
        autoSaveTimer();
        toast('Модель: ' + provider(pid).name.split(' ·')[0] + ' · ' + mid);
        if (window.onSettingsChanged) window.onSettingsChanged(settings);
      },
    });
  });
  custom.addEventListener('input', () => { settings.aimodel = custom.value; custom.dataset.typed = '1'; renderModelCurrent(); autoSaveTimer(); });
}

/* Текущая выбранная модель: подпись на кнопке и подсказка. */
function renderModelCurrent() {
  const btn = $('btnPickModel');
  const cur = $('aimodel-current');
  if (!btn || !cur) return;
  const p = provider(settings.ai);
  const pid = settings.ai;
  const mid = settings.aimodel || (p.models[0] ? p.models[0].id : 'openai');
  const mt = modelMeta(pid, mid);
  btn.textContent = '🔍 ' + (mt.nokey ? '🆓 ' : mt.free ? '' : '') + (mt.label || mid) + ' — ' + mt.providerName;
  const tags = [
    mt.nokey ? 'без ключа' : (mt.free ? 'бесплатно' : 'платно'),
    mt.vision ? 'vision' : '',
    mt.curated ? 'проверено' : 'каталог',
  ].filter(Boolean);
  cur.textContent = 'Провайдер: ' + pid + (mt.nokey ? ' (без ключа)' : '') + ' · ' + mid + ' · ' + tags.join(' / ');
}

function populateModelSelect() { renderModelCurrent(); }

function syncModelUi() {
  const custom = $('opt-aimodel-custom');
  if (custom && custom.dataset.typed !== '1') custom.value = settings.aimodel || '';
  renderModelCurrent();
}

async function refreshModelList() {
  toast('Обновляю список моделей без ключа…');
  const list = await refreshFreeModels();
  renderModelCurrent();
  toast('Моделей без ключа (Pollinations): ' + list.length + ' (' + list.slice(0, 10).join(', ') + (list.length > 10 ? '…' : '') + ')');
}
function bindInp(id) {
  const elEl = $(id);
  const key = id.replace(/^opt-/, '');
  elEl.value = settings[key] != null ? settings[key] : '';
  elEl.addEventListener('input', () => { settings[key] = elEl.value; autoSaveTimer(); });
}
function bindRange(id, labelId, apply, fmt) {
  const elEl = $(id);
  elEl.value = settings[id.replace(/^opt-/, '')] != null ? settings[id.replace(/^opt-/, '')] : elEl.value;
  const lbl = $(labelId);
  const raw = elEl.value;
  lbl.textContent = typeof fmt === 'function' ? fmt(raw) : raw + ' ' + fmt;
  elEl.addEventListener('input', () => {
    apply(elEl.value);
    const v = elEl.value;
    lbl.textContent = typeof fmt === 'function' ? fmt(v) : v + ' ' + fmt;
    autoSaveTimer();
  });
}

function syncProviderUi() {
  const p = provider(settings.ai);
  const custom = settings.ai === 'custom';
  const keyless = settings.ai === 'pollinations';
  $('f-opt-key').hidden = !(p.key === true);
  $('f-opt-aiurl').hidden = !custom;
  $('f-opt-zenrelay').hidden = settings.ai !== 'opencode';
  $('f-opt-aimodel').hidden = false;
  $('opt-aimodel-custom').hidden = !(custom || keyless || settings.ai === 'opencode');
  $('f-opt-proxy').hidden = settings.voiceBackend !== 'edge-proxy';
}

function renderVoiceCount() {
  $('voice-count').textContent = 'В каталоге голосов: ' + allVoices().length;
}

async function fetchAllVoices() {
  try {
    const list = await fetchVoicesFromMicrosoft();
    renderVoiceCount(); renderRoles();
    toast('Голосов на сервере: ' + list.length);
  } catch (e) { toast('voices: ' + e.message, 'err'); }
}

/* Статус модели облачков + скачивание по кнопке */
async function renderBubbleModelStatus() {
  const el = $('bubble-model-status');
  if (!el) return;
  const modelId = getYoloModel();
  const info = getModelInfo(modelId);
  const st = await bubbleModelStatus();
  const size = info ? (info.size / 1048576).toFixed(1) : (bubbleModelTargetBytes(modelId) / 1048576).toFixed(1);
  if (st.ready) el.textContent = 'модель на устройстве (' + (st.bytes / 1048576).toFixed(1) + 'МБ)';
  else el.textContent = 'не скачана (около ' + size + 'МБ)';
  // показать/скрыть кастомное поле
  const customDiv = $('custom-yolo-url');
  if (customDiv) customDiv.classList.toggle('hidden', modelId !== 'custom');
}

async function wireBubbleModel() {
  const btn = $('btnBubbleModel');
  const modelSel = $('opt-yolo-model');
  if (!btn) return;
  renderBubbleModelStatus();
  if (modelSel) {
    modelSel.value = getYoloModel();
    modelSel.addEventListener('change', async () => {
      const mid = modelSel.value;
      if (mid === 'custom') {
        // wait for user to enter URL
        return;
      }
      setYoloModel(mid);
      renderBubbleModelStatus();
      toast('Модель: ' + (getModelInfo(mid)?.name || mid));
    });
  }
  const customUrlInput = $('opt-yolo-custom-url');
  if (customUrlInput) {
    customUrlInput.addEventListener('change', async () => {
      const url = customUrlInput.value.trim();
      if (url) {
        // register custom model dynamically
        YOLO_MODELS.custom = {
          id: 'custom',
          name: 'Кастомная модель',
          url,
          size: 0,
          nPred: 37,
          imgsz: 640,
        };
        setYoloModel('custom');
        toast('Кастомная модель установлена');
      }
    });
  }
  btn.addEventListener('click', async () => {
    const modelId = getYoloModel();
    const info = getModelInfo(modelId);
    const st = await bubbleModelStatus();
    if (st.ready) {
      if (!confirm('Модель уже скачана. Удалить и скачать заново?')) return;
      await bubbleModelClear();
    }
    btn.disabled = true;
    btn.textContent = '⬇ Скачивание…';
    const size = info ? info.size : 0;
    setProgress(0, 'Скачиваю модель облачков (' + (size/1048576).toFixed(0) + 'МБ)…');
    $('imp-progress').classList.remove('hidden');
    try {
      await downloadBubbleModel((p) => {
        setProgress(p, 'Скачиваю модель облачков: ' + Math.round(p * 100) + '%');
      });
      toast('Модель облачков скачана');
    } catch (e) { toast('Скачивание: ' + e.message, 'err'); }
    $('imp-progress').classList.add('hidden');
    setProgress(0);
    btn.disabled = false;
    btn.textContent = '⬇ Скачать выбранную модель';
    renderBubbleModelStatus();
  });
}

async function saveProject() { try { await saveToDB(); toast('Сохранено в IndexedDB'); } catch (e) { toast('Ошибка сохранения: ' + e.message, 'err'); } }

function exportProject() {
  const store = {
    kind: project.kind,
    roles: project.roles,
    clips: (project.clips || []).map(c => ({ id: c.id, name: c.name, duration: c.duration, count: c.count })),
    pages: project.pages.map(p => ({
      id: p.id, w: p.w, h: p.h, name: p.name || '',
      bubbles: (p.bubbles || []).map(b => ({ id: b.id, text: b.text, tr: b.tr, roleId: b.roleId, x: b.x, y: b.y, w: b.w, h: b.h })),
    })),
  };
  download(new Blob([JSON.stringify({ version: 1, settings, project: store }, null, 2)], { type: 'application/json' }), 'voicecomic_project.json');
  toast('Экспортирован сценарий без звука/страниц — файлы импортируйте отдельно');
}

async function importProject(file) {
  try {
    const j = JSON.parse(await file.text());
    if (!j.project) throw new Error('Файл не похож на проект VoiceComic');
    settings = Object.assign(defaultSettings(), j.settings || {});
    const imp = j.project;
    if (Array.isArray(imp.roles) && imp.roles.length) project.roles = imp.roles;
    if (Array.isArray(imp.pages)) {
      (imp.pages).forEach(ip => {
        const own = project.pages.find(p => p.id === ip.id);
        if (own) {
          own.w = ip.w; own.h = ip.h;
          own.bubbles = (ip.bubbles || []).map(b => ({ ...b, audio: undefined }));
        }
      });
    }
    bindSettings(); syncModelUi(); syncProviderUi(); renderAll();
    toast('Проект импортирован: роли и тексты восстановлены');
  } catch (e) { toast('Импорт: ' + e.message, 'err'); }
}

function resetAll() {
  stopPreview();
  project.pages.forEach(p => { if (p.url) URL.revokeObjectURL(p.url); });
  project = defaultProject();
  settings = defaultSettings();
  bindSettings(); syncModelUi(); syncProviderUi(); renderAll();
  toast('Сброс выполнен');
}

/* ================================================================
 * Рендер всех разделов + листeners
 * ================================================================ */
function renderAll() {
  renderLib();
  renderRoles();
  renderScript();
  scriptStatus();
  renderVoiceCount();
  renderMusicLabel();
  renderClipsGrid();
}

function settab(name) {
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  document.querySelectorAll('#tabsbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  location.hash = name;
}

function bindLibSwitch() {
  $('lib-mode-switch').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => btn.dataset.mode === 'pages' ? showPagesView() : showClipsView());
  });
  document.querySelector('#tab-script .seg').querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      const listView = btn.dataset.view === 'list';
      btn.classList.toggle('active', listView);
      document.querySelector('#tab-script .seg button[data-view=pages]').classList.toggle('active', !listView);
      $('script-list').classList.toggle('hidden', !listView);
      $('script-pages').classList.toggle('hidden', listView);
    });
  });
}

async function wire() {
  document.querySelectorAll('#tabsbar button').forEach(b =>
    b.addEventListener('click', () => settab(b.dataset.tab)));
  if (location.hash) settab(location.hash.replace('#', ''));

  const fileInput = $('fileInput');
  const dropzone = $('dropzone');
  $('btnPick').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { handleFiles(fileInput.files); fileInput.value = ''; });
  ['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
  dropzone.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });

  $('clipFile').addEventListener('change', (e) => { if (e.target.files.length) importAudio([...e.target.files]); e.target.value = ''; });
  $('recFile').addEventListener('change', (e) => { if (e.target.files.length) importAudio([...e.target.files]); e.target.value = ''; });

  $('btnImprov').addEventListener('click', () => aiRoles());
  $('btnOcrAll').addEventListener('click', () => ocrAll(false));
  $('btnRolesAi').addEventListener('click', () => aiRoles());
  $('btnTranslate').addEventListener('click', () => translateAll());
  $('btnTtsAll').addEventListener('click', () => ttsAll());
  $('btnSubs').addEventListener('click', () => exportScript());

  $('btnAddRole').addEventListener('click', () => addRole());
  $('btnPreview').addEventListener('click', () => doPreview());
  $('btnRender').addEventListener('click', () => doRender());
  $('btnAudioOnly').addEventListener('click', () => doAudioOnly());

  $('btnFetchVoices').addEventListener('click', () => fetchAllVoices());
  $('btnRefreshModels').addEventListener('click', () => refreshModelList());
  wireBubbleModel();
  wireBackend();
  $('btnSave').addEventListener('click', () => saveProject());
  $('btnExportJson').addEventListener('click', () => exportProject());
  $('jsonImport').addEventListener('change', (e) => { if (e.target.files[0]) importProject(e.target.files[0]); e.target.value = ''; });
  $('btnReset').addEventListener('click', () => { if (confirm('Сбросить проект и настройки?')) resetAll(); });
  $('btnNew').addEventListener('click', () => { if (confirm('Начать новый проект?')) resetAll(); });
  $('btnMenu').addEventListener('click', () => settab('settings'));

  $('modal-close').addEventListener('click', () => closeModal());
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

  bindLibSwitch();

  if ('beforeinstallprompt' in window) {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredPrompt = e; $('btnInstall').classList.remove('hidden'); });
    $('btnInstall').addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $('btnInstall').classList.add('hidden');
    });
  }
  setupServiceWorker();
  $('pwa-status').textContent = deferredPrompt ? 'Приложение можно установить кнопкой ⬇ вверху.' : 'Работает в браузере / как PWA. Установка предлагается после второго посещения.';
}

/* Service worker: автообновление страницы в браузере и в APK.
 * Новая версия SW забирает контроль (skipWaiting/claim) и страница
 * перезагружается один раз, чтобы не показывать устаревший кэш. */
function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; } // первая установка SW
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const check = () => { try { reg.update(); } catch (e) { /* нет сети */ } };
      setInterval(check, 60 * 60 * 1000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    })
    .catch(() => {});
}

/* Backend / Terminal */
  let term = null;
  let termFit = null;
  let termLinks = null;
  let termWs = null;

  function wireBackend() {
    const testBtn = $('btnBackendTest');
    const termBtn = $('btnBackendOpenTerm');
    const status = $('backend-status');
    if (testBtn) testBtn.addEventListener('click', async () => {
      status.textContent = 'Проверка…';
      try {
        const url = settings.backendUrl?.replace(/\/+$/, '');
        if (!url) throw new Error('URL не задан');
        const token = settings.backendToken;
        if (!token) throw new Error('Токен не задан');
        const res = await fetch(`${url.replace('ws://', 'http://').replace('wss://', 'https://')}/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        const me = await res.json();
        status.textContent = `OK: ${me.login} (id: ${me.id})`;
        status.style.color = 'var(--ok)';
      } catch (e) {
        status.textContent = 'Ошибка: ' + e.message;
        status.style.color = 'var(--bad)';
      }
    });
    if (termBtn) termBtn.addEventListener('click', openTerminal);
  }

  async function openTerminal() {
    if (!settings.backendUrl || !settings.backendToken) {
      toast('Задайте URL и токен бэкенда', 'err'); return;
    }

    // xterm подгружается лениво — блокирующие теги CDN в index.html запрещены
    try {
      await loadCss(XTERM_CSS);
      await Promise.all(XTERM_JS.map((u) => loadScript(u)));
    } catch (e) { /* ниже выдадим понятную ошибку */ }
    if (typeof Terminal === 'undefined') { toast('xterm.js не загружен (нет сети?)', 'err'); return; }

    const modal = $('term-modal');
    const container = $('term-container');
    container.innerHTML = '';
    modal.classList.remove('hidden');

    // init xterm
    term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
      theme: { background: '#1e1e1e', foreground: '#d4d4d4' },
      convertEol: true,
    });
    term.open(container);
    if (typeof FitAddon !== 'undefined') {
      termFit = new FitAddon.FitAddon();
      term.loadAddon(termFit);
      termFit.fit();
    }
    if (typeof WebLinksAddon !== 'undefined') {
      termLinks = new WebLinksAddon.WebLinksAddon();
      term.loadAddon(termLinks);
    }
    window.addEventListener('resize', () => termFit?.fit());

    // WS connect
    const wsUrl = `${settings.backendUrl.replace(/\/+$/, '')}/pty?token=${encodeURIComponent(settings.backendToken)}&cols=${term.cols}&rows=${term.rows}&cwd=${encodeURIComponent($('term-cwd').value || '/')}`;
    termWs = new WebSocket(wsUrl);
    termWs.binaryType = 'arraybuffer';
    termWs.onopen = () => { toast('Терминал подключён'); };
    termWs.onmessage = (ev) => { term.write(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); };
    termWs.onclose = () => { toast('Терминал отключён'); termWs = null; };
    termWs.onerror = () => { toast('Ошибка WS', 'err'); };

    term.onData((data) => { if (termWs?.readyState === WebSocket.OPEN) termWs.send(JSON.stringify({ type: 'input', data })); });

    $('term-resize').onclick = () => {
      const c = +$('term-cols').value, r = +$('term-rows').value;
      termWs?.send(JSON.stringify({ type: 'resize', cols: c, rows: r }));
      termFit?.fit();
    };
    $('term-close').onclick = closeTerminal;
    $('term-modal').onclick = (e) => { if (e.target.id === 'term-modal') closeTerminal(); };
  }

  function closeTerminal() {
    termWs?.close();
    term?.dispose();
    term = termFit = termLinks = termWs = null;
    $('term-modal').classList.add('hidden');
  }

  window.onSettingsChanged = (s) => { settings = s; };

async function init() {
  try {
    const savedSettings = await idbGet(KEY_SETTINGS);
    if (savedSettings) settings = Object.assign(defaultSettings(), savedSettings);
    const stored = await idbGet(KEY_PROJECT);
    if (stored && stored.pages && Array.isArray(stored.pages) && stored.roles) {
      project = stored;
      if (!project.clips) project.clips = [];
      project.pages.forEach(p => { if (p.file) { p.url = URL.createObjectURL(p.file); } });
      await probeMetrics(project.pages);
    }
  } catch (e) { console.error('init:', e); }
  bindSettings();
  syncModelUi();
  syncProviderUi();
  setChatSettings(settings);
  initChat();
  renderAll();
  wire();
}

init();