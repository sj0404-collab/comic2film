package com.voicecomic.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import com.voicecomic.app.AppViewModel
import com.voicecomic.app.ai.CastPlanner
import com.voicecomic.app.Toast
import com.voicecomic.app.ai.CastApply
import com.voicecomic.app.ai.CastPlanner as CP
import com.voicecomic.app.ai.Providers
import com.voicecomic.app.audio.VoiceCatalog
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.Clip
import com.voicecomic.app.data.Defaults
import com.voicecomic.app.data.Page
import com.voicecomic.app.data.Role
import com.voicecomic.app.render.Timeline
import java.io.File
import kotlin.math.roundToInt

@Composable
fun Field(
    value: String,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    singleLine: Boolean = true,
    onChange: (String) -> Unit
) {
    TextField(
        value = value,
        onValueChange = onChange,
        modifier = modifier.fillMaxWidth(),
        placeholder = { Text(placeholder, fontSize = 13.sp, color = Palette.mut) },
        singleLine = singleLine,
        visualTransformation = if (password) PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        textStyle = androidx.compose.ui.text.TextStyle(fontSize = 15.sp, color = Palette.txt),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = Palette.bg2,
            unfocusedContainerColor = Palette.bg2,
            disabledContainerColor = Palette.bg2,
            focusedIndicatorColor = Color.Transparent,
            unfocusedIndicatorColor = Color.Transparent,
            cursorColor = Palette.acc
        ),
        shape = RoundedCornerShape(10.dp)
    )
}

@Composable
fun SelectBox(
    options: List<String>,
    selected: Int,
    modifier: Modifier = Modifier,
    onSelect: (Int) -> Unit
) {
    var open by remember { mutableStateOf(false) }
    Box(modifier) {
        Row(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(Palette.bg2)
                .border(1.dp, Palette.line, RoundedCornerShape(10.dp))
                .clickable { open = true }
                .padding(horizontal = 10.dp, vertical = 9.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                options.getOrNull(selected) ?: "—",
                fontSize = 14.sp, color = Palette.txt, modifier = Modifier.weight(1f),
                maxLines = 1
            )
            Text("▾", fontSize = 12.sp, color = Palette.mut)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { i, opt ->
                DropdownMenuItem(
                    text = { Text(opt, fontSize = 14.sp, color = Palette.txt) },
                    onClick = { onSelect(i); open = false }
                )
            }
        }
    }
}

@Composable
fun SliderRow(
    label: String,
    value: Int,
    range: IntRange,
    steps: Int = 0,
    suffix: String = "",
    onChange: (Int) -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, fontSize = 13.sp, color = Palette.mut, modifier = Modifier.weight(1f))
            Text("$value$suffix", fontSize = 13.sp, color = Palette.txt)
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { onChange(it.roundToInt().coerceIn(range.first, range.last)) },
            valueRange = range.first.toFloat()..range.last.toFloat(),
            steps = steps,
            colors = SliderDefaults.colors(
                thumbColor = Palette.acc,
                activeTrackColor = Palette.acc,
                inactiveTrackColor = Palette.bg2
            )
        )
    }
}

@Composable
fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, fontSize = 13.sp, color = Palette.mut, modifier = Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

// ---------------- Импорт ----------------

