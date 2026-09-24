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

Требуется Node ≥22, JDK 21, Android SDK (compileSdk 36).

```bash
npm install
npm run build:www        # собирает www/ (без node_modules)
npx cap sync android     # копирует www/ в android/app/src/main/assets/public
cd android && ./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
# Release-APK (подписан debug-ключом): ./gradlew assembleRelease
```

Готовый релизный APK всегда лежит в GitHub Release: `voicecomic-vX.Y.Z.apk`.

`android/` и `www/` в `.gitignore` (генерируются), `capacitor.config.json` уже в репозитории (webDir: 'www', allowMixedContent: true).

## Требования

- Браузер с поддержкой: `WebSocket`, `MediaRecorder`, `OffscreenCanvas` (опционально), `WebAssembly` (ffmpeg.wasm), `IndexedDB`, `AudioContext`, `fetch`, `FileReader`.
- HTTPS или `localhost` (для MediaRecorder/Service Worker/микрофона).
- Интернет для Edge-TTS, Pollinations, pdf.js worker, Tesseract wasm, ffmpeg.wasm core — всё грузится с CDN.

## API и ключи

Встроен полный каталог провайдеров и моделей (Исходник — models.dev, см. `js/models.dev.js`): 200+ провайдеров OpenAI-/Anthropic-совместимых API с реальных сайтов. Пикер моделей — кнопки-вкладки по провайдерам, внутри каждой вкладки дерево моделей и фильтры:

- **🆓 без ключа**: Pollinations — единственный провайдер, работающий совсем без ключа (`text.pollinations.ai/openai`). **Протестировано вживую: отвечают все 5 анонимных моделей** — `openai`, `openai-fast`, `gpt-oss`, `gpt-oss-20b`, `ovh-reasoning` (изредка при параллельных вызовах с одного IP Pollinations отдаёт 429 «queue full» — это rate limit, не поломка; список обновляется кнопкой «🔄 Модели без ключа»). Пикер по умолчанию открывается с фильтром «🆓 без ключа». Внимание: «бесплатные» модели OpenCode Zen (big-pickle, qwen3.6-plus-free и др.) бесплатны по тарифу, но отдаются **только с ключом Zen** — без ключа проверено 401/403 (big-pickle вообще разрешён только изнутри OpenCode: «free tier only from within OpenCode»).
- **🔑 с ключом**: OpenRouter (оркестратор: один ключ → модели многих команд), OpenCode Zen (реальный шлюз opencode.ai/zen, тоже один ключ на любые модели), OpenAI, Anthropic Claude, Google Gemini, Groq (free tier), DeepSeek, Mistral, Together AI, xAI Grok, Perplexity, Cerebras (free tier) + 190+ совместимых провайдеров. Рядом с таким провайдером — ссылка «где взять ключ» (официальный сайт).
- **Фильтры дерева**: 🆓 без ключа · бесплатно · платно · 👁 vision · 🧠 умные · ⚡ быстрые · 🎛 оркестратор + поиск. Каждую модель можно проверить «вживую» (⚡ проверить, отвечает ли реально).
- **👁 Vision** — читают картинки, используются как OCR вместо Tesseract. **Tesseract** — полностью локально (wasm с CDN при первом OCR).
- **Свой OpenAI-совместимый** — любой endpoint (Ollama, LM Studio, VPN-прокси) + ключ.
- **Edge-TTS** — работает напрямую из браузера через WSS (Microsoft публичный эндпоинт), прокси опционально.

Каталог генерируется скриптом `tools/gen-models.mjs` из https://models.dev/api.json (те же данные, что использует npm-пакет opencode), без автообновляемой копии моделей opencode-zen (у Zen — отдельная curated-запись в `js/ai.js` со стабильным списком, любую модель можно вписать вручную) и без локальных mini-провайдеров.

## Лицензия

MIT — свободное использование, модификация, распространение.

---

*Сделано для удобного создания озвученных манг/комиксов без серверов и ключей.*