/* Live-тест бесплатных моделей без ключей: реальный запрос в Pollinations.
 * НЕ является частью CI (npm test) — запуск вручную: node tests/ai-live.mjs
 */
import { chat, refreshFreeModels } from '../js/ai.js';

let fails = 0;
const ok = (cond, name) => { console.log((cond ? 'ok  ' : 'FAIL') + ' ' + name); if (!cond) fails++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const models = await refreshFreeModels();
console.log('Список бесплатных моделей с сервера: ' + models.join(' | '));
ok(models.length >= 1, 'список бесплатных моделей не пуст');
if (!models.length) process.exit(1);

const settings = { ai: 'pollinations', aimodel: 'openai', key: '', aiurl: '', aiGap: 2000 };
for (const model of models) {
  settings.aimodel = model;
  const t0 = Date.now();
  try {
    const out = await chat(settings, [
      { role: 'user', content: 'Ответь ровно одним словом: привет' },
    ], { json: false });
    const ms = Date.now() - t0;
    const txt = String(out ?? '').trim();
    console.log(`${model.padEnd(16)} -> ${txt ? 'OK   ' : 'EMPTY'} ${String(ms).padStart(5)}ms  "${txt.slice(0, 50)}"`);
    ok(txt.length > 0, `model "${model}" вернул непустой ответ`);
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    console.log(`${model.padEnd(16)} -> ERR  ${String(Date.now() - t0).padStart(5)}ms  ${msg.slice(0, 90)}`);
    if (/429/.test(msg)) console.log(`skip model "${model}": лимит Pollinations (429) — временно, не падение`);
    else ok(false, `model "${model}" без ошибок сети/лимита`);
  }
  await wait(12000); // раздвигаем запросы, чтобы реже ловить 429
}

console.log(fails ? `\n${fails} FAILURES` : '\nALL PASS (модели без ключей отвечают)');
process.exit(fails ? 1 : 0);