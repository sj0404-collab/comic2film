package com.voicecomic.app

import com.voicecomic.app.audio.EdgeTts
import com.voicecomic.app.audio.Mp3Frames
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * Живой тест Edge-TTS: WSS-рукопожатие, GEC-токен, SSML, разбор бинарных кадров.
 * Код тот же, что в приложении; сеть нужна только здесь.
 * Запуск: ./gradlew :app:testDebugUnitTest -Plive --tests '*EdgeTtsLiveTest*'
 */
class EdgeTtsLiveTest {

    private fun client() = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .build()

    @Test
    fun synthesizesRussianPhrase() = runBlocking {
        assumeTrue(System.getProperty("zen.live") == "1")
        val tts = EdgeTts(client())
        val started = System.currentTimeMillis()
        val res = tts.synthesize(
            text = "Проверка связи. Произнесённое предложение.",
            voice = "ru-RU-DmitryNeural",
            pitch = "+0Hz", rate = "+0%", volume = "+0%", style = ""
        )
        val ms = System.currentTimeMillis() - started
        println("Edge-TTS ru-RU-DmitryNeural: ${res.mp3.size} байт mp3 за $ms мс")
        assertTrue("пустой звук", res.mp3.size > 2000)

        // поток должен состоять из целых MPEG-кадров 24 кГц / 48 кбит/с
        val clean = Mp3Frames.clean(res.mp3)
        val frames = countMp3Frames(clean)
        println("после вычистки: ${clean.size} байт, кадров: $frames")
        assertTrue("вычистка срезала слишком много: ${res.mp3.size} → ${clean.size}", clean.size > res.mp3.size / 2)
        assertTrue("кадров слишком мало: $frames", frames >= 20)
        // 24 кГц, MPEG-2 Layer III, 48 кбит/с → 144 байта на кадр → ~0.5 с речи
        val seconds = frames * 144.0 / 24000.0
        println("длительность по кадрам: %.2f c".format(seconds))
        assertTrue("подозрительно короткое: $frames кадров", frames >= 20)
    }

    @Test
    fun speaksWithStyleAndProsody() = runBlocking {
        assumeTrue(System.getProperty("zen.live") == "1")
        val tts = EdgeTts(client())
        val res = tts.synthesize(
            text = "Коротко и весело.",
            voice = "en-US-JennyNeural",
            pitch = "+10Hz", rate = "+20%", volume = "+0%", style = "cheerful"
        )
        println("Edge-TTS en-US-JennyNeural + стиль: ${res.mp3.size} байт")
        assertTrue(res.mp3.size > 1000)
    }

    @Test
    fun rejectsUnknownVoice() = runBlocking {
        assumeTrue(System.getProperty("zen.live") == "1")
        val tts = EdgeTts(client())
        val err = runCatching {
            tts.synthesize("тест", "ru-RU-НетТакогоГолосаNeural")
        }.exceptionOrNull()
        println("неизвестный голос → ${err?.message}")
        assertTrue("ожидали ошибку от сервера", err != null)
    }

    private fun countMp3Frames(data: ByteArray): Int {
        var n = 0
        var i = 0
        while (i + 4 <= data.size) {
            if ((data[i].toInt() and 0xff) == 0xff && (data[i + 1].toInt() and 0xe0) == 0xe0) {
                val h = ((data[i].toInt() and 0xff) shl 24) or ((data[i + 1].toInt() and 0xff) shl 16) or
                    ((data[i + 2].toInt() and 0xff) shl 8) or (data[i + 3].toInt() and 0xff)
                val ver = (h ushr 19) and 3
                val layer = (h ushr 17) and 3
                if ((ver == 3 || ver == 2 || ver == 0) && layer == 1) {
                    n++
                    i += 4
                    continue
                }
            }
            i++
        }
        return n
    }
}
