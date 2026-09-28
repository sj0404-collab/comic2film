package com.voicecomic.app.data

import kotlinx.serialization.Serializable
import java.util.UUID

@Serializable
data class BubbleAudio(
    /** файл нарезки относительно каталога проекта, напр. clips/xx/seg-0.wav */
    val file: String = "",
    val duration: Double = 0.0,
    /** true — кусок вырезан из клипа, повторно обрезать тишину нельзя */
    val noTrim: Boolean = false
)

@Serializable
data class Bubble(
    val id: String = newId(),
    val text: String = "",
    /** перевод */
    val tr: String = "",
    val roleId: String = "",
    /** координаты в пикселях страницы; null — OCR без боксов (vision) */
    val x: Float? = null,
    val y: Float? = null,
    val w: Float? = null,
    val h: Float? = null,
    /** порядок чтения для vision-OCR (0..1) */
    val order: Float? = null,
    val audio: BubbleAudio? = null,
    /** ручная привязка нарезки клипа */
    val clipSeg: Int? = null
) {
    fun hasBox(): Boolean = x != null && y != null && w != null && h != null && w!! > 0f && h!! > 0f
}

@Serializable
data class Page(
    val id: String = newId(),
    val name: String = "",
    /** файл изображения относительно каталога проекта */
    val file: String = "",
    val filesize: Long = 0,
    val w: Int = 0,
    val h: Int = 0,
    /** false — OCR не дал боксов: пузыри рисуются только субтитрами, зум по ним не делается */
    val bubblesHaveBoxes: Boolean = true,
    val bubbles: List<Bubble> = emptyList()
)

@Serializable
data class Role(
    val id: String = newId(),
    val name: String = "",
    val emoji: String = "🧑",
    val color: String = "#5b8cff",
    /** Edge-TTS ShortName */
    val voice: String = "",
    /** legacy SSML-строки */
    val pitch: String = "+0Hz",
    val rate: String = "+0%",
    val volume: String = "+0%",
    val style: String = "",
    /** edge | clip */
    val type: String = "edge",
    val clipId: String = "",
    val gender: String = "",
    val manualVoice: Boolean = false,
    val castReason: String = "",
    val pitchNum: Int = 0,
    val rateNum: Int = 0,
    val volumeNum: Int = 100,
    /** order | duration */
    val takeMode: String = "order"
)

@Serializable
data class ClipSeg(
    val startS: Double = 0.0,
    val endS: Double = 0.0,
    val duration: Double = 0.0,
    /** файл wav относительно каталога проекта */
    val file: String = ""
)

@Serializable
data class Clip(
    val id: String = newId(),
    val name: String = "",
    val duration: Double = 0.0,
    val sr: Int = 44100,
    val segs: List<ClipSeg> = emptyList()
) {
    val count: Int get() = segs.size
}

@Serializable
data class Settings(
    /** mlkit | <vision-провайдер> */
    val ocr: String = "mlkit",
    val lang: String = "rus",
    val trlang: String = "ru",
    val ai: String = "pollinations",
    val key: String = "",
    val aiurl: String = "",
    val aimodel: String = "openai",
    val aiGap: Int = 2500,
    val gap: Int = 350,
    val res: String = "1080x1920",
    val fps: Int = 30,
    val zoom: String = "smart",
    val caption: String = "bubble",
    val biling: String = "orig",
    val music: String = "",
    val mvol: Int = 15
)

@Serializable
data class Project(
    val kind: String = "pages",
    val pages: List<Page> = emptyList(),
    val clips: List<Clip> = emptyList(),
    val roles: List<Role> = emptyList()
)

fun newId(): String = UUID.randomUUID().toString().replace("-", "")