@Composable
fun ImportScreen(vm: AppViewModel, onPick: (String) -> Unit) {
    val p = vm.project
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
    ) {
        Card {
            CardTitle("1 · Исходники")
            Muted("PDF, CBZ, CBR, RAR, ZIP, картинки — всё разбирается на устройстве, данные никуда не уходят. Аудио и видео режутся на фразы по тишине.")
            RowGap()
            Box(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Palette.bg2)
                    .border(2.dp, Palette.line, RoundedCornerShape(14.dp))
                    .padding(26.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📚", fontSize = 38.sp)
                    RowGap(4)
                    Text("Перетащите файлы сюда или нажмите «Выбрать файлы»", fontSize = 13.sp, color = Palette.mut, textAlign = TextAlign.Center)
                    RowGap(8)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton("📄 Страницы") { onPick("pages") }
                        PrimaryButton("🎵 Нарезки") { onPick("clips") }
                    }
                }
            }
            vm.progress?.let { RowGap(); ProgressBar(it.frac, it.text) }
        }
        RowGap(14)

        Card {
            CardTitle("Библиотека")
            Segmented(
                listOf("Страницы (${p.pages.size})", "Голосовые нарезки (${p.clips.size})"),
                if (vm.importModePages) 0 else 1
            ) { vm.importModePages = it == 0 }
            RowGap(10)
            if (vm.importModePages) {
                if (p.pages.isEmpty()) {
                    EmptyState("Пока пусто — загрузите файлы сверху.")
                } else {
                    val progress = vm.project.pages.indices.toList()
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.height(((p.pages.size + 2) / 3 * 130).dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(progress) { i ->
                            val page = p.pages[i]
                            Box(
                                Modifier
                                    .aspectRatio(3f / 4f)
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(Palette.bg2)
                                    .clickable { vm.openPage(page.id) }
                            ) {
                                pageThumb(vm, page)
                                Box(
                                    Modifier
                                        .align(Alignment.TopStart)
                                        .padding(4.dp)
                                        .clip(RoundedCornerShape(6.dp))
                                        .background(Color(0xAA000000))
                                        .padding(horizontal = 6.dp, vertical = 1.dp)
                                ) { Text("${i + 1}", fontSize = 11.sp, color = Color.White) }
                                Box(Modifier.align(Alignment.TopEnd).padding(4.dp).clickable { vm.deletePage(page) }) {
                                    Text("✕", fontSize = 11.sp, color = Color.White, modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Color(0xAA000000)).padding(3.dp))
                                }
                                if (page.bubbles.isNotEmpty()) {
                                    Box(Modifier.align(Alignment.BottomStart).padding(6.dp)) { Dot(Palette.ok) }
                                }
                            }
                        }
                    }
                }
            } else {
                if (p.clips.isEmpty()) {
                    EmptyState("Нарезок пока нет — загрузите аудио или видео.")
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        p.clips.forEach { clip -> ClipRow(vm, clip) }
                    }
                }
            }
        }
        RowGap(14)

        Card {
            CardTitle("Действия")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("🔎 Распознать весь текст") { vm.ocrAll() }
                PrimaryButton("🎭 Раздать роли ИИ") { vm.aiRoles() }
            }
        }
    }
}

@Composable
private fun pageThumb(vm: AppViewModel, page: Page) {
    val bmp = remember(page.id, page.file) { vm.pageBitmap(page) }
    if (bmp != null) {
        Image(
            bitmap = bmp.asImageBitmap(),
            contentDescription = page.name,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )
    }
}

@Composable
private fun ClipRow(vm: AppViewModel, clip: Clip) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.panel2)
            .border(1.dp, Palette.line, RoundedCornerShape(10.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text("▶", fontSize = 16.sp, color = Palette.acc)
        WidthGap()
        Column(Modifier.weight(1f)) {
            Text(clip.name, fontSize = 14.sp, color = Palette.txt, maxLines = 1)
            Text(
                "фраз: ${clip.count} · ${vm.fmtDur(clip.duration)}",
                fontSize = 12.sp, color = Palette.mut
            )
        }
        IconButton("🎵") { vm.useClipAsMusic(clip) }
        IconButton("✕") { vm.deleteClip(clip) }
    }
}

// ---------------- Сценарий ----------------

