/* Пикер моделей: кнопки-вкладки по провайдерам, у каждой вкладки — дерево
 * моделей с фильтрами (без ключа / бесплатно / платно / vision / умные /
 * быстрые / оркестратор), ссылкой «где взять ключ» и живой проверкой
 * «отвечает ли модель реально». */

import {
  PROVIDERS, provider, modelMeta, MODEL_HEALTH, probeModel, refreshFreeModels,
  providerKeyUrl, isOrchestrator,
} from './ai.js';
import { toast } from './util.js';

const $ = (id) => document.getElementById(id);

let flatCache = null;
function flatModels() {
  if (flatCache) return flatCache;
  const rows = [];
  for (const pid of Object.keys(PROVIDERS)) {
    const p = provider(pid);
    if (!p.models || !p.models.length) continue;
    for (const m of p.models) rows.push(modelMeta(pid, m.id));
  }
  rows.sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d) return d;
    const pa = a.providerName.toLocaleLowerCase(), pb = b.providerName.toLocaleLowerCase();
    return pa !== pb ? pa.localeCompare(pb, 'ru') : a.label.localeCompare(b.label, 'ru');
  });
  flatCache = rows;
  return rows;
}

/* 0..1 — проверенные напрямую (OpenAI/Gemini/Claude/…). По нарастающей
 * идут шлюзы/агрегаторы из каталога models.dev. */
function rank(mt) {
  if (mt.curated && mt.nokey) return 0;
  if (mt.curated && mt.free) return 1;
  if (mt.curated && mt.paid) return 2;
  if (mt.nokey) return 3;
  if (mt.free) return 4;
  return 5;
}

function match(mt, f) {
  if (f.tab !== 'all' && mt.pid !== f.tab) return false;
  if (f.quality === 'curated' && !mt.curated) return false;
  if (f.cat === 'nokey' && !mt.nokey) return false;
  if (f.cat === 'free' && !mt.free) return false;
  if (f.cat === 'paid' && !mt.paid) return false;
  if (f.cat === 'vision' && !mt.vision) return false;
  if (f.cat === 'smart' && !mt.smart) return false;
  if (f.cat === 'dumb' && mt.smart) return false;
  if (f.cat === 'orch' && !mt.orchestrator) return false;
  if (f.q) {
    const hay = (mt.label + ' ' + mt.providerName + ' ' + mt.pid + ' ' + mt.mid).toLocaleLowerCase();
    if (!hay.includes(f.q.toLocaleLowerCase())) return false;
  }
  return true;
}

function tagHtml(mt) {
  const t = [];
  if (mt.nokey) t.push('<span class="mp-tag green">🆓 без ключа</span>');
  else if (mt.free) t.push('<span class="mp-tag blue">бесплатно</span>');
  else t.push('<span class="mp-tag red">платно</span>');
  if (mt.vision) t.push('<span class="mp-tag warn">👁 vision</span>');
  if (mt.orchestrator) t.push('<span class="mp-tag">🎛 оркестратор</span>');
  t.push(mt.smart
    ? '<span class="mp-tag">🧠 умная</span>'
    : '<span class="mp-tag">⚡ быстрая</span>');
  if (mt.curated) t.push('<span class="mp-tag green">проверено</span>');
  return t.join(' ');
}

function esc(s) { return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function optEl(value, text) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}
function div(className, text) {
  const n = document.createElement('div');
  if (className) n.className = className;
  if (text) n.textContent = text;
  return n;
}

let settingsSrc = () => ({});
export function setSettingsGetter(fn) { settingsSrc = fn; }
function currentSettings() { return settingsSrc() || {}; }

/* ================================================================
 * Пикер
 * ================================================================ */
