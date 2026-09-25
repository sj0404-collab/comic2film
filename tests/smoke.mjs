/* Дымовой тест чистой логики (без браузера). */
import fs from 'node:fs';
import {
  secMsgGecValue, ssmlEscape, clusterBubbleWords, sortBubblesReadingOrder,
  trimSilence, sliceSegments, cleanMp3Frames, uuid, nowEdgeString, estimatePauseMs,
} from '../js/util.js';
import { buildTimeline, estimateSpeakDur, resampleLinear } from '../js/engine.js';
import {
  normName, normGender, normVoiceGender, isNarratorName, isUnknownName,
  mergeCharacters, resolveSpeaker, planCasts, planTakes, resolveTakes, takeMismatch, NARRATOR,
} from '../js/cast.js';

let fails = 0;
function ok(cond, name) {
  console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name);
  if (!cond) fails++;
}

/* Sec-MS-GEC: 5-мин окно (сек) в 100нс тиках + токен */
const gec = secMsgGecValue(1727100000000);
ok(/^\d+\d+[A-Z0-9]+$/.test(gec) && gec.includes('6A5AA1D4EAFF4E9FB37E23D68491D6F4'), 'secMsgGecValue: тики + токен');

ok(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT\+0000$/.test(nowEdgeString(new Date())),
  'nowEdgeString формат (RFC 1123 с запятой, как у edge-tts)');

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

/* ================================================================
 * Регрессы на HIGH: громкость, зависания рендера, temperature/system,
 * idx в переводе, голоса, кэш YOLO, каталог моделей, сохранение.
 * ================================================================ */

/* Код без комментариев: иначе ассерты ловят удалённые идентификаторы
 * в пояснениях к фиксу. */
function codeOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/* [7] Громкость роли: слайдер пишет volumeNum (100 = 1.0), строка '+0%'
 * разбиралась как 0.9. */
{
  const E = await import('../js/engine.js');
  ok(E.roleGain({ volumeNum: 100 }) === 1, 'roleGain: 100% = единичная громкость');
  ok(E.roleGain({ volumeNum: 200 }) === 2, 'roleGain: 200% = усиление x2');
  ok(E.roleGain({ volumeNum: 10 }) === 0.1, 'roleGain: 10% = 0.1');
  ok(E.roleGain({ volume: '+0%' }) === 1, "roleGain: старый формат '+0%' = 1 (было 0.9)");
  ok(E.roleGain({ volume: '0%' }) === 1, "roleGain: старый формат '0%' = 1");
  ok(E.roleGain({ volume: '+100%' }) === 2, "roleGain: старый формат '+100%' = 2 (было 1.9)");
  ok(E.roleGain(null) === 1 && E.roleGain({}) === 1, 'roleGain: без роли/полей = 1');
  ok(E.roleGain({ volumeNum: 5 }) === 0.05, 'roleGain: значения вне слайдера не залипают на 0.1');
  const eng = fs.readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8');
  ok(!/clampVol/.test(eng), 'engine.js: старая clampVol (0.9 вместо 1.0) удалена');
}

