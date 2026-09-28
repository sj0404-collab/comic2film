package com.voicecomic.app.render

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES20
import android.view.Surface
import com.voicecomic.app.audio.Pcm
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Поверхность ввода MediaCodec: готовый Bitmap кадра уходит в кодировщик H.264 через EGL.
 * Замена связки canvas.captureStream + MediaRecorder из веб-версии.
 */
class CodecSurface(private val codec: MediaCodec, private val width: Int, private val height: Int) {

    private var display: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var context: EGLContext = EGL14.EGL_NO_CONTEXT
    private var surface: EGLSurface = EGL14.EGL_NO_SURFACE
    private var program = 0
    private var aPos = 0
    private var aTex = 0
    private var uMvp = 0
    private var uTex = 0
    private var texture = 0

    fun start() {
        display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val version = IntArray(2)
        EGL14.eglInitialize(display, version, 0, version, 1)
        val attrs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8,
            EGL14.EGL_ALPHA_SIZE, 8, EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT, 0x3033, 1, 0x0000
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val num = IntArray(1)
        EGL14.eglChooseConfig(display, attrs, 0, configs, 0, 1, num, 0)
        val config = configs[0] ?: throw IllegalStateException("EGL: подходящей конфигурации нет")
        context = EGL14.eglCreateContext(
            display, config, EGL14.EGL_NO_CONTEXT,
            intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, 0x3098), 0
        )
        val input: Surface = codec.createInputSurface()
        surface = EGL14.eglCreateWindowSurface(display, config, input, intArrayOf(EGL14.EGL_NONE), 0)
        EGL14.eglMakeCurrent(display, surface, surface, context)
        GLES20.glViewport(0, 0, width, height)
        buildProgram()
    }

    private fun buildProgram() {
        val vs = compile(GLES20.GL_VERTEX_SHADER, VERT)
        val fs = compile(GLES20.GL_FRAGMENT_SHADER, FRAG)
        program = GLES20.glCreateProgram()
        GLES20.glAttachShader(program, vs)
        GLES20.glAttachShader(program, fs)
        GLES20.glLinkProgram(program)
        GLES20.glUseProgram(program)
        aPos = GLES20.glGetAttribLocation(program, "aPos")
        aTex = GLES20.glGetAttribLocation(program, "aTex")
        uMvp = GLES20.glGetUniformLocation(program, "uMvp")
        uTex = GLES20.glGetUniformLocation(program, "uTex")
        val ids = IntArray(1)
        GLES20.glGenTextures(1, ids, 0)
        texture = ids[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        val vp = floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)
        GLES20.glVertexAttribPointer(aPos, 2, GLES20.GL_FLOAT, false, 0, floatBuf(vp))
        GLES20.glEnableVertexAttribArray(aPos)
        val uv = floatArrayOf(0f, 1f, 1f, 1f, 0f, 0f, 1f, 0f)
        GLES20.glVertexAttribPointer(aTex, 2, GLES20.GL_FLOAT, false, 0, floatBuf(uv))
        GLES20.glEnableVertexAttribArray(aTex)
    }

    private fun floatBuf(a: FloatArray): ByteBuffer {
        val bb = ByteBuffer.allocateDirect(a.size * 4).order(ByteOrder.nativeOrder())
        bb.asFloatBuffer().put(a)
        return bb
    }

    private fun compile(type: Int, src: String): Int {
        val shader = GLES20.glCreateShader(type)
        GLES20.glShaderSource(shader, src)
        GLES20.glCompileShader(shader)
        return shader
    }

    fun draw(bitmap: Bitmap, ptsUs: Long) {
        GLES20.glClearColor(0f, 0f, 0f, 1f)
        GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        val buf = ByteBuffer.allocateDirect(bitmap.width * bitmap.height * 4).order(ByteOrder.nativeOrder())
        bitmap.copyPixelsToBuffer(buf)
        buf.position(0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, texture)
        GLES20.glTexImage2D(
            GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, bitmap.width, bitmap.height, 0,
            GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, buf
        )
        GLES20.glUniformMatrix4fv(uMvp, 1, false, IDENTITY, 0)
        GLES20.glUniform1i(uTex, 0)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        EGLExt.eglPresentationTimeANDROID(display, surface, ptsUs)
        EGL14.eglSwapBuffers(display, surface)
    }

    fun release() {
        if (display != EGL14.EGL_NO_DISPLAY) {
            EGL14.eglMakeCurrent(
                display, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT
            )
            EGL14.eglDestroySurface(display, surface)
            EGL14.eglDestroyContext(display, context)
            EGL14.eglReleaseThread()
            EGL14.eglTerminate(display)
        }
        display = EGL14.EGL_NO_DISPLAY
        context = EGL14.EGL_NO_CONTEXT
        surface = EGL14.EGL_NO_SURFACE
    }

    companion object {
        private val IDENTITY = floatArrayOf(
            1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f
        )
        private const val VERT =
            "attribute vec4 aPos; attribute vec2 aTex; uniform mat4 uMvp; varying vec2 vTex;" +
                "void main(){ gl_Position = uMvp * aPos; vTex = aTex; }"
        private const val FRAG =
            "precision mediump float; varying vec2 vTex; uniform sampler2D uTex;" +
                "void main(){ gl_FragColor = texture2D(uTex, vTex); }"
    }
}

