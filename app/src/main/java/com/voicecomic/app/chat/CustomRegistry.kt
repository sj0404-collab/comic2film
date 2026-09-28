package com.voicecomic.app.chat

import android.content.Context
import com.voicecomic.app.ai.ToolCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.concurrent.TimeUnit

@Serializable
data class ToolParam(val name: String, val description: String = "", val required: Boolean = true)

/**
 * Свой инструмент пользователя. Два вида:
 *  - http: запрос к API (GitHub, свой сервер, раннер) с подстановкой параметров в url/headers/body;
 *  - shell: команда через sh в папке workspace.
 * Схема параметров уходит модели как function-calling, поэтому она их и заполняет.
 */
@Serializable
data class CustomTool(
    val id: String,
    val name: String,
    val description: String,
    val kind: String = "http", // http | shell
    val params: List<ToolParam> = emptyList(),
    val method: String = "GET",
    val url: String = "",
    val headers: Map<String, String> = emptyMap(),
    val body: String = "",
    val command: String = "",
    val timeoutMs: Int = 30000,
    val resultLimit: Int = 8000
) {
    fun schema(): JsonObject = buildJsonObject {
        put("type", "function")
        putJsonObject("function") {
            put("name", name)
            put("description", description.ifEmpty { "пользовательский инструмент $name" })
            putJsonObject("parameters") {
                put("type", "object")
                putJsonArray("properties") {
                    params.forEach { p ->
                        add(buildJsonObject {
                            putJsonObject(p.name) {
                                put("type", "string")
                                put("description", p.description)
                            }
                        })
                    }
                }
                putJsonArray("required") {
                    params.filter { it.required }.forEach { add(kotlinx.serialization.json.JsonPrimitive(it.name)) }
                }
            }
        }
    }
}

/** Хранилище пользовательских инструментов и навыков. */
class CustomRegistry(
    context: Context,
    private val ws: Workspace
) {
    private val app = context.applicationContext
    private val json = Json { prettyPrint = true; ignoreUnknownKeys = true; encodeDefaults = true }
    private val file = File(app.filesDir, "custom-tools.json")

    fun tools(): List<CustomTool> = runCatching {
        if (!file.exists()) emptyList() else json.decodeFromString(
            kotlinx.serialization.builtins.ListSerializer(CustomTool.serializer()),
            file.readText()
        )
    }.getOrDefault(emptyList())

    fun save(tools: List<CustomTool>) {
        file.writeText(json.encodeToString(kotlinx.serialization.builtins.ListSerializer(CustomTool.serializer()), tools))
    }

    fun upsert(tool: CustomTool) {
        val list = tools().filterNot { it.id == tool.id || it.name == tool.name }
        save(list + tool)
    }

    fun delete(id: String) = save(tools().filterNot { it.id == id })

    fun find(name: String): CustomTool? = tools().firstOrNull { it.name == name }

    fun workspaceRoot(): File = ws.root

    // ---------- навыки пользователя ----------

    fun userSkills(): List<String> = ws.skillsDir().listFiles()
        ?.filter { it.isFile && it.name.endsWith(".md") }
        ?.map { it.name.removeSuffix(".md") }
        ?.sorted()
        ?: emptyList()

    fun addSkill(name: String, content: String): String = runCatching {
        // кириллицу в именах навыков режем нельзя — оставляем буквы любых алфавитов
        val clean = name.replace(Regex("[^\\p{L}\\p{N}_-]"), "_").trim('_').ifEmpty { "skill" }
        val dir = ws.skillsDir()
        dir.mkdirs() // без этого File.writeText падает: папки после clear() может не быть
        File(dir, "$clean.md").writeText(content)
        "навык $clean сохранён"
    }.getOrElse { "не сохранился: ${it.message}" }

    fun deleteSkill(name: String): Boolean =
        File(ws.skillsDir(), "$name.md").delete()

    fun readUserSkill(name: String): String? =
        File(ws.skillsDir(), "$name.md").takeIf { it.exists() }?.readText()
}

/** Исполнитель пользовательских инструментов. */
class CustomRunner(
    private val registry: CustomRegistry,
    private val http: OkHttpClient
) {

    suspend fun run(call: ToolCall): String = withContext(Dispatchers.IO) {
        val tool = registry.find(call.name) ?: return@withContext "инструмент ${call.name} не найден"
        val args = tool.params.associate { p -> p.name to (call.arg(p.name) ?: "") }
        val missing = tool.params.filter { it.required && args[it.name].isNullOrBlank() }
        if (missing.isNotEmpty()) {
            return@withContext "не хватает параметров: ${missing.joinToString(", ") { it.name }}"
        }
        when (tool.kind) {
            "shell" -> runShell(tool, args)
            "http" -> runHttp(tool, args)
            else -> "неизвестный вид инструмента: ${tool.kind}"
        }
    }

    private fun fill(text: String, args: Map<String, String>): String {
        var out = text
        args.forEach { (k, v) -> out = out.replace("{{$k}}", v) }
        return out
    }

    private fun runShell(tool: CustomTool, args: Map<String, String>): String {
        val cmd = fill(tool.command, args)
        if (cmd.isBlank()) return "пустая команда"
        val proc = runCatching {
            ProcessBuilder("sh", "-c", cmd)
                .directory(wsRoot(registry))
                .redirectErrorStream(true)
                .start()
        }.getOrElse { return "не удалось запустить sh: ${it.message}" }
        val out = StringBuilder()
        val reader = Thread {
            runCatching { proc.inputStream.bufferedReader().forEachLine { out.appendLine(it) } }
        }
        reader.isDaemon = true
        reader.start()
        val ok = proc.waitFor(tool.timeoutMs.toLong().coerceIn(1000, 120_000), TimeUnit.MILLISECONDS)
        if (!ok) {
            proc.destroy()
            return "не уложилась в ${tool.timeoutMs} мс и была остановлена\n${out.toString().take(2000)}"
        }
        reader.join(400)
        return out.toString().take(tool.resultLimit).ifEmpty { "(пусто, код ${proc.exitValue()})" }
    }

    private fun wsRoot(registry: CustomRegistry): File = registry.workspaceRoot()

    private fun runHttp(tool: CustomTool, args: Map<String, String>): String {
        val url = fill(tool.url.trim(), args)
        if (url.isEmpty()) return "пустой url"
        if (!url.startsWith("http")) return "url должен начинаться с http: $url"
        val body = fill(tool.body, args)
        val req = Request.Builder().url(url)
        tool.headers.forEach { (k, v) -> req.header(k, fill(v, args)) }
        val method = tool.method.uppercase()
        val built = when {
            body.isNotBlank() -> req.method(method, body.toRequestBody("application/json".toMediaType()))
            method == "GET" || method == "HEAD" -> req.method(method, null)
            else -> req.method(method, "".toRequestBody(null))
        }
        return runCatching {
            http.newCall(built.build()).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                val head = "HTTP ${resp.code} ${resp.message}\n"
                (head + text).take(tool.resultLimit)
            }
        }.getOrElse { "ошибка запроса: ${it.message}" }
    }
}
