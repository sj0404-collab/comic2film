package com.voicecomic.app.data

object Defaults {
    val ROLE_COLORS = listOf(
        "#5b8cff", "#ff6b7a", "#3ecf9a", "#ffb454", "#c084fc",
        "#38bdf8", "#fb7185", "#a3e635", "#f472b6", "#60a5fa"
    )

    val TTS_STYLES = listOf(
        "", "cheerful", "excited", "angry", "sad",
        "whisper", "shouting", "terrified", "unfriendly", "gentle"
    )

    val RESOLUTIONS = listOf("1080x1920", "1920x1080", "1280x720", "720x1280", "1080x1080", "auto")

    val OCR_LANGS = listOf("rus", "eng", "chi_sim", "jpn", "kor", "spa", "fra", "deu", "por")

    val LANG_NAMES = mapOf(
        "rus" to "русский", "eng" to "английский", "chi_sim" to "китайский",
        "jpn" to "японский", "kor" to "корейский", "spa" to "испанский",
        "fra" to "французский", "deu" to "немецкий", "por" to "португальский"
    )

    val LANG_LOCALE = mapOf(
        "rus" to "ru", "eng" to "en-US", "chi_sim" to "zh-CN", "jpn" to "ja-JP",
        "kor" to "ko-KR", "spa" to "es-ES", "fra" to "fr-FR", "deu" to "de-DE", "por" to "pt-BR"
    )

    val TR_LANGS = mapOf("ru" to "русский", "en" to "английский")

    const val NARRATOR = "Нарратор"

    fun defaultRoles(): List<Role> = listOf(
        Role(name = NARRATOR, emoji = "🎙", color = "#93a0b8", gender = "other", manualVoice = true),
        Role(name = "Персонаж 1", emoji = "🧑", color = ROLE_COLORS[0]),
        Role(name = "Персонаж 2", emoji = "👩", color = ROLE_COLORS[1])
    )

    fun defaultProject(): Project = Project(kind = "pages", roles = defaultRoles())

    fun roleColor(index: Int): String = ROLE_COLORS[index % ROLE_COLORS.size]

    fun emojiForGender(gender: String): String = when (gender.lowercase()) {
        "male" -> "🧔"
        "female" -> "👩"
        "other" -> "🤖"
        else -> "🧑"
    }
}
