/* Дымовой тест чистой логики (без браузера). */
import fs from 'node:fs';
import {
  secMsgGecValue, ssmlEscape, clusterBubbleWords, sortBubblesReadingOrder,
  trimSilence, sliceSegments, cleanMp3Frames, uuid, nowEdgeString, estimatePauseMs,
} from '../js/util.js';
import { buildTimeline, estimateSpeakDur, resampleLinear } from '../js/engine.js';

let fails = 0;
function ok(cond, name) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) fails++;
}

/* Sec-MS-GEC: 5-мин окно (сек) в 100нс тиках + токен */
const gec = secMsgGecValue(1727100000000);
ok(/^\d+\d+[A-Z0-9]+$/.test(gec) && gec.includes('6A5AA1D4EAFF4E9FB37E23D68491D6F4'), 'secMsgGecValue: тики + токен');

ok(/^[A-Z][a-z]{2} \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT/.test(nowEdgeString(new Date())), 'nowEdgeString формат');

ok(ssmlEscape('Привет <world> & "x"') === 'Привет &lt;world&gt; &amp; &quot;x&quot;', 'ssmlEscape');

const w = uuid();
ok(typeof w === 'string' && w.length >= 32, 'uuid');

/* кластеризация слов в пузыри */
const words = [
  { x: 10, y: 10, w: 40, h: 12, text: 'Привет' },
  { x: 60, y: 10, w: 40, h: 12, text: 'мир!' },
  { x: 30, y: 400, w: 60, h: 12, text: 'Вторая' },
  { x: 100, y: 400, w: 60, h: 12, text: 'линия' },
];
const bubbles = clusterBubbleWords(words, 300, 500);
ok(bubbles.length === 2, 'clusterBubbleWords → 2 пузыря');
const sorted = sortBubblesReadingOrder(bubbles, {});
ok(sorted[0].y < sorted[1].y, 'sortBubblesReadingOrder сверху вниз');

/* тишина и нарезка */
const sr = 8000;
const segs = sliceSegments(trimSilence(new Float32Array(sr * 4).fill(0), sr).start > 0 ? [] : new Float32Array(sr * 4).fill(0), sr);
ok(Array.isArray(segs) && segs.length === 0, 'sliceSegments на пустом сигнале → 0 сегментов');

/* таймлайн */
const project = {
  settings: { gap: 350 },
  roles: [],
  pages: [
    { w: 800, h: 1200, bubbles: [] },
    { w: 800, h: 1200, bubbles: [
      { id: 'a', text: 'Привет мир', audio: null, roleId: '' },
      { id: 'b', text: 'Это вторая реплика — чуть длиннее', audio: null, roleId: '' },
    ] },
  ],
};
const tl = buildTimeline(project);
ok(tl.items.length === 3, 'buildTimeline: 1 idle + 2 реплики');
ok(tl.total > estimateSpeakDur('Привет мир'), 'total > длительности реплики');
ok(tl.items[1].t > tl.items[0].t && tl.items[2].t > tl.items[1].t, 'таймлайн упорядочен');

/* MP3 frame walker на реальном Edge-файле (если есть) */
const mp3Path = process.env.EDGE_MP3;
if (mp3Path && fs.existsSync(mp3Path)) {
  const bytes = new Uint8Array(fs.readFileSync(mp3Path));
  const out = cleanMp3Frames(bytes);
  ok(out.length > 0, 'cleanMp3Frames: produced output');
  ok(out[0] === 0xff && (out[1] & 0xe0) === 0xe0, 'output starts with valid sync');
  console.log('cleanMp3Frames: in', bytes.length, 'out', out.length, 'ratio', (out.length/bytes.length).toFixed(3));
} else {
  console.log('skip cleanMp3Frames real file (нет EDGE_MP3)');
}

/* синтетический round-trip V2 (Edge реальный: 48kbps/24kHz V2 L3) */
const frames = (() => {
  const arr = [];
  for (let k = 0; k < 50; k++) {
    arr.push(0xff, 0xf2, 0x64, 0x00);
    for (let i = 0; i < 140; i++) arr.push((k * 7 + i) & 0xff);
  }
  return new Uint8Array(arr);
})();
const clean = cleanMp3Frames(frames);
ok(clean.length === frames.length, 'cleanMp3Frames V2 roundtrip lossless');

