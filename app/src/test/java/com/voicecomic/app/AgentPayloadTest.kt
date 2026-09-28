package com.voicecomic.app

import com.voicecomic.app.ai.AgentClient
import com.voicecomic.app.ai.AiClient
import com.voicecomic.app.ai.Msg
import com.voicecomic.app.data.Settings
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import okhttp3.OkHttpClient
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Три бага, найденных при переносе веб-правок в натив (2.0.3):
 * вложенные картинки не доходили до модели, картинки дублировались на
 * каждый ход истории, а цикл инструментов для Responses-моделей терял
 * связь вызов↔результат.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class AgentPayloadTest {

    private val IMG = "data:image/png;base64,iVBORw0KGgo="

    private fun settings() = Settings(ai = "openai", aimodel = "gpt-4o-mini", key = "k")

    private fun ai() = AiClient(OkHttpClient())

    private fun call(id: String, name: String, args: String) = buildJsonObject {
        put("id", id)
        put("type", "function")
        putJsonObject("function") {
            put("name", name)
            put("arguments", args)
        }
    }

    // ---------- 1. вложения доходят до модели ----------

    /**
     * Раньше Agent.run принимал images, подменял ею текст и ни разу не
     * передавал в client.turn — у всех четырёх провайдеров вложение исчезало.
     */
    @Test
    fun imagesSurviveIntoEveryProvider() {
        val msgs = listOf(Msg("system", "система"), Msg("user", "что на картинке?"))

        val responses = AgentClient.responsesInput(msgs, listOf(IMG))
        assertEquals(1, responses.inputImage())

        val gemini = AgentClient.geminiContents(msgs, listOf(IMG))
        assertEquals(1, gemini.inlineData())

        val anthropic = AgentClient.anthropicMessages(msgs, listOf(IMG))
        assertEquals(1, anthropic.imageBlock())

        val openAi = ai().buildOpenAiBody(settings(), msgs, false, listOf(IMG), false)
        assertEquals(1, openAi.imageUrl())
    }

    @Test
    fun imagesWithoutAttachmentsKeepPlainTextContent() {
        val msgs = listOf(Msg("user", "привет"))
        assertEquals(0, AgentClient.responsesInput(msgs, emptyList()).inputImage())
        val first = (ai().buildOpenAiBody(settings(), msgs, false, emptyList(), false)["messages"] as JsonArray)
            .jsonArray[0].jsonObject
        // без вложений ход остаётся строкой, а не content-массивом:
        // провайдеры по-разному относятся к лишней обёртке
        assertTrue(first["content"] is JsonPrimitive)
        assertEquals("привет", (first["content"] as JsonPrimitive).content)
    }

    // ---------- 2. картинка прикреплена к своему ходу, а не к каждому ----------

    @Test
    fun openAiAttachesImageToLastUserTurnOnly() {
        val msgs = listOf(
            Msg("user", "первый вопрос"),
            Msg("assistant", "первый ответ"),
            Msg("user", "а это что?"),
            Msg("assistant", ""),
            Msg("user", "и картинка")
        )
        val messages = (ai().buildOpenAiBody(settings(), msgs, false, listOf(IMG), false)["messages"] as JsonArray).jsonArray
        val users = messages.map { it.jsonObject }.filter { it["role"]!!.jsonPrimitive.content == "user" }

        // три хода пользователя — картинка одна, в последнем
        assertEquals(3, users.size)
        assertEquals(0, users[0].imageUrl())
        assertEquals(0, users[1].imageUrl())
        assertEquals(1, users[2].imageUrl())
        // предыдущие ходы остались текстом, а не превратились в content-массивы
        assertTrue(messages[0].jsonObject["content"] is kotlinx.serialization.json.JsonPrimitive)
    }

    @Test
    fun responsesAndGeminiAttachImageToLastUserTurnOnly() {
        val msgs = listOf(
            Msg("user", "первый вопрос"),
            Msg("assistant", "ответ"),
            Msg("user", "и картинка")
        )
        assertEquals(1, AgentClient.responsesInput(msgs, listOf(IMG)).inputImage())
        assertEquals(1, AgentClient.geminiContents(msgs, listOf(IMG)).inlineData())
        assertEquals(1, AgentClient.anthropicMessages(msgs, listOf(IMG)).imageBlock())
    }

    @Test
    fun severalImagesAllLandOnTheLastTurn() {
        val msgs = listOf(Msg("user", "что там?"), Msg("assistant", "ок"), Msg("user", "и ещё"))
        val imgs = listOf(IMG, "data:image/jpeg;base64,/9j/4AAQ")
        val messages = (ai().buildOpenAiBody(settings(), msgs, false, imgs, false)["messages"] as JsonArray).jsonArray
        assertEquals(2, messages.jsonArray.last().jsonObject.imageUrl())
        assertEquals(0, messages.jsonArray.first().jsonObject.imageUrl())
    }

    // ---------- 3. цикл инструментов для Responses ----------

    /**
     * Ключевой регресс: раньше и вызов, и результат уходили в input как
     * user-текст, а tool_calls ассистентского хода выбрасывались. Модель не
     * видела, что инструмент вызывался, и повторяла вызов.
     */
    @Test
    fun responsesEmitsFunctionCallAndOutputItems() {
        val msgs = listOf(
            Msg("user", "список файлов"),
            Msg("assistant", "", "", listOf(call("call_a", "ls", """{"path":"/tmp"}"""))),
            Msg("tool", "a.txt\nb.txt", "call_a")
        )
        val input = AgentClient.responsesInput(msgs)
        val items = input.jsonArray.map { it.jsonObject }

        val fnCall = items.first { it["type"]!!.jsonPrimitive.content == "function_call" }
        assertEquals("call_a", fnCall["call_id"]!!.jsonPrimitive.content)
        assertEquals("ls", fnCall["name"]!!.jsonPrimitive.content)
        assertEquals("""{"path":"/tmp"}""", fnCall["arguments"]!!.jsonPrimitive.content)

        val fnOut = items.first { it["type"]!!.jsonPrimitive.content == "function_call_output" }
        assertEquals("call_a", fnOut["call_id"]!!.jsonPrimitive.content)
        assertEquals("a.txt\nb.txt", fnOut["output"]!!.jsonPrimitive.content)

        // главное: в input больше нет прозаического user-текста про инструмент
        val texts = items.filter { it["type"]!!.jsonPrimitive.content == "message" }
            .flatMap { (it["content"] as JsonArray).jsonArray }
            .map { it.jsonObject["text"]!!.jsonPrimitive.content }
        assertTrue("результат инструмента не должен приходить как реплика пользователя",
            texts.none { it.contains("Результат инструмента") })
    }

    @Test
    fun severalToolCallsInOneTurnAllSurvive() {
        val calls = listOf(call("call_1", "read", """{"filePath":"a.md"}"""), call("call_2", "read", """{"filePath":"b.md"}"""))
        val msgs = listOf(
            Msg("user", "прочитай оба"),
            Msg("assistant", "читаю", "", calls),
            Msg("tool", "A", "call_1"),
            Msg("tool", "B", "call_2")
        )
        val items = AgentClient.responsesInput(msgs).jsonArray.map { it.jsonObject }

        assertEquals(2, items.count { it["type"]!!.jsonPrimitive.content == "function_call" })
        assertEquals(2, items.count { it["type"]!!.jsonPrimitive.content == "function_call_output" })
        // вызовы идут подряд, до результатов — так ждёт Responses
        assertEquals("function_call", items[1]["type"]!!.jsonPrimitive.content)
        assertEquals("function_call", items[2]["type"]!!.jsonPrimitive.content)
        assertEquals(listOf("A", "B"), items.drop(3).map { it["output"]!!.jsonPrimitive.content })
    }

    @Test
    fun assistantReasoningTextIsKeptAlongsideToolCalls() {
        val msgs = listOf(
            Msg("user", "что делать?"),
            Msg("assistant", "сейчас посмотрю", "", listOf(call("call_a", "read", """{"filePath":"a.md"}"""))),
            Msg("tool", "текст файла", "call_a")
        )
        val items = AgentClient.responsesInput(msgs).jsonArray.map { it.jsonObject }
        val message = items.first { it["type"]!!.jsonPrimitive.content == "message" && it["role"]!!.jsonPrimitive.content == "assistant" }
        val part = (message["content"] as JsonArray).jsonArray[0].jsonObject
        assertEquals("output_text", part["type"]!!.jsonPrimitive.content)
        assertEquals("сейчас посмотрю", part["text"]!!.jsonPrimitive.content)
    }

    /** Без текста ассистентский message-item не добавляется — пустой content ломает API. */
    @Test
    fun blankAssistantTextProducesNoEmptyMessageItem() {
        val msgs = listOf(
            Msg("user", "список"),
            Msg("assistant", "", "", listOf(call("call_a", "ls", "{}"))),
            Msg("tool", "ok", "call_a")
        )
        val items = AgentClient.responsesInput(msgs).jsonArray.map { it.jsonObject }
        assertTrue(items.none { it["type"]!!.jsonPrimitive.content == "message" && it["role"]!!.jsonPrimitive.content == "assistant" })
        assertEquals(1, items.count { it["type"]!!.jsonPrimitive.content == "function_call" })
    }

    /** function_call принимается и в плоском виде — обёртка не обязательна. */
    @Test
    fun flatFunctionCallShapeIsAccepted() {
        val flat = buildJsonObject {
            put("type", "function_call")
            put("call_id", "call_z")
            put("name", "bash")
            put("arguments", """{"command":"ls"}""")
        }
        val msgs = listOf(Msg("user", "выполни"), Msg("assistant", "", "", listOf(flat)), Msg("tool", "ok", "call_z"))
        val item = AgentClient.responsesInput(msgs).jsonArray.map { it.jsonObject }
            .first { it["type"]!!.jsonPrimitive.content == "function_call" }
        assertEquals("call_z", item["call_id"]!!.jsonPrimitive.content)
        assertEquals("bash", item["name"]!!.jsonPrimitive.content)
        assertEquals("""{"command":"ls"}""", item["arguments"]!!.jsonPrimitive.content)
    }

    // ---------- счётчики по типам частей ----------

    /**
     * Рекурсивный подсчёт частей: структура разная у всех пяти сборщиков
     * (input-item с content, messages с content, contents с parts), а
     * проверять надо одно и то же — «сколько картинок ушло в запрос».
     */
    private fun countParts(el: JsonElement?, pred: (JsonObject) -> Boolean): Int = when (el) {
        null, is JsonNull, is JsonPrimitive -> 0
        is JsonArray -> el.sumOf { countParts(it, pred) }
        is JsonObject -> (if (pred(el)) 1 else 0) +
            KEYS.sumOf { k -> countParts(el[k], pred) }
    }

    private fun JsonArray.inputImage() = countParts(this) { it["type"]?.jsonPrimitive?.content == "input_image" }
    private fun JsonArray.imageBlock() = countParts(this) { it["type"]?.jsonPrimitive?.content == "image" }
    private fun JsonArray.inlineData() = countParts(this) { it.containsKey("inline_data") }
    private fun JsonObject.imageUrl() = countParts(this) { it["type"]?.jsonPrimitive?.content == "image_url" }

    private companion object {
        val KEYS = listOf("content", "parts", "messages", "input", "contents")
    }
}