@Composable
fun ScriptScreen(vm: AppViewModel, onPick: (String) -> Unit) {
    val rows = CastPlanner.allRows(vm.project.pages)
    val (total, withRole, voiced) = CastApply.durationStats(vm.project.pages.flatMap { it.bubbles })
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
    ) {
        Card {
            CardTitle("2 · Сценарий и роли")
            Muted("Реплик: $total · с ролью: $withRole · озвучено: $voiced/$total · страниц: ${vm.project.pages.size}")
            RowGap(10)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("🔎 OCR") { vm.ocrAll() }
                    PrimaryButton("🎭 Роли (ИИ)", Modifier.weight(1f)) { vm.aiRoles() }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("🌐 Перевести", Modifier.weight(1f)) { vm.translateAll() }
                    PrimaryButton("🗣 Озвучить все", Modifier.weight(1f)) { vm.voiceAll() }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton("⬇ Сценарий txt", Modifier.weight(1f)) { vm.shareScenarioTxt() }
                    GhostButton("⬇ Проект json", Modifier.weight(1f)) { vm.shareProjectJson() }
                }
            }
        }
        RowGap(14)

        Card {
            CardTitle("Реплики")
            if (rows.isEmpty()) {
                EmptyState("Сначала распознайте текст или напишите реплики вручную.")
            } else {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    rows.forEach { row ->
                        BubbleRow(vm, row.pageIndex, row.pageId, row.bubble, vm.project.roles)
                    }
                }
            }
        }
    }
}

@Composable
private fun BubbleRow(
    vm: AppViewModel,
    pageIndex: Int,
    pageId: String,
    b: Bubble,
    roles: List<Role>
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.panel2)
            .border(1.dp, Palette.line, RoundedCornerShape(10.dp))
            .padding(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "стр. ${pageIndex + 1}",
                fontSize = 11.sp,
                color = Color.White,
                modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(Palette.acc).padding(horizontal = 6.dp, vertical = 2.dp)
            )
            WidthGap()
            SelectBox(
                listOf("— роль —") + roles.map { "${it.emoji} ${it.name}" },
                if (b.roleId.isBlank()) 0 else roles.indexOfFirst { it.id == b.roleId } + 1
            ) { i -> vm.updateBubble(pageId, b.id) { it.copy(roleId = if (i == 0) "" else roles[i - 1].id) } }
            WidthGap()
            IconButton(if (b.audio != null) "🔊" else "▶") { vm.playBubble(pageId, b.id) }
            IconButton("🗑") { vm.clearAudio(pageId, b.id) }
        }
        RowGap(4)
        Field(
            b.text, placeholder = "Текст реплики…",
            onChange = { t -> vm.updateBubble(pageId, b.id) { it.copy(text = t) } }
        )
        if (b.tr.isNotEmpty()) {
            Text("перевод: ${b.tr}", fontSize = 12.sp, color = Palette.mut)
        }
        if (b.audio != null) {
            Text("🔊 ${"%.2f".format(b.audio.duration)} c", fontSize = 11.sp, color = Palette.ok)
        }
    }
}

// ---------------- Голоса ----------------

@Composable
fun RolesScreen(vm: AppViewModel, onPick: (String) -> Unit) {
    val langPrefix = Defaults.LANG_LOCALE[vm.settings.lang] ?: "ru"
    val pool = remember(langPrefix) { VoiceCatalog.forLang(langPrefix).ifEmpty { VoiceCatalog.all() } }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
    ) {
        Card {
            CardTitle("3 · Труппа / голоса")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("🎭 Подобрать голоса", Modifier.weight(1f)) { vm.autoCast() }
                GhostButton("+ Персонаж") { vm.addRole() }
            }
            RowGap(8)
            Muted("Каждому персонажу — свой голос Edge-TTS с интонацией (высота, темп, громкость) или собственный голосовой клип. «Подобрать голоса» учитывает пол и язык и не трогает ручной выбор.")
            RowGap(6)
            GhostButton("🔄 Обновить каталог голосов", Modifier.fillMaxWidth()) { vm.refreshVoices() }
        }
        RowGap(14)

        vm.project.roles.forEach { role ->
            RoleCard(vm, role, pool)
            RowGap(10)
        }

        Card {
            CardTitle("Нарезки голосов")
            GhostButton("🎙 Аудио/видео → нарезки", Modifier.fillMaxWidth()) { onPick("clips") }
        }
    }
}

