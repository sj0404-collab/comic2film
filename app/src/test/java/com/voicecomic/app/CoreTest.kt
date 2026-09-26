package com.voicecomic.app

import com.voicecomic.app.ai.AiClient
import com.voicecomic.app.ai.CastPlanner
import com.voicecomic.app.ai.Providers
import com.voicecomic.app.audio.Gec
import com.voicecomic.app.audio.Mp3Frames
import com.voicecomic.app.audio.Pcm
import com.voicecomic.app.audio.VoiceCatalog
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.Defaults
import com.voicecomic.app.data.Page
import com.voicecomic.app.data.Role
import com.voicecomic.app.render.Item
import com.voicecomic.app.render.Timeline
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.assertNotNull
import org.junit.Test
import java.io.File

class CoreTest {

    // ---------- Edge-TTS: токен и кадры ----------

    @Test
    fun gecTokenIsUppercaseHex32() {
        val g = Gec.value(1_757_000_000_000)
        // как в util.js: полный SHA-256 в верхнем регистре
        assertEquals(64, g.length)
        assertTrue(g.all { it.isDigit() || it in 'A'..'F' })
        // токен стабилен в пределах 5-минутного окна
        assertEquals(g, Gec.value(1_757_000_000_000 + 60_000))
        // и меняется после окна
        assertTrue(g != Gec.value(1_757_000_000_000 + 400_000))
    }

    @Test
    fun mp3FrameCleanerKeepsFrames() {
        // два настоящих MPEG-2 Layer III кадра: 24 кГц, 48 кбит/с → 144 байта
        val frame = ByteArray(144)
        frame[0] = 0xff.toByte()
        frame[1] = 0xf3.toByte()  // MPEG-2, Layer III, без CRC
        frame[2] = 0x64.toByte()  // 48 kbps, 24 кГц
        val junk = byteArrayOf(1, 2, 3, 4, 5)
        val input = junk + frame + junk + frame + junk
        val out = Mp3Frames.clean(input)
        assertEquals(288, out.size)
    }

    @Test
    fun browserUaIsWellFormed() {
        // на мусорный UA Edge-TTS отвечает 403 — это уже стоило нам нерабочей озвучки
        val ua = com.voicecomic.app.audio.EdgeTts.BROWSER_UA
        assertTrue(ua, ua.matches(Regex("^Mozilla/5\\.0 \\(Windows NT 10\\.0.*Chrome/\\d+\\.\\d+\\.\\d+\\.\\d+ .*Edg/\\d+\\.\\d+\\.\\d+\\.\\d+$")))
        assertTrue("UA не должен содержать GEC-версию дважды", !ua.contains(Gec.CHROMIUM))
    }

    @Test
    fun ssmlAndLocale() {
        val tts = com.voicecomic.app.audio.EdgeTts(okhttp3.OkHttpClient())
        assertEquals("ru-RU", tts.voiceLocale("ru-RU-DmitryNeural"))
        assertEquals("en-US", tts.voiceLocale("en-US-JennyNeural"))
        assertEquals("en-US", tts.voiceLocale("SomethingElse"))
        val ssml = tts.ssml("Привет & <тест>", "ru-RU-DmitryNeural", "+5Hz", "+10%", "+0%", "cheerful")
        assertTrue(ssml.contains("xml:lang='ru-RU'"))
        assertTrue(ssml.contains("mstts:express-as style='cheerful' styledegree='1'"))
        assertTrue(ssml.contains("&amp;") && ssml.contains("&lt;тест&gt;"))
        val plain = tts.ssml("a", "en-US-JennyNeural", "+0Hz", "+0%", "+0%", "")
        assertTrue(plain.contains("pitch='+0Hz' rate='+0%' volume='+0%'"))
        assertTrue(!plain.contains("mstts"))
    }

    // ---------- голоса ----------

