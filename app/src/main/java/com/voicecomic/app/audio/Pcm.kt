package com.voicecomic.app.audio

import java.io.File
import java.io.RandomAccessFile
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Утилиты PCM: моно-микс, ресемплинг, обрезка тишины, нарезка по паузам, WAV. */
object Pcm {

    const val MIX_RATE = 44100

    data class Trim(val start: Int, val end: Int)

    /** Склеивает все каналы усреднением (как в веб-версии). */
    fun toMono(buffers: Array<FloatArray>, frames: Int): FloatArray {
        val ch = buffers.size
        if (ch == 1) return buffers[0].let { if (it.size >= frames) it.copyOf(frames) else it.copyOf(frames) }
        val out = FloatArray(frames)
        for (c in buffers) {
            for (i in 0 until min(frames, c.size)) out[i] += c[i] / ch
        }
        return out
    }

    /** Линейный ресемплинг, точная копия resampleLinear из веб-версии. */
    fun resampleLinear(src: FloatArray, fromSr: Int, toSr: Int): FloatArray {
        if (fromSr == toSr) return src
        val step = fromSr.toDouble() / toSr
        val n = (src.size * toSr / fromSr.toDouble()).toInt().coerceAtLeast(0)
        val out = FloatArray(n)
        for (i in 0 until n) {
            val x = i * step
            val i0 = x.toInt()
            val i1 = min(i0 + 1, src.size - 1)
            val t = (x - i0).toFloat()
            out[i] = src[i0.coerceIn(0, src.size - 1)] * (1 - t) + src[i1] * t
        }
        return out
    }

    /**
     * Обрезка тишины по окнам. threshold — пиковый порог, margin — отступ в секундах.
     * Покрывает util.trimSilence и engine.TRIM (порог/отступ задаются вызывающим).
     */
    fun trimSilence(
        samples: FloatArray,
        sr: Int,
        threshold: Double = 0.02,
        margin: Double = 0.09,
        winMs: Int = 10
    ): Trim {
        val n = samples.size
        if (n == 0) return Trim(0, 0)
        val win = max(1, (sr * winMs / 1000.0).toInt())
        val pad = max(1, (sr * margin).toInt())
        var start = 0
        var end = 0
        var i = 0
        var found = false
        while (i + win <= n) {
            var peak = 0f
            var k = i
            while (k < i + win) {
                val v = abs(samples[k])
                if (v > peak) peak = v
                k++
            }
            if (peak > threshold) {
                start = max(0, i - pad)
                found = true
                break
            }
            i += win
        }
        if (!found) return Trim(0, 0)
        i = n
        var foundEnd = false
        while (i - win >= 0) {
            var peak = 0f
            var k = max(0, i - win)
            while (k < i) {
                val v = abs(samples[k])
                if (v > peak) peak = v
                k++
            }
            if (peak > threshold) {
                end = min(n, i + pad)
                foundEnd = true
                break
            }
            i -= win
        }
        if (!foundEnd) end = n
        return Trim(start, max(start, end))
    }

    data class Seg(val startS: Double, val endS: Double)

    /**
     * Нарезка по тишине. window активности — RMS > threshold, тишина длиной не меньше
     * minSilence завершает фразу, фраза короче minClip выбрасывается, длиннее maxClip режется.
     */
    fun sliceSegments(
        samples: FloatArray,
        sr: Int,
        threshold: Double = 0.02,
        minSilence: Double = 0.32,
        minClip: Double = 0.3,
        maxClip: Double = 16.0,
        winMs: Int = 40
    ): List<Seg> {
        val n = samples.size
        if (n == 0) return emptyList()
        val win = max(1, (sr * winMs / 1000.0).toInt())
        val steps = n / win
        val active = BooleanArray(steps + 1)
        for (k in 0 until steps) {
            var sum = 0.0
            val base = k * win
            for (j in base until base + win) {
                val v = samples[j].toDouble()
                sum += v * v
            }
            active[k] = (sum / win) > threshold * threshold
        }
        val minSil = max(1, (minSilence / (winMs / 1000.0)).toInt())
        val out = ArrayList<Seg>()
        var inClip = false
        var cStart = 0
        var cEnd = 0
        var silence = 0
        for (k in 0..steps) {
            val act = k < steps && active[k]
            if (act) {
                if (!inClip) {
                    inClip = true
                    cStart = k
                }
                silence = 0
                cEnd = k
            } else if (inClip) {
                silence++
                if (silence >= minSil) {
                    emit(out, cStart, cEnd, win, sr, n, minClip, maxClip)
                    inClip = false
                }
            }
        }
        if (inClip) emit(out, cStart, cEnd, win, sr, n, minClip, maxClip)
        return out
    }

    private fun emit(
        out: MutableList<Seg>, cStart: Int, cEnd: Int, win: Int, sr: Int,
        n: Int, minClip: Double, maxClip: Double
    ) {
        val s = cStart * win.toDouble() / sr
        val e = min(n, (cEnd + 1) * win).toDouble() / sr
        if (e - s >= minClip) out.add(Seg(s, min(e, s + maxClip)))
    }

