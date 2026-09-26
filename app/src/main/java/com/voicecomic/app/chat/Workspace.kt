package com.voicecomic.app.chat

import android.content.Context
import java.io.File

/**
 * Рабочая папка, куда пишут файлы инструменты ИИ (write/edit) и куда смотрит bash.
 * Файлы можно открыть и отдать наружу из вкладки «Workspace».
 */
class Workspace(context: Context) {
    val root: File = File(context.filesDir, "workspace").apply { mkdirs() }
    private val skillsDir: File = File(root, ".skills").apply { mkdirs() }

    fun resolve(path: String): File? {
        val clean = path.trim().removePrefix("./").trimStart('/')
        if (clean.isEmpty()) return null
        // никаких выходов за пределы workspace
        if (clean.contains("..")) return null
        val f = File(root, clean)
        val canon = f.canonicalFile
        return if (canon.path.startsWith(root.canonicalFile.path)) canon else null
    }

    fun write(path: String, content: String): String = runCatching {
        val f = resolve(path) ?: return "путь за пределами workspace: $path"
        f.parentFile?.mkdirs()
        f.writeText(content)
        "записано ${f.length()} байт → ${f.relativeTo(root).path}"
    }.getOrElse { "ошибка записи: ${it.message}" }

    fun read(path: String, offset: Int = 0, limit: Int = 0): String = runCatching {
        val f = resolve(path) ?: return "путь за пределами workspace: $path"
        if (!f.exists()) return "нет такого файла: $path"
        if (f.isDirectory) return "это папка: $path"
        val all = f.readLines()
        val from = offset.coerceAtLeast(0)
        val to = if (limit > 0) (from + limit).coerceAtMost(all.size) else all.size
        if (from >= all.size) return "файл короче смещения ${from + 1}"
        all.subList(from, to).joinToString("\n").ifEmpty { "(пусто)" }
    }.getOrElse { "ошибка чтения: ${it.message}" }

    fun edit(path: String, old: String, new: String, replaceAll: Boolean): String = runCatching {
        val f = resolve(path) ?: return "путь за пределами workspace: $path"
        if (!f.exists()) return "нет такого файла: $path"
        val text = f.readText()
        if (!text.contains(old)) return "не найден фрагмент для замены"
        val updated = if (replaceAll) text.replace(old, new) else text.replaceFirst(old, new)
        f.writeText(updated)
        "заменено ${if (replaceAll) "все" else "первое"} вхождение, ${updated.length} символов"
    }.getOrElse { "ошибка правки: ${it.message}" }

    /** Грубый glob: поддерживает * и ? в имени и ** для подкаталогов. */
    fun glob(pattern: String, path: String?): List<String> {
        val base = path?.let { resolve(it) } ?: root
        val rx = globToRegex(pattern)
        val out = ArrayList<String>()
        base.walkTopDown()
            .filter { it.isFile && !it.path.contains("/.skills/") }
            .forEach { f ->
                val rel = f.relativeTo(base).path
                if (rx.containsMatchIn(rel)) out.add(rel)
            }
        return out.sorted().take(500)
    }

    private fun globToRegex(p: String): Regex {
        val sb = StringBuilder("^")
        var i = 0
        while (i < p.length) {
            when (val c = p[i]) {
                '*' -> {
                    if (i + 1 < p.length && p[i + 1] == '*') {
                        sb.append(".*"); i++
                    } else sb.append("[^/]*")
                }

                '?' -> sb.append("[^/]")
                '.', '(', ')', '[', ']', '{', '}', '+', '^', '$', '|', '\\' -> sb.append('\\').append(c)
                else -> sb.append(c)
            }
            i++
        }
        sb.append('$')
        return Regex(sb.toString())
    }

    fun grep(pattern: String, path: String?, include: String?): List<String> {
        val base = path?.let { resolve(it) } ?: root
        val rx = runCatching { Regex(pattern) }.getOrElse {
            return listOf("некорректная регулярка: ${it.message}")
        }
        val inc = include?.let { globToRegex(it) }
        val out = ArrayList<String>()
        base.walkTopDown()
            .filter { it.isFile && !it.path.contains("/.skills/") }
            .forEach { f ->
                if (inc != null && !inc.containsMatchIn(f.name)) return@forEach
                runCatching {
                    f.forEachLine { line ->
                        if (rx.containsMatchIn(line) && out.size < 300) {
                            out.add("${f.relativeTo(base).path}:$line")
                        }
                    }
                }
            }
        return out.ifEmpty { listOf("совпадений нет") }
    }

    /** Файлы, созданные инструментами (без служебной папки навыков). */
    fun files(): List<File> = root.walkTopDown()
        .filter { it.isFile && !it.path.contains("${File.separator}.skills${File.separator}") }
        .sortedBy { it.lastModified() }
        .toList()

    fun skillsDir(): File = skillsDir

    fun delete(rel: String): Boolean = resolve(rel)?.delete() ?: false

    fun clear() {
        files().forEach { it.delete() }
        root.listFiles()?.filter { it.isDirectory }?.forEach { it.deleteRecursively() }
    }
}
