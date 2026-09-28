package com.voicecomic.app.audio

/** Каталог голосов Edge-TTS: 110 curated + дозагрузка списка с сервера. */
object VoiceCatalog {

    data class Voice(val id: String, val lang: String, val gender: String) // gender: m | f

    private fun v(id: String, gender: String = "m") = Voice(id, id.take(5), gender)

    private val CURATED: List<Voice> = buildList {
        fun add(lang: String, gender: String, vararg names: String) {
            names.forEach { add(Voice("$lang-$it" + "Neural", lang, gender)) }
        }
        add("ru-RU", "m", "Dmitry"); add("ru-RU", "f", "Svetlana", "Dariya"); add("ru-RU", "m", "Pavel")
        add("en-US", "m", "Christopher", "Guy", "Andrew", "Brian", "Roger", "Steffan")
        add("en-US", "f", "Jenny", "Aria", "EmmaMultilingual", "Amy", "Michelle", "Ana")
        add("en-GB", "f", "Sonia"); add("en-GB", "m", "Ryan", "Thomas"); add("en-GB", "f", "Libby")
        add("en-AU", "f", "Natasha"); add("en-AU", "m", "William")
        add("en-CA", "f", "Clara"); add("en-CA", "m", "Liam")
        add("en-IN", "f", "Neerja"); add("en-IN", "m", "Prabhat")
        add("en-IE", "f", "Emily"); add("en-IE", "m", "Connor")
        add("en-NZ", "f", "Molly"); add("en-NZ", "m", "Mitchell")
        add("uk-UA", "f", "Polina"); add("uk-UA", "m", "Ostap")
        add("de-DE", "f", "Katja", "Amala"); add("de-DE", "m", "Conrad", "Bernd", "Christoph")
        add("de-AT", "f", "Ingrid"); add("de-AT", "m", "Jonas")
        add("de-CH", "f", "Leni"); add("de-CH", "m", "Jan")
        add("fr-FR", "f", "Denise", "Eloise"); add("fr-FR", "m", "Henri", "Remy")
        add("fr-CA", "f", "Sylvie"); add("fr-CA", "m", "Jean")
        add("es-ES", "f", "Elvira"); add("es-ES", "m", "Alvaro")
        add("es-MX", "f", "Dalia"); add("es-MX", "m", "Jorge")
        add("es-AR", "f", "Elena"); add("es-AR", "m", "Tomas")
        add("it-IT", "f", "Elsa", "Isabella"); add("it-IT", "m", "Diego")
        add("pt-BR", "f", "Francisca"); add("pt-BR", "m", "Antonio")
        add("pt-PT", "f", "Raquel"); add("pt-PT", "m", "Duarte")
        add("pl-PL", "f", "Zofia"); add("pl-PL", "m", "Marek")
        add("tr-TR", "f", "Emel"); add("tr-TR", "m", "Ahmet")
        add("ar-SA", "f", "Zariyah"); add("ar-SA", "m", "Hamed")
        add("ar-EG", "f", "Salma")
        add("he-IL", "f", "Hila"); add("he-IL", "m", "Avri")
        add("ja-JP", "f", "Nanami"); add("ja-JP", "m", "Keita")
        add("ko-KR", "f", "SunHi"); add("ko-KR", "m", "InJoon")
        add("zh-CN", "f", "Xiaoxiao", "Xiaoyi"); add("zh-CN", "m", "Yunxi", "Yunyang")
        add("zh-TW", "f", "HsiaoChen"); add("zh-TW", "m", "YunJhe")
        add("hi-IN", "f", "Swara"); add("hi-IN", "m", "Madhur")
        add("nl-NL", "f", "Colette", "Fenna"); add("nl-NL", "m", "Maarten")
        add("sv-SE", "f", "Sofie"); add("sv-SE", "m", "Mattias")
        add("nb-NO", "f", "Pernille"); add("nb-NO", "m", "Finn")
        add("da-DK", "f", "Christel"); add("da-DK", "m", "Jeppe")
        add("fi-FI", "f", "Selma"); add("fi-FI", "m", "Harri")
        add("cs-CZ", "f", "Vlasta"); add("cs-CZ", "m", "Antonin")
        add("el-GR", "f", "Athina"); add("el-GR", "m", "Nestoras")
        add("hu-HU", "f", "Noemi"); add("hu-HU", "m", "Tamas")
        add("ro-RO", "f", "Alina"); add("ro-RO", "m", "Emil")
        add("vi-VN", "f", "HoaiMy"); add("vi-VN", "m", "NamMinh")
        add("th-TH", "f", "Premwadee"); add("th-TH", "m", "Niwat")
        add("id-ID", "f", "Gadis"); add("id-ID", "m", "Ardi")
    }

    @Volatile
    private var extra: List<Voice> = emptyList()

    fun all(): List<Voice> {
        val e = extra
        if (e.isEmpty()) return CURATED
        val known = CURATED.map { it.id }.toSet()
        return CURATED + e.filter { it.id !in known }
    }

    fun forLang(prefix: String): List<Voice> {
        if (prefix.isBlank()) return all()
        val p = prefix.lowercase()
        return all().filter { it.lang.lowercase().startsWith(p) }
    }

    fun byId(id: String): Voice? = all().firstOrNull { it.id == id }

    fun defaultVoice(pool: List<Voice> = all()): String = (pool.firstOrNull() ?: all().first()).id

    /** ru | en-US | zh-CN … — префикс языка реплик. */
    fun voiceGender(id: String): String = byId(id)?.gender ?: ""

    fun normLocale(locale: String?, fallback: String = "en-US"): String {
        val parts = (locale ?: "").replace('_', '-').split('-').filter { it.isNotEmpty() }
        if (parts.isEmpty()) return fallback
        val lang = parts[0].lowercase()
        val region = parts.drop(1).firstOrNull { it.length == 2 && it.all { c -> c.isLetter() } }
            ?: parts.drop(1).firstOrNull { it.length == 3 && it.all { c -> c.isDigit() } }
        return if (region != null) "$lang-${region.uppercase()}" else lang
    }

    /**
     * Забирает полный список голосов с сервера Microsoft и мержит в каталог.
     * В отличие от браузера, ключ не нужен.
     */
    suspend fun refreshFromMicrosoft(client: okhttp3.OkHttpClient): Int {
        val gec = Gec.value()
        val url = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list" +
            "?trustedclienttoken=${Gec.TRUSTED_CLIENT_TOKEN}" +
            "&Sec-MS-GEC=$gec" +
            "&Sec-MS-GEC-Version=${Gec.GEC_VERSION}"
        val req = okhttp3.Request.Builder().url(url)
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("User-Agent", "Mozilla/5.0 Chrome/${Gec.CHROMIUM}.0.0.0")
            .build()
        val body = client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return 0
            resp.body?.string() ?: return 0
        }
        val root = kotlinx.serialization.json.Json.parseToJsonElement(body)
        val arr = root as? kotlinx.serialization.json.JsonArray ?: return 0
        val out = ArrayList<Voice>()
        for (item in arr) {
            val o = item as? kotlinx.serialization.json.JsonObject ?: continue
            fun str(k: String) = o[k]?.let {
                (it as? kotlinx.serialization.json.JsonPrimitive)?.content
            }
            val short = str("ShortName") ?: continue
            if (!short.endsWith("Neural")) continue
            val loc = str("Locale") ?: short.take(5)
            val gender = (str("Gender") ?: "").lowercase().startsWith("f")
            out.add(Voice(short, normLocale(loc, short.take(5)), if (gender) "f" else "m"))
        }
        extra = out
        return out.size
    }
}
