package com.voicecomic.app.ai

import com.voicecomic.app.data.Defaults
import com.voicecomic.app.data.Settings
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

object Prompts {
    const val CHAT_SYSTEM =
        "Ты — помощник пользователя приложения VoiceComic (комиксы → озвученное видео). " +
            "Отвечай по-русски, коротко и по делу. Пользователь может присылать изображения и файлы: " +
            "изображения разбирай как страницы манги/комикса, текстовые файлы прочитывай и комментируй."

    fun vision(langName: String) =
        "Прочитай весь текст на этом изображении ($langName). Это страница манги/комикса. " +
            "Верни строго JSON массив строк в том порядке, в котором их нужно читать. " +
            "Внутри double quotes. Не добавляй ничего кроме JSON."

    fun cast(langName: String): String {
        val head = if (langName.isEmpty()) "" else "Язык реплик: $langName. "
        return "Ты — режиссёр дубляжа манги/комикса. Определи, кто говорит каждую реплику. ${head}Правила:\n" +
            "1. В characters перечисли КАЖДОГО говорящего один раз: {\"name\":\"Имя\",\"gender\":\"male|female|other\"}.\n" +
            "2. В lines верни {\"idx\":<номер из входа>,\"character\":\"имя ровно как в characters\"} для КАЖДОЙ реплики.\n" +
            "3. Имя выбирай устойчиво: один и тот же герой на всех страницах должен называться одинаково, " +
            "сначала по имени, а не по прозвищу.\n" +
            "4. Закадровый текст, внутренний монолог и мысли автора — character: \"Нарратор\".\n" +
            "5. Если говорящего определить невозможно — character: \"?\" (не выдумывай имя).\n" +
            "6. Верни строго JSON без пояснений."
    }

    fun translate(toLang: String) =
        "Ты — профессиональный переводчик манги/комиксов. Переведи реплики на язык: $toLang. " +
            "Сохрани смысл обращений/имён. Верни строго JSON: [{\"idx\":0,\"text\":\"...\"}]"
}

/** Высокоуровневые ИИ-задачи: разметка ролей, перевод, OCR через vision-модель. */
class AiTasks(private val ai: AiClient) {

    data class LineInput(val idx: Int, val page: Int, val text: String)
    data class AiCharacter(val name: String, val gender: String)
    data class AnalyzeResult(
        val characters: List<AiCharacter>,
        val items: List<Pair<Int, String>>,
        val batches: Int,
        val missing: List<ClosedRange<Int>>
    )

    private fun str(o: JsonObject, key: String): String? =
        runCatching { o[key]?.jsonPrimitive?.content }.getOrNull()

    // ---------- разметка ролей ----------

    suspend fun analyzeRoles(settings: Settings, langName: String, lines: List<LineInput>): AnalyzeResult {
        val chars = LinkedHashMap<String, AiCharacter>()
        val items = ArrayList<Pair<Int, String>>()
        val missing = ArrayList<ClosedRange<Int>>()
        val batch = 60
        var batches = 0
        var from = 0
        while (from < lines.size) {
            val to = minOf(from + batch, lines.size)
            val payload = buildString {
                append('[')
                for (i in from until to) {
                    if (i > from) append(',')
                    append("{\"idx\":").append(i)
                    append(",\"page\":").append(lines[i].page)
                    append(",\"text\":").append(kx(lines[i].text)).append('}')
                }
                append(']')
            }
            val out = ai.chat(
                settings,
                listOf(
                    Msg("system", Prompts.cast(langName)),
                    Msg("user", "Реплики (JSON): $payload")
                ),
                wantJson = true,
                minGap = 6000
            )
            batches++
            val root = AiClient.parseJsonLoose(out) as? JsonObject
            if (root == null) {
                missing.add(from until (to - 1))
            } else {
                (root["characters"] as? JsonArray)?.forEach { e ->
                    val o = e.jsonObject
                    val name = str(o, "name") ?: return@forEach
                    val gender = str(o, "gender") ?: "other"
                    chars.putIfAbsent(name.lowercase().replace('ё', 'е'), AiCharacter(name, gender))
                }
                val ls = root["lines"] as? JsonArray
                if (ls == null) {
                    missing.add(from until (to - 1))
                } else {
                    ls.forEach { e ->
                        val o = e.jsonObject
                        val idx = str(o, "idx")?.toIntOrNull() ?: return@forEach
                        val ch = str(o, "character") ?: return@forEach
                        if (idx in 0 until lines.size) items.add(idx to ch)
                    }
                }
            }
            from = to
        }
        if (chars.isEmpty() && items.isEmpty()) {
            return AnalyzeResult(emptyList(), emptyList(), batches, emptyList())
        }
        return AnalyzeResult(chars.values.toList(), items, batches, missing)
    }

    // ---------- перевод ----------

    suspend fun translate(
        settings: Settings,
        toLang: String,
        lines: List<Pair<Int, String>>
    ): List<String?> {
        val out = arrayOfNulls<String>(lines.size)
        val batch = 30
        var from = 0
        while (from < lines.size) {
            val to = minOf(from + batch, lines.size)
            val payload = buildString {
                append('[')
                for (i in from until to) {
                    if (i > from) append(',')
                    append("{\"idx\":").append(i).append(",\"text\":").append(kx(lines[i].second)).append('}')
                }
                append(']')
            }
            val res = ai.chat(
                settings,
                listOf(Msg("user", "Реплики: $payload")),
                wantJson = true,
                minGap = 4000
            )
            val arr = AiClient.parseJsonLoose(res) as? JsonArray
                ?: throw AiException("API вернул не JSON-массив: ${res.take(120)}")
            arr.forEach { e ->
                val o = e.jsonObject
                val idx = str(o, "idx")?.toIntOrNull() ?: return@forEach
                val text = str(o, "text")?.takeIf { it.isNotBlank() } ?: return@forEach
                if (idx in out.indices) out[idx] = text
            }
            delay(300)
            from = to
        }
        return out.toList()
    }

    // ---------- OCR через vision-модель ----------

    suspend fun visionLines(settings: Settings, langName: String, dataUrl: String): List<String> {
        val res = ai.chat(settings, listOf(Msg("user", Prompts.vision(langName))), images = listOf(dataUrl))
        val el = AiClient.parseJsonLoose(res)
        return when {
            el is JsonArray -> el.mapNotNull { (it as? JsonObject)?.get("value")?.jsonPrimitive?.content }
                .ifEmpty { el.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } }
                .map { it.trim() }.filter { it.isNotEmpty() }

            res.isNotBlank() -> res.lines().map { it.trim() }.filter { it.isNotEmpty() }
            else -> emptyList()
        }
    }

    fun langName(code: String): String = Defaults.LANG_NAMES[code] ?: ""
    fun trLangName(code: String): String = Defaults.TR_LANGS[code] ?: code

    private fun kx(s: String): String {
        val sb = StringBuilder(s.length + 8)
        sb.append('"')
        for (c in s) when (c) {
            '"' -> sb.append("\\\"")
            '\\' -> sb.append("\\\\")
            '\n' -> sb.append("\\n")
            '\r' -> sb.append("\\r")
            '\t' -> sb.append("\\t")
            else -> if (c.code < 0x20) sb.append(' ') else sb.append(c)
        }
        sb.append('"')
        return sb.toString()
    }
}
