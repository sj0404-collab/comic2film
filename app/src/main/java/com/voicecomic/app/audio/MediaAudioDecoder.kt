package com.voicecomic.app.audio

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.max

/** Декодер звука/видео через MediaExtractor + MediaCodec (замена decodeAudioData). */
object MediaAudioDecoder {

    class Result(val samples: FloatArray, val sr: Int, val duration: Double)

    fun decode(file: File, maxSeconds: Double = 0.0): Result? = runCatching {
        val extractor = MediaExtractor()
        extractor.setDataSource(file.absolutePath)

        var track = -1
        var format: MediaFormat? = null
        for (i in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(i)
            val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/")) {
                track = i
                format = f
                break
            }
        }
        if (track < 0 || format == null) {
            extractor.release()
            return null
        }
        extractor.selectTrack(track)
        val mime = format.getString(MediaFormat.KEY_MIME)!!
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(format, null, null, 0)
        codec.start()

        val chunks = ArrayList<FloatArray>()
        var total = 0
        var srcSr = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var srcCh = format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var sawInputEos = false
        var sawOutputEos = false
        var gotFormat = false
        val info = MediaCodec.BufferInfo()
        var pcmEncoding = AudioFormat.ENCODING_PCM_16BIT
        val limitFrames = if (maxSeconds > 0) (maxSeconds * srcSr).toInt() else Int.MAX_VALUE

        while (!sawOutputEos) {
            if (!sawInputEos) {
                val inIdx = codec.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    val buf = codec.getInputBuffer(inIdx)
                    val size = if (buf != null) extractor.readSampleData(buf, 0) else -1
                    if (size < 0) {
                        codec.queueInputBuffer(
                            inIdx, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM
                        )
                        sawInputEos = true
                    } else {
                        codec.queueInputBuffer(inIdx, 0, size, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }
            val outIdx = codec.dequeueOutputBuffer(info, 10_000)
            if (outIdx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                val of = codec.outputFormat
                srcSr = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                srcCh = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                pcmEncoding = of.getInteger(MediaFormat.KEY_PCM_ENCODING)
                gotFormat = true
                continue
            }
            if (outIdx >= 0) {
                if (info.size > 0 && total < limitFrames) {
                    val out = codec.getOutputBuffer(outIdx)
                    if (out != null) {
                        out.position(info.offset)
                        out.limit(info.offset + info.size)
                        val n = info.size / 2
                        val shorts = ShortArray(n)
                        out.asShortBuffer().get(shorts, 0, n)
                        val frames = n / max(1, srcCh)
                        val mono = FloatArray(frames)
                        for (f in 0 until frames) {
                            var acc = 0f
                            for (c in 0 until srcCh) {
                                val idx = f * srcCh + c
                                if (idx < n) acc += shorts[idx] / 32768f
                            }
                            mono[f] = acc / max(1, srcCh)
                        }
                        chunks.add(mono)
                        total += frames
                    }
                }
                codec.releaseOutputBuffer(outIdx, false)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) sawOutputEos = true
            }
            if (chunks.sumOf { it.size } > limitFrames) break
        }
        codec.stop()
        codec.release()
        extractor.release()

        @Suppress("UNUSED_EXPRESSION") gotFormat
        @Suppress("UNUSED_EXPRESSION") pcmEncoding
        val samples = FloatArray(total)
        var off = 0
        for (c in chunks) {
            System.arraycopy(c, 0, samples, off, c.size)
            off += c.size
        }
        Result(samples, srcSr, samples.size.toDouble() / srcSr)
    }.getOrNull()

    /** Декодер в PCM 16 kHz моно для MediaCodec-энкодера AAC. */
    fun toPcm16(file: File): Pair<ShortArray, Int>? {
        val r = decode(file) ?: return null
        val target = if (r.sr == Pcm.MIX_RATE) r.samples else Pcm.resampleLinear(r.samples, r.sr, Pcm.MIX_RATE)
        return Pcm.floatToPcm16(target) to Pcm.MIX_RATE
    }

}
