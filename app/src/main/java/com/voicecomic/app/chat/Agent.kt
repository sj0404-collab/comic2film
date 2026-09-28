package com.voicecomic.app.chat

import com.voicecomic.app.ai.AgentClient
import com.voicecomic.app.ai.AiTurn
import com.voicecomic.app.ai.AgentCancelled
import com.voicecomic.app.ai.Msg
import com.voicecomic.app.ai.Prompts
import com.voicecomic.app.data.Settings
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Агентный цикл чата: модель получает локальные инструменты, мы их выполняем
 * и отдаём результат обратно. Ограничение по шагам, остановка по кнопке «Стоп».
 */
class Agent(
    private val settingsProvider: () -> Settings,
    private val client: AgentClient,
    private val tools: Tools,
    private val http: OkHttpClient
) {

    companion object {
        const val MAX_STEPS = 8
        val SYSTEM_EXTRA = """
Ты — агент внутри приложения VoiceComic (комиксы → озвученное видео). Отвечай по-русски, коротко и по делу.

У тебя есть локальные инструменты: read, write, edit, glob, grep, list, bash (через sh, cwd = workspace),
webfetch, websearch, todowrite, skill. Всё, что ты создаёшь инструментами write/edit, попадает в папку
workspace — её видит пользователь во вкладке «Workspace».

Правила:
- пользователь может присылать изображения и файлы: изображения разбирай как страницы манги/комикса,
  текстовые файлы прочитывай и комментируй;
- не выдумывай содержимое файлов: чтобы узнать, что в проекте, вызови list или read;
- прежде чем отвечать «готово» по задаче с файлами, проверь результат через read;
- если инструмент не нужен — просто отвечай текстом.
""".trimIndent()
    }

    private val stopped = AtomicBoolean(false)

    fun stop() {
        stopped.set(true)
        AgentClient.stop()
    }

    /**
     * @param history предыдущие ходы (роль/контент), последний — новое сообщение пользователя.
     * @param on событие для UI.
     */
    suspend fun run(
        settings: Settings,
        history: List<Msg>,
        userText: String,
        images: List<String> = emptyList(),
        on: (AgentEvent) -> Unit
    ) {
        stopped.set(false)
        val json = Json { ignoreUnknownKeys = true; isLenient = true }
        val msgs = ArrayList<Msg>()
        msgs.add(Msg("system", Prompts.CHAT_SYSTEM + "\n\n" + SYSTEM_EXTRA))
        msgs.addAll(history.takeLast(12))
        // картинки уходят отдельным сообщением — так же, как в старой версии
        if (images.isNotEmpty()) {
            msgs.add(Msg("user", userText.ifBlank { "Посмотри на картинку." }))
        } else {
            msgs.add(Msg("user", userText))
        }

        val specs = tools.specs()
        var lastText = ""
        try {
            for (step in 0 until MAX_STEPS) {
                if (stopped.get()) {
                    on(AgentEvent.Failed("Остановлено"))
                    return
                }
                val turn: AiTurn = if (step == 0 && images.isNotEmpty()) {
                    // первый ход с картинками идёт через обычный канал (vision), но с инструментами
                    client.turn(settings, msgs, specs)
                } else {
                    client.turn(settings, msgs, specs)
                }
                if (turn.reasoning.isNotBlank()) on(AgentEvent.Reasoning(turn.reasoning))
                if (turn.text.isNotBlank()) {
                    on(AgentEvent.Text(turn.text))
                    lastText = turn.text
                }

                if (turn.toolCalls.isEmpty()) {
                    if (turn.text.isBlank()) {
                        // модель промолчала: одна попытка с явной просьбой ответить
                        val retry = client.turn(
                            settings,
                            msgs + Msg("user", "Ты ничего не ответил. Ответь текстом по существу."),
                            specs
                        )
                        if (retry.text.isBlank()) {
                            on(AgentEvent.Failed("модель вернула пустой ответ"))
                            return
                        }
                        on(AgentEvent.Reasoning(retry.reasoning))
                        on(AgentEvent.Text(retry.text))
                        lastText = retry.text
                    }
                    on(AgentEvent.Done(lastText))
                    return
                }

                // выполняем инструменты и возвращаем результаты
                val callsJson = turn.toolCalls.map { tc ->
                    buildJsonObject {
                        put("id", tc.id)
                        put("type", "function")
                        putJsonObject("function") {
                            put("name", tc.name)
                            put("arguments", tc.arguments)
                        }
                    }
                }
                msgs.add(Msg("assistant", turn.text, "", callsJson))
                for (tc in turn.toolCalls) {
                    on(AgentEvent.ToolStart(tc.name, tc.arguments.take(200)))
                    val res = tools.run(tc)
                    val brief = res.take(4000)
                    msgs.add(Msg("tool", brief, tc.id))
                    if (res.startsWith("ошибка") || res.startsWith("не удалось")) {
                        on(AgentEvent.ToolError(tc.name, brief.take(200)))
                    } else {
                        on(AgentEvent.ToolDone(tc.name, brief.take(200).replace('\n', ' ')))
                    }
                }
            }
            on(AgentEvent.Done(lastText.ifBlank { "Сделано шагов: $MAX_STEPS" }))
        } catch (e: AgentCancelled) {
            on(AgentEvent.Failed("Остановлено"))
        } catch (e: Throwable) {
            on(AgentEvent.Failed(e.message ?: e.toString()))
        }
    }
}