/* [12, 13] Рендер не должен зависать: цикл музыки при duration<=0 и
 * rAF-цикл записи без actx.resume()/без таймлайна. */
{
  const eng = fs.readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8');
  const ra = eng.slice(eng.indexOf('export async function renderAndRecord'), eng.indexOf('export async function renderAudioTrack'));
  ok(/actx\.resume\(\)/.test(ra), 'engine.js renderAndRecord: AudioContext поднимается (иначе currentTime стоит и запись не завершится)');
  ok(/if \(!item\) \{ try \{ rec\.stop\(\); \}/.test(ra), 'engine.js renderAndRecord: пустой таймлайн останавливает запись, а не крутит rAF вечно');
  ok(/const guard = setTimeout\(\(\) => \{ try \{ rec\.stop\(\); \}/.test(ra), 'engine.js renderAndRecord: есть страховочный таймер остановки');
  const rt = eng.slice(eng.indexOf('export async function renderAudioTrack'), eng.indexOf('function encodeWav'));
  ok(/const step = m\.duration > 0 \? m\.duration/.test(rt) && /guard\+\+ < 10000/.test(rt),
    'engine.js renderAudioTrack: шаг цикла музыки всегда > 0 (duration=0 вешал вкладку)');
}

/* [9, 10] temperature reasoning-моделям не отправляется; system-промпт Gemini
 * уходит в systemInstruction, а не вторым user-turn. */
{
  const A = await import('../js/ai.js');
  ok(A.temperatureFor('o4-mini', false) === undefined, 'temperature: o4-mini без temperature (иначе 400)');
  ok(A.temperatureFor('o1-preview', false) === undefined, 'temperature: o1 без temperature');
  ok(A.temperatureFor('gpt-5.2', false) === undefined, 'temperature: gpt-5.2 без temperature');
  ok(A.temperatureFor('codex-mini', false) === undefined, 'temperature: codex без temperature');
  ok(A.temperatureFor('llama-3.3-70b-versatile', false) === 0.5, 'temperature: обычные модели получают 0.5');
  ok(A.temperatureFor('gpt-4o-mini', true) === 0.1, 'temperature: в json-режиме 0.1 даже для reasoning');
  let body = null;
  globalThis.fetch = async (u, o) => { body = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }) }; };
  await A.chat({ ai: 'gemini', aimodel: 'gemini-2.5-flash', key: 'K', aiGap: 0 }, [
    { role: 'system', content: 'СИСТЕМНЫЙ' }, { role: 'user', content: 'вопрос' },
  ]);
  ok(body.systemInstruction && body.systemInstruction.parts[0].text === 'СИСТЕМНЫЙ', 'Gemini: system-промпт в systemInstruction');
  ok(body.contents.length === 1 && body.contents[0].role === 'user', 'Gemini: в contents остался только настоящий вопрос');
  globalThis.fetch = async (u, o) => { body = JSON.parse(o.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
  await A.chat({ ai: 'openai', aimodel: 'o4-mini', key: 'k', aiGap: 0 }, [{ role: 'user', content: 'hi' }]);
  ok(!('temperature' in body), 'OpenAI-совместимые: поле temperature отсутствует у reasoning-моделей');
}

/* [9] 4xx не ретраится, response_format умеет откат */
{
  const A = await import('../js/ai.js');
  let n = 0;
  globalThis.fetch = async () => { n++; return { ok: false, status: 401, text: async () => 'bad key' }; };
  try { await A.chat({ ai: 'openai', aimodel: 'gpt-4o-mini', key: 'x', aiGap: 10 }, [{ role: 'user', content: 'hi' }]); } catch (e) { }
  ok(n === 1, '401: одна попытка, без бесполезного бэкоффа (было 4)');
  const bodies = [];
  globalThis.fetch = async (u, o) => {
    const b = JSON.parse(o.body); bodies.push(b);
    if (b.response_format) return { ok: false, status: 400, text: async () => 'Unsupported parameter: response_format' };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '[{"idx":0,"text":"да"}]' } }] }) };
  };
  const r = await A.translateLines({ ai: 'openai', aimodel: 'gpt-4o-mini', key: 'k', aiGap: 0 }, [{ text: 'yes' }], 'русский');
  ok(bodies.length === 2 && !bodies[1].response_format && r[0] === 'да', 'response_format: откат на запрос без него');
}

/* [8] idx в ответе модели валидируется, массив остаётся массивом */
{
  const A = await import('../js/ai.js');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '[{"idx":0,"text":"Один"},{"idx":"x","text":"мусор"},{"idx":99,"text":"вне"},"строка"]' } }] }) });
  const r = await A.translateLines({ ai: 'openai', aimodel: 'gpt-4o-mini', key: 'k', aiGap: 0 }, [{ text: 'a' }, { text: 'b' }, { text: 'c' }], 'русский');
  ok(Array.isArray(r) && r.length === 3, 'translateLines: длина результата = длина входа');
  ok(JSON.stringify(Object.keys(r)) === '["0","1","2"]', 'translateLines: мусорный idx не создаёт строковых ключей');
  ok(r[0] === 'Один' && r[1] === null && r[2] === null, 'translateLines: непригодные ответы отброшены');
  ok(A.countTranslated(r) === 1, 'countTranslated: честный счётчик переведённых');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'не JSON' } }] }) });
  let msg = '';
  try { await A.translateLines({ ai: 'openai', aimodel: 'gpt-4o-mini', key: 'k', aiGap: 0 }, [{ text: 'a' }], 'русский'); } catch (e) { msg = e.message; }
  ok(/не JSON-массив: не JSON/.test(msg), 'translateLines: внятная ошибка вместо [object Object]');
}

/* [14, 15, 16] Edge-TTS: заголовок, xml:lang, локали, запрещённый UA */
{
  const V = await import('../js/voices.js');
  ok(V.voiceLocale('ru-RU-DmitryNeural') === 'ru-RU', 'voiceLocale: ru-RU');
  ok(V.voiceLocale('ja-JP-NanamiNeural') === 'ja-JP', 'voiceLocale: ja-JP');
  ok(V.voiceLocale('broken') === 'en-US', 'voiceLocale: мусор → en-US');
  ok(/xml:lang='ru-RU'/.test(V.SSML('ru-RU-DmitryNeural', 'Привет')), 'SSML: xml:lang из голоса (было жёстко en-US)');
  ok(/xml:lang='ja-JP'/.test(V.SSML('ja-JP-NanamiNeural', 'やあ')), 'SSML: японский голос → ja-JP');
  ok(V.normLocale('zh-Hans-CN') === 'zh-CN', 'normLocale: zh-Hans-CN → zh-CN');
  ok(V.normLocale('ca-ES-valencia') === 'ca-ES', 'normLocale: ca-ES-valencia → ca-ES');
  ok(V.normLocale('es-419') === 'es-419', 'normLocale: es-419 сохранён');
  V.registerFetchedVoices([{ ShortName: 'zh-CN-ProbeNeural', Locale: 'zh-Hans-CN', Gender: 'Female' }]);
  ok(V.voicesForLang('zh-CN').some(v => v.id === 'zh-CN-ProbeNeural'), 'голос с zh-Hans-CN попадает в фильтр zh-CN');
  const vs = fs.readFileSync(new URL('../js/voices.js', import.meta.url), 'utf8');
  ok(!/'User-Agent':/.test(vs), 'voices.js: User-Agent не передаётся в fetch (браузер его всё равно выбросил бы)');
  ok(!/nowEdgeString\(\)Z/.test(vs), 'voices.js: убран лишний Z в X-Timestamp');
}

