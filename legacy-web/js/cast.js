/* Логика кастинга и раздачи нарезок — чистые функции без DOM и без сети,
 * чтобы их можно было тестировать в Node (tests/smoke.mjs).
 *
 * Три задачи:
 *   1) нормализация имён и сведение ответа ИИ к существующим персонажам
 *      так, чтобы один и тот же герой не превратился в трёх дублей;
 *   2) подбор голосов: у каждого персонажа свой голос, пол и язык учтены,
 *      ручные назначения не затираются;
 *   3) раздача нарезок (takes) по репликам персонажа в порядке сценария
 *      с честным учётом несовпадения количества. */

export const NARRATOR = 'Нарратор';

/* Служебные имена, которыми модели любят помечать закадровый текст. */
const NARRATOR_KEYS = new Set([
  'нарратор', 'рассказчик', 'автор', 'закадровый', 'текст', 'narrator',
  'narrator voice', 'off-screen', 'offscreen', 'ос', 's.e.',
]);

/* Признаки того, что реплику нельзя уверенно приписать конкретному герою. */
const UNKNOWN_KEYS = new Set(['?', 'неизвестно', 'неясно', 'unknown', 'none', '-', '—', 'нет', 'n/a']);

/* Нормализация имени: регистр, пробелы, кавычки, «ё»/«е», хвостовые знаки.
 * ИИ может вернуть «Марио», «марио», "«Марио»." — это один персонаж.
 * Порядок важен: сперва убираем кавычки, потом хвостовую пунктуацию, и
 * только затем схлопываем пробелы — иначе «МАРИО>. » не нормализуется. */
