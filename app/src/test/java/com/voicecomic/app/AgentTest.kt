package com.voicecomic.app

import com.voicecomic.app.ai.AgentClient
import com.voicecomic.app.ai.AiClient
import com.voicecomic.app.chat.MimeSniff
import com.voicecomic.app.chat.Tools
import com.voicecomic.app.chat.Workspace
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AgentTest {

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; isLenient = true }
    private fun client() = AgentClient(OkHttpClient.Builder().build())

    // ---------- разбор SSE с инструментами и размышлениями ----------

    @Test
    fun foldsContentReasoningAndToolCalls() {
        val sse = """
            data: {"choices":[{"delta":{"reasoning_content":"Думаю, что надо записать файл"},"finish_reason":null}]}

            data: {"choices":[{"delta":{"content":"Сейчас создам "},"finish_reason":null}]}

            data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","type":"function","function":{"name":"write","arguments":"{\"filePath\":"}}]},"finish_reason":null}]}

            data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"a.md\",\"content\":\"привет\"}"}}]},"finish_reason":null}]}

            data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}

            data: [DONE]
        """.trimIndent()
        val turn = client().foldChat(sse)
        assertEquals("Сейчас создам ", turn.text)
        assertEquals("Думаю, что надо записать файл", turn.reasoning)
        assertEquals(1, turn.toolCalls.size)
        val call = turn.toolCalls[0]
        assertEquals("call_a", call.id)
        assertEquals("write", call.name)
        // фрагменты arguments должны склеиться
        assertEquals("a.md", call.arg("filePath"))
        assertEquals("привет", call.arg("content"))
        assertEquals("tool_calls", turn.finishReason)
    }

    @Test
    fun foldsResponsesFunctionCall() {
        val sse = """
            data: {"type":"response.output_text.delta","delta":"ок"}
            data: {"type":"response.output_item.done","item":{"type":"function_call","call_id":"call_x","name":"read","arguments":"{\"filePath\":\"x.txt\"}"}}
            data: {"type":"response.completed","response":{"status":"completed"}}
        """.trimIndent()
        val turn = client().foldResponses(sse)
        assertEquals("ок", turn.text)
        assertEquals(1, turn.toolCalls.size)
        assertEquals("read", turn.toolCalls[0].name)
        assertEquals("x.txt", turn.toolCalls[0].arg("filePath"))
    }

    @Test
    fun emptyStreamIsDetected() {
        val turn = client().foldChat("data: [DONE]\n")
        assertTrue(turn.isEmpty)
    }

    @Test
    fun toolArgumentParsing() {
        val call = com.voicecomic.app.ai.ToolCall("id", "bash", """{"command":"ls -la","timeout":30}""")
        assertEquals("ls -la", call.arg("command"))
        assertEquals(30, call.argInt("timeout"))
        assertEquals(7, call.argInt("нет такого", 7))
    }

    // ---------- workspace и инструменты ----------

    @Test
    fun workspaceWriteReadEdit() {
        val ws = Workspace(RuntimeEnvironment.getApplication())
        ws.clear()
        assertTrue(ws.write("notes.md", "привет\nмир").startsWith("записано"))
        assertEquals("привет\nмир", ws.read("notes.md"))
        assertTrue(ws.edit("notes.md", "мир", "планета", false).contains("заменено"))
        assertEquals("привет\nпланета", ws.read("notes.md"))
    }

    @Test
    fun workspaceBlocksPathTraversal() {
        val ws = Workspace(RuntimeEnvironment.getApplication())
        assertEquals("путь за пределами workspace: ../secret", ws.write("../secret", "x"))
        assertEquals("путь за пределами workspace: a/../../b", ws.read("a/../../b"))
        // абсолютный путь не должен читать настоящий файл системы
        val abs = ws.read("/etc/passwd")
        assertTrue("прочитан системный файл: $abs", !abs.contains("root:") && abs.length < 200)
        assertTrue("файл вне workspace создан", !File(ws.root.parentFile, "secret").exists())
    }

    @Test
    fun workspaceGlobAndGrep() {
        val ws = Workspace(RuntimeEnvironment.getApplication())
        ws.clear()
        ws.write("src/app.kt", "fun main() { println(\"привет\") }")
        ws.write("src/util.kt", "val x = 1")
        ws.write("readme.md", "# проект")
        val files = ws.glob("**/*.kt", null)
        assertEquals(2, files.size)
        val hits = ws.grep("привет", null, null)
        assertTrue(hits.any { it.startsWith("src/app.kt") })
        assertTrue(ws.grep("нетакого", null, null).isNotEmpty())
    }

    @Test
    fun toolsExecuteReadWriteGrepList() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val ws = Workspace(app)
        ws.clear()
        val tools = Tools(app, ws, OkHttpClient())
        assertTrue(tools.run(com.voicecomic.app.ai.ToolCall("1", "write", """{"filePath":"a/b.txt","content":"данные"}""")).startsWith("записано"))
        assertEquals("данные", tools.run(com.voicecomic.app.ai.ToolCall("2", "read", """{"filePath":"a/b.txt"}""")))
        assertTrue(tools.run(com.voicecomic.app.ai.ToolCall("3", "list", "{}")).contains("a/b.txt"))
        assertTrue(tools.run(com.voicecomic.app.ai.ToolCall("4", "grep", """{"pattern":"данные"}""")).contains("a/b.txt"))
        assertTrue(tools.run(com.voicecomic.app.ai.ToolCall("5", "edit", """{"filePath":"a/b.txt","oldString":"данные","newString":"цифры"}""")).contains("заменено"))
    }

    @Test
    fun bashToolRunsThroughSh() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val ws = Workspace(app)
        ws.clear()
        val tools = Tools(app, ws, OkHttpClient())
        val out = tools.run(com.voicecomic.app.ai.ToolCall("1", "bash", """{"command":"echo привет-тест > f.txt && cat f.txt"}"""))
        assertTrue("вывод: $out", out.contains("привет-тест"))
        assertTrue(ws.read("f.txt").contains("привет-тест"))
    }

    @Test
    fun unsupportedToolIsReported() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val tools = Tools(app, Workspace(app), OkHttpClient())
        val out = tools.run(com.voicecomic.app.ai.ToolCall("1", "telepathy", "{}"))
        assertTrue(out.contains("не поддерживается"))
    }

    @Test
    fun toolSpecsAreSubsetOfOfficial() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val tools = Tools(app, Workspace(app), OkHttpClient())
        val specs = tools.specs()
        // без сети ассет может быть не загружен — проверяем только когда он есть
        if (AiClient.builtinTools.isNotEmpty()) {
            assertTrue(specs.isNotEmpty())
            val names = specs.map { it.toString() }
            assertTrue(names.any { it.contains("\"write\"") })
            assertTrue(specs.all { it.toString().contains("function") })
        }
    }

    // ---------- определение типа файла для вложений ----------

    @Test
    fun sniffsImagesAndText() {
        val png = byteArrayOf(0x89.toByte(), 'P'.code.toByte(), 'N'.code.toByte(), 'G'.code.toByte(), 0x0D, 0x0A, 0x1A, 0x0A, 0, 0)
        assertEquals("image", MimeSniff.kind(png))
        assertEquals("image/png", MimeSniff.imageMime(png))
        val jpg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte(), 0, 0, 0, 0)
        assertEquals("image", MimeSniff.kind(jpg))
        assertEquals("image/jpeg", MimeSniff.imageMime(jpg))
        val txt = "привет, это текст".toByteArray()
        assertEquals("text", MimeSniff.kind(txt))
        val bin = byteArrayOf(0, 1, 2, 3, 0, 9, 0, 9)
        assertEquals("binary", MimeSniff.kind(bin))
        assertEquals("text", MimeSniff.kind("json {\"a\":1}".toByteArray()))
    }

    @Test
    fun zeroModelTextIsNotEmpty() {
        // пустой ответ не должен попадать в чат: isEmpty это ловит
        val turn = client().foldChat("data: {\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"stop\"}]}")
        assertTrue(turn.isEmpty)
    }
}