private class Sample(val data: ByteArray, val ptsUs: Long, val sync: Boolean)

/**
 * Экспорт MP4: H.264 (MediaCodec) + AAC (MediaCodec), сборка MediaMuxer'ом.
 * Потоки кодируются во временные файлы и муксируются в конце — так не нужен один поток
 * записи сразу в два трека.
 */
class VideoExporter {

    /** frameAt(i, tSeconds) возвращает Bitmap кадра (или null — кадр будет пустым). */
    suspend fun exportMp4(
        out: File,
        width: Int,
        height: Int,
        fps: Int,
        totalSeconds: Double,
        audio: ShortArray?,
        audioSr: Int,
        onProgress: (Double, String) -> Unit,
        frameAt: suspend (i: Int, t: Double) -> Bitmap?
    ): File = withContext(Dispatchers.IO) {
        out.parentFile?.mkdirs()
        val totalFrames = ((totalSeconds * fps).toInt() + 1).coerceAtLeast(1)
        val videoFile = File(out.parentFile, "vc_video.h264")
        val audioFile = File(out.parentFile, "vc_audio.aac")
        try {
            val video = encodeVideo(videoFile, width, height, fps, totalFrames, onProgress, frameAt)
            val audio = if (audio != null && audio.isNotEmpty()) encodeAudio(audioFile, audio, audioSr) else null
            mux(out, video, audio, fps)
            onProgress(1.0, "Готово")
            out
        } finally {
            videoFile.delete()
            audioFile.delete()
        }
    }

    private class Encoded(val file: File, val format: MediaFormat, val samples: List<Sample>)