    @Test
    fun voiceCatalogAndLocale() {
        assertTrue(VoiceCatalog.all().size >= 100)
        assertEquals("ru-RU", VoiceCatalog.byId("ru-RU-DmitryNeural")!!.lang)
        assertEquals("f", VoiceCatalog.byId("ru-RU-SvetlanaNeural")!!.gender)
        assertTrue(VoiceCatalog.forLang("ru").all { it.lang.startsWith("ru") })
        assertEquals("zh-CN", VoiceCatalog.normLocale("zh-Hans-CN"))
        assertEquals("ca-ES", VoiceCatalog.normLocale("ca-ES-valencia"))
        assertEquals("es-419", VoiceCatalog.normLocale("es-419"))
        assertEquals("en-US", VoiceCatalog.normLocale(""))
    }

    // ---------- PCM: тишина, нарезка, WAV ----------

    private fun sine(sr: Int, ms: Int, amp: Float = 0.5f): FloatArray {
        val n = sr * ms / 1000
        return FloatArray(n) { i -> (amp * kotlin.math.sin(2.0 * Math.PI * 220 * i / sr)).toFloat() }
    }

    @Test
    fun trimSilenceCutsEdges() {
        val sr = 16000
        val body = sine(sr, 400)
        val padded = FloatArray(sr) // 1 c тишины
        System.arraycopy(body, 0, padded, (sr - body.size) / 2, body.size)
        val trim = Pcm.trimSilence(padded, sr, 0.012, 0.05)
        assertTrue(trim.start > 0)
        assertTrue(trim.end < padded.size)
        val dur = (trim.end - trim.start).toDouble() / sr
        assertTrue("dur=$dur", dur in 0.3..0.5)
    }

    @Test
    fun sliceSegmentsSplitsOnSilence() {
        val sr = 16000
        val out = FloatArray(sr * 3)
        fun put(fromMs: Int, lenMs: Int) {
            val s = sine(sr, lenMs)
            System.arraycopy(s, 0, out, sr * fromMs / 1000, s.size)
        }

        put(200, 500)
        put(1500, 700)
        val segs = Pcm.sliceSegments(out, sr)
        assertEquals(2, segs.size)
        assertTrue(segs[0].startS < segs[1].startS)
        assertTrue(segs[0].endS - segs[0].startS > 0.4)
    }

    @Test
    fun wavRoundTrip() {
        val sr = 22050
        val pcm = Pcm.floatToPcm16(sine(sr, 120))
        val f = File.createTempFile("vc_test", ".wav")
        Pcm.writeWav(f, pcm, sr)
        val back = Pcm.readWav(f)
        assertNotNull(back)
        assertEquals(sr, back!!.second)
        assertEquals(pcm.size, back.first.size)
        f.delete()
    }

    @Test
    fun resampleKeepsDuration() {
        val sr = 24000
        val pcm = sine(sr, 500)
        val up = Pcm.resampleLinear(pcm, sr, 44100)
        val expect = pcm.size * 44100 / sr  // 500 мс @24 кГц → 500 мс @44.1 кГц
        assertEquals(expect, up.size)
    }

    @Test
    fun estimateSpeakDurationMatchesWeb() {
        assertEquals(0.0, Pcm.estimateSpeakDuration("   "), 0.0001)
        // 13 символов в секунду + 0.55, но не меньше 1.1; без пробела без +0.15
        assertEquals(1.1, Pcm.estimateSpeakDuration("абвгд"), 0.001)
        assertEquals(1.25, Pcm.estimateSpeakDuration("абвгд "), 0.001)
        assertTrue(Pcm.estimateSpeakDuration("а".repeat(400)) <= 14.0)
    }

    // ---------- таймлайн и камера ----------

    private fun page(bubbles: List<Bubble>, boxes: Boolean = true) = Page(
        id = "p1", file = "pages/x.jpg", w = 1000, h = 1500, bubblesHaveBoxes = boxes, bubbles = bubbles
    )

    @Test
    fun timelineMatchesWebConstants() {
        val bubbles = listOf(
            Bubble(id = "b1", text = "раз", audio = com.voicecomic.app.data.BubbleAudio("a.wav", 2.0)),
            Bubble(id = "b2", text = "два", audio = com.voicecomic.app.data.BubbleAudio("b.wav", 3.0))
        )
        val (items, total) = Timeline.build(listOf(page(bubbles)), 350)
        // 0.55 заезд + 0.25 перед первой репликой
        assertEquals(2, items.size)
        assertEquals(0.80, items[0].t, 0.001)
        // +2.0 реплика + 0.21 (gap*0.6) + 0.35 (gap) перед второй
        assertEquals(3.36, items[1].t, 0.001)
        // +3.0 + 0.21 + 0.5 хвост страницы + 0.9 конец
        assertEquals(7.97, total, 0.01)
    }

