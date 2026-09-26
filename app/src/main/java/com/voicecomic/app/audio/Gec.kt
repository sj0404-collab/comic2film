package com.voicecomic.app.audio

import java.security.MessageDigest

/**
 * Токен Sec-MS-GEC для Edge-TTS: SHA-256 от метки времени в 100-насных тиках
 * Windows-эпохи, округлённой к началу 5-минутного окна, плюс trusted client token.
 */
object Gec {
    const val TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
    const val WIN_EPOCH_SEC = 11644473600L
    const val CHROMIUM = "143.0.3650.75"
    const val GEC_VERSION = "1-$CHROMIUM"

    fun value(nowMs: Long = System.currentTimeMillis()): String {
        var s = nowMs / 1000.0 + WIN_EPOCH_SEC
        s -= s % 300
        val ticks = Math.round(s * 1e7)
        val raw = ticks.toString() + TRUSTED_CLIENT_TOKEN
        val sha = MessageDigest.getInstance("SHA-256").digest(raw.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(32)
        for (b in sha) {
            val v = b.toInt() and 0xff
            if (v < 16) sb.append('0')
            sb.append(Integer.toHexString(v).uppercase())
        }
        return sb.toString()
    }
}

/** Вычищает межкадровый мусор из потока MP3, который Edge присылает в бинарных кадрах. */
object Mp3Frames {
    private val BR_V1 = intArrayOf(0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320)
    private val BR_V2 = intArrayOf(0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)
    private val SR_V1 = intArrayOf(44100, 48000, 32000)
    private val SR_V2 = intArrayOf(22050, 24000, 16000)
    private val SR_V25 = intArrayOf(11025, 12000, 8000)

    fun clean(bytes: ByteArray): ByteArray {
        val out = java.io.ByteArrayOutputStream(bytes.size)
        val n = bytes.size
        var i = 0
        while (i < n - 4) {
            val b0 = bytes[i].toInt() and 0xff
            val b1 = bytes[i + 1].toInt() and 0xff
            if (b0 == 0xff && (b1 and 0xe0) == 0xe0) {
                val h = ((b0.toLong() shl 24) or (b1.toLong() shl 16) or
                    ((bytes[i + 2].toInt() and 0xff).toLong() shl 8) or
                    (bytes[i + 3].toLong() and 0xff)).toInt()
                val ver = (h ushr 19) and 3
                val layer = (h ushr 17) and 3
                val brI = (h ushr 12) and 0xf
                val srI = (h ushr 10) and 3
                val pad = (h ushr 9) and 1
                if ((ver == 3 || ver == 2 || ver == 0) && layer == 1 && brI != 0 && brI != 0xf && srI != 3) {
                    val br: Int
                    val sr: Int
                    when (ver) {
                        3 -> { br = BR_V1[brI]; sr = SR_V1[srI] }
                        2 -> { br = BR_V2[brI]; sr = SR_V2[srI] }
                        else -> { br = BR_V2[brI]; sr = SR_V25[srI] }
                    }
                    val len = (if (ver == 3) 144 else 72) * br * 1000 / sr + pad
                    if (br != 0 && sr != 0 && len > 0 && i + len <= n) {
                        out.write(bytes, i, len)
                        i += len
                        continue
                    }
                }
            }
            i++
        }
        return out.toByteArray()
    }
}
