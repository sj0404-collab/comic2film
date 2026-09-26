package com.voicecomic.app.ai

import android.content.Context
import com.voicecomic.app.data.newId
import com.voicecomic.app.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class AiException(message: String, val status: Int = 0) : Exception(message)

/**
 * Клиент ИИ: OpenAI-совместимые / Gemini / Anthropic + прямой вызов OpenCode Zen
 * с identity-заголовками (нативная замена node-релея zen-relay.mjs).
 */
class AiClient(private val http: OkHttpClient) {

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }
        private val gapMutex = Mutex()
        private var lastCall = 0L
        private val ZEN_BASE = "https://opencode.ai/zen/v1"
        private val OPENCODE_VERSION = "1.18.31"
        private val RESPONSES_MODELS = Regex("muse-spark-\\S*contributor-free")
        private val JEV_MODELS = Regex("^jev-")

        /** Ленивый доступ к официальным тулам opencode (ассет из relay/builtin_tools.json). */
        @Volatile
        var builtinTools: JsonArray = JsonArray(emptyList())

        fun loadTools(context: Context) {
            if (builtinTools.isNotEmpty()) return
            runCatching {
                val txt = context.assets.open("builtin_tools.json").bufferedReader().use { it.readText() }
                builtinTools = json.parseToJsonElement(txt) as JsonArray
            }
        }

        fun ocId(prefix: String): String {
            val stamp = (System.currentTimeMillis() * 0x1000).toLong().toString(16).padStart(12, '0').takeLast(12)
            val rnd = (1..14).map { "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".random() }.joinToString("")
            return prefix + stamp + rnd
        }

        /** Ленивый JSON-парсинг: сначала напрямую, потом первый объект/массив в тексте. */
        fun parseJsonLoose(raw: String): JsonElement? {
            val s = raw.trim()
            runCatching { return json.parseToJsonElement(s) }
            Regex("\\{[\\s\\S]*\\}").find(s)?.let { m ->
                runCatching { return json.parseToJsonElement(m.value) }
            }
            Regex("\\[[\\s\\S]*\\]").find(s)?.let { m ->
                runCatching { return json.parseToJsonElement(m.value) }
            }
            return null
        }
    }

    private suspend fun waitGap(settings: Settings) {
        val gap = settings.aiGap.toLong()
        gapMutex.withLock {
            val now = System.currentTimeMillis()
            val wait = lastCall + gap - now
            if (wait > 0) delay(wait)
            lastCall = System.currentTimeMillis()
        }
    }

    // ---------- публичный вход ----------

    suspend fun chat(
        settings: Settings,
        messages: List<Msg>,
        wantJson: Boolean = false,
        images: List<String> = emptyList(),
        minGap: Int? = null
    ): String {
        if (images.isNotEmpty()) waitGap(settings)
        else waitGap(settings)
        val p = Providers.provider(settings.ai)
        if (settings.ai == "custom" && settings.aiurl.isBlank()) {
            throw AiException("Свой провайдер: не задан адрес OpenAI-совместимого API")
        }
        if (p.id == "opencode" && settings.key.isBlank() && Providers.ZEN_KEYLESS.contains(settings.aimodel)) {
            return zen(settings, messages, wantJson)
        }
        return when {
            p.gemini -> chatGemini(settings, messages, images)
            p.anthropic -> chatAnthropic(settings, messages, images)
            else -> openAiCompat(settings, messages, wantJson, images, minGap)
        }
    }

    // ---------- OpenAI-совместимый формат ----------

    private fun endpointFor(settings: Settings, p: com.voicecomic.app.ai.Provider): String = when (settings.ai) {
        "custom" -> settings.aiurl.trim()
        else -> p.endpoint
    }

    private fun buildOpenAiBody(
        settings: Settings,
        messages: List<Msg>,
        wantJson: Boolean,
        images: List<String>,
        useJsonMode: Boolean
    ): JsonObject = buildJsonObject {
        put("model", settings.aimodel)
        if (images.isEmpty()) {
            putJsonArray("messages") {
                messages.forEach { msg ->
                    add(buildJsonObject {
                        put("role", msg.role)
                        put("content", msg.content)
                    })
                }
            }
        } else {
            putJsonArray("messages") {
                messages.forEach { msg ->
                    if (msg.role == "user") {
                        add(buildJsonObject {
                            put("role", "user")
                            putJsonArray("content") {
                                add(buildJsonObject {
                                    put("type", "text")
                                    put("text", msg.content)
                                })
                                images.forEach { url ->
                                    add(buildJsonObject {
                                        put("type", "image_url")
                                        putJsonObject("image_url") { put("url", url) }
                                    })
                                }
                            }
                        })
                    } else {
                        add(buildJsonObject {
                            put("role", msg.role)
                            put("content", msg.content)
                        })
                    }
                }
            }
        }
        if (!Providers.isReasoningModel(settings.aimodel)) {
            put("temperature", if (wantJson) 0.1 else 0.5)
        }
        if (wantJson && useJsonMode) {
            putJsonObject("response_format") { put("type", "json_object") }
        }
    }

    private suspend fun openAiCompat(
        settings: Settings,
        messages: List<Msg>,
        wantJson: Boolean,
        images: List<String>,
        minGap: Int?
    ): String = withContext(Dispatchers.IO) {
        val p = Providers.provider(settings.ai)
        val url = endpointFor(settings, p)
        if (url.isBlank()) throw AiException("Свой провайдер: не задан адрес OpenAI-совместимого API")
        val gap = (minGap ?: settings.aiGap).toLong()
        var useJsonMode = wantJson
        var attempt = 0
        var waits = 0
        while (true) {
            val body = buildOpenAiBody(settings, messages, wantJson, images, useJsonMode)
            val req = Request.Builder().url(url)
                .header("Content-Type", "application/json")
                .apply { if (settings.key.isNotBlank()) header("Authorization", "Bearer ${settings.key}") }
                .apply {
                    if (settings.ai == "openrouter") {
                        header("HTTP-Referer", "https://github.com/sj0404-collab/comic2film")
                        header("X-Title", "VoiceComic")
                    }
                }
                .post(body.toString().toRequestBody(JSON_MEDIA))
                .build()
            val resp = http.newCall(req).execute()
            resp.use {
                val text = it.body?.string() ?: ""
                if (it.isSuccessful) {
                    val content = extractOpenAiText(text)
                    return@withContext if (wantJson) (parseJsonLoose(content)?.toString() ?: content) else content
                }
                val status = it.code
                if (status == 400 && useJsonMode && Regex("response_format|json_object", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
                    useJsonMode = false
                    continue
                }
                if (status == 429) {
                    waits++
                    if (waits <= 3) {
                        delay(5000L * waits)
                        continue
                    }
                } else if (status in 400..499) {
                    throw AiException("${p.name} $status: ${text.take(180)}", status)
                } else if (attempt < 3) {
                    attempt++
                    delay(gap * attempt)
                    continue
                }
                throw AiException("${p.name} $status: ${text.take(180)}", status)
            }
        }
        @Suppress("UNREACHABLE_CODE")
        ""
    }

    private fun extractOpenAiText(body: String): String {
        val root = runCatching { json.parseToJsonElement(body).jsonObject }.getOrNull()
            ?: return body
        val content = root["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("message")?.jsonObject?.get("content")
            ?: return ""
        return when (content) {
            is JsonPrimitive -> content.content
            is JsonArray -> content.joinToString("") { (it as? JsonPrimitive)?.content ?: "" }
            else -> ""
        }
    }

    // ---------- Gemini ----------

    private suspend fun chatGemini(settings: Settings, messages: List<Msg>, images: List<String>): String =
        withContext(Dispatchers.IO) {
            if (settings.key.isBlank()) throw AiException("Gemini: нужен API-ключ")
            val system = messages.filter { it.role == "system" }.joinToString("\n\n") { it.content }
            val turns = messages.filter { it.role != "system" }
                .map { it.role to it.content }
            val payload = buildJsonObject {
                putJsonArray("contents") {
                    if (turns.isEmpty()) {
                        add(buildJsonObject {
                            put("role", "user")
                            putJsonArray("parts") { add(buildJsonObject { put("text", "ping") }) }
                        })
                    }
                    turns.forEachIndexed { i, (role, text) ->
                        add(buildJsonObject {
                            put("role", if (role == "assistant") "model" else "user")
                            putJsonArray("parts") {
                                add(buildJsonObject { put("text", text) })
                                if (i == turns.lastIndex) {
                                    images.forEach { url ->
                                        add(buildJsonObject {
                                            putJsonObject("inline_data") {
                                                put("mime_type", mimeOf(url))
                                                put("data", url.substringAfter("base64,", ""))
                                            }
                                        })
                                    }
                                }
                            }
                        })
                    }
                }
                if (system.isNotEmpty()) {
                    putJsonObject("systemInstruction") {
                        putJsonArray("parts") { add(buildJsonObject { put("text", system) }) }
                    }
                }
            }
            val url = "https://generativelanguage.googleapis.com/v1beta/models/${settings.aimodel}:generateContent?key=${settings.key}"
            val req = Request.Builder().url(url)
                .header("Content-Type", "application/json")
                .post(payload.toString().toRequestBody(JSON_MEDIA))
                .build()
            var attempt = 0
            var waits = 0
            while (true) {
                http.newCall(req).execute().use { resp ->
                    val text = resp.body?.string() ?: ""
                    if (resp.isSuccessful) {
                        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                        val parts = root?.get("candidates")?.jsonArray?.firstOrNull()?.jsonObject
                            ?.get("content")?.jsonObject?.get("parts")?.jsonArray
                        val out = parts?.joinToString("") {
                            (it.jsonObject["text"] as? JsonPrimitive)?.content ?: ""
                        }.orEmpty()
                        if (out.isNotEmpty()) return@withContext out
                        val reason = root?.get("candidates")?.jsonArray?.firstOrNull()?.jsonObject
                            ?.get("finishReason")?.jsonPrimitive?.content
                        val block = root?.get("promptFeedback")?.jsonObject?.get("blockReason")?.jsonPrimitive?.content
                        throw AiException("Gemini $reason ($block)", 400)
                    }
                    val status = resp.code
                    if (status == 429) {
                        waits++
                        if (waits <= 3) {
                            delay(5000L * waits)
                            return@use
                        }
                    } else if (status in 400..499) {
                        throw AiException("Gemini $status: ${text.take(150)}", status)
                    } else if (attempt < 3) {
                        attempt++
                        delay(settings.aiGap.toLong() * attempt)
                        return@use
                    }
                    throw AiException("Gemini $status: ${text.take(150)}", status)
                }
                // повтор после 429
            }
            @Suppress("UNREACHABLE_CODE")
            ""
        }

    // ---------- Anthropic ----------

    private suspend fun chatAnthropic(settings: Settings, messages: List<Msg>, images: List<String>): String =
        withContext(Dispatchers.IO) {
            if (settings.key.isBlank()) throw AiException("Anthropic: нужен API-ключ")
            val system = messages.filter { it.role == "system" }.joinToString("\n\n") { it.content }
            val turns = messages.filter { it.role != "system" }
            val payload = buildJsonObject {
                put("model", settings.aimodel)
                put("max_tokens", 4096)
                if (system.isNotEmpty()) put("system", system)
                putJsonArray("messages") {
                    if (turns.isEmpty()) {
                        add(buildJsonObject {
                            put("role", "user"); put("content", "ping")
                        })
                    }
                    turns.forEachIndexed { i, msg ->
                        add(buildJsonObject {
                            put("role", if (msg.role == "assistant") "assistant" else "user")
                            if (images.isEmpty() || i != turns.lastIndex) {
                                put("content", msg.content)
                            } else {
                                putJsonArray("content") {
                                    add(buildJsonObject {
                                        put("type", "text"); put("text", msg.content)
                                    })
                                    images.forEach { url ->
                                        add(buildJsonObject {
                                            put("type", "image")
                                            putJsonObject("source") {
                                                put("type", "base64")
                                                put("media_type", mimeOf(url))
                                                put("data", url.substringAfter("base64,", ""))
                                            }
                                        })
                                    }
                                }
                            }
                        })
                    }
                }
            }
            val req = Request.Builder().url("https://api.anthropic.com/v1/messages")
                .header("Content-Type", "application/json")
                .header("x-api-key", settings.key)
                .header("anthropic-version", "2023-06-01")
                .post(payload.toString().toRequestBody(JSON_MEDIA))
                .build()
            var attempt = 0
            var waits = 0
            while (true) {
                http.newCall(req).execute().use { resp ->
                    val text = resp.body?.string() ?: ""
                    if (resp.isSuccessful) {
                        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                        val parts = root?.get("content")?.jsonArray
                        return@withContext parts?.joinToString("") {
                            (it.jsonObject["text"] as? JsonPrimitive)?.content ?: ""
                        }.orEmpty()
                    }
                    val status = resp.code
                    if (status == 429) {
                        waits++
                        if (waits <= 3) { delay(5000L * waits); return@use }
                    } else if (status in 400..499) {
                        throw AiException("Claude $status: ${text.take(150)}", status)
                    } else if (attempt < 3) {
                        attempt++; delay(settings.aiGap.toLong() * attempt); return@use
                    }
                    throw AiException("Claude $status: ${text.take(150)}", status)
                }
            }
            @Suppress("UNREACHABLE_CODE")
            ""
        }

    // ---------- OpenCode Zen напрямую (замена zen-relay.mjs) ----------

    private suspend fun zen(settings: Settings, messages: List<Msg>, wantJson: Boolean): String =
        withContext(Dispatchers.IO) {
            val model = settings.aimodel
            if (JEV_MODELS.containsMatchIn(model)) {
                throw AiException("«$model» (Jev) — это не чат-модель, а «система решений» (state+questions); в VoiceComic не используется.")
            }
            val useResponses = RESPONSES_MODELS.containsMatchIn(model)
            val payload = buildJsonObject {
                put("model", model)
                put("stream", true)
                put("tool_choice", "auto")
                if (useResponses) {
                    putJsonArray("tools") {
                        builtinTools.forEach { t ->
                            val f = t.jsonObject["function"]?.jsonObject ?: return@forEach
                            add(buildJsonObject {
                                put("type", "function")
                                put("name", f["name"]?.jsonPrimitive?.content ?: "")
                                put("description", f["description"]?.jsonPrimitive?.content ?: "")
                                put("parameters", f["parameters"] ?: JsonObject(emptyMap()))
                            })
                        }
                    }
                    put("max_output_tokens", 800)
                    putJsonArray("input") {
                        val turns = messages.filter { it.role != "system" }
                        if (turns.isEmpty()) {
                            add(buildJsonObject {
                                put("role", "user")
                                putJsonArray("content") {
                                    add(buildJsonObject { put("type", "input_text"); put("text", "ping") })
                                }
                            })
                        } else {
                            messages.forEach { msg ->
                                add(buildJsonObject {
                                    put("role", if (msg.role == "assistant") "assistant" else "user")
                                    putJsonArray("content") {
                                        add(buildJsonObject {
                                            put("type", "input_text")
                                            put("text", msg.content)
                                        })
                                    }
                                })
                            }
                        }
                    }
                } else {
                    putJsonArray("tools") { builtinTools.forEach { add(it) } }
                    putJsonArray("messages") {
                        val turns = messages.filter { it.role != "system" }
                        if (turns.isEmpty()) {
                            add(buildJsonObject { put("role", "user"); put("content", "ping") })
                        } else {
                            turns.forEach { msg ->
                                add(buildJsonObject { put("role", msg.role); put("content", msg.content) })
                            }
                        }
                    }
                }
            }
            val url = if (useResponses) "$ZEN_BASE/responses" else "$ZEN_BASE/chat/completions"
            val req = Request.Builder().url(url)
                .header("Content-Type", "application/json")
                .header("User-Agent", "opencode/$OPENCODE_VERSION")
                .header("x-opencode-client", "cli")
                .header("x-opencode-project", "global")
                .header("x-opencode-session", ocId("ses_"))
                .header("x-opencode-request", ocId("msg_"))
                .header("Accept", "application/json, text/event-stream")
                .apply { if (settings.key.isNotBlank()) header("Authorization", "Bearer ${settings.key}") }
                .post(payload.toString().toRequestBody(JSON_MEDIA))
                .build()
            http.newCall(req).execute().use { resp ->
                val text = resp.body?.string() ?: ""
                if (!resp.isSuccessful) throw AiException("Zen HTTP ${resp.code}: ${text.take(180)}", resp.code)
                val folded = if (useResponses) foldResponsesSse(text) else foldChatSse(text)
                if (folded.error != null) throw AiException("Zen: ${folded.error}")
                if (folded.content.isEmpty()) throw AiException("модель вернула пустой ответ")
                if (wantJson) return@use (parseJsonLoose(folded.content)?.toString() ?: folded.content)
                folded.content
            }
        }

    data class Folded(val content: String, val error: String? = null)

    fun foldChatSse(sse: String): Folded {
        val sb = StringBuilder()
        var finish = "stop"
        var err: String? = null
        for (line in sse.lineSequence()) {
            val t = line.trim()
            if (!t.startsWith("data:")) continue
            val payload = t.removePrefix("data:").trim()
            if (payload.isEmpty() || payload == "[DONE]") continue
            val el = runCatching { json.parseToJsonElement(payload) }.getOrNull() as? JsonObject ?: continue
            el["error"]?.let { err = it.toString(); continue }
            val choice = el["choices"]?.jsonArray?.firstOrNull()?.jsonObject
            val piece = choice?.get("delta")?.jsonObject?.get("content")?.jsonPrimitive?.content
            if (piece != null) sb.append(piece)
            choice?.get("finish_reason")?.jsonPrimitive?.content?.let { finish = it }
        }
        if (finish == "length") return Folded("", "модель упёрлась в лимит длины ответа (сократите запрос)")
        if (err != null) return Folded("", err)
        return Folded(sb.toString())
    }

    fun foldResponsesSse(sse: String): Folded {
        val sb = StringBuilder()
        var status = "completed"
        var err: String? = null
        for (line in sse.lineSequence()) {
            val t = line.trim()
            if (!t.startsWith("data:")) continue
            val payload = t.removePrefix("data:").trim()
            if (payload.isEmpty() || payload == "[DONE]") continue
            val el = runCatching { json.parseToJsonElement(payload) }.getOrNull() as? JsonObject ?: continue
            when (el["type"]?.jsonPrimitive?.content) {
                "response.output_text.delta" -> sb.append(el["delta"]?.jsonPrimitive?.content ?: "")
                "response.completed" -> status = el["response"]?.jsonObject?.get("status")?.jsonPrimitive?.content ?: "completed"
                "response.incomplete" -> {
                    val reason = el["response"]?.jsonObject?.get("incomplete_details")?.jsonObject
                        ?.get("reason")?.jsonPrimitive?.content ?: "incomplete"
                    err = "модель не закончила ответ: $reason"
                }

                "response.failed", "error", "response.error" -> err = payload
            }
        }
        if (err != null) return Folded("", err)
        if (status != "completed") return Folded("", "статус ответа zen: $status")
        return Folded(sb.toString())
    }

    private fun mimeOf(dataUrl: String): String =
        dataUrl.substringBefore(";base64,").substringAfterLast(':').ifEmpty { "image/jpeg" }
}