@Composable
private fun RoleCard(vm: AppViewModel, role: Role, pool: List<VoiceCatalog.Voice>) {
    val project = vm.project
    val roleRows = project.pages.flatMap { pg -> pg.bubbles.filter { it.roleId == role.id } }
    val clip = if (role.type == "clip") project.clips.firstOrNull { it.id == role.clipId } else null
    Card {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(role.emoji, fontSize = 24.sp)
            WidthGap()
            Field(
                role.name, modifier = Modifier.weight(1f), placeholder = "Имя",
                onChange = { t -> vm.updateRole(role.id) { it.copy(name = t) } }
            )
            IconButton("✕") { vm.deleteRole(role) }
        }
        RowGap(6)
        Segmented(listOf("Edge-TTS", "Свой клип"), if (role.type == "clip") 1 else 0) { i ->
            vm.updateRole(role.id) { it.copy(type = if (i == 1) "clip" else "edge") }
        }
        if (role.type == "clip") {
            RowGap(8)
            SelectBox(
                listOf("— клип —") + project.clips.map { it.name },
                if (role.clipId.isBlank()) 0 else project.clips.indexOfFirst { it.id == role.clipId } + 1
            ) { i ->
                vm.updateRole(role.id) { it.copy(clipId = if (i == 0) "" else project.clips[i - 1].id) }
            }
        } else {
            RowGap(8)
            SelectBox(
                pool.map { it.id },
                pool.indexOfFirst { it.id == role.voice }.coerceAtLeast(0)
            ) { i ->
                val v = pool[i]
                vm.updateRole(role.id) { it.copy(voice = v.id, manualVoice = true, gender = if (v.gender == "f") "female" else "male") }
            }
            RowGap(8)
            val styles = Defaults.TTS_STYLES.map { if (it.isEmpty()) "— стиль —" else it }
            SelectBox(styles, Defaults.TTS_STYLES.indexOf(role.style).coerceAtLeast(0)) { i ->
                vm.updateRole(role.id) { it.copy(style = Defaults.TTS_STYLES[i]) }
            }
            if (role.castReason.isNotEmpty()) {
                val reason = CP.REASON_TEXT[role.castReason] ?: role.castReason
                val warn = role.castReason == "reused" || role.castReason == "other-lang"
                Text(
                    "голос: $reason", fontSize = 12.sp,
                    color = if (warn) Palette.warn else Palette.mut
                )
            }
        }
        RowGap(4)
        SliderRow("Высота", role.pitchNum, -40..40, suffix = " Hz") { v ->
            vm.updateRole(role.id) { it.copy(pitchNum = v, pitch = (if (v > 0) "+" else "") + "$v" + "Hz") }
        }
        SliderRow("Темп", role.rateNum, -50..100, steps = 29, suffix = "%") { v ->
            vm.updateRole(role.id) { it.copy(rateNum = v, rate = (if (v > 0) "+" else "") + "$v" + "%") }
        }
        SliderRow("Громкость", role.volumeNum, 10..200, steps = 37, suffix = "%") { v ->
            val d = v - 100
            vm.updateRole(role.id) {
                it.copy(volumeNum = v, volume = (if (d > 0) "+" else "") + "$d" + "%")
            }
        }
        if (role.type == "clip" && clip != null) {
            RowGap(6)
            Text("🎙 нарезки: ${clip.count} · реплик у героя: ${roleRows.size}", fontSize = 12.sp, color = Palette.mut)
            Segmented(listOf("↔ по порядку записи", "⏱ по длительности"), if (role.takeMode == "duration") 1 else 0) { i ->
                vm.updateRole(role.id) { it.copy(takeMode = if (i == 1) "duration" else "order") }
            }
            val noTake = roleRows.count { it.audio == null }
            val extra = (clip.count - roleRows.size).coerceAtLeast(0)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("⚠ без нарезки: $noTake — озвучтся ИИ", fontSize = 12.sp, color = Palette.warn)
                if (extra > 0) Text("лишних нарезок: $extra", fontSize = 12.sp, color = Palette.mut)
            }
            roleRows.forEachIndexed { i, b ->
                val segIdx = b.clipSeg ?: (if (role.takeMode == "duration") i % clip.count.coerceAtLeast(1) else i % clip.count.coerceAtLeast(1))
                val seg = clip.segs.getOrNull(segIdx)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("стр. ${vm.pageNumber(b.id)}", fontSize = 11.sp, color = Palette.mut)
                    WidthGap(4)
                    Text(b.text.take(28), fontSize = 12.sp, color = Palette.txt, modifier = Modifier.weight(1f), maxLines = 1)
                    SelectBox(
                        listOf("№${segIdx + 1} · ${"%.1f".format(seg?.duration ?: 0.0)} c") + "— без нарезки —",
                        if (b.clipSeg == null) 1 else 0
                    ) { sel ->
                        vm.updateBubble(vm.pageIdOf(b.id), b.id) { it.copy(clipSeg = if (sel == 1) null else 0) }
                    }
                }
            }
        }
    }
}