    private suspend fun encodeVideo(
        file: File,
        width: Int,
        height: Int,
        fps: Int,
        totalFrames: Int,
        onProgress: (Double, String) -> Unit,
        frameAt: suspend (i: Int, t: Double) -> Bitmap?
    ): Encoded {
        val format = MediaFormat.createVideoFormat("video/avc", width, height).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(
                MediaFormat.KEY_BIT_RATE,
                (width * height * fps * 0.14).toInt().coerceIn(2_000_000, 16_000_000)
            )
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 2)
        }
        val codec = MediaCodec.createEncoderByType("video/avc")
        var egl: CodecSurface? = null
        var outFormat: MediaFormat? = null
        val raw = ArrayList<ByteArray>()
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            egl = CodecSurface(codec, width, height).also { it.start() }
            val info = MediaCodec.BufferInfo()
            var sent = 0
            var drained = 0
            var idle = 0
            while (true) {
                val idx = codec.dequeueOutputBuffer(info, if (sent < totalFrames) 0L else 10_000L)
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    outFormat = codec.outputFormat
                    continue
                }
                if (idx >= 0) {
                    val buf = codec.getOutputBuffer(idx)!!
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        info.size = 0
                    }
                    if (info.size > 0) {
                        val data = ByteArray(info.size)
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        buf.get(data)
                        raw.add(data)
                        drained++
                        if (drained % 30 == 0) {
                            onProgress(0.85 * drained / totalFrames, "Кодирование видео")
                        }
                    }
                    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    codec.releaseOutputBuffer(idx, false)
                    if (eos) break
                    continue
                }
                if (sent < totalFrames) {
                    val bmp = frameAt(sent, sent.toDouble() / fps)
                    if (bmp != null) {
                        egl.draw(bmp, sent * 1_000_000L / fps)
                        bmp.recycle()
                    }
                    sent++
                    if (sent == totalFrames) {
                        runCatching { codec.signalEndOfInputStream() }
                    }
                } else {
                    idle++
                    if (idle > 500) break
                }
            }
        } finally {
            runCatching { egl?.release() }
            runCatching { codec.stop() }
            runCatching { codec.release() }
        }
        val of = outFormat ?: throw IllegalStateException("кодировщик не отдал формат")
        file.writeBytes(join(raw))
        return Encoded(file, of, avccSamples(of, file.readBytes(), fps))
    }

    private fun join(list: List<ByteArray>): ByteArray {
        var n = 0
        list.forEach { n += it.size }
        val out = ByteArray(n)
        var o = 0
        list.forEach { System.arraycopy(it, 0, out, o, it.size); o += it.size }
        return out
    }

    /** Annex-B → список AVCC-семплов; длительность кадра считается по fps. */
    private fun avccSamples(format: MediaFormat, data: ByteArray, fps: Int): List<Sample> {
        val out = ArrayList<Sample>()
        var i = 0
        var start = -1
        var index = 0
        while (i + 3 < data.size) {
            val isStart = data[i] == 0.toByte() && data[i + 1] == 0.toByte() &&
                data[i + 2] == 0.toByte() && data[i + 3] == 1.toByte()
            val isStart3 = i + 3 < data.size && data[i] == 0.toByte() && data[i + 1] == 0.toByte() &&
                data[i + 2] == 1.toByte()
            if (isStart || isStart3) {
                if (start >= 0) {
                    val nal = data.copyOfRange(start, i)
                    if (nal.isNotEmpty()) {
                        val type = nal[0].toInt() and 0x1f
                        if (type == 1 || type == 5) {
                            out.add(Sample(nal, index * 1_000_000L / fps, type == 5))
                            index++
                        }
                    }
                }
                start = if (isStart) i + 4 else i + 3
                i = start
            } else i++
        }
        if (start in 0 until data.size) {
            val nal = data.copyOfRange(start, data.size)
            if (nal.isNotEmpty()) {
                val type = nal[0].toInt() and 0x1f
                if (type == 1 || type == 5) out.add(Sample(nal, index * 1_000_000L / fps, type == 5))
            }
        }
        return out
    }

    private fun encodeAudio(file: File, pcm: ShortArray, sr: Int): Encoded {
        val format = MediaFormat.createAudioFormat("audio/mp4a-latm", sr, 1).apply {
            setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
            setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
            setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 32 * 1024)
        }
        val codec = MediaCodec.createEncoderByType("audio/mp4a-latm")
        var outFormat: MediaFormat? = null
        val raw = ArrayList<ByteArray>()
        try {
            codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            val info = MediaCodec.BufferInfo()
            var idx = 0
            var samplesFed = 0L
            var idle = 0
            while (true) {
                val inIdx = codec.dequeueInputBuffer(10_000)
                if (inIdx >= 0) {
                    val buf = codec.getInputBuffer(inIdx)!!
                    buf.clear()
                    val room = buf.capacity() / 2
                    val n = minOf(room, pcm.size - idx)
                    if (n > 0) {
                        val bytes = ByteArray(n * 2)
                        for (k in 0 until n) {
                            val v = pcm[idx + k].toInt()
                            bytes[k * 2] = (v and 0xff).toByte()
                            bytes[k * 2 + 1] = ((v shr 8) and 0xff).toByte()
                        }
                        buf.put(bytes)
                        codec.queueInputBuffer(
                            inIdx, 0, bytes.size, samplesFed * 1_000_000L / sr, 0
                        )
                        samplesFed += n
                        idx += n
                    } else {
                        codec.queueInputBuffer(
                            inIdx, 0, 0, samplesFed * 1_000_000L / sr,
                            MediaCodec.BUFFER_FLAG_END_OF_STREAM
                        )
                    }
                } else idle++
                val outIdx = codec.dequeueOutputBuffer(info, 10_000)
                if (outIdx >= 0) {
                    val buf = codec.getOutputBuffer(outIdx)!!
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) {
                        outFormat = codec.outputFormat
                        info.size = 0
                    }
                    if (info.size > 0) {
                        val data = ByteArray(info.size)
                        buf.position(info.offset)
                        buf.limit(info.offset + info.size)
                        buf.get(data)
                        raw.add(data)
                    }
                    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
                    codec.releaseOutputBuffer(outIdx, false)
                    if (eos) break
                } else if (idx >= pcm.size && idle > 50) break
            }
        } finally {
            runCatching { codec.stop() }
            runCatching { codec.release() }
        }
        val bytes = join(raw)
        file.writeBytes(bytes)
        val of = outFormat ?: throw IllegalStateException("AAC-энкодер не отдал формат")
        return Encoded(file, of, adtsSamples(bytes, sr))
    }

    /** ADTS → отдельные AAC-фреймы для MediaMuxer. */
    private fun adtsSamples(data: ByteArray, sr: Int): List<Sample> {
        val out = ArrayList<Sample>()
        var i = 0
        var frame = 0L
        while (i + 7 <= data.size) {
            if (data[i].toInt() and 0xFF != 0xFF || (data[i + 1].toInt() and 0xF0) != 0xF0) {
                i++
                continue
            }
            val len = ((data[i + 3].toInt() and 0x03) shl 11) or
                ((data[i + 4].toInt() and 0xFF) shl 3) or
                ((data[i + 5].toInt() and 0xE0) shr 5)
            if (len < 7 || i + len > data.size) {
                i++
                continue
            }
            out.add(Sample(data.copyOfRange(i, i + len), frame * 1024L * 1_000_000L / sr, true))
            frame++
            i += len
        }
        return out
    }

    private fun mux(out: File, video: Encoded, audio: Encoded?, fps: Int) {
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        val videoTrack = muxer.addTrack(video.format)
        val audioTrack = if (audio != null) muxer.addTrack(audio.format) else -1
        muxer.start()
        val info = MediaCodec.BufferInfo()
        for (s in video.samples) {
            val buf = ByteBuffer.allocateDirect(s.data.size + 4)
            buf.putInt(s.data.size)
            buf.put(s.data)
            buf.position(0)
            info.offset = 0
            info.size = s.data.size + 4
            info.presentationTimeUs = s.ptsUs
            info.flags = if (s.sync) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
            muxer.writeSampleData(videoTrack, buf, info)
        }
        if (audioTrack >= 0 && audio != null) {
            for (s in audio.samples) {
                val buf = ByteBuffer.wrap(s.data)
                info.offset = 0
                info.size = s.data.size
                info.presentationTimeUs = s.ptsUs
                info.flags = MediaCodec.BUFFER_FLAG_KEY_FRAME
                muxer.writeSampleData(audioTrack, buf, info)
            }
        }
        muxer.stop()
        muxer.release()
    }

    /** Только звук: WAV + M4A. */
    suspend fun exportAudio(
        wavOut: File,
        m4aOut: File,
        pcm: ShortArray,
        sr: Int
    ): Pair<File, File> = withContext(Dispatchers.IO) {
        wavOut.parentFile?.mkdirs()
        Pcm.writeWav(wavOut, pcm, sr)
        val tmp = File(wavOut.parentFile, "vc_audio_only.aac")
        try {
            val enc = encodeAudio(tmp, pcm, sr)
            val muxer = MediaMuxer(m4aOut.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            val track = muxer.addTrack(enc.format)
            muxer.start()
            val info = MediaCodec.BufferInfo()
            for (s in enc.samples) {
                info.offset = 0
                info.size = s.data.size
                info.presentationTimeUs = s.ptsUs
                info.flags = MediaCodec.BUFFER_FLAG_KEY_FRAME
                muxer.writeSampleData(track, ByteBuffer.wrap(s.data), info)
            }
            muxer.stop()
            muxer.release()
        } finally {
            tmp.delete()
        }
        wavOut to m4aOut
    }
}
