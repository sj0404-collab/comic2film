/* Чат с ИИ: сессии, сообщения, файловые вложения (без лимитов). */

import { idbGet, idbSet, chatGetSessions, chatSetSessions, chatGetMessages, chatSetMessages, chatDelSession, KEY_SETTINGS } from './store.js';
import { provider, PROVIDERS, chat, chatWithImage } from './ai.js';

const LS_CURRENT = 'chat:current';
const MAX_COPY = 12;

const $ = (id) => document.getElementById(id);
let sessions = [];
let currentId = null;
let messages = [];
let attachments = []; // { file, name, type, dataURL? }
let asking = false;

export async function initChat() {
  sessions = await chatGetSessions();
  currentId = (idbGet && (await idbGet(LS_CURRENT))) || null;
  if (!currentId || !sessions.find(s => s.id === currentId)) {
    currentId = sessions[0] ? sessions[0].id : null;
  }
  if (currentId) { await loadMessages(); } else { currentId = newChat(); await loadMessages(); }
  refreshModels();
  renderSessions();
  renderMessages();
  wireChat();
}

function newChat() {
  const s = { id: 's' + Date.now(), title: 'Сессия ' + new Date().toLocaleString('ru', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }), ts: Date.now() };
  sessions.unshift(s);
  persistSessions();
  return s.id;
}

async function persistSessions() {
  await chatSetSessions(sessions);
  if (currentId) await idbSet(LS_CURRENT, currentId);
}

async function loadMessages() {
  messages = await chatGetMessages(currentId);
}

async function persistMessages() {
  await chatSetMessages(currentId, messages);
}

let S = {}; // текущие настройки (обновляются из app.js)

function refreshModels() {
  const sel = $('chat-model');
  if (!sel) return;
  sel.replaceChildren();
  const all = [];
  for (const pid of Object.keys(PROVIDERS)) {
    const p = provider(pid);
    if (!p.models || !p.models.length) continue;
    for (const m of p.models) {
      all.push({ pid, id: m.id, name: (p.name || pid) + ' · ' + m.id });
    }
  }
  all.sort((a, b) => a.name.localeCompare(b.name));
  const cur = all.find(x => x.pid === S.ai && x.id === S.aimodel);
  for (const m of all) {
    const o = document.createElement('option');
    o.value = m.pid + '::' + m.id;
    o.textContent = m.name;
    o.selected = cur ? (m.pid === cur.pid && m.id === cur.id) : false;
    sel.appendChild(o);
  }
  if (!cur && all.length) {
    const first = all.find(x => x.pid === S.ai) || all[0];
    sel.value = first.pid + '::' + first.id;
  } else if (cur) {
    sel.value = cur.pid + '::' + cur.id;
  }
}

function renderSessions() {
  const sel = $('chat-sessions');
  if (!sel) return;
  sel.replaceChildren();
  for (const s of sessions) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.title;
    o.selected = s.id === currentId;
    sel.appendChild(o);
  }
  const empty = $('chat-empty');
  if (empty) empty.classList.toggle('hidden', messages.length > 0);
}

function renderMessages() {
  const box = $('chat-messages');
  const empty = $('chat-empty');
  if (!box) return;
  box.replaceChildren();
  if (messages.length === 0) { if (empty) empty.classList.remove('hidden'); return; }
  if (empty) empty.classList.add('hidden');
  messages.forEach((m, i) => {
    const d = document.createElement('div');
    d.className = 'msg ' + (m.role === 'user' ? 'user' : m.role === 'err' ? 'err' : 'ai');
    if (m.typing) d.classList.add('typing');
    let h = '<span class="who">' + (m.role === 'user' ? 'Вы' : m.role === 'err' ? 'Ошибка' : 'ИИ') + '</span>';
    if (m.files && m.files.length && m.role === 'user') {
      for (const f of m.files) {
        if (f.dataURL || f.objectUrl) {
          h += '<img class="att" src="' + (f.dataURL || f.objectUrl) + '" alt="…">';
        } else {
          h += '<span class="attfile">📎 ' + escapeHtml(f.name) + ' · ' + fmtSize(f.size) + '</span>';
        }
      }
    }
    if (i === messages.length - 1 && messages[messages.length - 1].typing && !m.content) {
      // пусто пока печатает
    }
    h += '<div>' + escapeHtml(m.content || (m.typing ? '…' : '')) + '</div>';
    if (m.content && m.role === 'ai' && m.content.length > 60) h += '<span class="mtime">' + new Date(m.ts).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' }) + '</span>';
    d.innerHTML = h;
    box.appendChild(d);
  });
  box.scrollTop = box.scrollHeight;
}

function resolveModel() {
  const sel = $('chat-model');
  const v = (sel && sel.value) || '';
  if (v && v.includes('::')) {
    const [pid, mid] = v.split('::');
    return { provider: pid, model: mid };
  }
  return { provider: S.ai, model: S.aimodel };
}