// ---------------- Монтаж ----------------

@Composable
fun RenderScreen(vm: AppViewModel) {
    val s = vm.settings
    val (items, total) = remember(vm.project.pages, s.gap) { Timeline.build(vm.project.pages, s.gap) }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
    ) {
        Card {
            CardTitle("4 · Монтаж")
            LabeledRow("Разрешение") {
                SelectBox(Defaults.RESOLUTIONS, Defaults.RESOLUTIONS.indexOf(s.res).coerceAtLeast(0)) { i ->
                    vm.configure { it.copy(res = Defaults.RESOLUTIONS[i]) }
                }
            }
            SliderRow("Кадров в секунду", s.fps, 12..60, steps = 7, suffix = " fps") { v ->
                vm.configure { it.copy(fps = v) }
            }
            LabeledRow("Движение камеры (Ken Burns)") {
                SelectBox(listOf("smart", "zoom", "pan", "none"), listOf("smart", "zoom", "pan", "none").indexOf(s.zoom).coerceAtLeast(0)) { i ->
                    vm.configure { it.copy(zoom = listOf("smart", "zoom", "pan", "none")[i]) }
                }
            }
            LabeledRow("Стиль реплик") {
                SelectBox(listOf("bubble", "sub", "none"), listOf("bubble", "sub", "none").indexOf(s.caption).coerceAtLeast(0)) { i ->
                    vm.configure { it.copy(caption = listOf("bubble", "sub", "none")[i]) }
                }
            }
            LabeledRow("Двуязычные субтитры") {
                SelectBox(listOf("orig", "tr", "origtr"), listOf("orig", "tr", "origtr").indexOf(s.biling).coerceAtLeast(0)) { i ->
                    vm.configure { it.copy(biling = listOf("orig", "tr", "origtr")[i]) }
                }
            }
            SliderRow("Пауза между репликами", s.gap, 0..1500, steps = 29, suffix = " мс") { v ->
                vm.configure { it.copy(gap = v) }
            }
            LabeledRow("Фоновая музыка (необязательно)") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    GhostButton(if (s.music.isBlank()) "🎵 Выбрать файл" else "🎵 music.wav", Modifier.weight(1f)) {
                        vm.onPickMusic()
                    }
                    if (s.music.isNotBlank()) GhostButton("убрать") { vm.clearMusic() }
                }
            }
            SliderRow("Громкость музыки", s.mvol, 0..100, steps = 19, suffix = "%") { v ->
                vm.configure { it.copy(mvol = v) }
            }
            RowGap(6)
            Muted("Формат: MP4 (H.264 + AAC) собирается нативно через MediaCodec. Длительность: ${vm.fmtDur(total)} · кадров: ${items.size}.")
        }
        RowGap(14)

        Card {
            CardTitle("Сборка")
            vm.progress?.let { ProgressBar(it.frac, it.text) }
            BigButton("▶ Предпросмотр", enabled = !vm.busy) { vm.previewOpen = true; vm.startPreview() }
            RowGap(8)
            BigButton("🎬 Собрать видеофайл", enabled = !vm.busy) { vm.renderVideo() }
            RowGap(8)
            BigButton("🎧 Только аудио-дорожка", enabled = !vm.busy) { vm.renderAudioOnly() }
            vm.lastExport?.let { f ->
                RowGap(10)
                Text("💾 ${vm.lastExportLabel}", fontSize = 12.sp, color = Palette.ok)
                RowGap(6)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("📤 Поделиться", Modifier.weight(1f)) { vm.shareFile(f) }
                    PrimaryButton("▶ Открыть", Modifier.weight(1f)) { vm.openFile(f) }
                }
            }
        }
    }
}