    @Test
    fun idlePageHasNoLeadIn() {
        val (items, total) = Timeline.build(listOf(page(emptyList())), 350)
        assertEquals(1, items.size)
        assertEquals("idle", items[0].kind)
        assertEquals(1.8, items[0].dur, 0.001)
        assertEquals(2.7, total, 0.001)
    }

    @Test
    fun roleGainUsesVolumeNum() {
        assertEquals(1f, Timeline.roleGain(Role(volumeNum = 100)), 0.001f)
        assertEquals(1.5f, Timeline.roleGain(Role(volumeNum = 150)), 0.001f)
        assertEquals(2f, Timeline.roleGain(Role(volumeNum = 400)), 0.001f)
        assertEquals(1f, Timeline.roleGain(null), 0.001f)
    }

    @Test
    fun cameraZoomsIntoBubble() {
        val b = Bubble(id = "b1", text = "x", audio = com.voicecomic.app.data.BubbleAudio("a.wav", 2.0), x = 400f, y = 600f, w = 200f, h = 100f)
        val item = Item(page(listOf(b)), 0, b, 0.0, 2.0, "line")
        val start = Timeline.cameraFor(item, 0.0, 1080, 1920, "smart")
        val mid = Timeline.cameraFor(item, 1.0, 1080, 1920, "smart")
        assertTrue("zoom должен расти: ${start.zoom} -> ${mid.zoom}", mid.zoom > start.zoom)
        // вырезка не выходит за страницу
        assertTrue(start.sx >= 0 && start.sx + start.sw <= 1000.001f)
        assertTrue(start.sy >= 0 && start.sy + start.sh <= 1500.001f)
        // центр вырезки близок к центру пузыря
        val cx = start.sx + start.sw / 2
        val cy = start.sy + start.sh / 2
        assertEquals(500f, cx, 6f)
        assertEquals(650f, cy, 6f)
    }

    @Test
    fun visionPagesHaveNoZoomAnchor() {
        val b = Bubble(id = "b1", text = "x")
        val item = Item(page(listOf(b), boxes = false), 0, b, 0.0, 2.0, "line")
        assertTrue(!Timeline.bubbleHasBox(b, item.page))
        val cam = Timeline.cameraFor(item, 0.5, 1080, 1920, "smart")
        // без пузыря — простое кадрирование с полным кадром
        assertTrue(cam.sw <= 1000.001f && cam.sh <= 1500.001f)
    }

    @Test
    fun resolveSizeAutoKeepsEvenWidth() {
        val p = Page(w = 1000, h = 1500)
        val (w, h) = Timeline.resolveSize("auto", listOf(p))
        assertEquals(1080, h)
        assertEquals(0, w % 2)
    }

    // ---------- кастинг ----------

    @Test
    fun castPlanRespectsGenderAndLanguage() {
        val roles = listOf(
            Role(id = "n", name = Defaults.NARRATOR, gender = "other"),
            Role(id = "m", name = "Саске", gender = "male"),
            Role(id = "f", name = "Сакура", gender = "female")
        )
        val pool = VoiceCatalog.forLang("ru")
        val plan = CastPlanner.planCasts(roles, pool, "ru", emptySet(), "n")
        assertEquals("m", VoiceCatalog.byId(plan.casts["m"]!!.voice)!!.gender)
        assertEquals("f", VoiceCatalog.byId(plan.casts["f"]!!.voice)!!.gender)
        assertEquals(0, plan.reused)
    }

