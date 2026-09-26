package com.voicecomic.app.chat

import kotlin.math.min

/**
 * Определение типа файла по содержимому. Файловые менеджеры часто отдают mime = null,
 * из-за чего картинки в чате молча уезжали в «текст» и вообще не отправлялись.
 */
object MimeSniff {

    fun kind(bytes: ByteArray): String {
        if (bytes.isEmpty()) return "text"
        fun s(o: Int, l: Int) = String(bytes, o, min(l, bytes.size - o), Charsets.ISO_8859_1)
        if (bytes.size >= 8) {
            if (bytes[0] == 0x89.toByte() && s(1, 3) == "PNG") return "image"
            if (s(0, 3) == "GIF") return "image"
            if (bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()) return "image"
            if (bytes[0] == 0x42.toByte() && bytes[1] == 0x4D.toByte()) return "image"
            if (s(0, 4) == "RIFF" && bytes.size >= 12 && s(8, 4) == "WEBP") return "image"
        }
        if (bytes.size >= 4 && s(0, 4) == "%PDF") return "binary"
        val head = min(bytes.size, 600)
        val printable = bytes.take(head).count {
            val v = it.toInt() and 0xff
            v in 9..13 || v in 32..126 || v > 126
        }
        return if (printable.toDouble() / head > 0.9) "text" else "binary"
    }

    fun imageMime(bytes: ByteArray): String {
        fun s(o: Int, l: Int) = String(bytes, o, min(l, bytes.size - o), Charsets.ISO_8859_1)
        return when {
            bytes.size >= 8 && bytes[0] == 0x89.toByte() && s(1, 3) == "PNG" -> "image/png"
            s(0, 3) == "GIF" -> "image/gif"
            bytes.size >= 12 && s(0, 4) == "RIFF" && s(8, 4) == "WEBP" -> "image/webp"
            bytes.size >= 2 && bytes[0] == 0x42.toByte() && bytes[1] == 0x4D.toByte() -> "image/bmp"
            else -> "image/jpeg"
        }
    }
}
