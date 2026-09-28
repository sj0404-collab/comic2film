package com.voicecomic.app

import com.voicecomic.app.ai.AiClient
import com.voicecomic.app.ai.Msg
import com.voicecomic.app.ai.Providers
import com.voicecomic.app.data.Settings
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Живой тест бесплатных моделей OpenCode Zen — ровно тем кодом, что работает в приложении
 * (прямой вызов без node-релея: identity-заголовки, официальные тулы, stream + сворачивание SSE).
 *
 * В обычном прогоне пропускается: ./gradlew :app:testDebugUnitTest
 * Запуск с сетью: ./gradlew :app:testDebugUnitTest -Plive --tests '*ZenLiveTest*'
 */
class ZenLiveTest {

    private fun loadTools() {
        val f = File("src/main/assets/builtin_tools.json")
        if (f.exists() && AiClient.builtinTools.isEmpty()) {
            AiClient.builtinTools = Json.parseToJsonElement(f.readText()) as JsonArray
        }
    }

    private fun client() = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .callTimeout(120, TimeUnit.SECONDS)
        .build()

    @Test
    fun zenKeylessModelsRespond() = runBlocking {
        assumeTrue("запуск только с -Plive", System.getProperty("zen.live") == "1")
        loadTools()
        assertTrue("тулы не загрузились", AiClient.builtinTools.size == 11)

        val http = client()
        val ai = AiClient(http)
        val models = Providers.ZEN_KEYLESS
        println("=== Zen free tier: ${models.size} моделей, эндпоинт выбирается по id ===")
        println("--- карта моделей: id | эндпоинт | статус | мс | ответ")
        val results = mutableListOf<Triple<String, String, String>>()
        for (m in models) {
            val endpoint = if (m.startsWith("muse-spark")) "/v1/responses" else "/v1/chat/completions"
            val s = Settings(ai = "opencode", aimodel = m, key = "", aiGap = 0)
            val t0 = System.currentTimeMillis()
            val out = withTimeoutOrNull(100_000) {
                runCatching { ai.chat(s, listOf(Msg("user", "Ответь одним словом: работаешь?"))) }
            }
            val ms = System.currentTimeMillis() - t0
            when {
                out == null -> {
                    println("$m | $endpoint | ТАЙМАУТ | - | -")
                    results.add(Triple(m, "timeout", ""))
                }

                out.isFailure -> {
                    val msg = (out.exceptionOrNull()?.message ?: "").take(110)
                    println("$m | $endpoint | ОШИБКА | $ms | $msg")
                    results.add(Triple(m, "error", msg))
                }

                else -> {
                    val text = out.getOrThrow().replace(Regex("\\s+"), " ").take(70)
                    println("$m | $endpoint | OK | $ms | $text")
                    results.add(Triple(m, "ok", text))
                }
            }
        }
        val ok = results.count { it.second == "ok" }
        println("=== ИТОГ: $ok из ${results.size} моделей отвечают ===")
        results.filter { it.second != "ok" }.forEach { println("  не ответили: ${it.first} — ${it.second} ${it.third}") }
        // падать только если не ответил никто — иначе это информация о доступности
        assertTrue("ни одна бесплатная модель Zen не ответила", ok > 0)
    }

    @Test
    fun pollinationsAnswers() = runBlocking {
        assumeTrue(System.getProperty("zen.live") == "1")
        val http = client()
        val ai = AiClient(http)
        val s = Settings(ai = "pollinations", aimodel = "openai", key = "", aiGap = 0)
        val out = withTimeoutOrNull(60_000) { runCatching { ai.chat(s, listOf(Msg("user", "ping"))) } }
        println("Pollinations: ${out?.fold({ "OK: " + it.take(60) }, { "ОШИБКА: " + it.message?.take(90) }) ?: "ТАЙМАУТ"}")
        assertTrue("Pollinations не ответил", out?.isSuccess == true)
    }
}