    @Test
    fun castPlanKeepsManualVoices() {
        val roles = listOf(
            Role(id = "m", name = "Герой", gender = "male", voice = "en-US-GuyNeural", manualVoice = true)
        )
        val plan = CastPlanner.planCasts(roles, VoiceCatalog.forLang("ru"), "ru", setOf("m"), null)
        assertEquals("en-US-GuyNeural", plan.casts["m"]!!.voice)
        assertEquals("manual", plan.casts["m"]!!.reason)
    }

    @Test
    fun castPlanReusesWhenNotEnoughVoices() {
        val roles = (1..4).map { Role(id = "r$it", name = "Г$it", gender = "male") }
        val pool = listOf(
            VoiceCatalog.Voice("ru-RU-DmitryNeural", "ru-RU", "m"),
            VoiceCatalog.Voice("ru-RU-PavelNeural", "ru-RU", "m")
        )
        val plan = CastPlanner.planCasts(roles, pool, "ru", emptySet(), null)
        assertTrue(plan.reused > 0)
    }

    @Test
    fun nameNormalization() {
        assertEquals("саске", CastPlanner.normName(" Саске! "))
        assertEquals("сестра", CastPlanner.normName("Сёстра!"))
        assertTrue(CastPlanner.isNarrator("Нарратор"))
        assertTrue(CastPlanner.isNarrator("off-screen"))
        assertTrue(CastPlanner.isUnknownName("?"))
        assertEquals("male", CastPlanner.normGender("Муж"))
        assertEquals("female", CastPlanner.normGender("FEM"))
    }

    // ---------- ИИ: SSE, каталог ----------

    @Test
    fun foldsChatSse() {
        val sse = """
            data: {"choices":[{"delta":{"content":"Привет"},"finish_reason":null}]}

            data: {"choices":[{"delta":{"content":", мир"},"finish_reason":"stop"}]}

            data: [DONE]
        """.trimIndent()
        val out = AiClient(httpClient()).foldChatSse(sse)
        assertEquals("Привет, мир", out.content)
        assertEquals(null, out.error)
    }

    @Test
    fun foldsChatSseReportsLength() {
        val sse = """data: {"choices":[{"delta":{"content":"x"},"finish_reason":"length"}]}"""
        assertNotNull(AiClient(httpClient()).foldChatSse(sse).error)
    }

    @Test
    fun foldsResponsesSse() {
        val sse = """
            data: {"type":"response.output_text.delta","delta":"да"}
            data: {"type":"response.output_text.delta","delta":"нет"}
            data: {"type":"response.completed","response":{"status":"completed"}}
        """.trimIndent()
        assertEquals("данет", AiClient(httpClient()).foldResponsesSse(sse).content)
    }

    @Test
    fun jsonRepair() {
        val el = AiClient.parseJsonLoose("бла бла {\"a\":1} конец")
        assertEquals("{\"a\":1}", el.toString())
        val arr = AiClient.parseJsonLoose("вот массив [1,2]")
        assertEquals("[1,2]", arr.toString())
        assertEquals(null, AiClient.parseJsonLoose("вообще не json"))
    }

    @Test
    fun zenKeylessModelsSplitByEndpoint() {
        val chat = Providers.ZEN_KEYLESS.filter { !it.startsWith("muse-spark") }
        val resp = Providers.ZEN_KEYLESS.filter { it.startsWith("muse-spark") }
        assertTrue(chat.isNotEmpty() && resp.isNotEmpty())
        assertTrue("big-pickle" in chat)
        assertTrue(chat.any { it.endsWith("-free") })
    }

    @Test
    fun smartModelHeuristics() {
        assertTrue(Providers.isSmartModel("GPT-5.2", "gpt-5.2"))
        // как в ai.js: параметры сначала, 70b >= 32 → умная
        assertTrue(Providers.isSmartModel("Llama 3.3 70B", "llama-3.3-70b"))
        assertTrue(!Providers.isSmartModel("GPT-4o mini", "gpt-4o-mini"))
        assertTrue(!Providers.isSmartModel("Gemma 2 9B", "gemma-2-9b"))
        assertTrue(Providers.isReasoningModel("o3-mini"))
        assertTrue(!Providers.isReasoningModel("gpt-4.1"))
    }

    private fun httpClient() = okhttp3.OkHttpClient.Builder().build()
}
