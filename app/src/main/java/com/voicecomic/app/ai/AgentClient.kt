package com.voicecomic.app.ai

import com.voicecomic.app.data.Settings
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
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
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.atomic.AtomicReference

data class ToolCall(
    val id: String,
    val name: String,
    val arguments: String
) {
    fun arg(key: String): String? = runCatching {
        (Json.parseToJsonElement(arguments) as? JsonObject)?.get(key)?.jsonPrimitive?.content
    }.getOrNull()

    fun argInt(key: String, def: Int = 0): Int = arg(key)?.toIntOrNull() ?: def
}

data class AiTurn(
    val text: String,
    val reasoning: String,
    val toolCalls: List<ToolCall>,
    val finishReason: String
) {
    val isEmpty: Boolean get() = text.isBlank() && toolCalls.isEmpty()
}

class AgentCancelled : Exception("Остановлено пользователем")

/**
 * Клиент для чата с локальными инструментами: умеет stream + tool_calls + размышления
 * и отмену по кнопке «Стоп». Одиночные задачи (OCR, разметка, перевод) ходят через AiClient.
 */
class AgentClient(private val http: OkHttpClient) {

    companion object {
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }
        private const val ZEN_BASE = "https://opencode.ai/zen/v1"
        private const val OPENCODE_VERSION = "1.18.31"
        private val RESPONSES_MODELS = Regex("muse-spark-\\S*contributor-free")

        private val activeCall = AtomicReference<Call?>(null)

        /** Отмена запроса, идущего сейчас (кнопка «Стоп»). */
        fun stop() {
            activeCall.getAndSet(null)?.cancel()
        }