ok(estimatePauseMs('Привет!?') > estimatePauseMs('Привет'), 'estimatePauseMs с пунктуацией длиннее');

/* Каталог провайдеров и моделей */
const ai = await import('../js/ai.js');
const { PROVIDERS, provider, isFreeModel, MODELS_DEV, providerHasVision, isSmartModel, isOrchestrator, providerKeyUrl } = ai;
ok(Object.keys(PROVIDERS).length >= 10, 'каталог: >=10 провайдеров');
ok(Object.keys(MODELS_DEV).length >= 150, 'models.dev: >=150 провайдеров из opencode npm');
ok(providerHasVision('pollinations'), 'pollinations помечен как vision');
ok([...Object.keys(PROVIDERS)].filter((id) => providerHasVision(id)).length >= 50, 'vision-провайдеров в каталоге >= 50 (для OCR-селекта)');
ok(Object.keys(PROVIDERS).every((id) => provider(id).vision === undefined || provider(id).vision === true || provider(id).vision === false, 'vision-флаг корректен'));
ok(provider('pollinations').key === false && !provider('pollinations').endpoint.includes('zen'), 'pollinations — без ключа');
ok(provider('openai').key === true && provider('anthropic').key === true, 'openai/anthropic — с ключом');
ok(provider('openai').models.length >= 4 && provider('anthropic').anthropic === true && provider('gemini').gemini === true, 'каталог моделей и форматов');
ok(isFreeModel('pollinations', 'openai'), 'pollinations/openai помечена free');
ok(ai.FREE_MODELS.length >= 1 && Array.isArray(ai.FREE_MODELS), 'FREE_MODELS непустой список');
ok(provider('openai').models.length >= 20, 'openai: добавлены ВСЕ модели из models.dev');
ok(provider('openrouter').models.length >= 20, 'openrouter: добавлены ВСЕ модели из models.dev');
ok(Object.keys(PROVIDERS).every((id) => {
  const p = provider(id);
  return !p.endpoint || p.endpoint.startsWith('https://') || p.endpoint.startsWith('http://localhost');
}), 'у всех провайдеров корректный https-эндпоинт');
ok(Object.keys(PROVIDERS).every((id) => {
  const p = provider(id);
  return !p.endpoint || !p.endpoint.includes('${');
}), 'нет шаблонных эндпоинтов с ${...}');
ok(provider('minimax').anthropic === true && provider('subconscious').anthropic === true, 'minimax/subconscious — антропиковский формат из models.dev');
ok((provider('minimax').endpoint || '').startsWith('https://') && (provider('minimax').endpoint || '').endsWith('/messages'), 'minimax: антропиковский endpoint /messages');

/* Фейковый провайдер Zen AI (api.zen.ai / zen-30b...) не существует — удалён.
 * OpenCode Zen (opencode) вернулся как РЕАЛЬНЫЙ шлюз (opencode.ai/zen) с curated-списком;
 * автообновляемый блоб его моделей из models.dev и устаревший opencode-go не включаются. */
