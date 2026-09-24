const CACHE = 'voicecomic-v4';
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
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Network-first для внешних CDN (онлайн-функции), кэш-фолбэк
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }
  // App shell: кэш-first
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req))
  );
});