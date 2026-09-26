package com.voicecomic.app

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.media.MediaPlayer
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.voicecomic.app.ai.AiClient
import com.voicecomic.app.ai.AiTasks
import com.voicecomic.app.ai.CastApply
import com.voicecomic.app.ai.CastPlanner
import com.voicecomic.app.ai.Msg
import com.voicecomic.app.ai.Providers
import com.voicecomic.app.audio.EdgeTts
import com.voicecomic.app.audio.MediaAudioDecoder
import com.voicecomic.app.audio.Mp3Frames
import com.voicecomic.app.audio.Pcm
import com.voicecomic.app.audio.VoiceCatalog
import com.voicecomic.app.chat.AgentEvent
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.BubbleAudio
import com.voicecomic.app.data.Clip
import com.voicecomic.app.data.Defaults
import com.voicecomic.app.data.Page
import com.voicecomic.app.data.Project
import com.voicecomic.app.data.ProjectStore
import com.voicecomic.app.data.Role
import com.voicecomic.app.data.Settings
import com.voicecomic.app.data.newId
import com.voicecomic.app.importer.Importer
import com.voicecomic.app.ocr.MlKitOcr
import com.voicecomic.app.render.AudioMixer
import com.voicecomic.app.render.FrameRenderer
import com.voicecomic.app.render.Item
import com.voicecomic.app.render.Timeline
import com.voicecomic.app.render.VideoExporter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.min

data class Toast(val text: String, val kind: String = "ok")
data class Prog(val frac: Double, val text: String)
data class ChatMsg(
    val role: String,
    val content: String,
    val ts: Long = System.currentTimeMillis(),
    val files: List<String> = emptyList(),
    val images: List<Int> = emptyList(),
    val reasoning: String = "",
    val tools: List<ToolRun> = emptyList()
)

/** Выполненный инструмент в чате: видно, что агент делал и что вышло. */
data class ToolRun(val name: String, val summary: String, val ok: Boolean = true)

class AppViewModel(app: Application) : AndroidViewModel(app) {

    val store = ProjectStore(app)
    private val http = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .callTimeout(180, TimeUnit.SECONDS)
        .build()
    private val tts = EdgeTts(http)
    val ai = AiClient(http)
    val agentClient = com.voicecomic.app.ai.AgentClient(http)
    val workspace = com.voicecomic.app.chat.Workspace(app)
    val tools = com.voicecomic.app.chat.Tools(app, workspace, http)
    val agent = com.voicecomic.app.chat.Agent({ settings }, agentClient, tools, http)
    private val tasks = AiTasks(ai)
    private val exporter = VideoExporter()

    var projectId by mutableStateOf("")
        private set
    var project by mutableStateOf(Defaults.defaultProject())
        private set
    var settings by mutableStateOf(Settings())
        private set

    var toast by mutableStateOf<Toast?>(null)
    var progress by mutableStateOf<Prog?>(null)
    var busy by mutableStateOf(false)
    var lastExport by mutableStateOf<File?>(null)
    var lastExportLabel by mutableStateOf("")

    var previewTick by mutableIntStateOf(0)
    var previewBitmap by mutableStateOf<Bitmap?>(null)
    var previewActive by mutableStateOf(false)
    var previewTotal by mutableStateOf(0.0)
    var modelPickerOpen by mutableStateOf(false)

    var chatSessions by mutableStateOf(listOf<String>())
    var chatCurrent by mutableStateOf("")
    var chatMessages by mutableStateOf(listOf<ChatMsg>())
    var chatTyping by mutableStateOf(false)

    private var saveJob: Job? = null
    private var player: MediaPlayer? = null
    private val pageCache = HashMap<String, Bitmap>()
    private var previewBmp: Bitmap? = null

    init {
        AiClient.loadTools(app)
        viewModelScope.launch {
            Providers.loadDevCatalog(app)
            val existing = store.lastProjectId()
            if (existing != null) {
                val loaded = store.load(existing)
                if (loaded != null) {
                    projectId = loaded.projectId
                    project = loaded.project
                    settings = loaded.settings
                    loadChat()
                    return@launch
                }
            }
            projectId = store.newProjectId()
            project = Defaults.defaultProject()
            settings = Settings()
            store.setLastProject(projectId)
        }
    }

    // ---------- служебное ----------

    fun say(text: String, kind: String = "ok") {
        toast = Toast(text, kind)
    }

    fun edit(block: (Project) -> Project) {
        project = block(project)
        scheduleSave()
    }

    fun configure(block: (Settings) -> Settings) {
        settings = block(settings)
        scheduleSave()
    }

    private fun scheduleSave() {
        saveJob?.cancel()
        saveJob = viewModelScope.launch {
            delay(600)
            runCatching { store.save(projectId, project, settings) }
                .onFailure { say("Ошибка сохранения: ${it.message}", "err") }
        }
    }

    fun roleOf(id: String): Role? = project.roles.firstOrNull { it.id == id }

    fun narratorRole(): Role? = project.roles.firstOrNull { CastPlanner.isNarrator(it.name) }

    fun clipById(id: String): Clip? = project.clips.firstOrNull { it.id == id }

    fun pageBitmap(page: Page): Bitmap? {
        pageCache[page.id]?.let { return it }
        val f = store.resolve(projectId, page.file)
        if (!f.exists()) return null
        val bmp = BitmapFactory.decodeFile(f.absolutePath) ?: return null
        pageCache[page.id] = bmp
        return bmp
    }

    fun dropPageCache(pageId: String) {
        pageCache.remove(pageId)?.recycle()
    }

    private fun importer() = Importer(getApplication(), store.projectDir(projectId))

    private fun mixPath(relative: String) = store.resolve(projectId, relative)

    private suspend fun <T> work(
        label: String,
        block: suspend (setProgress: (Double, String) -> Unit) -> T
    ): T? {
        if (busy) {
            say("Занято: дождитесь окончания текущей операции", "err")
            return null
        }
        busy = true
        progress = Prog(0.0, label)
        return try {
            block { f, t -> progress = Prog(f, t) }
        } catch (e: Throwable) {
            say(e.message ?: e.toString(), "err")
            null
        } finally {
            busy = false
            progress = null
        }
    }

    // ---------- импорт ----------