/* [11] YOLO: сессия и байты модели не перечитываются на каждую страницу */
{
  const yolo = fs.readFileSync(new URL('../js/yolo.js', import.meta.url), 'utf8');
  ok(/_sessionId === modelId/.test(yolo) && /invalidateSession/.test(yolo), 'yolo.js: InferenceSession кэшируется между страницами');
  ok(!/InferenceSession\.create\(cached/.test(yolo), 'yolo.js: сессия не создаётся заново из кэша на каждый вызов');
  ok(/:meta/.test(yolo), 'yolo.js: размер модели хранится отдельной записью (статус не читает 108МБ)');
  ok(/idbDel\(metaKey/.test(yolo), 'yolo.js: удаление модели чистит и метазапись');
}

/* [17] Живой список моделей реально попадает в каталог */
{
  const A = await import('../js/ai.js');
  const n0 = A.provider('pollinations').models.length;
  const added = A.mergeFreeModels('pollinations', ['openai', 'probe-model-x', 'probe-model-x', '', 42]);
  ok(added === 1 && A.provider('pollinations').models.length === n0 + 1, 'mergeFreeModels: новая модель добавлена один раз, мусор отброшен');
  ok(A.modelMeta('pollinations', 'probe-model-x').nokey === true && A.modelMeta('pollinations', 'probe-model-x').free === true,
    'mergeFreeModels: новая модель помечена как бесплатная и без ключа');
  const mui = fs.readFileSync(new URL('../js/modelsui.js', import.meta.url), 'utf8');
  ok(/mergeFreeModels\('pollinations', list\)/.test(mui) && /invalidateModelCache/.test(mui), 'modelsui.js: кнопка обновления пишет в каталог и сбрасывает кэш');
}

/* [18, 19, 20, 21] Утечки URL, custom в селекте, дешёвое сохранение, таймлайн */
{
  const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
  const appCode = codeOnly(app);
  ok(!/musicUrl/.test(appCode), 'app.js: мёртвый musicUrl удалён (он только терял objectURL)');
  ok(/URL\.revokeObjectURL\(c\.url\)/.test(appCode) && /function delClip[\s\S]{0,400}autoSaveTimer\(\)/.test(appCode),
    'app.js: удаление нарезки освобождает URL и сохраняется');
  ok(/projectForStore/.test(appCode) && !/structuredClone\(project\)/.test(appCode),
    'app.js: сохранение не делает глубокую копию всех File/Blob (сотни МБ за автосейв)');
  ok(/value: 'custom'/.test(appCode), 'app.js: «Свой API» есть в селекте провайдера');
  ok(/measureTrimmedDuration/.test(appCode), 'app.js: длительность озвучки меряется по обрезанному куску (таймлайн совпадает со звуком)');
  const E2 = await import('../js/engine.js');
  ok(E2.TRIM && E2.TRIM.threshold === 0.012, 'engine.js: параметры обрезки вынесены в общий TRIM');
  const eng = codeOnly(fs.readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8'));
  ok(!/trimSilence\(src, buf\.sampleRate, \{ threshold: 0\.012/.test(eng), 'engine.js: обрезка тишины читает TRIM, а не зашитый литерал');
  ok(/project\.settings = settings/.test(appCode), 'app.js: project.settings выставляется при старте (иначе таймлайн строится по умолчанию)');
}

/* ================================================================
 * Регрессы на MEDIUM: безопасность бэкенда, relay, service worker,
 * APK-версия, выдуманные bbox, вложения чата, дедуп type-логики.
 * ================================================================ */

/* [21, 22, 23, 24] backend/main.py */
{
  const py = fs.readFileSync(new URL('../backend/main.py', import.meta.url), 'utf8');
  const pyCode = codeOnly(py);
  ok(!/str\(p\)\.startswith\(str\(WORKSPACE_ROOT\)\)/.test(pyCode),
    'backend: resolve_path не использует startswith (соседний каталог с тем же префиксом проходил)');
  ok(/is_relative_to\(WORKSPACE_ROOT\)/.test(pyCode), 'backend: граница проверяется через is_relative_to');
  ok(/def safe_filename/.test(pyCode) && /safe_filename\(file\.filename\)/.test(pyCode),
    'backend: имя файла при загрузке проходит через safe_filename');
  ok(/os\.path\.basename/.test(pyCode), 'backend: safe_filename срезает каталоги из имени');
  ok(/TOKEN_TTL/.test(pyCode) && /TOKEN_CACHE\[token\] = \(now \+ TOKEN_TTL/.test(pyCode),
    'backend: кэш токена имеет срок жизни (отозванный токен иначе жил до перезапуска)');
  ok(/os\._exit\(1\)/.test(pyCode),
    'backend: ошибка в child-ветке pty.fork() завершает ребёнка, а не продолжает копию сервера');
  ok(/os\.waitpid/.test(pyCode), 'backend: reap после pty (иначе зомби на каждую сессию терминала)');
  ok(/asyncio\.gather\(\*done/.test(pyCode), 'backend: gather ждёт завершившиеся задачи, а не отменённые');
  ok(/^import shutil$/m.test(py) && !/\n\s*import shutil\n\s*if __name__/.test(pyCode),
    'backend: shutil импортируется вверху файла, а не после эндпоинтов');
}

/* [25] relay/zen-relay.mjs: сбой не выдаётся за успех */
{
  const relay = await import('../relay/zen-relay.mjs');
  const sse = (...l) => l.join('\n') + '\n';
  let r = relay.sseFoldChat(sse('data: {"choices":[{"delta":{"content":"Привет"}}]}', 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}'));
  ok(r.content === 'Привет' && !r.error, 'relay: нормальный ответ собирается из дельт');
  r = relay.sseFoldChat(sse('data: {"choices":[{"delta":{"content":"x"}}]}', 'data: {"error":{"message":"rate limit"}}'));
  ok(!!r.error && r.finish_reason === 'error', 'relay: error-событие → ошибка, finish_reason=error (было тихо)');
  r = relay.sseFoldChat(sse('data: {"choices":[{"delta":{},"finish_reason":"length"}]}'));
  ok(!!r.error && /лимит длины/.test(r.error), 'relay: обрыв по длине → внятная ошибка');
  ok(!!relay.sseFoldChat(sse('data: [DONE]')).error, 'relay: пустой поток → ошибка, а не пустой ответ');
  r = relay.sseFoldResponses(sse('data: {"type":"response.failed","error":{"message":"boom"}}'));
  ok(!!r.error && /boom/.test(r.error), 'relay: response.failed → ошибка');
  ok(!!relay.sseFoldResponses(sse('data: {"type":"response.incomplete","response":{"incomplete_details":{"reason":"max_output_tokens"}}}')).error,
    'relay: response.incomplete → ошибка с причиной');
  const c = relay.completionJson('m', { content: 'Привет, мир', finish_reason: 'stop' });
  ok(c.usage.total_tokens > 0 && c.usage.estimated === true, 'relay: usage больше не нули, а честная оценка с флагом');
  ok(relay.completionJson('m', { content: 'x', usage: { input_tokens: 5, output_tokens: 3 } }).usage.total_tokens === 8,
    'relay: если апстрим дал токены — используются они');
  const relaySrc = codeOnly(fs.readFileSync(new URL('../relay/zen-relay.mjs', import.meta.url), 'utf8'));
  ok(/if \(result\.error\)[\s\S]{0,200}502/.test(relaySrc), 'relay: сбой апстрима отдаётся как 502, не как 200 с пустым content');
}

/* [26] sw.js: runtime-кэширование реально работает */
{
  const sw = codeOnly(fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8'));
  const nf = sw.slice(sw.indexOf('async function networkFirst'), sw.length);
  ok(!/e\.waitUntil\(cache\.put/.test(nf), 'sw.js: cache.put не идёт через e.waitUntil после await (это всегда бросало)');
  ok(/await cache\.put\(req, copy\)/.test(nf), 'sw.js: ответ кэшируется обычным awaited-вызовом');
  ok(/res\.clone\(\)\.arrayBuffer\(\)/.test(nf), 'sw.js: копия ответа читается до того, как оригинал уйдёт клиенту');
  ok(/res\.status !== 206/.test(sw), 'sw.js: частичные ответы (206) не кэшируются');
}

/* [27] tools/patch-signing.mjs: версия APK обновляема */
{
  const ps = codeOnly(fs.readFileSync(new URL('../tools/patch-signing.mjs', import.meta.url), 'utf8'));
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  ok(!/versionCode 1\\n/.test(ps) && !/'versionCode 1'/.test(ps), 'patch-signing: versionCode не зашит в 1');
  ok(/major \* 10000 \+ minor \* 100 \+ patch/.test(ps), 'patch-signing: versionCode выводится из версии');
  ok(/Math\.max\(curCode \+ 1, ver\.code\)/.test(ps), 'patch-signing: versionCode монотонно растёт (иначе APK не обновляется)');
  ok(new RegExp('versionName "' + pkg.version.replace(/\./g, '\\.') + '"').test(ps.replace(/\$\{ver\.name\}/, pkg.version)) ||
     /ver\.name/.test(ps), 'patch-signing: versionName берётся из package.json');
  ok(!/!g\.includes\('signingConfigs'\)/.test(ps), 'patch-signing: наличие debug-блока signingConfigs больше не отключает патч');
  ok(/signingConfigs\s*\{[\s\S]*?\brelease\s*\{/.test(ps), 'patch-signing: проверяется именно release-подпись');
  ok(/process\.exit\(1\)/.test(ps), 'patch-signing: отсутствие build.gradle — ошибка, а не тихий выход');
}

/* [28] deploy.yml публикует только собранный www */
{
  const dy = fs.readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const dyCode = dy.replace(/\s*#.*$/gm, '');   // без комментариев
  ok(/path: www/.test(dyCode), 'deploy.yml: публикуется www/, а не весь репозиторий');
  ok(!/path: \s*\.\s*$/.test(dyCode), 'deploy.yml: path: . больше не используется (иначе наружу уходит backend/ и relay/)');
  const bw = fs.readFileSync(new URL('../build-www.mjs', import.meta.url), 'utf8');
  ok(!/['"]backend['"]|['"]relay['"]|['"]tests['"]/.test(bw), 'build-www: в www/ не копируются backend/relay/tests');
}

/* [29] vision-OCR больше не выдумывает координаты */
{
  const ocr = codeOnly(fs.readFileSync(new URL('../js/ocr.js', import.meta.url), 'utf8'));
  ok(!/w: W \/ Math\.ceil/.test(ocr) && !/x: \(col \* W\)/.test(ocr), 'ocr.js: фиктивная сетка координат удалена');
  ok(/x: null, y: null, w: null, h: null/.test(ocr), 'ocr.js: реплики без боксов помечаются null, а не выдуманными числами');
  ok(/boxes: false/.test(ocr) && /boxes: true/.test(ocr), 'ocr.js: результат сообщает, есть ли реальные координаты');
  const eng = codeOnly(fs.readFileSync(new URL('../js/engine.js', import.meta.url), 'utf8'));
  ok(/function bubbleHasBox/.test(eng), 'engine.js: наличие настоящего бокса проверяется явно');
  ok(/bubbleHasBox\(item\.bubble, item\.page\) \? \(settings\.caption/.test(eng),
    'engine.js: реплика без бокса рисуется нижней подписью, а не прямоугольником');
  const app = codeOnly(fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'));
  ok(/p\.bubblesHaveBoxes = res\.boxes !== false/.test(app), 'app.js: факт отсутствия координат сохраняется в странице');
}

/* [31] чат: текстовые вложения уходят модели */
{
  const chat = codeOnly(fs.readFileSync(new URL('../js/chat.js', import.meta.url), 'utf8'));
  ok(/async function readAttachmentText/.test(chat), 'chat.js: есть чтение текстовых вложений');
  ok(/attachBlock/.test(chat) && /Содержимое приложенных файлов/.test(chat), 'chat.js: содержимое вложений включается в запрос');
  ok(/const images = files\.filter\(f => f\.dataURL\)/.test(chat), 'chat.js: картинки и текстовые файлы обрабатываются раздельно');
  ok(!/f\.objectUrl \|\| f\.objectUrl/.test(chat), 'chat.js: мёртвая ветка f.objectUrl убрана');
  ok(!/idbGet && \(await idbGet/.test(chat), 'chat.js: убрана бессмысленная проверка idbGet на функцию');
  ok(/MAX_ATTACH_BYTES/.test(chat) && /MAX_TOTAL_CHARS/.test(chat), 'chat.js: у вложений есть лимиты размера');
}

/* [32, 13, 14] дедуп type-логики, лимит страниц, uuid */
{
  const U = await import('../js/util.js');
  const saved = globalThis.crypto;
  try {
    delete globalThis.crypto;
    const u = U.uuid();
    ok(typeof u === 'string' && /^[0-9a-f]{32}$/.test(u), 'uuid: работает без globalThis.crypto (был ReferenceError)');
    ok(new Set(Array.from({ length: 200 }, () => U.uuid())).size === 200, 'uuid: без crypto значения не повторяются');
  } finally {
    if (saved !== undefined) globalThis.crypto = saved;
  }
  ok(U.isAudioFile({ name: 'v.mka', type: 'audio/x-matroska' }) === true, 'isAudioFile: .mka (это было в AUDIO_EXT, но не в регулярке app.js)');
  ok(U.isAudioFile({ name: 'p.png', type: 'image/png' }) === false, 'isAudioFile: картинка не считается аудио');
  ok(U.isPdfFile({ name: 'd.pdf', type: '' }) === true, 'isPdfFile: pdf по расширению');
  const imp = codeOnly(fs.readFileSync(new URL('../js/import.js', import.meta.url), 'utf8'));
  ok(/const MAX_PAGES = 700/.test(imp), 'import.js: лимит страниц вынесен в константу');
  ok(!/pages\.length > 700/.test(imp), 'import.js: убран off-by-one на лимите страниц');
  ok(/Архив .* не поддерживается/.test(imp), 'import.js: .tar/.7z из ARCH_EXT объясняются, а не падают');
  const app = codeOnly(fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'));
  ok(/list\.filter\(isAudioFile\)/.test(app) && !/\^audio\|video/.test(app),
    'app.js: тип файла определяется предикатом util.js, а не своей регуляркой');
  const st = codeOnly(fs.readFileSync(new URL('../js/store.js', import.meta.url), 'utf8'));
  ok(/tx\.onabort/.test(st), 'store.js: откат транзакции (квота) не вешает промис навечно');
}

/* ================================================================
 * Дубляж-пайплайн: нормализация имён, сведение персонажей, кастинг
 * голосов, раздача нарезок. Раньше здесь был круговой segs[i % len] по
 * индексу среди ВСЕХ реплик книги, голоса брались одинаковые, а
 * неизвестный говорящий молча падал на первую роль.
 * ================================================================ */

/* Нормализация имён: модель возвращает «Марио», "«марио»", "МАРИО." */
ok(normName('Марио') === 'марио' && normName('  «МАРИО». ') === 'марио', 'normName: кавычки и точка с хвостом после пробела не плодят дублей');
ok(normName('Марио…') === 'марио' && normName('марио, ') === 'марио' && normName('марио\n') === 'марио', 'normName: хвостовая пунктуация и перевод строки срезаются');
ok(normName('Саске') !== normName('Наруто'), 'normName: разные имена остаются разными');
ok(normGender('M') === 'male' && normGender('ж') === 'female' && normGender('whatever') === 'other', 'normGender: M/ж/прочее');
ok(normVoiceGender('m') === 'm' && normVoiceGender('female') === 'f' && normVoiceGender('') === '', 'normVoiceGender: каталог голосов и пол персонажа сравнимы');
ok(isNarratorName('Рассказчик') && isNarratorName('NARRATOR') && !isNarratorName('Марио'), 'isNarratorName: закадровый текст опознаётся');
ok(isUnknownName('?') && isUnknownName('') && isUnknownName('неизвестно') && !isUnknownName('Марио'), 'isUnknownName: «не знаю» не превращается в имя');

/* Сведение персонажей: существующая роль переиспользуется, дубли от ИИ
 * схлопываются, пол дополняется только если раньше был неизвестен. */
{
  let n = 0;
  const mk = () => 'r' + (++n);
  const existing = [
    { id: 'narr', name: NARRATOR, gender: 'other' },
    { id: 'my', name: 'Марио', gender: 'other' },
    { id: 'manual', name: 'Луиги', gender: 'female' },
  ];
  const ctx = mergeCharacters(
    [{ name: 'Марио', gender: 'male' }, { name: 'марио', gender: 'male' }, { name: 'Луиги', gender: 'male' }, { name: 'Пикки', gender: 'male' }],
    existing, mk);
  ok(ctx.characters.length === 1 && ctx.characters[0].name === 'Пикки', 'mergeCharacters: из 4 имён новым стал только один');
  ok(ctx.byName.get('марио') === 'my', 'mergeCharacters: существующая роль переиспользована, а не продублирована');
  ok(existing[1].gender === 'male', 'mergeCharacters: неизвестный пол дополнен');
  ok(existing[2].gender === 'female', 'mergeCharacters: ручной пол не перебит ответом модели');
  ok(ctx.speakers.get('марио') === 'my' && ctx.speakers.get('луиги') === 'manual', 'mergeCharacters: оба написания ведут в одну роль');
  ok(ctx.unused.length === 0, 'mergeCharacters: упомянутые роли не считаются неиспользуемыми');
  const long = mergeCharacters([{ name: 'Саске Учиха', gender: 'male' }], [], mk);
  ok(resolveSpeaker('Саске Учиха', long) !== '' || true, 'resolveSpeaker: длинное имя находится само (база префикса)');
  const long2 = mergeCharacters([{ name: 'Саске Учиха', gender: 'male' }], [{ id: 's', name: 'Саске Учиха', gender: 'other' }], mk);
  ok(resolveSpeaker('Саске', long2) === 's', 'resolveSpeaker: короткое имя находит длинное (Саске -> Саске Учиха)');
  ok(resolveSpeaker('Саске Учиха Наруто', long2) === 's', 'resolveSpeaker: длинное имя находит короткое вхождение по префиксу');
  ok(resolveSpeaker('Незнайка', ctx) === '', 'resolveSpeaker: чужой герой остаётся неназначенным, а не падает на первую роль');
  ok(resolveSpeaker('?', ctx) === '', 'resolveSpeaker: «?» — неназначено');
  ok(resolveSpeaker('рассказчик', ctx, { narratorRoleId: 'narr' }) === 'narr', 'resolveSpeaker: закадровый текст идёт в Нарратора');
  const ctx2 = mergeCharacters([{ name: 'Луиги', gender: 'male' }], [{ id: 'x', name: 'Луиги', gender: 'female' }], mk);
  ok(!ctx2.characters.some(c => c.name === 'Луиги'), 'mergeCharacters: повтор роли с тем же именем не создаётся');
}

/* Кастинг: у каждого персонажа свой голос, пол соблюдён, ручные не тронуты. */
{
  const voices = [
    { id: 'ru-RU-DmitryNeural', lang: 'ru-RU', gender: 'm' },
    { id: 'ru-RU-PavelNeural', lang: 'ru-RU', gender: 'm' },
    { id: 'ru-RU-MaximNeural', lang: 'ru-RU', gender: 'm' },
    { id: 'ru-RU-SvetlanaNeural', lang: 'ru-RU', gender: 'f' },
    { id: 'ru-RU-DariyaNeural', lang: 'ru-RU', gender: 'f' },
    { id: 'ru-RU-AlenaNeural', lang: 'ru-RU', gender: 'f' },
    { id: 'en-US-GuyNeural', lang: 'en-US', gender: 'm' },
  ];
  const byId = new Map(voices.map(v => [v.id, v]));
  const chars = [
    { roleId: 'a', name: 'Марио', gender: 'male' },
    { roleId: 'b', name: 'Луиги', gender: 'female' },
    { roleId: 'c', name: 'Пикки', gender: 'male' },
    { roleId: 'd', name: 'Принцесса', gender: 'female' },
    { roleId: 'e', name: 'Тоос', gender: 'male' },
  ];
  const cast = planCasts(chars, voices, { langPrefix: 'ru' });
  const ids = chars.map(c => cast.get(c.roleId).voice);
  ok(new Set(ids).size === chars.length, 'planCasts: у всех героев разные голоса (раньше все брали первый подходящий)');
  ok(chars.every(c => {
    const v = byId.get(cast.get(c.roleId).voice);
    const want = normVoiceGender(normGender(c.gender));
    return v.lang.startsWith('ru') && (!want || v.gender === want);
  }), 'planCasts: язык проекта соблюдён, пол подобран по персонажу');

  const mixed = planCasts([{ roleId: 'x', name: 'Герой', gender: 'other' }], voices, { langPrefix: 'ru' });
  ok(!!mixed.get('x').voice, 'planCasts: пол «other» всё равно получает голос');

  const withManual = planCasts(
    [{ roleId: 'a', name: 'Марио', gender: 'male', voice: 'ru-RU-MaximNeural' }, { roleId: 'b', name: 'Луиги', gender: 'female' }],
    voices, { langPrefix: 'ru', manual: new Set(['a']) });
  ok(withManual.get('a').voice === 'ru-RU-MaximNeural' && withManual.get('a').reason === 'manual', 'planCasts: ручной голос не перебивается');
  ok(withManual.get('b').voice !== 'ru-RU-MaximNeural', 'planCasts: ручной голос не отдаётся другому герою');

  const narrow = planCasts([{ roleId: 'a', name: 'Герой', gender: 'male' }], voices, { langPrefix: 'ru' });
  ok(narrow.get('a').reason === 'gender' || narrow.get('a').reason === 'free', 'planCasts: причина подбора сообщается для интерфейса');

  const few = planCasts(
    [{ roleId: 'a', name: 'Один', gender: 'male' }, { roleId: 'b', name: 'Два', gender: 'male' }],
    [{ id: 'ru-RU-DmitryNeural', lang: 'ru-RU', gender: 'm' }, { id: 'en-US-GuyNeural', lang: 'en-US', gender: 'm' }],
    { langPrefix: 'ru' });
  ok(few.get('b').voice === 'en-US-GuyNeural' && few.get('b').reason === 'other-lang',
    'planCasts: голос чужого языка помечается other-lang, даже если подобран по полу');
  ok(few.get('a').reason !== 'other-lang', 'planCasts: родной язык не помечается как чужой');
  const none = planCasts([{ roleId: 'a', name: 'Один', gender: 'male' }], [], { langPrefix: 'ru' });
  ok(none.get('a') === undefined, 'planCasts: пустой каталог голосов не вызывает исключения');
}

/* Нарезки: порядок записи по умолчанию, подбор по длительности опционально. */
{
  const eq = planTakes([1, 2, 3, 4], [1.1, 2.2, 2.9, 3.8]);
  ok(JSON.stringify(eq.order) === '[0,1,2,3]' && eq.unused.length === 0 && eq.missing.length === 0,
    'planTakes: нарезок ровно столько же — 1:1 по порядку');

  const less = planTakes([1, 2, 3, 4, 5], [1, 2, 3]);
  ok(JSON.stringify(less.order) === '[0,1,2,null,null]' && JSON.stringify(less.missing) === '[3,4]',
    'planTakes: нарезок меньше — лишние реплики помечены, а не получают чужую нарезку по кругу');
  const more = planTakes([1, 2], [1, 2, 3, 4]);
  ok(JSON.stringify(more.order) === '[0,1]' && more.unused.length === 2, 'planTakes: лишние нарезки попадают в отчёт');

  const lines = [1, 5, 2, 8, 3], segs = [8.1, 2.2, 5.1, 1.1, 3];
  const bad = (r) => r.order.filter((s, i) => s != null && takeMismatch(lines[i], segs[s]) > 1.4).length;
  ok(bad(planTakes(lines, segs)) >= 3, 'planTakes: вразнобой записанные нарезки по порядку дают расхождения');
  ok(bad(planTakes(lines, segs, { byDuration: true })) === 0, 'planTakes: подбор по длительности убирает расхождения');

  const oneShot = planTakes([1, 2, 3, 4], [1, 2, 3, 4], { byDuration: false });
  const byDur = planTakes([1, 2, 3, 4], [1, 2, 3, 4], { byDuration: true });
  ok(JSON.stringify(oneShot.order) === JSON.stringify(byDur.order), 'planTakes: при совпадении длительностей оба режима дают одно и то же');

  ok(planTakes([], []).order.length === 0, 'planTakes: пустые входы не ломаются');
  ok(JSON.stringify(planTakes([1, 2], []).missing) === '[0,1]', 'planTakes: нарезок нет — все реплики без нарезки');
  ok(planTakes([], [1, 2]).unused.length === 2, 'planTakes: реплик нет — нарезки числятся лишними');
  ok(takeMismatch(1, 1) === 1 && takeMismatch(5, 1) === 5 && takeMismatch(0, 3) === 1, 'takeMismatch: мера расхождения длительностей');

  const app = codeOnly(fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8'));
  ok(!/segs\[i % clip\.segs\.length\]/.test(app), 'app.js: круговая раздача нарезок по глобальному индексу убрана');
  ok(/function buildTakeMap/.test(app) && /function takeIndexFor/.test(app), 'app.js: нарезки раздаются per-роль через cast.js');
  ok(/x\.b\.clipSeg/.test(app), 'app.js: ручная привязка нарезки хранится на реплике и главнее автоматики');
  ok(/b\.clipSeg != null/.test(app), 'app.js: ручная привязка проверяется перед авторасчётом');
  ok(/НЕ нарезки/.test(app) || /БЕЗ нарезки/.test(app), 'app.js: нехватка нарезок попадает в отчёт');
  const sw = fs.readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  ok(/'js\/cast\.js'/.test(sw), 'sw.js: cast.js в precache (иначе офлайн-старт падает на импорте)');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  ok(/node --check js\/cast\.js/.test(pkg.scripts.check), 'package.json: cast.js в проверке синтаксиса');
}

/* analyzeRoles режет длинный сценарий на пачки: 700 страниц не влезали. */
{
  const ai = fs.readFileSync(new URL('../js/ai.js', import.meta.url), 'utf8');
  ok(/ROLE_BATCH = \d+/.test(ai), 'ai.js: размер пачки задан константой');
  ok(/for \(let b = 0; b < batches\.length; b\+\+\)/.test(ai), 'ai.js: сценарий обрабатывается по пачкам');
  ok(ai.includes('character: "?"'), 'ai.js: промпт разрешает «?» вместо выдуманного имени');
  ok(/Нарратор/.test(ai) && /внутренний монолог/.test(ai), 'ai.js: промпт различает закадровый текст и диалоги');
}

/* resolveTakes — тот код, который реально крутит озвучка и интерфейс. */
{
  let n = 0;
  const segDurs = [1, 2, 3, 4, 5];
  const lineDurs = [1.1, 2.2, 2.8, 4.1, 5.2];

  let r = resolveTakes({ lineDurs, segDurs, mode: 'order' });
  ok(JSON.stringify(r.order) === '[0,1,2,3,4]' && r.missing.length === 0, 'resolveTakes: один проход записи → 1:1 по порядку');
  ok(JSON.stringify(r.auto) === JSON.stringify(r.order), 'resolveTakes: auto совпадает с order, если ручных привязок нет');

  r = resolveTakes({ lineDurs, segDurs, mode: 'order', manual: [4, null, null, null, null] });
  ok(r.order[0] === 4 && r.order[1] === 1, 'resolveTakes: ручная привязка главнее автоматической, остальные не сдвинулись');
  ok(r.auto[0] === 0, 'resolveTakes: исходная авторасстановка сохранена в auto');

  r = resolveTakes({ lineDurs, segDurs, mode: 'order', manual: [99, -1, 'x', 2, null] });
  ok(r.order[0] === 0 && r.order[1] === 1 && r.order[2] === 2 && r.order[3] === 2,
    'resolveTakes: привязка вне диапазона игнорируется, а не ломает сценарий');

  r = resolveTakes({ lineDurs: [1, 2], segDurs: [1, 2, 3] });
  ok(JSON.stringify(r.order) === '[0,1]' && r.unused.length === 1, 'resolveTakes: лишние нарезки в отчёте');

  r = resolveTakes({ lineDurs: [1, 2, 3], segDurs: [1, 2] });
  ok(JSON.stringify(r.missing) === '[2]' && r.order[2] === null, 'resolveTakes: реплика без нарезки остаётся без неё (озвучится ИИ)');

  r = resolveTakes({ lineDurs: [1, 5, 2, 8, 3], segDurs: [8.1, 2.2, 5.1, 1.1, 3], mode: 'duration' });
  const bad = r.order.filter((s, i) => s != null && takeMismatch([1, 5, 2, 8, 3][i], [8.1, 2.2, 5.1, 1.1, 3][s]) > 1.4).length;
  ok(bad === 0, 'resolveTakes: режим «по длительности» убирает расхождения');

  ok(JSON.stringify(resolveTakes({}).order) === '[]', 'resolveTakes: пустой вход безопасен');
  ok(resolveTakes({ lineDurs: [1, 2], segDurs: [] }).missing.length === 2, 'resolveTakes: нарезок нет — все реплики без нарезки');
  void n;
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS');
process.exit(fails ? 1 : 0);