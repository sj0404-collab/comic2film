package com.voicecomic.app.ai

import com.voicecomic.app.audio.VoiceCatalog
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.Defaults
import com.voicecomic.app.data.Page
import com.voicecomic.app.data.Role
import com.voicecomic.app.audio.Pcm
import kotlin.math.max
import kotlin.math.min

/** Нормализация имён и раздача голосов — порт js/cast.js. */
object CastPlanner {

    val NARRATOR = Defaults.NARRATOR

    private val NARRATOR_KEYS = setOf(
        "нарратор", "рассказчик", "автор", "закадровый", "текст", "narrator", "narrator voice",
        "off-screen", "offscreen", "ос", "s.e."
    )
    private val UNKNOWN_KEYS = setOf("?", "неизвестно", "неясно", "unknown", "none", "-", "—", "нет", "n/a")

    fun normName(s: String): String {
        var t = s.replace(Regex("[«»\"“”'`*_~]"), " ")
        t = t.replace(Regex("\\s+"), " ").trim()
        t = t.replace(Regex("[.!?,;:…]+$"), "")
        t = t.replace(Regex("\\s+"), " ").trim()
        return t.lowercase().replace('ё', 'е')
    }

    fun isNarrator(name: String): Boolean = normName(name) in NARRATOR_KEYS

    /** Пустое имя — тоже «неизвестно»: в веб-версии normName('?') даёт пустую строку. */
    fun isUnknownName(name: String): Boolean {
        val n = normName(name)
        return n.isEmpty() || n in UNKNOWN_KEYS
    }

    fun normGender(g: String): String {
        val s = g.lowercase().trim()
        return when {
            s in listOf("m", "male", "man", "masc", "муж", "м") -> "male"
            s in listOf("f", "female", "woman", "fem", "жен", "ж") -> "female"
            else -> "other"
        }
    }

    /** Результат раздачи: роль → голос и причина. */
    data class Cast(val voice: String, val reason: String)
    data class CastPlan(val casts: Map<String, Cast>, val reused: Int, val otherLang: Int)

    val REASON_TEXT = mapOf(
        "manual" to "вручную", "gender" to "по полу", "free" to "свободный",
        "other-lang" to "другой язык", "reused" to "повтор: голосов не хватило"
    )

    /**
     * Раздаёт голоса с учётом пола и языка, не трогая ручной выбор.
     * langPrefix — «ru», «en-US»…; narratorRoleId — роль закадрового голоса.
     */
    fun planCasts(
        roles: List<Role>,
        voices: List<VoiceCatalog.Voice>,
        langPrefix: String,
        manual: Set<String>,
        narratorRoleId: String?
    ): CastPlan {
        if (roles.isEmpty()) return CastPlan(emptyMap(), 0, 0)
        val langPool = voices.filter { it.lang.lowercase().startsWith(langPrefix.lowercase()) }
        val useLangPool = langPool.size >= roles.size
        val base = if (useLangPool) langPool else voices
        val used = HashSet<String>()
        roles.forEach { if (it.voice.isNotBlank()) used.add(it.voice) }
        val out = HashMap<String, Cast>()

        // 1) ручные и уже назначенные
        val pending = ArrayList<Role>()
        for (r in roles) {
            if (r.voice.isNotBlank() && (manual.contains(r.id) || manual.isEmpty())) {
                out[r.id] = Cast(r.voice, "manual")
            } else pending.add(r)
        }
        // 2) по полу
        for (r in pending) {
            val want = when (normGender(r.gender)) {
                "male" -> "m"
                "female" -> "f"
                else -> ""
            }
            if (r.id == narratorRoleId || want.isEmpty()) continue
            val free = base.firstOrNull { it.gender == want && !used.contains(it.id) }
            if (free != null) {
                used.add(free.id)
                out[r.id] = Cast(free.id, "gender")
            }
        }
        // 3) любой свободный из базового пула
        for (r in pending) {
            if (out.containsKey(r.id)) continue
            val free = base.firstOrNull { !used.contains(it.id) }
            if (free != null) {
                used.add(free.id)
                out[r.id] = Cast(free.id, if (useLangPool) "free" else "other-lang")
            }
        }
        // 4) повтор
        var reused = 0
        for (r in pending) {
            if (out.containsKey(r.id)) continue
            val v = base.firstOrNull()?.id ?: voices.firstOrNull()?.id ?: return CastPlan(out, reused, 0)
            reused++
            out[r.id] = Cast(v, "reused")
        }
        // причина должна отражать реальность
        var otherLang = 0
        for (r in roles) {
            val c = out[r.id] ?: continue
            if (c.reason != "manual" && c.reason != "reused") {
                val vlang = VoiceCatalog.byId(c.voice)?.lang ?: ""
                if (!vlang.lowercase().startsWith(langPrefix.lowercase())) {
                    out[r.id] = c.copy(reason = "other-lang")
                }
            }
            if (out[r.id]?.reason == "other-lang") otherLang++
        }
        return CastPlan(out, reused, otherLang)
    }

