package com.voicecomic.app.render

import com.voicecomic.app.audio.Pcm
import com.voicecomic.app.data.Project
import com.voicecomic.app.data.Role
import com.voicecomic.app.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.max
import kotlin.math.min

/**
 * Сведение дорожки в один буфер 44.1 кГц моно — порт renderAudioTrack из engine.js.
 * Возвращает FloatArray PCM.
 */
class AudioMixer(
    private val projectId: String,
    private val resolve: (String) -> File
) {

    class Mixed(val pcm: FloatArray, val sr: Int, val duration: Double, val voiced: Int)

    private fun mixAdd(out: FloatArray, samples: FloatArray, offsetSec: Double, vol: Float, sr: Int) {
        val i0 = (offsetSec * sr).toInt()
        if (i0 >= out.size || samples.isEmpty()) return
        val n = min(out.size - i0, samples.size)
        for (k in 0 until n) out[i0 + k] += samples[k] * vol
    }

    suspend fun render(
        items: List<Item>,
        total: Double,
        project: Project,
        settings: Settings,
        onProgress: (Double, String) -> Unit
    ): Mixed = withContext(Dispatchers.IO) {
        val sr = Pcm.MIX_RATE
        val frames = Pcm.framesFor(total, sr)
        val out = FloatArray(max(0, frames))
        val roleById = project.roles.associateBy { it.id }
        var voiced = 0

        for ((n, it) in items.withIndex()) {
            val b = it.bubble ?: continue
            val audio = b.audio ?: continue
            val f = resolve(audio.file)
            if (!f.exists()) continue
            val raw = Pcm.readWav(f) ?: continue
            var (samples, fileSr) = raw
            var offsetSec = it.t
            var dur = it.dur
            if (audio.noTrim) {
                dur = samples.size.toDouble() / fileSr
            } else {
                val trim = Pcm.trimSilence(samples, fileSr, Timeline.TRIM_THRESHOLD, Timeline.TRIM_MARGIN)
                if (trim.end > trim.start) {
                    samples = samples.copyOfRange(trim.start, trim.end)
                    offsetSec = it.t + trim.start.toDouble() / fileSr
                    dur = max(Timeline.TRIM_MIN_DUR, (trim.end - trim.start).toDouble() / fileSr)
                } else dur = Timeline.TRIM_MIN_DUR
            }
            if (fileSr != sr) samples = Pcm.resampleLinear(samples, fileSr, sr)
            val gain = Timeline.roleGain(roleById[b.roleId])
            mixAdd(out, samples, offsetSec, gain, sr)
            voiced++
            if (n % 5 == 0) onProgress(0.5 * (n + 1) / items.size, "Сведение речи")
        }

        if (settings.music.isNotBlank()) {
            val mf = resolve(settings.music)
            if (mf.exists()) {
                Pcm.readWav(mf)?.let { (mSamples, mSr) ->
                    val music = if (mSr != sr) Pcm.resampleLinear(mSamples, mSr, sr) else mSamples
                    val step = if (music.isNotEmpty()) music.size.toDouble() / sr else total
                    if (step > 0) {
                        var pos = 0.0
                        var guard = 0
                        val vol = (settings.mvol / 100.0 * 0.6).toFloat()
                        while (pos < total && guard++ < 10000) {
                            mixAdd(out, music, pos, vol, sr)
                            pos += step
                        }
                    }
                }
            }
        }

        for (i in out.indices) out[i] = out[i].coerceIn(-1f, 1f)
        onProgress(0.9, "Аудио готово")
        Mixed(out, sr, total, voiced)
    }

    /** Список файлов озвучки, участвующих в миксе (для оценок и отладки). */
    fun speechFiles(items: List<Item>): List<File> = items.mapNotNull { it.bubble?.audio?.file }
        .filter { it.isNotBlank() }
        .map { resolve(it) }
        .filter { it.exists() }
}

fun roleFor(project: Project, roleId: String): Role? = project.roles.firstOrNull { it.id == roleId }