    fun floatToPcm16(src: FloatArray, from: Int = 0, count: Int = src.size - from): ShortArray {
        val n = min(count, src.size - from).coerceAtLeast(0)
        val out = ShortArray(n)
        for (i in 0 until n) {
            val v = src[from + i].coerceIn(-1f, 1f)
            out[i] = (if (v < 0) v * 0x8000 else v * 0x7fff).toInt().toShort()
        }
        return out
    }

    fun pcm16ToFloat(src: ShortArray): FloatArray {
        val out = FloatArray(src.size)
        for (i in src.indices) out[i] = src[i] / 32768f
        return out
    }

    /** WAV 16-bit mono — тот же формат, что samplesToWav в веб-версии. */
    fun writeWav(file: File, pcm: ShortArray, sr: Int) {
        val dataLen = pcm.size * 2
        file.parentFile?.mkdirs()
        RandomAccessFile(file, "rw").use { raf ->
            raf.setLength(0)
            val h = ByteArray(44)
            fun putStr(off: Int, s: String) = s.toByteArray(Charsets.US_ASCII).copyInto(h, off)
            fun putLe32(off: Int, v: Int) {
                h[off] = (v and 0xff).toByte(); h[off + 1] = ((v shr 8) and 0xff).toByte()
                h[off + 2] = ((v shr 16) and 0xff).toByte(); h[off + 3] = ((v shr 24) and 0xff).toByte()
            }

            fun putLe16(off: Int, v: Int) {
                h[off] = (v and 0xff).toByte(); h[off + 1] = ((v shr 8) and 0xff).toByte()
            }

            putStr(0, "RIFF"); putLe32(4, 36 + dataLen); putStr(8, "WAVE")
            putStr(12, "fmt "); putLe32(16, 16); putLe16(20, 1); putLe16(22, 1)
            putLe32(24, sr); putLe32(28, sr * 2); putLe16(32, 2); putLe16(34, 16)
            putStr(36, "data"); putLe32(40, dataLen)
            raf.write(h)
            val bytes = ByteArray(dataLen)
            var i = 0
            while (i < pcm.size) {
                val v = pcm[i].toInt()
                bytes[i * 2] = (v and 0xff).toByte()
                bytes[i * 2 + 1] = ((v shr 8) and 0xff).toByte()
                i++
            }
            raf.write(bytes)
        }
    }

    fun readWav(file: File): Pair<FloatArray, Int>? {
        val bytes = file.readBytes()
        if (bytes.size < 44) return null
        val sr = (bytes[24].toInt() and 0xff) or ((bytes[25].toInt() and 0xff) shl 8) or
            ((bytes[26].toInt() and 0xff) shl 16) or ((bytes[27].toInt() and 0xff) shl 24)
        val channels = (bytes[22].toInt() and 0xff) or ((bytes[23].toInt() and 0xff) shl 8)
        val bits = (bytes[34].toInt() and 0xff) or ((bytes[35].toInt() and 0xff) shl 8)
        if (bits != 16) return null
        // ищем начало data-чанка
        var off = 12
        while (off + 8 <= bytes.size) {
            val id = String(bytes, off, 4, Charsets.US_ASCII)
            val size = (bytes[off + 4].toInt() and 0xff) or ((bytes[off + 5].toInt() and 0xff) shl 8) or
                ((bytes[off + 6].toInt() and 0xff) shl 16) or ((bytes[off + 7].toInt() and 0xff) shl 24)
            if (id == "data") {
                off += 8
                val frames = (bytes.size - off) / 2 / max(1, channels)
                val out = FloatArray(frames)
                var i = 0
                while (i < frames) {
                    var acc = 0f
                    for (c in 0 until max(1, channels)) {
                        val p = off + (i * channels + c) * 2
                        if (p + 1 >= bytes.size) break
                        val v = ((bytes[p].toInt() and 0xff) or ((bytes[p + 1].toInt() and 0xff) shl 8)).toShort()
                        acc += v / 32768f
                    }
                    out[i] = acc / max(1, channels)
                    i++
                }
                return out to sr
            }
            off += 8 + size + (size and 1)
        }
        return null
    }

    fun durationSeconds(pcm: FloatArray, sr: Int): Double = pcm.size.toDouble() / sr

    fun rms(samples: FloatArray, from: Int, len: Int): Double {
        val n = min(len, samples.size - from).coerceAtLeast(0)
        if (n == 0) return 0.0
        var sum = 0.0
        for (i in 0 until n) {
            val v = samples[from + i].toDouble()
            sum += v * v
        }
        return sqrt(sum / n)
    }

    /** Оценка длительности реплики без озвучки — 13 символов/с, как в веб-версии. */
    fun estimateSpeakDuration(text: String): Double {
        if (text.isBlank()) return 0.0
        val len = text.length
        val base = max(1.1, min(14.0, len / 13.0 + 0.55))
        return base + if (text.any { it.isWhitespace() }) 0.15 else 0.0
    }

    fun framesFor(duration: Double, sr: Int): Int = ceil(duration * sr).toInt()
}
