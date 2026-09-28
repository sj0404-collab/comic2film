/* IndexedDB: ключ-значение для проекта, настроек, чата. */

const DB_NAME = 'voicecomic';
const STORE = 'kv';
const CHAT = 'chat';

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      if (!req.result.objectStoreNames.contains(CHAT)) req.result.createObjectStore(CHAT);
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function storeOp(store, mode, fn) {
  return new Promise((res, rej) => {
    openDB().then(db => {
      const tx = db.transaction(store, mode);
      const s = tx.objectStore(store);
      const r = fn(s);
      // onabort обязателен: при откате по квоте не срабатывает ни oncomplete,
      // ни onerror, и промис оставался ждать навсегда — сохранение молчало
      tx.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error || new DOMException('Транзакция прервана (не хватило места)', 'QuotaExceededError'));
    }).catch(rej);
  });
}

async function getStore(store, key) {
  return storeOp(store, 'readonly', s => s.get(key));
}
async function putStore(store, key, value) {
  return storeOp(store, 'readwrite', s => s.put(value, key));
}
async function delStore(store, key) {
  return storeOp(store, 'readwrite', s => s.delete(key));
}

export async function idbSet(key, value) { return putStore(STORE, key, value); }
export async function idbGet(key) { return getStore(STORE, key); }
export async function idbDel(key) { return delStore(STORE, key); }

/* Чат: сессии и сообщения (могут содержать Blob-файлы). */
export async function chatGetSessions() { return (await getStore(CHAT, 'sessions')) || []; }
export async function chatSetSessions(list) { return putStore(CHAT, 'sessions', list); }
export async function chatGetMessages(sid) { return (await getStore(CHAT, 'msgs:' + sid)) || []; }
export async function chatSetMessages(sid, msgs) { return putStore(CHAT, 'msgs:' + sid, msgs); }
export async function chatDelSession(sid) { await delStore(CHAT, 'msgs:' + sid); }

export const KEY_PROJECT = 'project';
export const KEY_SETTINGS = 'settings';