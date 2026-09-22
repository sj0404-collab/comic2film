/* Единый пикер моделей с фильтрами (без ключа / бесплатные / платные /
 * vision / провайдер) и живой проверкой «отвечает ли модель реально». */

import { PROVIDERS, provider, modelMeta, MODEL_HEALTH, probeModel, refreshFreeModels } from './ai.js';
import { toast } from './util.js';

const $ = (id) => document.getElementById(id);

/* Собрать плоский список моделей: curated (проверенные) сперва, затем
 * без-ключ, затем бесплатные, и только потом остальные. */
function flatModels() {
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
  return rows;
}

/* 0..1 — проверенные напрямую (OpenAI/Gemini/Claude/…. По нарастающей
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
  if (f.provider !== 'all' && mt.pid !== f.provider) return false;
  if (f.quality === 'curated' && !mt.curated) return false;
  if (f.cat === 'nokey' && !mt.nokey) return false;
  if (f.cat === 'free' && !mt.free) return false;
  if (f.cat === 'paid' && !mt.paid) return false;
  if (f.cat === 'vision' && !mt.vision) return false;
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
  $title.textContent = 'Модель ИИ — фильтры и проверка';
  $body.className = '';
  $body.replaceChildren();
  $('modal').classList.remove('hidden');

  const f = { cat: 'all', provider: 'all', quality: 'curated', q: '' };

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';

  const row1 = document.createElement('div');
  row1.style.display = 'flex';
  row1.style.gap = '8px';
  row1.style.flexWrap = 'wrap';
  const catSel = document.createElement('select');
  catSel.style.flex = '1';
  catSel.style.minWidth = '150px';
  [['all', 'Все категории'], ['nokey', '🆓 без ключа'], ['free', 'Бесплатные (с ключом)'], ['paid', 'Платные'], ['vision', '👁 видит картинки']]
    .forEach(([v, l]) => catSel.appendChild(optEl(v, l)));
  const provSel = document.createElement('select');
  provSel.style.flex = '1';
  provSel.style.minWidth = '150px';
  const qualSel = document.createElement('select');
  qualSel.style.minWidth = '135px';
  [['curated', 'только проверенные'], ['all', 'все (вкл. каталог)']]
    .forEach(([v, l]) => qualSel.appendChild(optEl(v, l)));
  row1.appendChild(catSel);
  row1.appendChild(provSel);
  row1.appendChild(qualSel);

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Поиск по модели или провайдеру…';

  const toolbar = document.createElement('div');
  toolbar.style.display = 'flex';
  toolbar.style.gap = '8px';
  toolbar.style.alignItems = 'center';
  toolbar.style.flexWrap = 'wrap';
  const btnProbe = document.createElement('button');
  btnProbe.className = 'btn mini';
  btnProbe.textContent = '⚡ Проверить все видимые';
  const btnPolli = document.createElement('button');
  btnPolli.className = 'btn mini';
  btnPolli.textContent = '🔄 Список моделей без ключа';
  toolbar.appendChild(btnProbe);
  toolbar.appendChild(btnPolli);
  const statusEl = div('muted', '');

  const listWrap = div('mp-rows');
  wrap.appendChild(row1);
  wrap.appendChild(search);
  wrap.appendChild(toolbar);
  wrap.appendChild(statusEl);
  wrap.appendChild(listWrap);
  $body.appendChild(wrap);

  /* провайдеры с пометкой без-ключа/каталог */
  function fillProviders() {
    provSel.replaceChildren();
    provSel.appendChild(optEl('all', 'Все провайдеры'));
    const seen = new Set();
    for (const mt of flatModels()) {
      if (seen.has(mt.pid)) continue;
      seen.add(mt.pid);
      const p = provider(mt.pid);
      const suf = p.key === false ? ' · без ключа' : (mt.curated ? '' : ' · каталог');
      provSel.appendChild(optEl(mt.pid, mt.providerName + suf));
    }
    provSel.value = f.provider;
  }
  fillProviders();

  function render() {
    const curKey = (currentSettings().ai || '') + '::' + (currentSettings().aimodel || '');
    const list = flatModels().filter((mt) => match(mt, f));
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
    for (const mt of list) {
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
      listWrap.appendChild(row);
    }
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
    const keys = [...listWrap.querySelectorAll('.mp-row')].map(r => r.dataset.key);
    if (!keys.length) return;
    let ok = 0, bad = 0;
    statusEl.textContent = 'Проверяю ' + keys.length + ' моделей…';
    for (let i = 0; i < keys.length; i++) {
      statusEl.textContent = 'Проверка ' + (i + 1) + '/' + keys.length + ' …';
      const res = await probeModel(currentSettings(), ...keys[i].split('::'));
      if (res.ok) ok++; else bad++;
    }
    render();
    statusEl.textContent = 'Проверено: ✓ ' + ok + ' отвечают, ✗ ' + bad + ' ошибок';
  }

  async function refreshPollinations() {
    f.cat = 'nokey'; f.provider = 'all'; f.quality = 'all';
    catSel.value = 'nokey'; qualSel.value = 'all'; provSel.value = 'all';
    statusEl.textContent = 'Обновляю список моделей без ключа (Pollinations)…';
    const list = await refreshFreeModels();
    statusEl.textContent = 'Моделей без ключа (Pollinations): ' + list.length + ' (' + list.join(', ') + ')';
    render();
  }

  catSel.addEventListener('change', () => { f.cat = catSel.value; render(); });
  provSel.addEventListener('change', () => { f.provider = provSel.value; render(); });
  qualSel.addEventListener('change', () => { f.quality = qualSel.value; render(); });
  search.addEventListener('input', () => { f.q = search.value; render(); });
  btnProbe.addEventListener('click', () => probeVisible());
  btnPolli.addEventListener('click', () => refreshPollinations());

  render();
}