// ---------------- Опции ----------------

@Composable
fun SettingsScreen(vm: AppViewModel, onPick: (String) -> Unit) {
    val s = vm.settings
    val catalog = remember { Providers.catalog() }
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(14.dp)
    ) {
        Card {
            CardTitle("5 · ИИ и движки")
            LabeledRow("OCR") {
                SelectBox(
                    listOf("ML Kit (на устройстве)") + Providers.visionProviders().map { it.name },
                    (listOf("mlkit") + Providers.visionProviders().map { it.id }).indexOf(s.ocr).coerceAtLeast(0)
                ) { i ->
                    val ids = listOf("mlkit") + Providers.visionProviders().map { it.id }
                    vm.configure { it.copy(ocr = ids[i]) }
                }
            }
            LabeledRow("Язык реплик") {
                SelectBox(Defaults.OCR_LANGS, Defaults.OCR_LANGS.indexOf(s.lang).coerceAtLeast(0)) { i ->
                    vm.configure { it.copy(lang = Defaults.OCR_LANGS[i]) }
                }
            }
            LabeledRow("Язык перевода") {
                val trs = listOf("ru", "en", "donot")
                SelectBox(listOf("русский", "английский", "не переводить"), trs.indexOf(s.trlang).coerceAtLeast(0)) { i ->
                    vm.configure { it.copy(trlang = trs[i]) }
                }
            }
            LabeledRow("ИИ-провайдер") {
                val ids = catalog.map { it.id }
                SelectBox(catalog.map { it.name }, ids.indexOf(s.ai).coerceAtLeast(0)) { i ->
                    val p = catalog[i]
                    val model = if (p.models.any { it.id == s.aimodel }) s.aimodel else (p.models.firstOrNull()?.id ?: s.aimodel)
                    vm.configure { it.copy(ai = p.id, aimodel = model) }
                }
            }
            val provider = Providers.provider(s.ai)
            if (provider.key) {
                LabeledRow("API-ключ") {
                    Field(s.key, placeholder = Providers.keyUrl(provider), password = true) { t ->
                        vm.configure { it.copy(key = t) }
                    }
                }
            }
            if (s.ai == "custom") {
                LabeledRow("Адрес OpenAI-совместимого API") {
                    Field(s.aiurl, placeholder = "http://10.0.2.2:11434/v1/chat/completions") { t ->
                        vm.configure { it.copy(aiurl = t) }
                    }
                }
            }
            LabeledRow("Модель") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Field(s.aimodel, modifier = Modifier.weight(1f), placeholder = "id модели") { t ->
                        vm.configure { it.copy(aimodel = t) }
                    }
                    PrimaryButton("🔍 Каталог") { vm.modelPickerOpen = true }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("⚡ Проверить", Modifier.weight(1f)) { vm.verifyModel(s.ai, s.aimodel) }
                GhostButton("🔄 Pollinations", Modifier.weight(1f)) { vm.refreshPollinations() }
            }
            vm.modelHealth["${s.ai}::${s.aimodel}"]?.let {
                Text("Статус: $it", fontSize = 12.sp, color = if (it.startsWith("отвечает")) Palette.ok else Palette.bad)
            }
            RowGap(6)
            Muted("Free tier OpenCode Zen без ключа работает напрямую из приложения — отдельный релей больше не нужен.")
        }
        RowGap(14)

        Card {
            CardTitle("Проект")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("💾 Сохранить", Modifier.weight(1f)) { vm.saveNow() }
                GhostButton("⬇ Экспорт json", Modifier.weight(1f)) { vm.shareProjectJson() }
            }
            RowGap(8)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("⬆ Импорт json", Modifier.weight(1f)) { onPick("project") }
                DangerButton("Сбросить", Modifier.weight(1f)) { vm.confirmReset = true }
            }
            RowGap(6)
            Hint("Проект хранится в файлах приложения и автосохраняется. Экспорт json содержит только сценарий — файлы импортируйте отдельно.")
        }
    }
}

