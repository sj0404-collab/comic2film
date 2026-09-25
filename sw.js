const CACHE = 'voicecomic-v5';
const CORE = [
  './',
  'index.html',
  'css/ui.css',
  'js/util.js',
  'js/store.js',
  'js/ai.js',
  'js/models.dev.js',
  'js/import.js',
  'js/ocr.js',
  'js/voices.js',
  'js/engine.js',
  'js/yolo.js',
  'js/app.js',
  'js/modelsui.js',
  'js/chat.js',
  'manifest/manifest.webmanifest',
  'icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // каждый файл по отдельности: отсутствие одного не должно валить установку SW
      Promise.all(CORE.map((u) => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const stale = keys.filter((k) => k !== CACHE);
    await Promise.all(stale.map((k) => caches.delete(k)));
    await self.clients.claim();
    // Старая версия отдавала оболочку из кэша (cache-first): после обновления
    // уже открытые страницы надо перезагрузить, иначе APK/PWA продолжает
    // показывать прошлую версию. Ждать навигацию внутри waitUntil нельзя —
    // активация и загрузка страницы начинают ждать друг друга и SW зависает
    // в состоянии «activating».
    if (stale.length) {
      try {
        const wins = await self.clients.matchAll({ type: 'window' });
        for (const w of wins) {
          try {
            const p = w.navigate(w.url);
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch (err) { /* WebView без Client.navigate — обновится при следующем старте */ }
        }
      } catch (err) { /* ignore */ }
    }
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (req.headers.get('range')) return; // частичные ответы не кэшируем
  e.respondWith(networkFirst(req, e));
});

/* Сеть первым, кэш — только как запасной вариант на случай офлайна.
 * В APK «сеть» — это свежие файлы из установленного пакета, поэтому
 * приложение всегда стартует с актуальной версией.
 *
 * Кэширование выполняется НЕ через e.waitUntil: после await это событие уже
 * не в диспетчере, и waitUntil бросает InvalidStateError — ошибка глоталась,
 * а значит ничего не кэшировалось вообще (работал только precache в install).
 * Поэтому ответ сначала полностью читается в память и уже потом кладётся в
 * кэш обычным awaited-вызовом, который ответа не ждёт. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && res.status !== 206) {
      try {
        // копия читается целиком; оригинал отдаём клиенту без задержек
        const copy = new Response(await res.clone().arrayBuffer(), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
        await cache.put(req, copy);
      } catch (err) { /* квота/приватный режим — работаем без записи */ }
    }
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = (await cache.match('index.html')) || (await cache.match('./')) || (await cache.match('/'));
      if (shell) return shell;
    }
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}