    fun importPages(uris: List<Uri>, password: String = "") {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            work("Анализ файлов…") { set ->
                val imported = importer().importPages(uris, password) { f, t -> set(f, t) }
                edit { p ->
                    p.copy(
                        kind = "pages",
                        pages = p.pages + imported.map {
                            Page(
                                id = newId(),
                                name = it.name,
                                file = store.pagesDir(projectId).toPath().relativize(it.file.toPath()).toString(),
                                filesize = it.size,
                                w = it.width,
                                h = it.height
                            )
                        }
                    )
                }
                say("Добавлено страниц: ${project.pages.size}")
            }
        }
    }

    fun importClips(uris: List<Uri>) {
        if (uris.isEmpty()) return
        viewModelScope.launch {
            work("Нарезка…") { set ->
                val imported = importer().importClips(uris) { f, t -> set(f, t) }
                edit { p ->
                    p.copy(
                        kind = "clips",
                        clips = p.clips + imported.map {
                            Clip(it.id, it.name, it.duration, it.sr, it.segs)
                        }
                    )
                }
                say("Звук нарезан на фразы")
            }
        }
    }

    fun deletePage(page: Page) {
        edit { p -> p.copy(pages = p.pages.filterNot { it.id == page.id }) }
        store.resolve(projectId, page.file).delete()
        dropPageCache(page.id)
    }

    fun deleteClip(clip: Clip) {
        edit { p -> p.copy(clips = p.clips.filterNot { it.id == clip.id }) }
        store.resolve(projectId, "clips/${clip.id}").deleteRecursively()
        if (settings.music.startsWith("clips/${clip.id}")) configure { it.copy(music = "") }
    }

    fun setMusic(uri: Uri) {
        viewModelScope.launch {
            work("Загрузка музыки…") { set ->
                set(0.3, "Декод аудио")
                val raw = withContext(Dispatchers.IO) {
                    val tmp = File(getApplication<Application>().cacheDir, "music_${newId().take(6)}")
                    getApplication<Application>().contentResolver.openInputStream(uri)?.use { i ->
                        tmp.outputStream().use { i.copyTo(it) }
                    }
                    tmp
                }
                val decoded = MediaAudioDecoder.decode(raw) ?: throw IllegalStateException("Не удалось прочитать аудио")
                val pcm16 = Pcm.floatToPcm16(decoded.samples)
                val out = File(store.projectDir(projectId), "music.wav")
                Pcm.writeWav(out, pcm16, decoded.sr)
                raw.delete()
                configure { it.copy(music = "music.wav") }
                say("Фоновая музыка подключена")
            }
        }
    }

    fun clearMusic() = configure { it.copy(music = "") }

    fun useClipAsMusic(clip: Clip) {
        if (clip.segs.isEmpty()) {
            say("В клипе нет нарезок (загрузите аудио заново, чтобы фразы разрезались по тишине)", "err")
            return
        }
        viewModelScope.launch {
            work("Сборка музыки из клипа…") { set ->
                val first = store.resolve(projectId, clip.segs.first().file)
                if (!first.exists()) throw IllegalStateException("Нет нарезок")
                val pcm = Pcm.readWav(first) ?: throw IllegalStateException("Не удалось прочитать нарезку")
                val out = File(store.projectDir(projectId), "music.wav")
                Pcm.writeWav(out, Pcm.floatToPcm16(pcm.first), pcm.second)
                configure { it.copy(music = "music.wav") }
                say("Нарезанный клип → фоновая музыка")
            }
        }
    }

    // ---------- OCR ----------

    fun ocrAll() {
        if (project.pages.isEmpty()) {
            say("Нет страниц", "err")
            return
        }
        viewModelScope.launch {
            work("OCR") { set ->
                val lang = settings.lang
                val langName = tasks.langName(lang)
                val useVision = settings.ocr != "mlkit" && settings.ocr.isNotBlank()
                val aiSettings = settings.copy(ai = settings.ocr)
                val n = project.pages.size
                val updated = project.pages.mapIndexed { pi, page ->
                    set(pi.toDouble() / n, "OCR страницы ${pi + 1}/$n…")
                    val bmp = pageBitmap(page) ?: return@mapIndexed page
                    val res = if (useVision) visionOcr(bmp, aiSettings, langName) else null
                    if (res != null) {
                        page.copy(
                            bubblesHaveBoxes = false,
                            bubbles = res.mapIndexed { i, line ->
                                Bubble(text = line, order = i.toFloat() / max1(res.size))
                            }
                        )
                    } else {
                        val r = MlKitOcr.recognize(bmp, lang)
                        page.copy(
                            bubblesHaveBoxes = r.boxes,
                            bubbles = r.bubbles.map { b ->
                                Bubble(text = b.text, x = b.x, y = b.y, w = b.w, h = b.h, order = b.order)
                            }
                        )
                    }
                }
                edit { p -> p.copy(pages = updated) }
                say("OCR завершён")
            }
        }
    }

    private suspend fun visionOcr(bmp: Bitmap, s: Settings, langName: String): List<String>? = runCatching {
        val scaled = if (maxOf(bmp.width, bmp.height) > 1400) {
            val k = 1400.0 / maxOf(bmp.width, bmp.height)
            Bitmap.createScaledBitmap(bmp, (bmp.width * k).toInt(), (bmp.height * k).toInt(), true)
        } else bmp
        val out = File(getApplication<Application>().cacheDir, "ocr_${newId().take(6)}.jpg")
        out.outputStream().use { scaled.compress(Bitmap.CompressFormat.JPEG, 85, it) }
        val url = "data:image/jpeg;base64," + java.util.Base64.getEncoder().encodeToString(out.readBytes())
        out.delete()
        tasks.visionLines(s, langName, url)
    }.getOrNull()

    private fun max1(v: Int) = if (v > 0) v else 1

    fun ocrRegion(page: Page, bubble: Bubble) {
        val bmp = pageBitmap(page) ?: return
        val x = bubble.x?.toInt() ?: return
        val y = bubble.y?.toInt() ?: return
        val w = bubble.w?.toInt() ?: return
        val h = bubble.h?.toInt() ?: return
        viewModelScope.launch {
            val text = runCatching { MlKitOcr.recognize(Bitmap.createBitmap(bmp, x, y, w, h), settings.lang).bubbles.joinToString(" ") { it.text } }.getOrNull()
            if (text.isNullOrBlank()) say("OCR: пусто", "err") else updateBubble(page.id, bubble.id) { it.copy(text = text) }
        }
    }

    // ---------- реплики ----------

    fun updateBubble(pageId: String, bubbleId: String, block: (Bubble) -> Bubble) {
        edit { p ->
            p.copy(pages = p.pages.map { pg ->
                if (pg.id != pageId) pg
                else pg.copy(bubbles = pg.bubbles.map { if (it.id == bubbleId) block(it) else it })
            })
        }
    }

    fun addBubble(pageId: String) {
        edit { p ->
            p.copy(pages = p.pages.map { pg ->
                if (pg.id != pageId) pg
                else pg.copy(
                    bubbles = pg.bubbles + Bubble(
                        text = "", x = if (pg.bubblesHaveBoxes) 10f else null,
                        y = if (pg.bubblesHaveBoxes) 10f else null,
                        w = if (pg.bubblesHaveBoxes) 120f else null,
                        h = if (pg.bubblesHaveBoxes) 40f else null
                    )
                )
            })
        }
    }

    fun deleteBubble(pageId: String, bubbleId: String) {
        val page = project.pages.firstOrNull { it.id == pageId } ?: return
        val b = page.bubbles.firstOrNull { it.id == bubbleId } ?: return
        b.audio?.file?.let { store.resolve(projectId, it).delete() }
        edit { p ->
            p.copy(pages = p.pages.map { pg ->
                if (pg.id != pageId) pg else pg.copy(bubbles = pg.bubbles.filterNot { it.id == bubbleId })
            })
        }
    }

    fun clearAudio(pageId: String, bubbleId: String) {
        val page = project.pages.firstOrNull { it.id == pageId } ?: return
        page.bubbles.firstOrNull { it.id == bubbleId }?.audio?.file?.let {
            store.resolve(projectId, it).delete()
        }
        updateBubble(pageId, bubbleId) { it.copy(audio = null) }
    }

    fun moveBubble(pageId: String, bubbleId: String, nx: Float, ny: Float, nw: Float, nh: Float) {
        updateBubble(pageId, bubbleId) { it.copy(x = nx, y = ny, w = nw, h = nh) }
    }

    // ---------- роли ----------

    fun addRole() {
        edit { p -> p.copy(roles = p.roles + Role(name = "Персонаж ${p.roles.size}", color = Defaults.roleColor(p.roles.size))) }
    }

    fun deleteRole(role: Role) {
        edit { p -> p.copy(roles = p.roles.filterNot { it.id == role.id }) }
    }

    fun updateRole(roleId: String, block: (Role) -> Role) {
        edit { p -> p.copy(roles = p.roles.map { if (it.id == roleId) block(it) else it }) }
    }

    fun autoCast(force: Boolean = false) {
        if (project.roles.isEmpty()) return
        val prefix = Defaults.LANG_LOCALE[settings.lang] ?: "ru"
        val pool = VoiceCatalog.forLang(prefix).ifEmpty { VoiceCatalog.all() }
        val manual = project.roles.filter { it.manualVoice }.map { it.id }.toSet()
        val plan = CastPlanner.planCasts(project.roles, pool, prefix, manual, narratorRole()?.id)
        edit { p ->
            p.copy(roles = p.roles.map { r ->
                val c = plan.casts[r.id] ?: return@map r
                r.copy(
                    voice = c.voice, castReason = c.reason,
                    manualVoice = if (force) false else r.manualVoice,
                    emoji = if (r.emoji.isEmpty()) Defaults.emojiForGender(r.gender) else r.emoji
                )
            })
        }
        val reused = plan.reused
        val otherLang = plan.otherLang
        say(
            buildString {
                append("Голоса подобраны")
                if (reused > 0) append(" · повтор: $reused")
                if (otherLang > 0) append(" · другой язык: $otherLang")
            },
            if (reused > 0 || otherLang > 0) "err" else "ok"
        )
    }

    fun aiRoles() {
        val rows = CastPlanner.allRows(project.pages)
        if (rows.none { it.bubble.text.isNotBlank() }) {
            say("Сначала получите текст (OCR)", "err")
            return
        }
        viewModelScope.launch {
            work("ИИ-разметка ролей") { set ->
                val langName = tasks.langName(settings.lang)
                val lines = rows.map { AiTasks.LineInput(it.pageIndex, it.pageIndex, it.bubble.text) }
                val res = tasks.analyzeRoles(settings, langName, lines)
                if (res.characters.isEmpty() && res.items.isEmpty()) {
                    say("ИИ не вернул разметку", "err")
                    return@work
                }
                val (roles, _, _) = CastApply.mergeCharacters(project.roles, res.characters)
                val speakers = res.items.map { it.second }.toSet()
                val narratorRoleId = roles.firstOrNull { CastPlanner.isNarrator(it.name) }?.id

                val assignment = res.items.associate { (idx, name) ->
                    idx to CastApply.resolveSpeaker(name, speakers, narratorRoleId)
                }
                val speakerByBubble = HashMap<String, String>()
                var assigned = 0
                var unnamed = 0
                rows.forEachIndexed { i, row ->
                    val name = assignment[i].orEmpty()
                    speakerByBubble[row.bubble.id] = name
                    if (name.isNotEmpty()) assigned++ else unnamed++
                }
                val pages = project.pages.map { pg ->
                    pg.copy(bubbles = pg.bubbles.map { b ->
                        speakerByBubble[b.id]?.let { b.copy(roleId = it) } ?: b
                    })
                }
                edit { p -> p.copy(roles = roles, pages = pages) }
                autoCast()
                say(
                    buildString {
                        append("Роли: персонажей: ${res.characters.size} · реплик назначено: $assigned")
                        if (unnamed > 0) append(" · БЕЗ РОЛИ: $unnamed (разметьте вручную)")
                        if (res.batches > 0) append(" · пачек: ${res.batches}")
                    },
                    if (unnamed > 0) "err" else "ok"
                )
            }
        }
    }

    // ---------- перевод ----------

    fun translateAll() {
        if (settings.trlang == "donot") {
            say("Перевод отключён в настройках", "err")
            return
        }
        val rows = CastPlanner.allRows(project.pages).filter { it.bubble.text.isNotBlank() }
        if (rows.isEmpty()) {
            say("Нет реплик", "err")
            return
        }
        viewModelScope.launch {
            work("Перевод") { set ->
                val toLang = tasks.trLangName(settings.trlang)
                var done = 0
                val translated = tasks.translate(settings, toLang, rows.mapIndexed { i, r -> i to r.bubble.text })
                val byId = rows.mapIndexed { i, r -> r.bubble.id to translated[i] }.toMap()
                edit { p ->
                    p.copy(pages = p.pages.map { pg ->
                        pg.copy(bubbles = pg.bubbles.map { b ->
                            byId[b.id]?.let { b.copy(tr = it) } ?: b
                        })
                    })
                }
                done = translated.count { !it.isNullOrBlank() }
                set(1.0, "Готово")
                say("Переведено $done из ${rows.size}" + if (done < rows.size) " · без перевода: ${rows.size - done}" else "")
            }
        }
    }

    // ---------- озвучка ----------

    fun voiceAll() {
        val rows = CastPlanner.allRows(project.pages).filter { it.bubble.text.isNotBlank() }
        if (rows.isEmpty()) {
            say("Нет реплик для озвучки", "err")
            return
        }
        viewModelScope.launch {
            work("Озвучка") { set ->
                val langPrefix = Defaults.LANG_LOCALE[settings.lang] ?: "ru"
                val pool = VoiceCatalog.forLang(langPrefix).ifEmpty { VoiceCatalog.all() }
                val result = synthesizeAll(rows, pool, set)
                say(
                    "Озвучка: озвучено: ${result.done}/${rows.size}" +
                        if (result.fromClips > 0) " · нарезками: ${result.fromClips}" else ""
                )
            }
        }
    }

    private data class VoiceResult(val done: Int, val fromClips: Int)

    private suspend fun synthesizeAll(
        rows: List<CastPlanner.Row>,
        pool: List<VoiceCatalog.Voice>,
        set: (Double, String) -> Unit
    ): VoiceResult {
        var done = 0
        var fromClips = 0
        val perRole = HashMap<String, Int>()
        // нарезки клипов: раздаём по репликам героя
        val takeMap = HashMap<String, ClipTakes>()
        for (row in rows) {
            val role = roleOf(row.bubble.roleId) ?: continue
            if (role.type != "clip" || role.clipId.isBlank()) continue
            val clip = clipById(role.clipId) ?: continue
            val idx = perRole.getOrPut(role.id) { 0 }
            val plan = takeMap.getOrPut(role.id) {
                ClipTakes(role.takeMode == "duration", HashMap())
            }
            val segIdx = row.bubble.clipSeg ?: plan.pick(idx, clip.segs.size)
            plan.manual[row.bubble.id] = segIdx
            perRole[role.id] = idx + 1
        }

        rows.forEachIndexed { i, row ->
            set(i.toDouble() / rows.size, "Озвучка ${i + 1}/${rows.size}")
            val b = row.bubble
            val role = roleOf(b.roleId)
            val audio: BubbleAudio? = if (role != null && role.type == "clip" && role.clipId.isNotBlank()) {
                val clip = clipById(role.clipId)
                val plan = takeMap[role.id]
                val segIdx = plan?.manual?.get(b.id) ?: 0
                val seg = clip?.segs?.getOrNull(segIdx)
                if (seg != null) {
                    fromClips++
                    BubbleAudio(file = seg.file, duration = seg.duration, noTrim = true)
                } else null
            } else {
                val voice = role?.voice?.takeIf { it.isNotBlank() }
                    ?: pool.getOrNull(0)?.id
                    ?: VoiceCatalog.defaultVoice()
                synthesizeOne(b.text, voice, role).let { file ->
                    if (file != null) {
                        val (f, dur) = file
                        BubbleAudio(file = f, duration = dur)
                    } else null
                }
            }
            if (audio != null) {
                updateBubble(row.pageId, b.id) {
                    it.copy(audio = audio, clipSeg = takeMap[role?.id ?: ""]?.manual?.get(b.id))
                }
                done++
            }
        }
        return VoiceResult(done, fromClips)
    }

    private class ClipTakes(byDuration: Boolean, val manual: HashMap<String, Int>) {
        private val byDur = byDuration
        private val cursor = HashMap<Int, Int>()

        fun pick(i: Int, segCount: Int): Int {
            if (segCount == 0) return 0
            return if (byDur) {
                val c = cursor.getOrPut(segCount) { 0 }
                cursor[segCount] = (c + 1) % segCount
                c % segCount
            } else i % segCount
        }
    }

    private suspend fun synthesizeOne(
        text: String,
        voice: String,
        role: Role?
    ): Pair<String, Double>? = runCatching {
        val pitch = role?.pitch ?: "+0Hz"
        val rate = role?.rate ?: "+0%"
        val volume = role?.volume ?: "+0%"
        val style = role?.style ?: ""
        val syn = tts.synthesize(text, voice, pitch, rate, volume, style)
        val mp3 = Mp3Frames.clean(syn.mp3)
        val tmp = File(getApplication<Application>().cacheDir, "tts_${newId().take(8)}.mp3")
        tmp.writeBytes(mp3)
        val decoded = MediaAudioDecoder.decode(tmp) ?: throw IllegalStateException("Edge-TTS вернул нечитаемый звук")
        tmp.delete()
        val rel = "bubbles/${newId()}.wav"
        Pcm.writeWav(store.resolve(projectId, rel), Pcm.floatToPcm16(decoded.samples), decoded.sr)
        val trim = Pcm.trimSilence(decoded.samples, decoded.sr, Timeline.TRIM_THRESHOLD, Timeline.TRIM_MARGIN)
        val dur = if (trim.end > trim.start) {
            maxOf(Timeline.TRIM_MIN_DUR, (trim.end - trim.start).toDouble() / decoded.sr)
        } else Timeline.TRIM_MIN_DUR
        rel to dur
    }.getOrNull()

    fun playBubble(pageId: String, bubbleId: String) {
        val b = project.pages.firstOrNull { it.id == pageId }?.bubbles?.firstOrNull { it.id == bubbleId } ?: return
        viewModelScope.launch {
            val file = b.audio?.file?.let { store.resolve(projectId, it) }
            if (file != null && file.exists()) {
                playFile(file)
                return@launch
            }
            progress = Prog(0.2, "Синтез реплики…")
            val role = roleOf(b.roleId)
            val pool = VoiceCatalog.forLang(Defaults.LANG_LOCALE[settings.lang] ?: "ru")
                .ifEmpty { VoiceCatalog.all() }
            val voice = role?.voice?.takeIf { it.isNotBlank() } ?: pool.firstOrNull()?.id ?: VoiceCatalog.defaultVoice()
            val res = synthesizeOne(b.text, voice, role)
            progress = null
            if (res == null) {
                say("Не удалось озвучить реплику", "err")
                return@launch
            }
            val (rel, dur) = res
            updateBubble(pageId, bubbleId) { it.copy(audio = BubbleAudio(rel, dur)) }
            playFile(store.resolve(projectId, rel))
        }
    }

    private fun playFile(file: File) {
        runCatching {
            player?.release()
            player = MediaPlayer().apply {
                setDataSource(file.absolutePath)
                prepare()
                setOnCompletionListener { it.release(); player = null }
                start()
            }
        }.onFailure { say("Не удалось воспроизвести: ${it.message}", "err") }
    }

    fun stopPlayback() {
        runCatching { player?.stop() }
        player?.release()
        player = null
    }

    // ---------- предпросмотр ----------

    fun startPreview() {
        if (project.pages.isEmpty()) {
            say("Нет страниц", "err")
            return
        }
        stopPreview()
        viewModelScope.launch {
            work("Предпросмотр") { set ->
                val (items, total) = Timeline.build(project.pages, settings.gap)
                set(0.1, "Сведение аудио")
                val mixer = AudioMixer(projectId) { mixPath(it) }
                val mixed = mixer.render(items, total, project, settings) { f, t -> set(f * 0.4, t) }
                val wav = File(getApplication<Application>().cacheDir, "preview_${newId().take(6)}.wav")
                Pcm.writeWav(wav, Pcm.floatToPcm16(mixed.pcm), mixed.sr)
                val (w, h) = previewSize()
                val renderer = FrameRenderer(w, h)
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bmp)
                previewBmp = bmp
                previewBitmap = bmp
                previewTotal = total
                val mp = MediaPlayer().apply {
                    setDataSource(wav.absolutePath)
                    prepare()
                }
                player = mp
                previewActive = true
                mp.start()
                val zoom = settings.zoom
                while (isActive && previewActive) {
                    val clock = mp.currentPosition / 1000.0
                    if (clock >= total) break
                    val item = Timeline.currentItem(items, clock) ?: break
                    renderer.roleResolver = { roleOf(it.bubble?.roleId ?: "") }
                    renderer.drawFrame(canvas, pageBitmap(item.page), item, clock, settings, zoom)
                    previewTick++
                    delay(1000L / 30)
                }
                previewActive = false
                runCatching { mp.stop() }
                mp.release()
                player = null
                wav.delete()
            }
        }
    }

    fun stopPreview() {
        previewActive = false
        runCatching { player?.stop() }
        player?.release()
        player = null
        previewBmp = null
        previewBitmap = null
    }

    private fun previewSize(): Pair<Int, Int> {
        val (w, h) = Timeline.resolveSize(settings.res, project.pages)
        val k = min(1.0, 640.0 / maxOf(w, h))
        val pw = ((w * k).toInt() / 2 * 2).coerceAtLeast(2)
        val ph = ((h * k).toInt() / 2 * 2).coerceAtLeast(2)
        return pw to ph
    }

    // ---------- сборка ----------

    fun renderVideo() {
        if (project.pages.isEmpty()) {
            say("Сначала добавьте страницы", "err")
            return
        }
        val voiced = CastPlanner.allRows(project.pages).count { it.bubble.audio != null }
        viewModelScope.launch {
            work("Сборка видео") { set ->
                set(0.02, "Старт")
                val (items, total) = Timeline.build(project.pages, settings.gap)
                val (w, h) = Timeline.resolveSize(settings.res, project.pages)
                val mixer = AudioMixer(projectId) { mixPath(it) }
                val mixed = mixer.render(items, total, project, settings) { f, t -> set(f * 0.35, t) }
                val pcm = Pcm.floatToPcm16(mixed.pcm)
                val renderer = FrameRenderer(w, h)
                renderer.roleResolver = { roleOf(it.bubble?.roleId ?: "") }
                val out = File(store.exportsDir(), "voicecomic_${System.currentTimeMillis()}.mp4")
                val cache = HashMap<String, Bitmap?>()
                exporter.exportMp4(
                    out = out, width = w, height = h, fps = settings.fps, totalSeconds = total,
                    audio = pcm, audioSr = mixed.sr,
                    onProgress = { f, t -> set(0.4 + 0.6 * f, t) },
                    frameAt = { _, t ->
                        val item = Timeline.currentItem(items, t) ?: return@exportMp4 null
                        val bmp = cache.getOrPut(item.page.id) { pageBitmap(item.page) }
                        val frame = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                        val canvas = Canvas(frame)
                        renderer.drawFrame(canvas, bmp, item, t, settings, settings.zoom)
                        frame
                    }
                )
                lastExport = out
                lastExportLabel = "${out.name} · ${fmtDur(total)} · ${w}×$h @${settings.fps}fps"
                say("Видео готово" + if (voiced == 0) " · реплики не озвучены" else "")
            }
        }
    }

    fun renderAudioOnly() {
        if (CastPlanner.allRows(project.pages).none { it.bubble.audio != null }) {
            say("Сначала озвучьте реплики", "err")
            return
        }
        viewModelScope.launch {
            work("Сборка аудио") { set ->
                val (items, total) = Timeline.build(project.pages, settings.gap)
                val mixer = AudioMixer(projectId) { mixPath(it) }
                val mixed = mixer.render(items, total, project, settings) { f, t -> set(f, t) }
                val stamp = System.currentTimeMillis()
                val wav = File(store.exportsDir(), "voicecomic_audio_$stamp.wav")
                val m4a = File(store.exportsDir(), "voicecomic_audio_$stamp.m4a")
                exporter.exportAudio(wav, m4a, Pcm.floatToPcm16(mixed.pcm), mixed.sr)
                lastExport = m4a
                lastExportLabel = "${m4a.name} + ${wav.name} · ${fmtDur(total)}"
                say("Аудио-дорожка готова")
            }
        }
    }

    fun fmtDur(sec: Double): String {
        val s = sec.toInt().coerceAtLeast(0)
        return "%d:%02d".format(s / 60, s % 60)
    }

    fun fmtSize(bytes: Long): String = when {
        bytes > 1048576 -> "%.1f МБ".format(bytes / 1048576.0)
        bytes > 1024 -> "${Math.round(bytes / 1024.0)} КБ"
        else -> "$bytes Б"
    }

    // ---------- каталог голосов / моделей ----------

    fun refreshVoices() {
        viewModelScope.launch {
            progress = Prog(0.2, "Обновление списка голосов…")
            val n = runCatching { VoiceCatalog.refreshFromMicrosoft(http) }.getOrDefault(0)
            progress = null
            say(if (n > 0) "Голосов в каталоге: ${VoiceCatalog.all().size}" else "Не удалось обновить список голосов", if (n > 0) "ok" else "err")
        }
    }

    fun refreshPollinations() {
        viewModelScope.launch {
            progress = Prog(0.2, "Список моделей Pollinations…")
            val n = runCatching {
                val req = okhttp3.Request.Builder().url("https://text.pollinations.ai/models").build()
                val body = http.newCall(req).execute().use { it.body?.string() ?: "" }
                val arr = kotlinx.serialization.json.Json.parseToJsonElement(body)
                    as? kotlinx.serialization.json.JsonArray ?: return@runCatching 0
                arr.count { (it as? kotlinx.serialization.json.JsonObject)?.get("tier")?.let { t ->
                        (t as? kotlinx.serialization.json.JsonPrimitive)?.content == "anonymous"
                    } == true }
            }.getOrDefault(0)
            progress = null
            say(if (n > 0) "Моделей без ключа у Pollinations: $n" else "Список не получен", if (n > 0) "ok" else "err")
        }
    }

    fun setModel(modelId: String) {
        configure { it.copy(aimodel = modelId) }
        modelPickerOpen = false
    }

    var modelHealth by mutableStateOf<Map<String, String>>(emptyMap())

    fun verifyModel(pid: String, mid: String) {
        val key = "$pid::$mid"
        modelHealth = modelHealth + (key to "проверяем…")
        viewModelScope.launch {
            val s2 = settings.copy(ai = pid, aimodel = mid)
            val started = System.currentTimeMillis()
            val res = runCatching {
                withTimeoutOrNull(20000) { ai.chat(s2, listOf(Msg("user", "ping"))) }
            }
            val ms = System.currentTimeMillis() - started
            val value = when {
                res == null -> "нет ответа за 20 c"
                res.isFailure -> "ошибка: " + (res.exceptionOrNull()?.message ?: "").take(140)
                else -> "отвечает · ${ms} мс"
            }
            modelHealth = modelHealth + (key to value)
        }
    }

    // ---------- проект ----------

    fun resetAll() {
        viewModelScope.launch {
            stopPreview()
            store.delete(projectId)
            pageCache.values.forEach { it.recycle() }
            pageCache.clear()
            projectId = store.newProjectId()
            project = Defaults.defaultProject()
            settings = Settings()
            store.setLastProject(projectId)
            store.save(projectId, project, settings)
            say("Новый проект")
        }
    }

    fun exportProjectJson(): File {
        val f = File(getApplication<Application>().getExternalFilesDir(null) ?: store.exportsDir(), "voicecomic_project.json")
        f.writeText(store.exportScenario(project, settings))
        return f
    }

    fun importProjectJson(uri: Uri) {
        viewModelScope.launch {
            runCatching {
                val txt = withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(uri)?.bufferedReader()?.use { it.readText() }
                } ?: throw IllegalStateException("Файл не похож на проект VoiceComic")
                val kx = kotlinx.serialization.json.Json { ignoreUnknownKeys = true; isLenient = true }
                val root = kx.parseToJsonElement(txt) as? kotlinx.serialization.json.JsonObject
                    ?: throw IllegalStateException("Файл не похож на проект VoiceComic")
                val proj = root["project"] ?: throw IllegalStateException("Файл не похож на проект VoiceComic")
                val imported = kx.decodeFromJsonElement(Project.serializer(), proj)
                edit { p ->
                    p.copy(
                        kind = imported.kind,
                        roles = imported.roles.ifEmpty { p.roles },
                        pages = p.pages.zip(imported.pages).map { (old, imp) ->
                            old.copy(
                                bubbles = old.bubbles.zip(imp.bubbles).map { (ob, ib) -> ob.copy(text = ib.text, tr = ib.tr) },
                                name = old.name.ifEmpty { imp.name }
                            )
                        }
                    )
                }
                say("Сценарий загружен")
            }.onFailure { say(it.message ?: "Ошибка импорта", "err") }
        }
    }

    // ---------- чат ----------

    private fun chatFile() = File(store.projectDir(projectId), "chat.json")

    private fun loadChat() {
        val f = chatFile()
        if (!f.exists()) {
            chatSessions = listOf("s" + System.currentTimeMillis())
            chatCurrent = chatSessions.first()
            return
        }
        runCatching {
            val root = kotlinx.serialization.json.Json.parseToJsonElement(f.readText())
                    as kotlinx.serialization.json.JsonObject
            chatSessions = (root["sessions"] as? kotlinx.serialization.json.JsonArray)
                ?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
                ?: emptyList()
            chatCurrent = (root["current"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: ""
            chatMessages = parseMessages(root["messages"])
        }
    }

    private fun parseMessages(el: kotlinx.serialization.json.JsonElement?): List<ChatMsg> {
        val arr = el as? kotlinx.serialization.json.JsonArray ?: return emptyList()
        return arr.mapNotNull { m ->
            val o = m as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
            ChatMsg(
                role = o["role"]?.toString()?.trim('"') ?: "user",
                content = o["content"]?.toString()?.trim('"') ?: "",
                files = (o["files"] as? kotlinx.serialization.json.JsonArray)
                    ?.mapNotNull { (it as? kotlinx.serialization.json.JsonPrimitive)?.content } ?: emptyList()
            )
        }
    }

    private fun saveChat() {
        val kx = kotlinx.serialization.json.buildJsonObject {
            put("current", kotlinx.serialization.json.JsonPrimitive(chatCurrent))
            put("sessions", kotlinx.serialization.json.buildJsonArray {
                chatSessions.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) }
            })
            put("messages", kotlinx.serialization.json.buildJsonArray {
                chatMessages.forEach { msg ->
                    add(kotlinx.serialization.json.buildJsonObject {
                        put("role", kotlinx.serialization.json.JsonPrimitive(msg.role))
                        put("content", kotlinx.serialization.json.JsonPrimitive(msg.content))
                        put("files", kotlinx.serialization.json.buildJsonArray {
                            msg.files.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) }
                        })
                    })
                }
            })
        }
        runCatching { chatFile().writeText(kx.toString()) }
    }

    fun newChatSession() {
        val id = "s" + System.currentTimeMillis()
        chatSessions = listOf(id) + chatSessions
        chatCurrent = id
        chatMessages = emptyList()
        saveChat()
    }

    fun selectChatSession(id: String) {
        chatCurrent = id
        saveChat()
    }

    fun deleteChatSession() {
        chatSessions = chatSessions.filterNot { it == chatCurrent }
        if (chatSessions.isEmpty()) newChatSession()
        chatMessages = emptyList()
        saveChat()
    }

    // ---------- чат: агентный цикл с инструментами ----------

    private var agentJob: Job? = null

    val chatBusy: Boolean get() = chatTyping

    fun stopChat() {
        agentJob?.cancel()
        agent.stop()
        chatTyping = false
    }

    fun sendChatWithAttachments(text: String) {
        val attach = chatAttach
        chatAttach = emptyList()
        if (text.isBlank() && attach.isEmpty()) return
        if (chatTyping) {
            say("Дождитесь ответа или нажмите «Стоп»", "err")
            return
        }
        val userMsg = ChatMsg("user", text, files = attach.map { it.first }, images = attach.indices.toList())
        chatMessages = chatMessages + userMsg
        saveChat()
        chatTyping = true
        val settingsSnapshot = settings
        agentJob = viewModelScope.launch {
            val events = ArrayList<AgentEvent>()
            try {
                val history = chatMessages
                    .filter { it.role == "user" || it.role == "ai" }
                    .dropLast(1)
                    .takeLast(10)
                    .map { Msg(if (it.role == "user") "user" else "assistant", it.content) }
                val imageData = attach.mapNotNull { if (it.third.isNotEmpty()) it.third else null }
                agent.run(settingsSnapshot, history, text, imageData) { ev ->
                    events.add(ev)
                    when (ev) {
                        is AgentEvent.Text -> chatMessages = chatMessages + ChatMsg("ai", ev.text)
                        is AgentEvent.Reasoning -> appendToLastAi { it.copy(reasoning = ev.text) }
                        is AgentEvent.ToolStart -> appendToLastAi {
                            it.copy(tools = it.tools + ToolRun(ev.name, "запускается…", true))
                        }

                        is AgentEvent.ToolDone -> markLastTool(ev.name, ev.summary, true)
                        is AgentEvent.ToolError -> markLastTool(ev.name, ev.message, false)
                        is AgentEvent.Failed -> {
                            chatMessages = chatMessages + ChatMsg("err", ev.message)
                        }

                        else -> Unit
                    }
                }
            } catch (e: Throwable) {
                chatMessages = chatMessages + ChatMsg("err", "Ошибка: ${e.message}")
            } finally {
                chatTyping = false
                saveChat()
            }
        }
    }

    private fun appendToLastAi(block: (ChatMsg) -> ChatMsg) {
        if (chatMessages.lastOrNull()?.role != "ai") {
            chatMessages = chatMessages + ChatMsg("ai", "", tools = emptyList())
        }
        chatMessages = chatMessages.dropLast(1) + block(chatMessages.last())
    }

    private fun markLastTool(name: String, summary: String, ok: Boolean) {
        appendToLastAi { m ->
            val idx = m.tools.indexOfLast { it.summary == "запускается…" }
            if (idx < 0) m.copy(tools = m.tools + ToolRun(name, summary, ok))
            else m.copy(tools = m.tools.toMutableList().also { it[idx] = ToolRun(name, summary, ok) })
        }
    }

    /** Содержимое сообщения для запроса к модели: файлы — текстом, картинки — картинками. */
    private fun ChatMsg.asRequestText(): String {
        if (files.isEmpty()) return content
        return content
    }

    // ---------- каталог моделей ----------

    fun refreshCatalog(silent: Boolean = false) {
        viewModelScope.launch {
            if (!silent) progress = Prog(0.3, "Обновление каталога моделей…")
            val models = com.voicecomic.app.ai.Providers.refreshFromNetwork(getApplication(), http)
            if (!silent) progress = null
            say(
                if (models > 0) "Каталог обновлён: моделей $models" else "Каталог не обновился",
                if (models > 0) "ok" else "err"
            )
        }
    }

    /** Модель пропала из каталога — молча подтягиваем свежий и повторяем. */
    fun ensureModelExists(): Boolean {
        if (com.voicecomic.app.ai.Providers.isValidModel(settings)) return true
        viewModelScope.launch {
            com.voicecomic.app.ai.Providers.refreshFromNetwork(getApplication(), http)
            if (!com.voicecomic.app.ai.Providers.isValidModel(settings)) {
                say("Модель ${settings.aimodel} не найдена в каталоге — обнови каталог или выбери другую", "err")
            }
        }
        return false
    }

    // ---------- workspace ----------

    var workspaceTick by mutableIntStateOf(0)

    fun workspaceFiles(): List<java.io.File> = workspace.files()

    fun shareWorkspaceFile(file: java.io.File) {
        val dir = File(app_files(), "workspace")
        val rel = file.relativeTo(dir).path
        val copy = File(store.exportsDir(), rel.substringAfterLast('/').ifEmpty { "file.txt" })
        runCatching { file.copyTo(copy, overwrite = true) }
        shareFile(copy)
    }

    fun openWorkspaceFile(file: java.io.File) {
        val dir = File(app_files(), "workspace")
        val rel = file.relativeTo(dir).path
        val copy = File(store.exportsDir(), rel.substringAfterLast('/').ifEmpty { "file.txt" })
        runCatching { file.copyTo(copy, overwrite = true) }
        openFile(copy)
    }

    fun deleteWorkspaceFile(file: java.io.File) {
        val dir = File(app_files(), "workspace")
        workspace.delete(file.relativeTo(dir).path)
        say("Файл удалён")
    }

    fun clearWorkspace() {
        workspace.clear()
        say("Workspace очищен")
    }

    private fun app_files() = getApplication<Application>().filesDir

    // ---------- состояние UI и системные действия ----------

    var importModePages by mutableStateOf(true)

    /** Событие «нужно открыть системный выбор файлов»: pages | clips | music | project | chatfiles. */
    var pickRequest by mutableStateOf<String?>(null)

    var confirmReset by mutableStateOf(false)
    var openPageId by mutableStateOf<String?>(null)
    var previewOpen by mutableStateOf(false)

    /** Прикреплённые к чату файлы: имя, текст (для text-файлов), data-url (для картинок). */
    var chatAttach by mutableStateOf(listOf<Triple<String, String, String>>())

    fun openPage(id: String) {
        openPageId = id
    }

    fun pageNumber(bubbleId: String): Int =
        project.pages.indexOfFirst { pg -> pg.bubbles.any { it.id == bubbleId } } + 1

    fun pageIdOf(bubbleId: String): String =
        project.pages.firstOrNull { pg -> pg.bubbles.any { it.id == bubbleId } }?.id ?: ""

    fun onPickMusic() {
        pickRequest = "music"
    }

    fun setModelFor(pid: String, mid: String) {
        configure { it.copy(ai = pid, aimodel = mid) }
        modelPickerOpen = false
    }

    /**
     * Вложения чата. Тип определяем по magic-байтам, а не по mime от провайдера:
     * многие файловые менеджеры отдают null, и картинки молча уезжали в «текст».
     */
    fun attachChatFiles(uris: List<android.net.Uri>, nameOf: (android.net.Uri) -> String) {
        viewModelScope.launch {
            val out = ArrayList<Triple<String, String, String>>()
            var skipped = 0
            for (u in uris) {
                val name = nameOf(u)
                val bytes = withContext(Dispatchers.IO) {
                    runCatching {
                        getApplication<Application>().contentResolver.openInputStream(u)?.use { it.readBytes() }
                    }.getOrNull()
                } ?: continue
                val kind = com.voicecomic.app.chat.MimeSniff.kind(bytes)
                when (kind) {
                    "image" -> out.add(
                        Triple(name, "", "data:${com.voicecomic.app.chat.MimeSniff.imageMime(bytes)};base64," +
                            android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP))
                    )

                    "text" -> {
                        if (bytes.size > 400 * 1024) {
                            skipped++
                            continue
                        }
                        val text = String(bytes, Charsets.UTF_8)
                        if (Regex("[\\x00-\\x08\\x0E-\\x1F]").containsMatchIn(text.take(512))) {
                            skipped++
                            continue
                        }
                        out.add(Triple(name, text.take(400 * 1024), ""))
                    }

                    else -> skipped++
                }
            }
            chatAttach = chatAttach + out
            if (out.isEmpty()) {
                say("Поддерживаются только картинки и текстовые файлы (отброшено: $skipped)", "err")
            } else {
                say("Прикреплено файлов: ${out.size}" + if (skipped > 0) " · отброшено: $skipped" else "")
            }
        }
    }

    fun saveNow() {
        viewModelScope.launch {
            runCatching { store.save(projectId, project, settings) }
                .onSuccess { say("Сохранено") }
                .onFailure { say("Ошибка сохранения: ${it.message}", "err") }
        }
    }

    private fun shareUri(file: File): android.net.Uri {
        val authority = "${getApplication<Application>().packageName}.fileprovider"
        return androidx.core.content.FileProvider.getUriForFile(getApplication(), authority, file)
    }

    fun shareFile(file: File) {
        if (!file.exists()) {
            say("Файл не найден", "err")
            return
        }
        val mime = when (file.extension.lowercase()) {
            "mp4" -> "video/mp4"
            "wav" -> "audio/wav"
            "m4a" -> "audio/mp4"
            "json" -> "application/json"
            "md" -> "text/markdown"
            "txt" -> "text/plain"
            else -> "*/*"
        }
        val intent = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
            type = mime
            putExtra(android.content.Intent.EXTRA_STREAM, shareUri(file))
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        runCatching {
            getApplication<Application>().startActivity(
                android.content.Intent.createChooser(intent, "Поделиться").apply {
                    addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                }
            )
        }.onFailure { say("Не удалось открыть меню «Поделиться»: ${it.message}", "err") }
    }

    fun openFile(file: File) {
        if (!file.exists()) {
            say("Файл не найден", "err")
            return
        }
        val mime = when (file.extension.lowercase()) {
            "mp4" -> "video/mp4"
            "wav" -> "audio/wav"
            "m4a" -> "audio/mp4"
            else -> "*/*"
        }
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
            setDataAndType(shareUri(file), mime)
            addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { getApplication<Application>().startActivity(intent) }
            .onFailure { say("Нет приложения для открытия файла", "err") }
    }

    fun shareProjectJson() {
        viewModelScope.launch {
            val f = withContext(Dispatchers.IO) { exportProjectJson() }
            shareFile(f)
        }
    }

    fun shareScenarioTxt() {
        viewModelScope.launch {
            val f = withContext(Dispatchers.IO) {
                val rows = CastPlanner.allRows(project.pages)
                val sb = StringBuilder()
                for ((i, r) in rows.withIndex()) {
                    val role = roleOf(r.bubble.roleId)
                    val voiced = if (r.bubble.audio != null) " 🔊" else ""
                    val tr = if (r.bubble.tr.isNotEmpty()) " (${r.bubble.tr})" else ""
                    sb.appendLine("[${{{i + 1}}}] ${role?.emoji ?: ""} ${role?.name ?: "—"}: ${r.bubble.text}$tr$voiced")
                }
                val out = File(store.exportsDir(), "scenario_${System.currentTimeMillis()}.txt")
                out.writeText(sb.toString())
                out
            }
            shareFile(f)
        }
    }
}
