# VoiceComic — манга/комиксы в озвученное видео

Нативное Android-приложение (Kotlin + Jetpack Compose). **Никакого WebView и веба в APK**:
OCR, распознавание форматов, TTS, монтаж и экспорт видео работают на устройстве.

Конвертирует комиксы (PDF, CBZ, CBR, RAR, ZIP, картинки) и аудио/видео в озвученное видео
с ролями, интонацией Edge-TTS, эффектом Ken Burns и субтитрами.

## Что нативно

| Задача | Реализация в 2.0 |
|---|---|
| Импорт PDF | `android.graphics.pdf.PdfRenderer` (≤1900 px, ≤2.2×) |
| Импорт CBZ/ZIP | `java.util.zip.ZipFile`, естественная сортировка имён |
| Импорт CBR/RAR | `junrar` (пароль, кол-во страниц, EXIF-поворот) |
| Нарезка аудио | `MediaExtractor` + `MediaCodec` → PCM, резка по тишине (RMS-окна 40 мс) |
| OCR | **ML Kit** Text Recognition, модели лежат в APK (latin + китайский/японский/корейский) |
| Озвучка | Edge-TTS через WebSocket (OkHttp), GEC-токен, SSML с pitch/rate/volume/стилем |
| Распределение ролей | собственный кастинг по полу и языку + ИИ-разметка (звёзды, промпты 1:1 с веб-версии) |
| ИИ | OpenAI-совместимые / Gemini / Anthropic + **прямой вызов OpenCode Zen** (релей больше не нужен) |
| Монтаж | таймлайн и Ken Burns те же формулы, что в веб-версии (см. `Timeline.kt`) |
| Экспорт видео | **MediaCodec H.264 + AAC → MediaMuxer** (MP4), кадры через EGL |
| Экспорт аудио | WAV + AAC/M4A |
| Проект | файлы в `filesDir/projects/<id>/` + автосохранение (дебаунс 600 мс) |

Каталог моделей (208 провайдеров, 6 7xx моделей) лежит в `app/src/main/assets/models.dev.json`,
генерируется из models.dev: `npm run models`.

## Сборка

```bash
# JDK 21, Android SDK (platform 37, build-tools 36+)
./gradlew :app:assembleDebug        # отладочный APK
./gradlew :app:assembleRelease      # релизный (подписывается, если есть keystore.properties)
./gradlew :app:testDebugUnitTest    # юнит-тесты (25 шт., JVM)
```

Версия живёт в `gradle.properties` (`voicecomic.versionName`, `voicecomic.versionCode`);
`versionCode = major*10000 + minor*100 + patch` — та же формула, что была у старой
Capacitor-сборки, где versionCode всегда был 1 и Android не давал обновиться.

Подпись релиза: положите `keystore.properties` в корень репозитория

```
STORE_FILE=keystore/voicecomic-release.jks
STORE_PASSWORD=…
KEY_ALIAS=…
KEY_PASSWORD=…
```

и пересоберите `:app:assembleRelease` — signingConfig подхватится сам.

## Структура

```
app/src/main/java/com/voicecomic/app/
├── MainActivity.kt          # навигация, системные диалоги файлов
├── AppViewModel.kt          # состояние, автосохранение, все действия
├── data/                    # модели проекта + хранилище (ProjectStore)
├── audio/                   # PCM-утилиты, Edge-TTS, каталог голосов, MediaCodec-декодер
├── importer/                # PDF/ZIP/RAR/картинки/аудио → страницы и нарезки
├── ocr/                     # ML Kit + кластеризация слов в пузыри
├── ai/                      # провайдеры, клиент, прямой Zen, промпты, кастинг
├── render/                  # таймлайн, отрисовка кадра, сведение, MediaCodec+EGL, MP4
└── ui/                      # Compose: 6 экранов, диалоги, тема
legacy-web/                  # веб-версия 1.x, оставлена для справки (в APK её нет)
tools/                       # build-time скрипты: каталог моделей, версия, тулы Zen
```

## Живая проверка бесплатных моделей

Живой прогон сделан нативным кодом (тест `ZenLiveTest`, тот же путь, что в приложении —
OkHttp + identity-заголовки opencode + `stream:true` + официальные тулы, без релея):
`./gradlew :app:testDebugUnitTest -Plive --tests '*ZenLiveTest*'`.

| модель | эндпоинт | результат |
|---|---|---|
| `big-pickle` | `/v1/chat/completions` | ✅ ~1.7 c |
| `space-bunny-free` | `/v1/chat/completions` | ✅ ~0.9 c |
| `ling-3.0-flash-fin-free` | `/v1/chat/completions` | ✅ ~1.6 c |
| `mimo-v2.5-free` | `/v1/chat/completions` | ✅ ~4 c |
| `mimo-v2.6-flash-free` | `/v1/chat/completions` | ✅ ~3 c |
| `nemotron-3-ultra-free` | `/v1/chat/completions` | ✅ ~3 c |
| `nemotron-3.5-lightning-free` | `/v1/chat/completions` | ✅ ~69 c (медленная) |
| `muse-spark-1.2-contributor-free` | `/v1/responses` | ✅ ~3 c |
| `muse-spark-1.3-contributor-free` | `/v1/responses` | ✅ ~4.5 c |
| `deepseek-v4-flash-free` | `/v1/chat/completions` | ❌ 400 от провайдера (недоступна на их стороне) |

Итог: 9 из 10 бесплатных моделей Zen отвечают прямо из приложения, релей не нужен.
`Pollinations` в момент прогона отдавал 500 «ENOSPC» (проблема их сервера) и прислал
notice об устаревании legacy text API — если Pollinations лежит, переключайтесь на
модели Zen без ключа.

## Требования

- Android 8.0 (API 26) и выше, JDK 21 для сборки, Node — только для build-time скриптов.
- Интернет нужен для Edge-TTS и ИИ; OCR, монтаж и экспорт работают офлайн.
- APK ≈ 35 МБ: модели OCR для латиницы и CJK лежат внутри (arm64-v8a + armeabi-v7a).

## Лицензия

MIT.