async function ask() {
  if (asking) return;
  const input = $('chat-input');
  const text = (input ? input.value : '').trim();
  if (!text && !attachments.length) return;
  asking = true;
  if (input) input.value = '';
  const files = attachments.splice(0);
  renderAttachments();
  const userMsg = { role: 'user', content: text, files, ts: Date.now() };
  messages.push(userMsg);
  await persistMessages();
  renderMessages();
  const typing = { role: 'ai', typing: true, ts: Date.now() };
  messages.push(typing);
  renderMessages();
  try {
    const { provider: pid, model: mid } = resolveModel();
    const chatSettings = { ...S, ai: pid, aimodel: mid };
    const history = messages.filter(m => !m.typing && m.role !== 'err' && m.role !== 'system')
      .filter((m, i, arr) => i >= Math.max(0, arr.length - MAX_COPY));
    const sys = messages.find(m => m.role === 'system');
    const systemPrompt = 'Ты — помощник пользователя приложения VoiceComic (комиксы → озвученное видео). Отвечай по-русски, коротко и по делу. Пользователь может присылать изображения и файлы: изображения разбирай как страницы манги/комикса, текстовые файлы прочитывай и комментируй.';
    void sys;
    const files = userMsg.files || [];
    const images = files.filter(f => f.dataURL);
    let answer;
    if (images.length) {
      answer = await chatWithImage(chatSettings, [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ], images[0].dataURL);
    } else {
      answer = await chat(chatSettings, [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role, content: m.content })),
      ]);
    }
    messages = messages.filter(m => m !== typing);
    messages.push({ role: 'ai', content: String(answer), ts: Date.now() });
    const title = (text || (files[0] && files[0].name) || 'Сессия').trim().slice(0, 40);
    if (currentId && sessions.find(sp => sp.id === currentId)) {
      const sp = sessions.find(x => x.id === currentId);
      if (sp.title.startsWith('Сессия ') || !sp.title) { sp.title = title; sp.ts = Date.now(); }
      sessions.sort((a, b) => b.ts - a.ts);
      await persistSessions();
      renderSessions();
    }
  } catch (e) {
    messages = messages.filter(m => m !== typing);
    messages.push({ role: 'err', content: 'Ошибка: ' + (e.message || e), ts: Date.now() });
    console.error(e);
  }
  asking = false;
  await persistMessages();
  renderMessages();
}

function renderAttachments() {
  const box = $('chat-attachments');
  if (!box) return;
  box.replaceChildren();
  attachments.forEach((a, i) => {
    const s = document.createElement('span');
    s.className = 'att';
    s.textContent = '📎 ' + a.name + ' · ' + fmtSize(a.size);
    const x = document.createElement('button');
    x.className = 'btn mini';
    x.style.padding = '0 6px';
    x.textContent = '✕';
    x.addEventListener('click', () => { attachments.splice(i, 1); renderAttachments(); });
    s.appendChild(x);
    box.appendChild(s);
  });
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' МБ' : n > 1024 ? Math.round(n / 1024) + ' КБ' : n + ' Б'; }

function wireChat() {
  const input = $('chat-input');
  const send = $('btnChatSend');
  const del = $('btnChatDel');
  const file = $('chat-file');
  const sessionsSel = $('chat-sessions');
  const modelSel = $('chat-model');
  const btnNew = $('btnChatNew');

  if (send) send.addEventListener('click', () => ask());
  if (input) input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); }
  });
  if (file) file.addEventListener('change', () => {
    for (const f of file.files) {
      if (!attachments.find(a => a.file === f)) {
        const a = { file: f, name: f.name, size: f.size, type: f.type };
        if (f.type.startsWith('image/')) {
          const rd = new FileReader();
          rd.onload = () => { a.dataURL = rd.result; };
          rd.readAsDataURL(f);
        }
        attachments.push(a);
      }
    }
    file.value = '';
    renderAttachments();
  });
  if (sessionsSel) sessionsSel.addEventListener('change', async () => {
    currentId = sessionsSel.value;
    await persistSessions();
    await loadMessages();
    renderSessions();
    renderMessages();
  });
  if (btnNew) btnNew.addEventListener('click', async () => {
    currentId = newChat();
    await persistSessions();
    await loadMessages();
    renderSessions();
    renderMessages();
  });
  if (del) del.addEventListener('click', async () => {
    if (!currentId) return;
    if (!confirm('Удалить текущую сессию чата?')) return;
    await chatDelSession(currentId);
    const list = sessions.filter(s => s.id !== currentId);
    sessions = list;
    currentId = list[0] ? list[0].id : (newChat(), currentId);
    if (!list[0]) { currentId = sessions[0].id; }
    await persistSessions();
    await loadMessages();
    renderSessions();
    renderMessages();
  });
  if (modelSel) modelSel.addEventListener('change', async () => {
    if (asking) return;
    const v = modelSel.value;
    if (!v.includes('::')) return;
    const [pid, mid] = v.split('::');
    S = { ...S, ai: pid, aimodel: mid };
    try {
      await idbSet(KEY_SETTINGS, S);
    } catch (e) { console.warn(e); }
    if (window.onSettingsChanged) window.onSettingsChanged(S);
  });
}

/* вызывается из app.js при старте и при изменении настроек */
export function setChatSettings(s) { S = s || {}; refreshModels(); }

export const chatApi = { initChat, renderAttachments, setChatSettings };