        fun isBusy(): Boolean = activeCall.get() != null
    }

    suspend fun turn(
        settings: Settings,
        messages: List<Msg>,
        tools: List<JsonObject>,
        toolChoice: String = "auto"
    ): AiTurn {
        val p = Providers.provider(settings.ai)
        return when {
            settings.ai == "opencode" -> zen(settings, messages, tools, toolChoice)
            p.gemini -> gemini(settings, messages, tools)
            p.anthropic -> anthropic(settings, messages, tools)
            else -> openAi(settings, messages, tools, toolChoice)
        }
    }

    // ---------- OpenAI-совместимые ----------

    private suspend fun openAi(
        settings: Settings,
        messages: List<Msg>,
        tools: List<JsonObject>,
        toolChoice: String
    ): AiTurn = withContext(Dispatchers.IO) {
        val p = Providers.provider(settings.ai)
        val url = if (settings.ai == "custom") settings.aiurl.trim() else p.endpoint
        if (url.isBlank()) throw AiException("Свой провайдер: не задан адрес OpenAI-совместимого API")
        val body = buildJsonObject {
            put("model", settings.aimodel)
            putJsonArray("messages") {
                messages.forEach { m ->
                    if (m.role == "tool") {
                        add(buildJsonObject {
                            put("role", "tool")
                            put("tool_call_id", m.toolCallId)
                            put("content", m.content)
                        })
                    } else if (m.role == "assistant" && m.toolCallsJson != null) {
                        add(buildJsonObject {
                            put("role", "assistant")
                            put("content", m.content)
                            putJsonArray("tool_calls") { m.toolCallsJson.forEach { add(it) } }
                        })
                    } else {
                        add(buildJsonObject {
                            put("role", m.role)
                            put("content", m.content)
                        })
                    }
                }
            }
            if (tools.isNotEmpty()) {
                putJsonArray("tools") { tools.forEach { add(it) } }
                put("tool_choice", toolChoice)
            }
            if (!Providers.isReasoningModel(settings.aimodel)) put("temperature", 0.3)
        }
        val call = http.newCall(
            Request.Builder().url(url)
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
        )
        val text = execute(call)
        val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: return@withContext AiTurn(text, "", emptyList(), "stop")
        val choice = root["choices"]?.jsonArray?.firstOrNull()?.jsonObject
        val message = choice?.get("message")?.jsonObject
        val content = (message?.get("content") as? JsonPrimitive)?.content.orEmpty()
        val reasoning = (message?.get("reasoning_content") as? JsonPrimitive)?.content.orEmpty()
        val calls = (message?.get("tool_calls") as? JsonArray)?.mapNotNull { e ->
            val o = e.jsonObject
            val f = o["function"]?.jsonObject
            ToolCall(
                id = o["id"]?.jsonPrimitive?.content ?: "call_${o.hashCode()}",
                name = f?.get("name")?.jsonPrimitive?.content ?: return@mapNotNull null,
                arguments = f?.get("arguments")?.jsonPrimitive?.content ?: "{}"
            )
        }.orEmpty()
        AiTurn(
            content, reasoning, calls,
            choice?.get("finish_reason")?.jsonPrimitive?.content ?: "stop"
        )
    }

    // ---------- OpenCode Zen (stream + SSE) ----------

    private suspend fun zen(
        settings: Settings,
        messages: List<Msg>,
        tools: List<JsonObject>,
        toolChoice: String
    ): AiTurn = withContext(Dispatchers.IO) {
        val useResponses = RESPONSES_MODELS.containsMatchIn(settings.aimodel)
        val payload = buildJsonObject {
            put("model", settings.aimodel)
            put("stream", true)
            if (tools.isNotEmpty()) put("tool_choice", toolChoice) else put("tool_choice", "auto")
            if (useResponses) {
                putJsonArray("tools") {
                    tools.forEach { add(toResponsesTool(it)) }
                }
                put("max_output_tokens", 4000)
                put("input", buildJsonArray {
                    messages.forEach { m ->
                        if (m.role == "tool") {
                            val toolText = "Результат инструмента " + m.toolCallId + ": " + m.content
                            add(buildJsonObject {
                                put("role", "user")
                                put("content", buildJsonArray {
                                    add(buildJsonObject {
                                        put("type", "input_text")
                                        put("text", toolText)
                                    })
                                })
                            })
                        } else {
                            val body = m.content
                            add(buildJsonObject {
                                put("role", if (m.role == "assistant") "assistant" else "user")
                                put("content", buildJsonArray {
                                    add(buildJsonObject {
                                        put("type", "input_text")
                                        put("text", body)
                                    })
                                })
                            })
                        }
                    }
                })
            } else {
                putJsonArray("tools") {
                    if (tools.isEmpty()) AiClient.builtinTools.forEach { add(it) } else tools.forEach { add(it) }
                }
                put("messages", buildJsonArray {
                    messages.forEach { m ->
                        if (m.role == "tool") {
                            add(buildJsonObject {
                                put("role", "tool")
                                put("tool_call_id", m.toolCallId)
                                put("content", m.content)
                            })
                        } else if (m.role == "assistant" && m.toolCallsJson != null) {
                            add(buildJsonObject {
                                put("role", "assistant")
                                put("content", m.content)
                                put("tool_calls", buildJsonArray { m.toolCallsJson.forEach { add(it) } })
                            })
                        } else {
                            add(buildJsonObject {
                                put("role", m.role)
                                put("content", m.content)
                            })
                        }
                    }
                })
            }
        }
        val url = if (useResponses) "$ZEN_BASE/responses" else "$ZEN_BASE/chat/completions"
        val call = http.newCall(
            Request.Builder().url(url)
                .header("Content-Type", "application/json")
                .header("User-Agent", "opencode/$OPENCODE_VERSION")
                .header("x-opencode-client", "cli")
                .header("x-opencode-project", "global")
                .header("x-opencode-session", AiClient.ocId("ses_"))
                .header("x-opencode-request", AiClient.ocId("msg_"))
                .header("Accept", "application/json, text/event-stream")
                .apply { if (settings.key.isNotBlank()) header("Authorization", "Bearer ${settings.key}") }
                .post(payload.toString().toRequestBody(JSON_MEDIA))
                .build()
        )
        val sse = execute(call)
        if (useResponses) foldResponses(sse) else foldChat(sse)
    }

    /** Из формата openai (function-обёртка) в плоский responses-формат. */
    private fun toResponsesTool(t: JsonObject): JsonObject {
        val f = t["function"] as? JsonObject ?: return t
        return buildJsonObject {
            put("type", "function")
            put("name", f["name"]?.jsonPrimitive?.content ?: "")
            put("description", f["description"]?.jsonPrimitive?.content ?: "")
            put("parameters", f["parameters"] ?: buildJsonObject { put("type", "object") })
        }
    }

    // ---------- Gemini / Anthropic ----------

    private suspend fun gemini(settings: Settings, messages: List<Msg>, tools: List<JsonObject>): AiTurn =
        withContext(Dispatchers.IO) {
            if (settings.key.isBlank()) throw AiException("Gemini: нужен API-ключ")
            val body = buildJsonObject {
                putJsonArray("contents") {
                    messages.forEach { m ->
                        val role = if (m.role == "assistant") "model" else "user"
                        add(buildJsonObject {
                            put("role", role)
                            putJsonArray("parts") {
                                add(buildJsonObject {
                                    put("text", if (m.role == "tool") "Результат инструмента: ${m.content}" else m.content)
                                })
                                if (m.role == "tool") {
                                    add(buildJsonObject {
                                        putJsonObject("functionResponse") {
                                            put("name", "tool")
                                            putJsonObject("response") { put("result", m.content) }
                                        }
                                    })
                                }
                            }
                        })
                    }
                }
                if (tools.isNotEmpty()) {
                    putJsonArray("tools") {
                        add(buildJsonObject {
                            putJsonArray("functionDeclarations") {
                                tools.forEach { t ->
                                    val f = t["function"] as? JsonObject ?: return@forEach
                                    add(buildJsonObject {
                                        put("name", f["name"]?.jsonPrimitive?.content ?: "")
                                        put("description", f["description"]?.jsonPrimitive?.content ?: "")
                                        put("parameters", f["parameters"] ?: buildJsonObject { put("type", "object") })
                                    })
                                }
                            }
                        })
                    }
                }
            }
            val call = http.newCall(
                Request.Builder()
                    .url("https://generativelanguage.googleapis.com/v1beta/models/${settings.aimodel}:generateContent?key=${settings.key}")
                    .header("Content-Type", "application/json")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
            )
            val text = execute(call)
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                ?: return@withContext AiTurn(text, "", emptyList(), "stop")
            val part = root["candidates"]?.jsonArray?.firstOrNull()?.jsonObject?.get("content")
                ?.jsonObject?.get("parts")?.jsonArray
            val sb = StringBuilder()
            val calls = ArrayList<ToolCall>()
            part?.forEach { e ->
                val o = e.jsonObject
                o["text"]?.jsonPrimitive?.content?.let { sb.append(it) }
                val fc = o["functionCall"]?.jsonObject
                if (fc != null) {
                    calls.add(
                        ToolCall(
                            id = fc["id"]?.jsonPrimitive?.content ?: "call_${calls.size}",
                            name = fc["name"]?.jsonPrimitive?.content ?: "",
                            arguments = fc["args"]?.toString() ?: "{}"
                        )
                    )
                }
            }
            AiTurn(sb.toString(), "", calls, "stop")
        }

    private suspend fun anthropic(settings: Settings, messages: List<Msg>, tools: List<JsonObject>): AiTurn =
        withContext(Dispatchers.IO) {
            if (settings.key.isBlank()) throw AiException("Anthropic: нужен API-ключ")
            val body = buildJsonObject {
                put("model", settings.aimodel)
                put("max_tokens", 4000)
                messages.filter { it.role == "system" }.forEach { put("system", it.content) }
                putJsonArray("messages") {
                    messages.filter { it.role != "system" }.forEach { m ->
                        if (m.role == "tool") {
                            add(buildJsonObject {
                                put("role", "user")
                                putJsonArray("content") {
                                    add(buildJsonObject {
                                        put("type", "tool_result")
                                        put("tool_use_id", m.toolCallId)
                                        put("content", m.content)
                                    })
                                }
                            })
                        } else if (m.role == "assistant" && m.toolCallsJson != null) {
                            add(buildJsonObject {
                                put("role", "assistant")
                                putJsonArray("content") {
                                    if (m.content.isNotBlank()) {
                                        add(buildJsonObject { put("type", "text"); put("text", m.content) })
                                    }
                                    m.toolCallsJson.forEach { tc ->
                                        val f = tc["function"] as? JsonObject
                                        add(buildJsonObject {
                                            put("type", "tool_use")
                                            put("id", tc["id"]?.jsonPrimitive?.content ?: "")
                                            put("name", f?.get("name")?.jsonPrimitive?.content ?: "")
                                            putJsonObject("input") {
                                                runCatching {
                                                    (f?.get("arguments")?.jsonPrimitive?.content
                                                        ?: "{}").let {
                                                        json.parseToJsonElement(it).jsonObject.forEach { (k, v) -> put(k, v) }
                                                    }
                                                }
                                            }
                                        })
                                    }
                                }
                            })
                        } else {
                            add(buildJsonObject { put("role", m.role); put("content", m.content) })
                        }
                    }
                }
                if (tools.isNotEmpty()) putJsonArray("tools") { tools.forEach { add(it) } }
            }
            val call = http.newCall(
                Request.Builder().url("https://api.anthropic.com/v1/messages")
                    .header("Content-Type", "application/json")
                    .header("x-api-key", settings.key)
                    .header("anthropic-version", "2023-06-01")
                    .post(body.toString().toRequestBody(JSON_MEDIA))
                    .build()
            )
            val text = execute(call)
            val root = runCatching { json.parseToJsonElement(text).jsonObject }.getOrNull()
                ?: return@withContext AiTurn(text, "", emptyList(), "stop")
            val parts = root["content"]?.jsonArray
            val sb = StringBuilder()
            val calls = ArrayList<ToolCall>()
            parts?.forEach { e ->
                val o = e.jsonObject
                when (o["type"]?.jsonPrimitive?.content) {
                    "text" -> sb.append(o["text"]?.jsonPrimitive?.content ?: "")
                    "tool_use" -> calls.add(
                        ToolCall(
                            id = o["id"]?.jsonPrimitive?.content ?: "call_${calls.size}",
                            name = o["name"]?.jsonPrimitive?.content ?: "",
                            arguments = o["input"]?.toString() ?: "{}"
                        )
                    )
                }
            }
            AiTurn(sb.toString(), "", calls, root["stop_reason"]?.jsonPrimitive?.content ?: "stop")
        }

    // ---------- выполнение с отменой ----------

    private fun execute(call: Call): String {
        activeCall.set(call)
        return try {
            call.execute().use { resp ->
                val body = resp.body?.string() ?: ""
                if (!resp.isSuccessful) {
                    throw AiException("HTTP ${resp.code}: ${body.take(200)}", resp.code)
                }
                body
            }
        } catch (e: java.io.IOException) {
            if (activeCall.get() == null) throw AgentCancelled()
            throw e
        } finally {
            activeCall.compareAndSet(call, null)
        }
    }

    // ---------- разбор SSE ----------

    class StreamFold(
        val text: StringBuilder = StringBuilder(),
        val reasoning: StringBuilder = StringBuilder(),
        val toolCalls: MutableList<ToolCall> = mutableListOf(),
        var finish: String = "stop"
    )

    fun foldChat(sse: String): AiTurn {
        val f = StreamFold()
        // ключ — индекс tool_call, чтобы склеивать фрагменты arguments
        val pending = LinkedHashMap<Int, ToolCall>()
        for (line in sse.lineSequence()) {
            val t = line.trim()
            if (!t.startsWith("data:")) continue
            val payload = t.removePrefix("data:").trim()
            if (payload.isEmpty() || payload == "[DONE]") continue
            val el = runCatching { json.parseToJsonElement(payload) }.getOrNull() as? JsonObject ?: continue
            val choice = el["choices"]?.jsonArray?.firstOrNull()?.jsonObject ?: continue
            val delta = choice["delta"] as? JsonObject
            delta?.get("content")?.jsonPrimitive?.content?.let { f.text.append(it) }
            delta?.get("reasoning_content")?.jsonPrimitive?.content?.let { f.reasoning.append(it) }
            (delta?.get("tool_calls") as? JsonArray)?.forEach { e ->
                val o = e.jsonObject
                val idx = o["index"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                val f2 = o["function"] as? JsonObject
                val prev = pending[idx]
                pending[idx] = ToolCall(
                    id = o["id"]?.jsonPrimitive?.content ?: prev?.id ?: "call_$idx",
                    name = f2?.get("name")?.jsonPrimitive?.content ?: prev?.name.orEmpty(),
                    arguments = (prev?.arguments ?: "") + (f2?.get("arguments")?.jsonPrimitive?.content ?: "")
                )
            }
            choice["finish_reason"]?.jsonPrimitive?.content?.let { f.finish = it }
        }
        f.toolCalls.addAll(pending.values)
        return AiTurn(f.text.toString(), f.reasoning.toString(), f.toolCalls, f.finish)
    }

    fun foldResponses(sse: String): AiTurn {
        val f = StreamFold()
        for (line in sse.lineSequence()) {
            val t = line.trim()
            if (!t.startsWith("data:")) continue
            val payload = t.removePrefix("data:").trim()
            if (payload.isEmpty() || payload == "[DONE]") continue
            val el = runCatching { json.parseToJsonElement(payload) }.getOrNull() as? JsonObject ?: continue
            when (el["type"]?.jsonPrimitive?.content) {
                "response.output_text.delta" -> f.text.append(el["delta"]?.jsonPrimitive?.content ?: "")
                "response.reasoning_summary_text.delta", "response.reasoning_text.delta" ->
                    f.reasoning.append(el["delta"]?.jsonPrimitive?.content ?: "")

                "response.output_item.done" -> {
                    val item = el["item"] as? JsonObject
                    if (item?.get("type")?.jsonPrimitive?.content == "function_call") {
                        f.toolCalls.add(
                            ToolCall(
                                id = item["call_id"]?.jsonPrimitive?.content ?: "call_${f.toolCalls.size}",
                                name = item["name"]?.jsonPrimitive?.content ?: "",
                                arguments = item["arguments"]?.jsonPrimitive?.content ?: "{}"
                            )
                        )
                    }
                }

                "response.completed" -> f.finish = "stop"
            }
        }
        return AiTurn(f.text.toString(), f.reasoning.toString(), f.toolCalls, f.finish)
    }
}

/** Сообщение чата с необязательными tool_calls (для цикла агента). */
data class Msg(
    val role: String,
    val content: String,
    val toolCallId: String = "",
    val toolCallsJson: List<JsonObject>? = null
) {
    constructor(role: String, content: String) : this(role, content, "", null)
}