// ---------------- Чат ----------------

@Composable
fun ChatScreen(vm: AppViewModel, onPick: (String) -> Unit) {
    var input by remember { mutableStateOf("") }
    Column(
        Modifier
            .fillMaxSize()
            .padding(14.dp)
    ) {
        Card(Modifier.weight(1f)) {
            CardTitle("💬 Чат с ИИ")
            Text(
                "Модель: ${vm.settings.ai} · ${vm.settings.aimodel}",
                fontSize = 12.sp, color = Palette.mut
            )
            RowGap(8)
            SelectBox(
                vm.chatSessions.map { "Сессия ${it.takeLast(6)}" }.ifEmpty { listOf("—") },
                vm.chatSessions.indexOf(vm.chatCurrent).coerceAtLeast(0)
            ) { i -> vm.selectChatSession(vm.chatSessions[i]) }
            RowGap(8)
            LazyColumn(
                Modifier
                    .fillMaxWidth()
                    .weight(1f),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                if (vm.chatMessages.isEmpty()) {
                    item {
                        EmptyState("Напишите что-нибудь или прикрепите файлы — ИИ ответит в контексте всей вашей работы.")
                    }
                }
                items(vm.chatMessages) { m ->
                    val who = when (m.role) {
                        "user" -> "Вы"
                        "ai" -> "ИИ"
                        else -> "Ошибка"
                    }
                    val bg = when (m.role) {
                        "user" -> Palette.acc
                        "ai" -> Palette.panel2
                        else -> Color(0x33253A4A)
                    }
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(bg)
                            .border(1.dp, if (m.role == "err") Palette.bad else Color.Transparent, RoundedCornerShape(12.dp))
                            .padding(10.dp)
                    ) {
                        Text(who, fontSize = 11.sp, color = if (m.role == "user") Color(0xFF06121F) else Palette.mut)
                        if (m.files.isNotEmpty()) {
                            m.files.forEach { Text("📎 $it", fontSize = 11.sp, color = Palette.mut) }
                        }
                        Text(m.content, fontSize = 14.sp, color = if (m.role == "user") Color(0xFF06121F) else Palette.txt)
                    }
                }
                if (vm.chatTyping) {
                    item { Text("ИИ печатает…", fontSize = 13.sp, color = Palette.mut) }
                }
            }
            if (vm.chatAttach.isNotEmpty()) {
                RowGap(6)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    vm.chatAttach.forEach { a ->
                        Text(
                            "📎 ${a.first} ✕",
                            fontSize = 11.sp,
                            color = Palette.mut,
                            modifier = Modifier.clickable { vm.chatAttach = vm.chatAttach - a }
                                .clip(RoundedCornerShape(8.dp))
                                .background(Palette.bg2)
                                .padding(horizontal = 8.dp, vertical = 4.dp)
                        )
                    }
                }
            }
            RowGap(8)
            Field(input, placeholder = "Сообщение…", singleLine = false) { input = it }
            RowGap(8)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("📎 Файлы") { onPick("chatfiles") }
                GhostButton("+ Сессия") { vm.newChatSession() }
                GhostButton("🗑") { vm.deleteChatSession() }
                PrimaryButton("➤", Modifier.weight(1f)) {
                    val t = input
                    input = ""
                    vm.sendChatWithAttachments(t)
                }
            }
        }
    }
}