export function openModelPicker({ settings, onSelect } = {}) {
  settingsSrc = () => settings || settingsSrc() || {};
  const $title = $('modal-title');
  const $body = $('modal-body');
  const oldBodyClass = $body.className;
  $title.textContent = 'Модель ИИ — вкладки провайдеров и дерево моделей';
  $body.className = '';
  $body.replaceChildren();
  $('modal').classList.remove('hidden');

  const f = { cat: 'all', tab: 'all', quality: 'curated', q: '' };
  let visibleKeys = [];

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';

  /* ---- вкладки провайдеров (кнопки) ---- */
  const tabs = document.createElement('div');
  tabs.className = 'mp-tabs';

  const chips = document.createElement('div');
  chips.className = 'mp-chips';
  const CATS = [
    ['all', 'Все'],
    ['nokey', '🆓 без ключа'],
    ['free', 'Бесплатно'],
    ['paid', 'Платно'],
    ['vision', '👁 vision'],
    ['smart', '🧠 умные'],
    ['dumb', '⚡ быстрые'],
    ['orch', '🎛 оркестратор'],
  ];

  const qualSel = document.createElement('select');
  qualSel.className = 'mp-qual';
  [['curated', 'только проверенные'], ['all', 'весь каталог']]
    .forEach(([v, l]) => qualSel.appendChild(optEl(v, l)));

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Поиск по модели или провайдеру…';

  const actions = document.createElement('div');
  actions.className = 'mp-actions';
  const btnProbe = document.createElement('button');
  btnProbe.className = 'btn mini';
  btnProbe.textContent = '⚡ Проверить видимые';
  const btnPolli = document.createElement('button');
  btnPolli.className = 'btn mini';
  btnPolli.textContent = '🔄 Модели без ключа';
  actions.appendChild(btnProbe);
  actions.appendChild(btnPolli);
  const statusEl = div('muted', '');

  const hintBox = div('mp-hint',
    '👁 Vision-модели читают картинки — их можно выбрать как OCR вместо Tesseract. ' +
    'Tesseract работает локально и бесплатно. 🎛 «Оркестратор» = один ключ → доступ к моделям сразу многих команд.');

  const listWrap = div('mp-rows');

  wrap.appendChild(tabs);
  wrap.appendChild(chips);
  wrap.appendChild(actions);
  wrap.appendChild(statusEl);
  wrap.appendChild(qualSel);
  wrap.appendChild(search);
  wrap.appendChild(hintBox);
  wrap.appendChild(listWrap);
  $body.appendChild(wrap);

  /* ---- кнопки-вкладки: Все + каждый провайдер ---- */
  function fillTabs() {
    tabs.replaceChildren();
    const seen = new Set();
    for (const mt of flatModels()) {
      if (!seen.has(mt.pid)) {
        seen.add(mt.pid);
        const b = document.createElement('button');
        const p = provider(mt.pid);
        b.className = 'mp-tab' + (mt.pid === f.tab ? ' active' : '');
        b.dataset.tab = mt.pid;
        b.title = (p.name || mt.pid) + (p.key === true ? ' · нужен ключ' : ' · без ключа');
        b.innerHTML = '<span class="mp-tabnm">' + esc(mt.providerName) + '</span>' +
          '<span class="mp-tabb">' + (p.key === true ? '🔑' : '🆓') + '</span>';
        b.addEventListener('click', () => {
          f.tab = mt.pid;
          if (!provider(mt.pid).curated && f.quality === 'curated') {
            f.quality = 'all';
            qualSel.value = 'all';
          }
          fillTabs();
          render();
        });
        tabs.appendChild(b);
      }
    }
    const allB = document.createElement('button');
    allB.className = 'mp-tab' + (f.tab === 'all' ? ' active' : '');
    allB.dataset.tab = 'all';
    allB.innerHTML = '<span class="mp-tabnm">Все модели</span><span class="mp-tabb">🗂</span>';
    allB.addEventListener('click', () => { f.tab = 'all'; fillTabs(); render(); });
    tabs.insertBefore(allB, tabs.firstChild);
  }

  /* ---- фильтры-чипсы ---- */
  function fillChips() {
    chips.replaceChildren();
    for (const [v, l] of CATS) {
      const c = document.createElement('button');
      c.className = 'mp-chip' + (v === f.cat ? ' active' : '');
      c.textContent = l;
      c.addEventListener('click', () => { f.cat = v; fillChips(); render(); });
      chips.appendChild(c);
    }
  }

  fillTabs();
  fillChips();

  /* ---- дерево моделей выбранного провайдера ---- */
  function renderTree(list) {
    const p = provider(f.tab);
    const cnt = (p.models || []).length;
    const head = document.createElement('div');
    head.className = 'mp-provh';
    const nm = document.createElement('div');
    nm.className = 'mp-provt';
    nm.innerHTML = '<b>' + esc(p.name) + '</b> <span class="mp-short">' + esc(f.tab) + ' · ' + cnt + ' моделей</span>';
    const badges = document.createElement('div');
    badges.className = 'mp-provb';
    if (p.key === true) badges.innerHTML += '<span class="mp-tag red">🔑 нужен ключ</span>';
    else badges.innerHTML += '<span class="mp-tag green">🆓 без ключа</span>';
    if (p.vision) badges.innerHTML += '<span class="mp-tag warn">👁 видит картинки</span>';
    if (isOrchestrator(f.tab)) badges.innerHTML += '<span class="mp-tag">🎛 оркестратор (один ключ → многие модели)</span>';
    if (!p.curated) badges.innerHTML += '<span class="mp-tag">из каталога models.dev</span>';
    head.appendChild(nm);
    head.appendChild(badges);

    const meta = document.createElement('div');
    meta.className = 'mp-provm muted';
    meta.appendChild(document.createTextNode((p.endpoint || 'свой endpoint') + (p.headers ? ' · ' + Object.keys(p.headers).join(', ') : '')));
    head.appendChild(meta);

    if (p.key === true) {
      const url = providerKeyUrl(f.tab);
      if (url) {
        const a = document.createElement('a');
        a.className = 'mp-key';
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '🔑 Где взять ключ →';
        head.appendChild(a);
      }
      if (f.tab === 'opencode') {
        const a = document.createElement('a');
        a.className = 'mp-key';
        a.href = 'https://opencode.ai/zen';
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '📚 Список моделей Zen → (можно вписать любую)';
        head.appendChild(a);
      }
    }

    listWrap.insertBefore(head, listWrap.firstChild);

    const tree = div('mp-tree');
    const groups = new Map(); // prefix -> [mt,…], '' = корень
    for (const mt of list) {
      const slash = mt.mid.indexOf('/');
      const prefix = slash > 0 ? mt.mid.slice(0, slash) : '';
      if (!groups.has(prefix)) groups.set(prefix, []);
      groups.get(prefix).push(mt);
    }
    const order = [...groups.keys()].sort((a, b) =>
      (a === '' ? 0 : 1) - (b === '' ? 0 : 1) || a.localeCompare(b, 'ru'));
    for (const prefix of order) {
      const items = groups.get(prefix);
      if (prefix === '') {
        for (const mt of items) tree.appendChild(modelRow(mt));
        continue;
      }
      const det = document.createElement('details');
      if (items.length <= 6) det.open = true;
      const sum = document.createElement('summary');
      sum.className = 'mp-grp';
      sum.innerHTML = '<b>' + esc(prefix) + '</b> <span class="mp-short">' + items.length + '</span>';
      det.appendChild(sum);
      for (const mt of items) det.appendChild(modelRow(mt));
      tree.appendChild(det);
    }
    listWrap.appendChild(tree);
  }

  /* ---- строка модели ---- */
  function modelRow(mt) {
    const curKey = (currentSettings().ai || '') + '::' + (currentSettings().aimodel || '');
    const row = document.createElement('div');
    row.className = 'mp-row' + (mt.pid + '::' + mt.mid === curKey ? ' sel' : '');
    row.dataset.key = mt.pid + '::' + mt.mid;
    const grow = div('grow');
    const name = document.createElement('div');
    name.innerHTML = '<b>' + esc(mt.label) + '</b> <span class="mp-short">' + esc(mt.providerName) + '</span>';
    const tags = document.createElement('div');
    tags.innerHTML = tagHtml(mt) + ' <span class="mp-short">' + esc(mt.pid) + '</span>';
    grow.appendChild(name);
    grow.appendChild(tags);
    row.appendChild(grow);
    row.appendChild(healthCell(mt.pid, mt.mid));
    row.addEventListener('click', () => {
      if (onSelect) onSelect(mt.pid, mt.mid);
      $body.className = oldBodyClass;
      $body.replaceChildren();
      $('modal').classList.add('hidden');
    });
    return row;
  }

  function healthCell(pid, mid) {
    const key = pid + '::' + mid;
    const st = MODEL_HEALTH.get(key);
    if (!st) {
      const btn = document.createElement('button');
      btn.className = 'btn mini';
      btn.textContent = '▸ проверить';
      btn.addEventListener('click', (e) => { e.stopPropagation(); probeRow(key); });
      return btn;
    }
    const box = div('');
    const span = div(st.ok ? 'mp-ok' : 'mp-bad', st.ok ? '✓ ' + st.ms + ' мс' : '✗ ошибка');
    span.title = (st.err || (st.ok ? 'ответил' : '')) + ' · ' + new Date(st.ts).toLocaleTimeString('ru');
    box.appendChild(span);
    if (!st.ok) {
      const btn = document.createElement('button');
      btn.className = 'btn mini';
      btn.textContent = '↻';
      btn.style.marginLeft = '6px';
      btn.addEventListener('click', (e) => { e.stopPropagation(); probeRow(key); });
      box.appendChild(btn);
    }
    return box;
  }

  function render() {
    const list = flatModels().filter((mt) => match(mt, f));
    visibleKeys = list.map((mt) => mt.pid + '::' + mt.mid);
    listWrap.replaceChildren();
    if (!list.length) {
      listWrap.appendChild(div('empty', 'Моделей с такими фильтрами нет.'));
      statusEl.textContent = 'Найдено: 0';
      return;
    }
    const ok = MODEL_HEALTH.size ? Array.from(MODEL_HEALTH.values()).filter(s => s.ok).length : 0;
    statusEl.textContent = 'Найдено: ' + list.length +
      (ok ? ' · проверено живых: ' + ok : '') +
      '. «Проверено» = прямой API без шлюзов. ⚡ — живой тест на ответ.';

    if (f.tab !== 'all') {
      renderTree(list);
    } else {
      for (const mt of list) listWrap.appendChild(modelRow(mt));
    }
  }

  async function probeRow(key) {
    const [pid, mid] = key.split('::');
    const btn = [...listWrap.querySelectorAll('.mp-row')].find(r => r.dataset.key === key)?.querySelector('button');
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    statusEl.textContent = 'Проверяю ' + pid + ' · ' + mid + '…';
    const res = await probeModel(currentSettings(), pid, mid);
    render();
    statusEl.textContent = res.ok
      ? '✓ «' + pid + ' · ' + mid + '» отвечает за ' + res.ms + ' мс'
      : '✗ «' + pid + ' · ' + mid + '» ошибка: ' + res.err;
  }

  async function probeVisible() {
    const keys = visibleKeys;
    if (!keys.length) return;
    let okN = 0, bad = 0;
    statusEl.textContent = 'Проверяю ' + keys.length + ' моделей…';
    for (let i = 0; i < keys.length; i++) {
      statusEl.textContent = 'Проверка ' + (i + 1) + '/' + keys.length + ' …';
      const res = await probeModel(currentSettings(), ...keys[i].split('::'));
      if (res.ok) okN++; else bad++;
    }
    render();
    statusEl.textContent = 'Проверено: ✓ ' + okN + ' отвечают, ✗ ' + bad + ' ошибок';
  }

  async function refreshPollinations() {
    f.cat = 'nokey'; f.tab = 'all'; f.quality = 'all';
    fillChips(); fillTabs(); qualSel.value = 'all';
    statusEl.textContent = 'Обновляю список моделей без ключа (Pollinations)…';
    const list = await refreshFreeModels();
    statusEl.textContent = 'Моделей без ключа (Pollinations): ' + list.length + ' (' + list.join(', ') + ')';
    toast('Моделей без ключа: ' + list.join(', '));
    render();
  }

  qualSel.addEventListener('change', () => { f.quality = qualSel.value; render(); });
  search.addEventListener('input', () => { f.q = search.value; render(); });
  btnProbe.addEventListener('click', () => probeVisible());
  btnPolli.addEventListener('click', () => refreshPollinations());

  render();
}