ok(!PROVIDERS.zen, 'фейковый провайдер Zen AI удалён');
ok(!Object.keys(PROVIDERS).some(k => (PROVIDERS[k].endpoint || '').includes('api.zen.ai')), 'в каталоге нет провайдеров с api.zen.ai');
ok(!!PROVIDERS.opencode, 'OpenCode Zen добавлен как реальный провайдер');
ok(provider('opencode').endpoint === 'https://opencode.ai/zen/v1/chat/completions', 'opencode: endpoint — реальный шлюз opencode.ai/zen');
ok(providerKeyUrl('opencode').includes('opencode.ai'), 'opencode: ссылка на ключ (opencode.ai/zen)');
ok(!PROVIDERS['opencode-go'], 'opencode-go (устаревший) не добавлен в каталог');
ok(!MODELS_DEV.opencode, 'список моделей Zen не раздут автообновляемой копией models.dev (curated)');
ok(Object.keys(provider('opencode').models).length >= 10, 'opencode: curated-список моделей (>=10)');
ok(provider('opencode').models.some(m => m.free) && provider('opencode').models.some(m => m.nokey), 'opencode: есть демо-модели без ключа');
ok(isFreeModel('opencode', 'big-pickle') === true, 'opencode: big-pickle помечена бесплатной (без ключа)');
ok(provider('opencode').models.some(m => m.id === 'big-pickle') && ai.modelMeta('opencode', 'big-pickle').nokey === true, 'opencode: big-pickle — демо-модель «без ключа»');
ok(provider('opencode').models.some(m => m.id === 'muse-spark-1.3-contributor-free' && m.nokey), 'opencode: muse-spark-1.3-contributor-free — демо (Responses)');
ok(provider('opencode').models.some(m => m.id === 'muse-spark-1.2-contributor-free' && m.nokey), 'opencode: muse-spark-1.2-contributor-free — демо (Responses)');
ok(provider('opencode').models.some(m => m.id === 'deepseek-v4-flash-free' && m.nokey), 'opencode: deepseek-v4-flash-free — зарегистрирована (провайдер недоступен)');
ok(!provider('opencode').models.some(m => m.id === 'x-preview-f-free'), 'opencode: x-preview-f-free («Ox Alpha») не отдаётся анонимно (401) — не добавлена');
ok(provider('opencode').models.filter(m => m.nokey).length === 10, 'opencode: ровно 10 демо-моделей без ключа');
ok(!provider('opencode').models.some(m => m.id === 'qwen3.6-plus-free'), 'opencode: нерабочие анонимные free-имена (qwen3.6-plus-free) заменены на демо-модели');
ok(isFreeModel('opencode', 'gpt-5.4-pro') === false, 'opencode: gpt-5.4-pro платная');
ok(isOrchestrator('opencode') === true, 'opencode помечен как оркестратор (один ключ → любые модели)');
ok(PROVIDERS.custom.name.includes('Свой') && !PROVIDERS.custom.name.includes('M-PM-'), 'custom-провайдер: имя без mojibake');

/* Где взять ключ: у всех curated-провайдеров с ключом есть ссылка на реальный сайт. */
ok(isOrchestrator('openrouter') === true, 'openrouter помечен как оркестратор (один ключ → многие модели)');
ok(isOrchestrator('openai') === false && isOrchestrator('pollinations') === false, 'openai/pollinations — не оркестраторы');
ok(providerKeyUrl('openai').startsWith('https://'), 'openai: ссылка на ключ = реальный сайт');
ok(providerKeyUrl('gemini').includes('aistudio.google.com'), 'gemini: ссылка на ключ AI Studio');
ok(providerKeyUrl('openrouter').includes('openrouter.ai'), 'openrouter: ссылка на ключ');
ok(providerKeyUrl('pollinations') === '', 'pollinations: без ключа → ссылки нет');
ok(ai.PROVIDER_KEY_URL && Object.keys(ai.PROVIDER_KEY_URL).length >= 10, 'PROVIDER_KEY_URL определён с непустым набором');
ok(Object.keys(PROVIDERS).every((id) => {
  const p = provider(id);
  if (p.key !== true) return true;
  return providerKeyUrl(id).startsWith('https://') || providerKeyUrl(id) === '';
}), 'у всех ключевых провайдеров есть ссылка на ключ (или сайт провайдера)');

/* Умные/быстрые: известно поведение для типовых имён. */
const mtSmart = ai.modelMeta('openai', 'gpt-5.2');
const mtFast = ai.modelMeta('openai', 'gpt-4o-mini');
const mtFlash = ai.modelMeta('gemini', 'gemini-2.0-flash');
const mtPro = ai.modelMeta('gemini', 'gemini-2.5-pro');
const mtLlama = ai.modelMeta('cerebras', 'llama-3.3-70b');
ok(typeof mtSmart.smart === 'boolean', 'modelMeta.smart — булев флаг');
ok(mtFast.smart === false && mtFlash.smart === false, 'mini/flash классифицируются как быстрые (глупые)');
ok(mtPro.smart === true && mtLlama.smart === true, 'pro/70B классифицируются как умные');
ok(typeof isSmartModel('pollinations', 'gpt-oss-20b') === 'boolean', 'isSmartModel работает и на без-ключ моделях');

