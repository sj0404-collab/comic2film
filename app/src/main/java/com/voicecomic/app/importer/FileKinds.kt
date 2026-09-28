package com.voicecomic.app.importer

import java.io.File

/** Определение типа файла — порт предикатов из util.js. */
object FileKinds {
    val IMAGE_EXT = listOf("png", "jpg", "jpeg", "webp", "gif", "bmp", "avif", "jfif")
    val ARCHIVE_EXT = listOf("zip", "cbz", "rar", "cbr", "tar", "7z")
    val AUDIO_EXT = listOf("mp3", "wav", "ogg", "oga", "m4a", "aac", "flac", "opus", "webm", "mp4", "mka")
    val VIDEO_EXT = listOf("mp4", "webm", "mkv", "mov", "avi", "m4v")

    fun ext(name: String): String = name.substringAfterLast('.', "").lowercase()

    fun isImageName(name: String): Boolean = ext(name) in IMAGE_EXT

    fun isPdfName(name: String): Boolean = ext(name) == "pdf"

    fun isArchiveName(name: String): Boolean = ext(name) in ARCHIVE_EXT

    /** Видео в веб-версии тоже считалось «аудио» — сохраняем поведение. */
    fun isAudioName(name: String, mime: String? = null): Boolean {
        val e = ext(name)
        if (e in VIDEO_EXT) return true
        if (e == "mp3") return true
        if (mime != null) {
            if (mime.startsWith("video")) return true
            if (mime.startsWith("audio")) return true
        }
        return e in AUDIO_EXT
    }

    fun guessMime(name: String, head: ByteArray? = null): String {
        if (head != null && head.size >= 4) {
            fun str(off: Int, len: Int) = String(head, off, len, Charsets.ISO_8859_1)
            if (str(0, 8) == "\u0089PNG\r\n\u001a\n") return "image/png"
            if (str(0, 3) == "GIF") return "image/gif"
            if (str(0, 2) == "BM") return "image/bmp"
            if (head[0].toInt() and 0xFF == 0x52 && head[1].toInt() and 0xFF == 0x49 &&
                head[2].toInt() and 0xFF == 0x46 && head[3].toInt() and 0xFF == 0x46 &&
                head.size >= 12 && str(8, 4) == "WEBP"
            ) return "image/webp"
        }
        return when (ext(name)) {
            "png" -> "image/png"
            "webp" -> "image/webp"
            "gif" -> "image/gif"
            "bmp" -> "image/bmp"
            "avif" -> "image/avif"
            else -> "image/jpeg"
        }
    }

    /** Естественная сортировка: page_2 < page_10 (тот же numKey, что в util.js). */
    private fun numKey(s: String): String =
        Regex("(\\d+)").replace(s) { it.value.length.toString().padStart(2, '0') + it.value }

    fun naturalCompare(a: String, b: String): Int {
        val ka = numKey(a)
        val kb = numKey(b)
        return when {
            ka < kb -> -1
            ka > kb -> 1
            else -> 0
        }
    }
}
