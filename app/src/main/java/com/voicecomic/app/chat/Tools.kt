package com.voicecomic.app.chat

import android.content.Context
import com.voicecomic.app.ai.AiClient
import com.voicecomic.app.ai.Msg
import com.voicecomic.app.ai.ToolCall
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/** Событие агентного цикла — на него подписан UI. */
sealed class AgentEvent {
    data class Reasoning(val text: String) : AgentEvent()
    data class Text(val text: String) : AgentEvent()
    data class ToolStart(val name: String, val args: String) : AgentEvent()
    data class ToolDone(val name: String, val summary: String) : AgentEvent()
    data class ToolError(val name: String, val message: String) : AgentEvent()
    data class Done(val text: String) : AgentEvent()
    data class Failed(val message: String) : AgentEvent()
}

/** Локальные инструменты агента: всё, что opencode умеет делать клиентскими тулами. */
class Tools(
    private val context: Context,
    private val ws: Workspace,
    private val http: OkHttpClient
) {

    companion object {
        private val json = Json { ignoreUnknownKeys = true; isLenient = true }
        const val BASH_TIMEOUT_MS = 20_000

        /** Официальные opencode-тулы, которые мы умеем исполнить локально. */
        val SUPPORTED = setOf(
            "read", "write", "edit", "glob", "grep", "bash", "webfetch", "websearch", "todowrite", "skill", "list"
        )
    }

    fun specs(): List<JsonObject> {
        val all = AiClient.builtinTools
        if (all.isEmpty()) return emptyList()
        return all.mapNotNull { e ->
            val o = e as? JsonObject ?: return@mapNotNull null
            val name = o["function"]?.jsonObject?.get("name")?.jsonPrimitive?.content ?: return@mapNotNull null
            if (name !in SUPPORTED) return@mapNotNull null
            o
        }
    }

    suspend fun run(call: ToolCall): String = withContext(Dispatchers.IO) {
        runCatching {
            when (call.name) {
                "read" -> ws.read(
                    call.arg("filePath") ?: return@runCatching "нужен filePath",
                    call.argInt("offset", 0).let { if (it > 0) it - 1 else 0 },
                    call.argInt("limit", 0)
                )

                "write" -> ws.write(
                    call.arg("filePath") ?: return@runCatching "нужен filePath",
                    call.arg("content") ?: ""
                )

                "edit" -> ws.edit(
                    call.arg("filePath") ?: return@runCatching "нужен filePath",
                    call.arg("oldString") ?: return@runCatching "нужен oldString",
                    call.arg("newString") ?: return@runCatching "нужен newString",
                    call.arg("replaceAll") == "true" || call.arg("replaceAll") == "true"
                )

                "glob" -> ws.glob(call.arg("pattern") ?: "**/*", call.arg("path"))
                    .joinToString("\n").ifEmpty { "ничего не найдено" }

                "grep" -> ws.grep(call.arg("pattern") ?: "", call.arg("path"), call.arg("include"))
                    .joinToString("\n")

                "list" -> ws.files().joinToString("\n") { it.relativeTo(ws.root).path }
                    .ifEmpty { "workspace пуст" }

                "bash" -> bash(call.arg("command") ?: return@runCatching "нужна команда")

                "webfetch" -> webfetch(call.arg("url") ?: return@runCatching "нужен url", call.arg("format") ?: "text")

                "websearch" -> websearch(call.arg("query") ?: return@runCatching "нужен query")

                "todowrite" -> call.arg("todos") ?: "[]"

                "skill" -> skill(call.arg("name") ?: return@runCatching "нужен name")

                else -> "инструмент ${call.name} не поддерживается на устройстве"
            }
        }.getOrElse { "ошибка инструмента: ${it.message}" }
    }

    /** На Android нет bash, но есть /system/bin/sh и toybox — этого хватает на бытовые команды. */
    private fun bash(command: String): String {
        val proc = runCatching {
            ProcessBuilder("sh", "-c", command)
                .directory(ws.root)
                .redirectErrorStream(true)
                .start()
        }.getOrElse { return "не удалось запустить sh: ${it.message}" }
        val out = StringBuilder()
        val reader = Thread {
            runCatching {
                proc.inputStream.bufferedReader().forEachLine { out.appendLine(it) }
            }
        }
        reader.isDaemon = true
        reader.start()
        val finished = proc.waitFor(BASH_TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS)
        if (!finished) {
            proc.destroy()
            return "команда не уложилась в ${BASH_TIMEOUT_MS / 1000} c и была остановлена\n${out.toString().take(4000)}"
        }
        reader.join(500)
        return out.toString().take(8000).ifEmpty { "(пустой вывод, код ${proc.exitValue()})" }
    }

    private fun webfetch(url: String, format: String): String {
        val norm = if (url.startsWith("http")) url else "https://$url"
        val req = Request.Builder().url(norm).header("User-Agent", "VoiceComic/2.0").build()
        val body = http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return "HTTP ${resp.code} ${resp.message}"
            resp.body?.string().orEmpty()
        }
        return if (format == "html" || format == "text") body.take(20000) else body.take(20000)
    }

    /** Поиск через DuckDuckGo без ключа: html и разбираем ссылки. */
    private fun websearch(query: String): String {
        val q = java.net.URLEncoder.encode(query, "UTF-8")
        val req = Request.Builder()
            .url("https://html.duckduckgo.com/html/?q=$q")
            .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) Chrome/143.0.0.0 Mobile Safari/537.36")
            .build()
        val html = http.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) return "HTTP ${resp.code}"
            resp.body?.string().orEmpty()
        }
        val results = Regex("(?s)result__a[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>")
            .findAll(html)
            .take(8)
            .map { m ->
                val href = m.groupValues[1].replace("&amp;", "&")
                val title = m.groupValues[2].replace(Regex("<[^>]+>"), "").trim()
                "$title — $href"
            }
            .toList()
        return results.joinToString("\n").ifEmpty { "ничего не нашлось" }
    }

    /** Навыки — markdown-подсказки из assets/skills, отдаём по запросу модели. */
    private fun skill(name: String): String {
        // android.jar не умеет File(AssetManager, String) — читаем потоком
        val text = runCatching {
            context.assets.open("skills/$name.md").bufferedReader().use { it.readText() }
        }.getOrNull()
        if (text != null) return text.take(20000)
        val dir = runCatching {
            context.assets.list("skills")?.map { it.removeSuffix(".md") } ?: emptyList()
        }.getOrDefault(emptyList())
        return "нет навыка «$name». Доступные: ${dir.joinToString(", ")}"
    }
}