    // ---------- привязка нарезок клипа к репликам ----------

    data class TakePlan(val order: List<Int>, val unused: List<Int>, val missing: List<Int>)

    fun planTakes(lineDurs: List<Double>, segDurs: List<Double>, byDuration: Boolean): TakePlan {
        if (lineDurs.isEmpty() || segDurs.isEmpty()) return TakePlan(emptyList(), segDurs.indices.toList(), lineDurs.indices.toList())
        if (!byDuration) {
            val order = lineDurs.indices.map { it % segDurs.size }
            return TakePlan(order, emptyList(), if (lineDurs.size > segDurs.size) (segDurs.size until lineDurs.size).toList() else emptyList())
        }
        val li = lineDurs.indices.sortedBy { lineDurs[it] }
        val si = segDurs.indices.sortedBy { segDurs[it] }
        val order = IntArray(lineDurs.size) { -1 }
        var p = 0
        for (idx in li) {
            if (p >= si.size) break
            order[idx] = si[p]
            p++
        }
        return TakePlan(order.toList(), (p until segDurs.size).map { si[it] }, emptyList())
    }

    fun takeMismatch(a: Double, b: Double): Double = max(a / b, b / a)

    // ---------- сборка реплик по страницам ----------

    data class Row(val pageIndex: Int, val pageId: String, val bubble: Bubble)

    fun allRows(pages: List<Page>): List<Row> =
        pages.flatMapIndexed { pi, p -> p.bubbles.map { Row(pi, p.id, it) } }

    fun lineDuration(b: Bubble): Double =
        b.audio?.duration?.takeIf { it > 0 } ?: Pcm.estimateSpeakDuration(b.text)
}

/** Планировщик озвучки: сопоставление ролей и реплик. */
object CastApply {

    data class Result(
        val roles: List<Role>,
        val bubblesByPage: Map<String, List<Bubble>>,
        val assigned: Int,
        val unnamed: Int,
        val unused: Int
    )

    fun mergeCharacters(
        existing: List<Role>,
        ai: List<AiTasks.AiCharacter>
    ): Triple<List<Role>, Map<String, Role>, Set<String>> {
        val roles = ArrayList(existing)
        val byName = HashMap<String, Role>()
        val taken = HashSet<String>()
        for (r in existing) {
            val k = CastPlanner.normName(r.name)
            if (k.isNotEmpty() && !byName.containsKey(k)) byName[k] = r
            if (CastPlanner.isNarrator(r.name)) taken.add(r.id)
        }
        val unused = existing.filter { !CastPlanner.isNarrator(it.name) && !byName.values.any { v -> v.id == it.id } }
        for (c in ai) {
            if (CastPlanner.isUnknownName(c.name)) continue
            val key = CastPlanner.normName(c.name)
            if (key.isEmpty() || byName.containsKey(key)) continue
            val free = existing.firstOrNull { !taken.contains(it.id) }
            val role = if (free != null) {
                taken.add(free.id)
                free.copy(
                    name = c.name, gender = CastPlanner.normGender(c.gender),
                    emoji = Defaults.emojiForGender(CastPlanner.normGender(c.gender))
                )
            } else {
                Role(
                    name = c.name, gender = CastPlanner.normGender(c.gender),
                    emoji = Defaults.emojiForGender(CastPlanner.normGender(c.gender)),
                    color = Defaults.roleColor(roles.size)
                ).also { taken.add(it.id) }
            }
            val idx = roles.indexOfFirst { it.id == role.id }
            if (idx >= 0) roles[idx] = role else roles.add(role)
            byName[key] = role
        }
        return Triple(roles, byName, unused.map { it.name }.toSet())
    }

    /** Сопоставляет имя говорящего с ролью: точное совпадение, потом префикс. */
    fun resolveSpeaker(speaker: String, speakers: Set<String>, narratorRoleId: String?): String {
        val s = speaker.trim()
        if (s.isEmpty() || CastPlanner.isUnknownName(s)) return ""
        if (CastPlanner.isNarrator(s) && narratorRoleId != null) return narratorRoleId
        if (speakers.contains(s)) return s
        val hit = speakers.firstOrNull { it.startsWith(s) || s.startsWith(it) }
        return hit ?: ""
    }

    fun durationStats(bubbles: List<Bubble>): Triple<Int, Int, Int> {
        val withRole = bubbles.count { it.roleId.isNotBlank() }
        val voiced = bubbles.count { it.audio != null }
        return Triple(bubbles.size, withRole, voiced)
    }

    fun minMax(durs: List<Double>): Pair<Double, Double> =
        if (durs.isEmpty()) 0.0 to 0.0 else durs.min() to durs.max()

    fun clampDur(d: Double): Double = min(14.0, max(1.1, d))
}