export function normName(s) {
  return String(s == null ? '' : s)
    .replace(/[«»"“”'`*_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,;:…]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е');
}

export function isNarratorName(s) {
  const n = normName(s);
  return n === NARRATOR.toLowerCase() || NARRATOR_KEYS.has(n);
}

export function isUnknownName(s) {
  const n = normName(s);
  return n === '' || UNKNOWN_KEYS.has(n);
}

/* Пол в каноническом виде. Модели любят 'woman', 'F', 'ж', null. */
export function normGender(g) {
  const t = String(g == null ? '' : g).trim().toLowerCase();
  if (/^(m|male|man|masc|муж|м)$/.test(t)) return 'male';
  if (/^(f|female|woman|fem|жен|ж)$/.test(t)) return 'female';
  return 'other';
}

/* Пол голоса к тому же виду 'm'/'f'/''. Каталог Edge отдаёт 'm'/'f',
 * некоторые источники — 'male'/'female'; сравнивать их напрямую нельзя. */
export function normVoiceGender(g) {
  const t = String(g == null ? '' : g).trim().toLowerCase();
  if (/^(m|male|man|masc|муж|м)$/.test(t)) return 'm';
  if (/^(f|female|woman|fem|жен|ж)$/.test(t)) return 'f';
  return '';
}

/* ------------------------------------------------------------------
 * Персонажи
 * ------------------------------------------------------------------ */

/**
 * Свести ответ ИИ к набору персонажей проекта.
 *
 * characters: [{ name, gender }] от ИИ
 * existing:   роли проекта [{ id, name, gender }]
 * mkId:       генератор id для новой роли
 *
 * Возвращает:
 *   characters — нормализованный список с готовым roleId (isNew = true для новых)
 *   byName     — normName -> roleId
 *   speakers   — normName имени из ответа ИИ -> roleId
 *   unused     — нормированные имена существующих ролей, которых не было в ответе ИИ
 *
 * Ключевое отличие от прежней логики: неизвестный говорящий больше не
 * подставляется «молча на первую роль» — он остаётся неназначенным,
 * чтобы это было видно в интерфейсе.
 */
export function mergeCharacters(characters, existing = [], mkId) {
  const byName = new Map();
  const speakers = new Map();
  const out = [];

  // Реестр существующих ролей. Дубликаты имён внутри проекта не трогаем:
  // это может быть осознанно (два похожих персонажа).
  const existingByName = new Map();
  for (const r of existing) {
    const n = normName(r.name);
    if (n && !existingByName.has(n)) existingByName.set(n, r);
  }

  const taken = new Set(); // roleId, уже выданные в этом проходе
  for (const c of characters || []) {
    const rawName = String((c && c.name) || '').trim();
    if (isUnknownName(rawName)) continue;
    const n = normName(rawName);
    if (!n || speakers.has(n)) continue; // модель продублировала персонажа

    const gender = normGender(c && c.gender);
    const own = existingByName.get(n);
    let role;
    if (own && !taken.has(own.id)) {
      role = own;
      // Пол дополняем, только если раньше был неизвестен: ручную правку
      // пола у роли не перебиваем ответом модели.
      if (gender !== 'other' && normGender(own.gender) === 'other') own.gender = gender;
    } else {
      role = { id: mkId(), name: rawName, gender, isNew: true };
      out.push(role);
    }
    taken.add(role.id);
    byName.set(n, role.id);
    speakers.set(n, role.id);
  }

  // Роли, о которых модель не упомянула: не удаляем, но и отмечаем как
  // неиспользуемые — иначе они молча пропадают из отчёта.
  const unused = [];
  for (const [n, r] of existingByName) {
    if (!byName.has(n) && !isNarratorName(n)) unused.push(normName(r.name));
  }

  return { characters: out, byName, speakers, unused };
}

/**
 * Назначить роль реплике по имени говорящего.
 * Возвращает roleId или '' (неназначено) — без выдуманных запасных вариантов.
 */
export function resolveSpeaker(speaker, ctx, { narratorRoleId = '' } = {}) {
  const n = normName(speaker);
  if (!n) return '';
  if (isUnknownName(n)) return '';
  if (isNarratorName(n) && narratorRoleId) return narratorRoleId;
  if (ctx.speakers.has(n)) return ctx.speakers.get(n);
  // Модель могла назвать героя чуть иначе, чем в characters:
  // пробуем совпадение по префиксу (Саске / Саске Учиха).
  for (const [name, id] of ctx.speakers) {
    if (name !== n && (name.startsWith(n) || n.startsWith(name))) return id;
  }
  return '';
}

/* ------------------------------------------------------------------
 * Кастинг голосов
 * ------------------------------------------------------------------ */

/**
 * Подобрать голоса.
 *
 * characters — [{ roleId, name, gender, voice }]  (voice может быть уже задан вручную)
 * voices     — [{ id, lang, gender }] доступные голоса
 * opts.langPrefix   — префикс языка проекта ('ru' для ru-RU-…)
 * opts.manual       — Map/Set roleId, чей голос назначен руками и не трогаем
 * opts.narratorRoleId — id роли «Нарратор»: получает нейтральный голос
 *
 * Возвращает Map roleId -> { voice, reason }. reason:
 *   manual | gender | free | other-lang | reused
 */
export function planCasts(characters, voices, opts = {}) {
  const { langPrefix = 'ru', manual = new Set(), narratorRoleId = '' } = opts;
  const out = new Map();
  if (!characters || !characters.length) return out;
  // Принимаем и roleId, и id: иначе все персонажи схлопываются в один
  // ключ undefined, и подбор тихо возвращает пустую карту.
  const keyOf = (c) => (c && c.roleId != null ? c.roleId : (c && c.id));

  const pool = Array.isArray(voices) ? voices.slice() : [];
  const wantLang = String(langPrefix || '').toLowerCase();
  const langPool = pool.filter(v => String(v.lang || '').toLowerCase().startsWith(wantLang));
  // Языковой пул предпочитаем, но если в нём меньше голосов, чем героев, —
  // расширяем: иначе часть персонажей неизбежно получит чужой язык.
  const useLangPool = langPool.length >= characters.length;
  const base = useLangPool ? langPool : pool;

  const used = new Set();
  for (const c of characters) {
    if (c.voice) used.add(c.voice); // уже занятые (в т.ч. ручные) не переиспользуем
  }

  // 'other'/'unknown' сознательно не ограничиваем полом: в манге пол
  // персонажа часто неизвестен, и требовать женский голос — значит ошибиться.
  const wantGender = (c) => (keyOf(c) === narratorRoleId ? '' : normVoiceGender(normGender(c.gender)));

  // 1) ручные и уже назначенные — не трогаем
  for (const c of characters) {
    if (c.voice && (manual.has(keyOf(c)) || !manual.size)) {
      out.set(keyOf(c), { voice: c.voice, reason: 'manual' });
    }
  }

  // 2) остальным — свободный голос нужного пола
  const pending = characters.filter(c => !out.has(keyOf(c)));
  for (const c of pending) {
    const g = wantGender(c);
    if (!g) continue;
    const v = base.find(x => !used.has(x.id) && x.gender === g);
    if (v) { used.add(v.id); out.set(keyOf(c), { voice: v.id, reason: 'gender' }); }
  }

  // 3) остальным — любой свободный
  for (const c of pending) {
    if (out.has(keyOf(c))) continue;
    const v = base.find(x => !used.has(x.id));
    if (v) { used.add(v.id); out.set(keyOf(c), { voice: v.id, reason: useLangPool ? 'free' : 'other-lang' }); }
  }

  // 4) голосов не хватило — честно помечаем повтор, интерфейс покажет предупреждение
  for (const c of pending) {
    if (out.has(keyOf(c))) continue;
    const v = base[0] || pool[0];
    if (v) out.set(keyOf(c), { voice: v.id, reason: 'reused' });
  }

  // Причина должна отражать РЕАЛЬНЫЙ результат, а не то, каким проходом
  // голос достался: если герю выпал голос чужого языка — это|other-lang,
  // даже когда он подобран по полу. Иначе интерфейс врёт.
  for (const [roleId, res] of out) {
    if (res.reason === 'manual' || res.reason === 'reused') continue;
    const v = pool.find(x => x.id === res.voice);
    if (v && !String(v.lang || '').toLowerCase().startsWith(wantLang)) res.reason = 'other-lang';
  }

  return out;
}

/** Короткое описание причины для интерфейса. */
export const CAST_REASON = {
  manual: 'вручную',
  gender: 'по полу',
  free: 'свободный',
  'other-lang': 'другой язык',
  reused: 'повтор: голосов не хватило',
};

/* ------------------------------------------------------------------
 * Нарезки (takes)
 * ------------------------------------------------------------------ */

/**
 * Раздать нарезки персонажа по его репликам.
 *
 * lineDurs / segDurs — длительности в секундах; для реплик без озвучки
 * можно передать оценку по длине текста.
 *
 * byDuration = false (по умолчанию) — порядок записи: одна нарезка на
 * реплику, по порядку. Это правильный режим, когда актёр записывал
 * страницу за страницей одним проходом.
 * byDuration = true — подбор по близости длительностей, когда нарезки
 * записаны в произвольном порядке.
 *
 * Возвращает:
 *   order     — segIndex на каждую реплику (null = нарезки нет)
 *   unused    — индексы нарезок, которые не достались ни одной реплике
 *   missing   — номера реплик без нарезки
 */
export function planTakes(lineDurs, segDurs, { byDuration = false } = {}) {
  const L = (lineDurs || []).length;
  const S = (segDurs || []).length;
  const order = new Array(L).fill(null);
  const unused = [];

  if (!L || !S) return { order, unused: Array.from({ length: S }, (_, i) => i), missing: order.map((_, i) => i) };

  if (!byDuration) {
    for (let i = 0; i < L; i++) order[i] = i < S ? i : null;
    for (let i = L; i < S; i++) unused.push(i);
  } else {
    // Жадный подбор по близости длительности: реплики берут нарезки по
    // возрастанию ожидаемой длины, чтобы близкие не разъехались.
    const idx = Array.from({ length: L }, (_, i) => i).sort((a, b) => (lineDurs[a] || 0) - (lineDurs[b] || 0));
    const pool = Array.from({ length: S }, (_, i) => i).sort((a, b) => (segDurs[a] || 0) - (segDurs[b] || 0));
    const taken = new Set();
    let p = 0;
    for (const li of idx) {
      let best = -1, bestDiff = Infinity;
      for (let k = p; k < pool.length; k++) {
        const d = Math.abs((lineDurs[li] || 0) - (segDurs[pool[k]] || 0));
        if (d < bestDiff) { bestDiff = d; best = k; }
      }
      if (best < 0) break;
      taken.add(pool[best]);
      p = best + 1;
      order[li] = pool[best];
    }
    for (let i = 0; i < S; i++) if (!taken.has(i)) unused.push(i);
  }

  const missing = [];
  for (let i = 0; i < L; i++) if (order[i] === null) missing.push(i);
  return { order, unused, missing };
}

/** Разница ожидаемой и фактической длительности (для подсветки плохих пар). */
export function takeMismatch(lineDur, segDur) {
  const a = lineDur || 0, b = segDur || 0;
  if (!(a > 0) || !(b > 0)) return 1;
  return Math.max(a / b, b / a);
}

/**
 * Итоговая привязка нарезок к репликам персонажа: автоматика + ручные
 * привязки. Ручная привязка главнее автоматической, но проверяется по
 * границам: если нарезок стало меньше, ссылка на пропавшую не должна
 * приводить к undefined в середине сценария.
 *
 * lineDurs — ожидаемая длительность реплики (факт озвучки или оценка);
 * segDurs  — длительности нарезок;
 * manual   — индекс нарезки, заданный вручную, по репликам (null/undefined = нет).
 */
export function resolveTakes({ lineDurs = [], segDurs = [], mode = 'order', manual = [] } = {}) {
  const plan = planTakes(lineDurs, segDurs, { byDuration: mode === 'duration' });
  const order = plan.order.map((auto, i) => {
    const m = manual[i];
    if (m === null || m === undefined) return auto;
    const n = Number(m);
    if (!Number.isInteger(n) || n < 0 || n >= segDurs.length) return auto;
    return n;
  });
  const missing = [];
  for (let i = 0; i < order.length; i++) if (order[i] === null) missing.push(i);
  return { order, missing, unused: plan.unused, auto: plan.order };
}
