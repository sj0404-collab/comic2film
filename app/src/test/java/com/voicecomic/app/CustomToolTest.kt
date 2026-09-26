package com.voicecomic.app

import com.voicecomic.app.ai.ToolCall
import com.voicecomic.app.chat.CustomRunner
import com.voicecomic.app.chat.CustomRegistry
import com.voicecomic.app.chat.CustomTool
import com.voicecomic.app.chat.ToolParam
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CustomToolTest {

    private fun parts(): Triple<Workspace, CustomRegistry, Tools> {
        val app = RuntimeEnvironment.getApplication()
        val ws = Workspace(app)
        ws.clear()
        val reg = CustomRegistry(app, ws)
        val tools = Tools(app, ws, OkHttpClient.Builder().build(), reg)
        return Triple(ws, reg, tools)
    }

    @Test
    fun customToolReachesModelSchema() {
        val (_, reg, tools) = parts()
        reg.upsert(
            CustomTool(
                id = "1", name = "github_runs", description = "список запусков GitHub Actions",
                kind = "http", params = listOf(ToolParam("owner"), ToolParam("repo")),
                method = "GET", url = "https://api.github.com/repos/{{owner}}/{{repo}}/actions/runs"
            )
        )
        val spec = tools.specs().firstOrNull { it.toString().contains("github_runs") }
        assertTrue("схема не попала к модели", spec != null)
        val text = spec.toString()
        assertTrue(text.contains("\"owner\"") && text.contains("\"repo\""))
        assertTrue("в схеме должны быть required", text.contains("required"))
    }

    @Test
    fun customToolOverridesAndExecutesShell() = runBlocking {
        val (ws, reg, tools) = parts()
        reg.upsert(
            CustomTool(
                id = "2", name = "note", description = "запиши заметку", kind = "shell",
                params = listOf(ToolParam("text")), command = "echo {{text}} > note.txt"
            )
        )
        val out = tools.run(ToolCall("c1", "note", """{"text":"привет из своего инструмента"}"""))
        assertTrue("вывод: $out", out.isNotEmpty())
        // команда пишет в файл — проверяем файл, а не stdout
        assertTrue(ws.read("note.txt").contains("привет из своего инструмента"))
    }

    @Test
    fun missingParamsAreReported() = runBlocking {
        val (_, reg, tools) = parts()
        reg.upsert(
            CustomTool(id = "3", name = "need_two", description = "два параметра", kind = "shell",
                params = listOf(ToolParam("a"), ToolParam("b")), command = "echo {{a}}{{b}}")
        )
        val out = tools.run(ToolCall("c2", "need_two", """{"a":"1"}"""))
        assertTrue(out, out.contains("не хватает параметров") && out.contains("b"))
    }

    @Test
    fun customHttpToolRuns() = runBlocking {
        val (_, reg, tools) = parts()
        reg.upsert(
            CustomTool(
                id = "4", name = "site", description = "проверка адреса", kind = "http",
                params = emptyList(), method = "GET", url = "https://example.com/", resultLimit = 200
            )
        )
        val out = tools.run(ToolCall("c3", "site", "{}"))
        // сеть может быть недоступна — важно, что причина внятная, а не «инструмент не найден»
        assertTrue("вывод: $out", out.startsWith("HTTP ") || out.contains("ошибка запроса"))
    }

    @Test
    fun httpToolRejectsNonHttpUrl() = runBlocking {
        val (_, reg, tools) = parts()
        reg.upsert(
            CustomTool(id = "5", name = "bad", description = "плохой url", kind = "http", url = "file:///etc/passwd")
        )
        val out = tools.run(ToolCall("c4", "bad", "{}"))
        assertTrue(out, out.contains("должен начинаться с http"))
    }

    @Test
    fun userSkillsOverrideBuiltins() = runBlocking {
        val (_, reg, tools) = parts()
        assertTrue(reg.addSkill("мой", "делай так").contains("сохранён"))
        assertTrue(reg.userSkills().contains("мой"))
        val out = tools.run(ToolCall("s1", "skill", """{"name":"мой"}"""))
        assertEquals("делай так", out)
        assertTrue(reg.deleteSkill("мой"))
    }

    @Test
    fun skillListMentionsBothSources() = runBlocking {
        val (_, reg, tools) = parts()
        reg.addSkill("alpha", "a")
        val out = tools.run(ToolCall("s2", "skill", """{"name":"нет-такого"}"""))
        assertTrue(out, out.contains("alpha") && out.contains("render"))
    }

    @Test
    fun registryUpsertReplacesByName() {
        val (_, reg, _) = parts()
        reg.upsert(CustomTool(id = "a", name = "dup", description = "первый", kind = "shell", command = "echo 1"))
        reg.upsert(CustomTool(id = "b", name = "dup", description = "второй", kind = "shell", command = "echo 2"))
        val list = reg.tools()
        assertEquals(1, list.size)
        assertEquals("второй", list[0].description)
    }

    @Test
    fun customRunnerMissingTool() = runBlocking {
        val app = RuntimeEnvironment.getApplication()
        val ws = Workspace(app)
        val runner = CustomRunner(CustomRegistry(app, ws), OkHttpClient.Builder().build())
        val out = runner.run(ToolCall("x", "нет-такого", "{}"))
        assertTrue(out, out.contains("не найден"))
    }
}
