# VoiceComic — манга/комиксы в озвученное видео

Полностью клиентское PWA-приложение (работает в браузере Android / Chrome / Firefox, можно установить на главный экран как APK). Конвертирует комиксы (PDF, CBZ, CBR, RAR, ZIP, картинки) и аудио/видео в озвученное видео с ролями, интонацией Edge-TTS, Ken Burns эффектом и субтитрами.

## Возможности

- **Импорт**: PDF (pdf.js), ZIP/CBZ (JSZip), RAR/CBR (node-unrar-js ESM), картинки, аудио/видео
- **OCR**: Tesseract.js локально (без интернета) или ИИ через Pollinations/Gemini
- **Роли**: автоматическое распределение голосов по персонажам (ИИ)
- **Перевод**: батчевый перевод реплик (Pollinations/Gemini/свой API)
- **Озвучка**: Edge-TTS (500+ голосов, стили эмоций, pitch/rate/volume) — без ключей через WSS
- **Монтаж**: Ken Burns камера, пузыри/субтитры, WebM запись через MediaRecorder
- **Экспорт**: WebM сразу, MP4/GIF через ffmpeg.wasm (в браузере), аудио WAV/MP3
- **Автосохранение**: проект в IndexedDB
- **PWA**: офлайн (Service Worker), установка на Android

## Быстрый старт (локально)

```bash
# из папки проекта
python3 -m http.server 8080
# открыть http://localhost:8080 в браузере
# Chrome → ⋮ → «Установить VoiceComic»
```

Или любой статический сервер: `npx serve .`, `php -S localhost:8080`, `nginx` и т.д.

## Структура

```
├── index.html           # UI (табы: Импорт/Сценарий/Голоса/Монтаж/Опции)
├── css/ui.css           # тёмная мобильная тема
├── manifest/manifest.webmanifest
├── sw.js                # Service Worker
├── js/
│   ├── app.js           # главная оркестрация
│   ├── util.js          # чистые утилиты (MP3 frame walker, SSML, GEC, bubbles clustering)
│   ├── store.js         # IndexedDB key-value
│   ├── ai.js            # Pollinations / Gemini / custom OpenAI-compatible
│   ├── import.js        # PDF/ZIP/RAR/аудио → страницы/клипы
│   ├── ocr.js           # Tesseract + vision fallback
│   ├── voices.js        # Edge-TTS WSS, каталог голосов, speechSynthesis fallback
│   └── engine.js        # таймлайн, рендер (canvas+MediaRecorder), ffmpeg.wasm
├── tests/smoke.mjs      # чистые юнит-тесты (node)
└── package.json         # npm scripts
```

## Как пользоваться

1. **Импорт** — перетащите PDF/CBZ/CBR/картинки/аудио/видео. Для комиксов создаются страницы; для аудио — нарезаются фразы по тишине (функция «Нарезки голосов»).
2. **Сценарий** — нажмите 🔎 OCR, затем 🎭 Раздать роли ИИ, 🌐 Перевести (опционально), 🗣 Озвучить все.
3. **Голоса** — добавьте/измените персонажей: выберите голос Edge-TTS, pitch/rate/volume, стиль эмоции; можно назначить свой аудио-клип вместо TTS.
4. **Монтаж** — настройте разрешение, fps, зум, стиль субтитров, паузу, фоновую музыку. Нажмите ▶ Предпросмотр или 🎬 Собрать видеофайл.
5. **Опции** — смените OCR движок, язык, ИИ-провайдера, голосовой бэкенд. Сохраните/экспортируйте проект JSON.

## Деплой на GitHub Pages

1. Форкните/создайте репозиторий
2. Settings → Pages → Source: GitHub Actions
3. Пуш в `main` — сработает workflow `.github/workflows/deploy.yml`
4. Сайт будет доступен по `https://<user>.github.io/<repo>/`

## Сборка APK (Capacitor)

```bash
npm install -g @capacitor/cli @capacitor/core @capacitor/android
npx cap init voicecomic com.example.voicecomic --web-dir=.
npx cap add android
npx cap copy
npx cap open android
# в Android Studio → Build → Build Bundle(s)/APK(s) → Build APK(s)
```

`capacitor.config.json` уже в репозитории (webDir: '.', android: { allowMixedContent: true }).

## Требования

- Браузер с поддержкой: `WebSocket`, `MediaRecorder`, `OffscreenCanvas` (опционально), `WebAssembly` (ffmpeg.wasm), `IndexedDB`, `AudioContext`, `fetch`, `FileReader`.
- HTTPS или `localhost` (для MediaRecorder/Service Worker/микрофона).
- Интернет для Edge-TTS, Pollinations, pdf.js worker, Tesseract wasm, ffmpeg.wasm core — всё грузится с CDN.

## API и ключи

- **Pollinations** — бесплатно, без ключа (`https://text.pollinations.ai/openai`). Список доступных бесплатных моделей (tier=anonymous) обновляется кнопкой «🔄 обновить список» в Опциях.
- **Google Gemini** — нужен API-ключ (есть бесплатный тариф).
- **Custom OpenAI-compatible** — свой endpoint + ключ.
- **Edge-TTS** — работает напрямую из браузера через WSS (Microsoft публичный эндпоинт), прокси опционально.
- **Tesseract** — полностью локально (wasm загружается с CDN при первом OCR).

## Лицензия

MIT — свободное использование, модификация, распространение.

---

*Сделано для удобного создания озвученных манг/комиксов без серверов и ключей.*