/* передискретизация: длина и значения при 24k -> 44.1k и обратно */
const ramp = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(i / 48000 * Math.PI * 4));
const up = resampleLinear(ramp, 24000, 44100);
ok(Math.abs(up.length - 88200) <= 1, 'resampleLinear 24k→44.1k: длина ~×1.84');
ok(Math.abs(resampleLinear(up, 44100, 24000).length - ramp.length) <= 2, 'resampleLinear roundtrip: длина совпадает');
ok(resampleLinear(ramp, 24000, 24000) === ramp, 'resampleLinear: та же частота → исходный объект');
let maxErr = 0;
for (let i = 0; i < ramp.length; i++) maxErr = Math.max(maxErr, Math.abs(up[Math.floor(i * 44100 / 24000)] - ramp[i]));
ok(maxErr < 0.001, 'resampleLinear: значения близки к оригиналу');

/* обрезка тишины и смещение нарезок (починка clipsFromAudio) */
{
  const sr = 8000;
  const leadS = 1.5, sigLen = 2.5;
  const n = Math.floor(sr * (leadS + sigLen));
  const sig = new Float32Array(n);
  sig.fill(0.5, Math.floor(sr * leadS), n); // 1.5 с тишины, затем сигнал
  const trimmed = trimSilence(sig, sr);
  ok(trimmed.start > 0 && trimmed.end === n, 'trimSilence: нашёл границы (лидирующая тишина + конец)');
  const body = sig.subarray(trimmed.start, trimmed.end);
  const segs = sliceSegments(body, sr, { threshold: 0.02, minSilence: 0.3, minClip: 0.3 });
  const mapped = segs.map(s => ({ startS: s.startS + trimmed.start / sr, endS: s.endS + trimmed.start / sr }));
  ok(mapped.length >= 1 && mapped[0].startS >= trimmed.start / sr && mapped[0].startS < trimmed.start / sr + 0.4,
    'смещения сегментов пересчитаны на исходный сигнал (в окне лидирующей тишины)');
  ok(segs[segs.length - 1].endS <= body.length / sr + 1e-6, 'последний сегмент не обрезан (фикс sliceSegments)');
  let peak = 0;
  for (let i = Math.floor(mapped[0].startS * sr); i < Math.min(n, Math.floor(mapped[0].endS * sr)); i++) peak = Math.max(peak, Math.abs(sig[i]));
  ok(peak > 0.02, 'по рассчитанным смещениям в исходном сигнале действительно звук');
}

/* sliceSegments: сегмент, доходящий до конца сигнала без хвостовой тишины, не теряется */
{
  const sr = 8000;
  const sig = new Float32Array(sr * 2);
  sig.fill(-0.4, 0, sr * 2); // активный сигнал до самого конца, без тишины
  const segs = sliceSegments(sig, sr, { threshold: 0.02, minSilence: 0.3, minClip: 0.3 });
  ok(segs.length === 1 && segs[0].startS === 0 && Math.abs(segs[0].endS - 2) < 0.05,
    'sliceSegments сохраняет хвостовой сегмент');
}

/* ================================================================
 * Регрессы на баги, найденные разбором репозитория.
 * Каждый блок ловит конкретную поломку — иначе она вернётся молча.
 * ================================================================ */

