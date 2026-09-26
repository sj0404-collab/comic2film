package com.voicecomic.app.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File

@Serializable
data class ProjectFile(
    val version: Int = 2,
    val projectId: String = "",
    val settings: Settings = Settings(),
    val project: Project = Project()
)

/**
 * Хранилище проекта: файлы в каталоге приложения вместо IndexedDB.
 *
 * projects/<id>/project.json      — проект, роли, клипы, настройки
 * projects/<id>/pages/<file>      — изображения страниц
 * projects/<id>/clips/<id> — нарезки клипов (wav)
 * projects/<id>/bubbles          — озвучка реплик (wav)
 * projects/<id>/music            — фоновая музыка
 */
class ProjectStore(context: Context) {
    private val app = context.applicationContext
    val root: File = File(app.filesDir, "projects").apply { mkdirs() }

    private val json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    fun projectDir(id: String): File = File(root, id).apply { mkdirs() }
    fun pagesDir(id: String): File = File(projectDir(id), "pages").apply { mkdirs() }
    fun clipsDir(id: String): File = File(projectDir(id), "clips").apply { mkdirs() }
    fun bubblesDir(id: String): File = File(projectDir(id), "bubbles").apply { mkdirs() }

    fun pageFile(id: String, name: String): File = File(pagesDir(id), name)
    fun segFile(projectId: String, clipId: String, name: String): File =
        File(File(clipsDir(projectId), clipId), name)
    fun bubbleFile(id: String, name: String): File = File(bubblesDir(id), name)

    fun resolve(projectId: String, relative: String): File = File(projectDir(projectId), relative)

    fun listProjects(): List<File> = root.listFiles()
        ?.filter { File(it, "project.json").exists() }
        ?.sortedByDescending { it.lastModified() }
        ?: emptyList()

    fun lastProjectId(): String? = File(app.filesDir, "last-project")
        .takeIf { it.exists() }?.readText()?.trim()?.takeIf { it.isNotEmpty() }

    fun setLastProject(id: String) {
        File(app.filesDir, "last-project").writeText(id)
    }

    fun newProjectId(): String = "p" + System.currentTimeMillis().toString(36) + newId().take(4)

    private fun file(projectId: String) = File(projectDir(projectId), "project.json")

    suspend fun save(projectId: String, project: Project, settings: Settings) =
        withContext(Dispatchers.IO) {
            val target = file(projectId)
            val tmp = File(target.parentFile, "project.json.tmp")
            tmp.writeText(
                json.encodeToString(
                    ProjectFile.serializer(),
                    ProjectFile(version = 2, projectId = projectId, settings = settings, project = project)
                )
            )
            if (!tmp.renameTo(target)) {
                target.writeText(tmp.readText())
                tmp.delete()
            }
        }

    suspend fun load(projectId: String): ProjectFile? = withContext(Dispatchers.IO) {
        val f = file(projectId)
        if (!f.exists()) return@withContext null
        runCatching { json.decodeFromString(ProjectFile.serializer(), f.readText()) }
            .onFailure { Log.e("ProjectStore", "не удалось прочитать проект $projectId", it) }
            .getOrNull()
    }

    /** Экспорт сценария без картинок и звука (совместим с веб-версией по полям). */
    fun exportScenario(project: Project, settings: Settings): String = json.encodeToString(
        ProjectFile.serializer(),
        ProjectFile(version = 1, projectId = "", settings = settings, project = project)
    )

    fun delete(projectId: String) {
        projectDir(projectId).deleteRecursively()
    }

    fun exportsDir(): File = File(app.filesDir, "exports").apply { mkdirs() }
}