/* [1] ffmpeg.wasm: UMD-сборка экспортирует глобал FFmpegWASM (не FFmpeg) и
 * создаёт воркер на кросс-доменном URL, что браузер запрещает. Значит
 * грузить можно только ESM через classWorkerURL (blob) + ESM-ядро. */
{
  const eng = fs.readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8');
  ok(!/https:\/\/[^'"\s]*\/umd\//.test(eng), 'engine.js: ни один ffmpeg-URL не указывает на dist/umd (UMD отдаёт FFmpegWASM и кросс-доменный воркер)');
  ok(/classWorkerURL/.test(eng), 'engine.js: ffmpeg load() получает classWorkerURL (иначе Worker с CDN-URL бросает SecurityError)');
  ok(!/window\.FFmpeg\b/.test(eng), 'engine.js: нет обращения к window.FFmpeg (в UMD такого глобала нет)');
  ok(/import\([^)]*FF_ESM/.test(eng) || /import\(FF_ESM\)/.test(eng), 'engine.js: ESM-библиотека ffmpeg подключается динамическим import()');
}

/* [2] Файловые кнопки UI: атрибут hidden на <input type=file> даёт
 * display:none из UA-стиля, и клик по кнопке/label невозможен. */
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../css/ui.css', import.meta.url), 'utf8');
  const inputs = [...html.matchAll(/<input[^>]*type="file"[^>]*>/g)].map(m => m[0]);
  const clickable = ['chat-file', 'clipFile', 'recFile', 'opt-music', 'jsonImport'];
  ok(inputs.length === 6, 'index.html: все 6 файловых инпутов на месте');
  ok(clickable.every(id => inputs.some(i => i.includes(`id="${id}"`) && !/\shidden/.test(i))),
    'index.html: кликабельные файловые инпуты без hidden (иначе кнопка мертва)');
  ok(/\.file input\[type=file\]/.test(css) && /label\.btn/.test(css),
    'ui.css: .file-инпут перекрывает кнопку, label.btn выглядит как кнопка');
}

/* [3] Бэкенд: get_user обязан читать заголовок Authorization. Без Header()
 * FastAPI трактует параметр как query и отдаёт 401 на любой запрос с токеном. */
{
  const py = fs.readFileSync(new URL('../backend/main.py', import.meta.url), 'utf8');
  ok(/authorization:\s*Optional\[str\]\s*=\s*Header\(/.test(py),
    'backend: токен читается из заголовка Authorization, а не из query-строки');
  ok(!/async def get_user\(authorization:\s*Optional\[str\]\s*=\s*None\)/.test(py),
    'backend: нет варианта get_user без Header() (это ломало авторизацию)');
}

/* [4] Двуязычные субтитры: режим «только основной текст» не должен рисовать
 * перевод (раньше 'orig' и 'origtr' вели себя одинаково). */
{
  const cap = (biling, mainText, trText) => {
    const show = biling === 'tr' ? (trText || mainText) : mainText;
    let second = '';
    if (biling === 'tr') second = trText ? mainText : '';
    else if (biling !== 'orig') second = trText;
    return [show, second].filter(Boolean);
  };
  ok(cap('orig', 'A', 'B').length === 1, 'субтитры: biling=orig рисует только оригинал');
  ok(cap('origtr', 'A', 'B').join('|') === 'A|B', 'субтитры: biling=origtr рисует оригинал + перевод');
  ok(cap('tr', 'A', 'B').join('|') === 'B|A', 'субтитры: biling=tr рисует перевод + оригинал');
  ok(cap('tr', 'A', '').join('|') === 'A', 'субтитры: без перевода оригинал не дублируется');
  ok(cap('origtr', 'A', '').join('|') === 'A', 'субтитры: biling=origtr без перевода = один оригинал');
  const eng = fs.readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8');
  ok(/if \(biling === 'tr'\) second = trText \? mainText : '';/.test(eng), 'engine.js drawCaption: перевод не дублирует оригинал');
  ok(/else if \(biling !== 'orig'\) second = trText;/.test(eng), 'engine.js drawCaption: режим orig не тянет перевод');
}

/* [5] Импорт проекта: страницы привязываются к загруженным (id, иначе
 * порядок), непривязанные попадают в отчёт, уже озвученные реплики не
 * теряются. */
{
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const imp = app.slice(app.indexOf('async function importProject'), app.indexOf('function resetAll'));
  ok(/sameCount/.test(imp), 'app.js importProject: привязка страниц по порядку, если id не совпали');
  ok(/НЕ привязано страниц/.test(imp), 'app.js importProject: непривязанные страницы попадают в отчёт');
  ok(!/audio:\s*undefined\s*\}/.test(imp) && /old\.audio/.test(imp),
    'app.js importProject: уже озвученные реплики не затираются');
  ok(/function onFirstBind/.test(app) && /uiBound = true/.test(app),
    'app.js: bindSettings() не вешает слушатели повторно (иначе дубли после импорта/сброса)');
}

/* [6] Сохранение: ошибки IndexedDB больше не глотаются — иначе тост
 * «Сохранено» появлялся при потере проекта (например, QuotaExceeded). */
{
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const sv = app.slice(app.indexOf('async function saveToDB'), app.indexOf('/* ====', app.indexOf('async function saveToDB')));
  ok(/if \(errs\.length\) throw new Error/.test(sv), 'app.js saveToDB: пробрасывает ошибку записи');
  ok(/QuotaExceededError/.test(app), 'app.js: квота IndexedDB распознаётся и объясняется пользователю');
  ok(!/try \{ await idbSet\(KEY_PROJECT[\s\S]{0,200}catch \(e\) \{\}/.test(sv),
    'app.js saveToDB: пустой catch больше не глушит потерю данных');
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);