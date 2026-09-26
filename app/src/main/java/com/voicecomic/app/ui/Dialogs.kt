package com.voicecomic.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import com.voicecomic.app.AppViewModel
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.Page
import com.voicecomic.app.data.Role
import com.voicecomic.app.render.Timeline
import kotlin.math.roundToInt

@Composable
fun AppDialog(title: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    Dialog(onDismissRequest = onClose) {
        Column(
            Modifier
                .fillMaxWidth()
                .heightIn(max = 620.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(Palette.panel)
                .border(1.dp, Palette.line, RoundedCornerShape(16.dp))
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Palette.panel2)
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Palette.txt, modifier = Modifier.weight(1f))
                Text("✕", fontSize = 16.sp, color = Palette.mut, modifier = Modifier.clickable { onClose() }.padding(4.dp))
            }
            Column(Modifier.padding(14.dp)) { content() }
        }
    }
}

/** Предпросмотр: кадры рисует ViewModel, часы — MediaPlayer. */
@Composable
fun PreviewDialog(vm: AppViewModel, onClose: () -> Unit) {
    AppDialog("Предпросмотр · ${vm.fmtDur(vm.previewTotal)}", onClose) {
        val bmp = vm.previewBitmap
        val tick = vm.previewTick
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(9f / 16f)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.Black)
        ) {
            if (bmp != null) {
                // tick заставляет Compose перерисовать содержимое bitmap
                androidx.compose.runtime.key(tick) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = "кадр",
                        modifier = Modifier.fillMaxWidth().aspectRatio(9f / 16f),
                        contentScale = ContentScale.Fit
                    )
                }
            }
        }
        RowGap(8)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(if (vm.previewActive) "■ Стоп" else "▶ Запустить", Modifier.weight(1f)) {
                if (vm.previewActive) vm.stopPreview() else vm.startPreview()
            }
            GhostButton("Закрыть", Modifier.weight(1f)) {
                vm.stopPreview()
                onClose()
            }
        }
    }
}

/** Редактор страницы: рамки пузырей поверх картинки, правка текста и роли. */
@Composable
fun PageEditorDialog(vm: AppViewModel, page: Page, onClose: () -> Unit) {
    val bmp = remember(page.id, page.bubbles.size) { vm.pageBitmap(page) }
    var selectedId by remember { mutableStateOf(page.bubbles.firstOrNull { it.hasBox() }?.id) }

    AppDialog("Страница ${vm.project.pages.indexOfFirst { it.id == page.id } + 1}", onClose) {
        Column(Modifier.verticalScroll(rememberScrollState())) {
            if (bmp != null) {
                BoxWithConstraints(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color.Black)
                        .pointerInput(page.id) {
                            detectTapGestures { pos ->
                                val fx = pos.x / size.width.toFloat()
                                val fy = pos.y / size.height.toFloat()
                                val hit = page.bubbles.lastOrNull { b ->
                                    b.hasBox() &&
                                        fx * bmp.width >= b.x!! - 40 && fx * bmp.width <= b.x!! + b.w!! + 40 &&
                                        fy * bmp.height >= b.y!! - 40 && fy * bmp.height <= b.y!! + b.h!! + 40
                                }
                                if (hit != null) selectedId = hit.id
                            }
                        }
                ) {
                    val iw = maxWidth
                    val ih = iw * bmp.height / bmp.width
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = null,
                        modifier = Modifier.width(iw).height(ih),
                        contentScale = ContentScale.Fit
                    )
                    page.bubbles.forEach { b ->
                        if (!b.hasBox()) return@forEach
                        val role = vm.roleOf(b.roleId)
                        val color = role?.let { Palette.hex(it.color) } ?: Palette.acc
                        val isSel = selectedId == b.id
                        val bw = iw * (b.w!! / bmp.width)
                        val bh = ih * (b.h!! / bmp.height)
                        Box(
                            Modifier
                                .offset(x = iw * (b.x!! / bmp.width), y = ih * (b.y!! / bmp.height))
                                .width(bw)
                                .height(bh)
                                .border(if (isSel) 3.dp else 1.5.dp, color, RoundedCornerShape(6.dp))
                                .background(color.copy(alpha = 0.18f))
                        ) {
                            Text(
                                b.text.take(60),
                                fontSize = 10.sp,
                                color = Color.White,
                                modifier = Modifier.padding(2.dp),
                                maxLines = 4
                            )
                        }
                    }
                }
            } else {
                EmptyState("Не удалось показать страницу")
            }
            RowGap(8)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("＋ Пузырь", Modifier.weight(1f)) {
                    vm.addBubble(page.id)
                    selectedId = null
                }
                GhostButton("🗣 Озвучить все", Modifier.weight(1f)) { vm.voiceAll() }
            }
            selectedId?.let { id ->
                val b = page.bubbles.firstOrNull { it.id == id }
                if (b != null) {
                    RowGap(10)
                    Card {
                        CardTitle("Реплика")
                        Field(b.text, singleLine = false) { t ->
                            vm.updateBubble(page.id, b.id) { it.copy(text = t) }
                        }
                        RowGap(6)
                        SelectBox(
                            listOf("— роль —") + vm.project.roles.map { "${it.emoji} ${it.name}" },
                            if (b.roleId.isBlank()) 0 else vm.project.roles.indexOfFirst { it.id == b.roleId } + 1
                        ) { i ->
                            vm.updateBubble(page.id, b.id) {
                                it.copy(roleId = if (i == 0) "" else vm.project.roles[i - 1].id)
                            }
                        }
                        RowGap(6)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            PrimaryButton("▶", Modifier.weight(1f)) { vm.playBubble(page.id, b.id) }
                            GhostButton("🔎 OCR области", Modifier.weight(2f)) { vm.ocrRegion(page, b) }
                            GhostButton("🗑", Modifier.weight(1f)) {
                                vm.deleteBubble(page.id, b.id)
                                selectedId = null
                            }
                        }
                        RowGap(4)
                        Text(
                            "Координаты: ${b.x?.roundToInt() ?: 0}, ${b.y?.roundToInt() ?: 0} · " +
                                "${b.w?.roundToInt() ?: 0}×${b.h?.roundToInt() ?: 0}",
                            fontSize = 11.sp, color = Palette.mut
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ModelPickerDialog(vm: AppViewModel, onClose: () -> Unit) {
    val catalog = remember { com.voicecomic.app.ai.Providers.catalog() }
    var tab by remember { mutableStateOf("") }
    var cat by remember { mutableStateOf("nokey") }
    var curatedOnly by remember { mutableStateOf(true) }
    var query by remember { mutableStateOf("") }
    val metas = remember(catalog, tab, cat, curatedOnly, query) {
        com.voicecomic.app.ai.Providers.flat()
            .filter { tab.isEmpty() || it.pid == tab }
            .filter { !curatedOnly || it.curated }
            .filter {
                when (cat) {
                    "nokey" -> it.nokey
                    "free" -> it.free
                    "paid" -> it.paid
                    "vision" -> it.vision
                    "smart" -> it.smart
                    "orch" -> it.orchestrator
                    else -> true
                }
            }
            .filter {
                query.isBlank() ||
                    listOf(it.label, it.providerName, it.pid, it.mid).any { s -> s.contains(query, true) }
            }
            .sortedWith(compareBy({ com.voicecomic.app.ai.Providers.rank(it) }, { it.providerName }, { it.label }))
    }
    AppDialog("Модель ИИ — каталог", onClose) {
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            item { Pill("Все модели", tab.isEmpty()) { tab = "" } }
            items(catalog.map { it.id }.distinct()) { pid ->
                val p = catalog.first { it.id == pid }
                Pill("${if (p.key) "🔑" else "🆓"} ${p.name.substringBefore(" ·")}", tab == pid) { tab = pid }
            }
        }
        RowGap(6)
        LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val chips = listOf(
                "all" to "Все", "nokey" to "🆓 без ключа", "free" to "Бесплатно", "paid" to "Платно",
                "vision" to "👁 vision", "smart" to "🧠 умные", "orch" to "🎛 оркестратор"
            )
            items(chips) { (id, label) -> Pill(label, cat == id) { cat = id } }
        }
        RowGap(6)
        Field(query, placeholder = "Поиск по модели или провайдеру…") { query = it }
        RowGap(4)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (curatedOnly) "только проверенные" else "весь каталог",
                fontSize = 12.sp, color = Palette.mut, modifier = Modifier.weight(1f).clickable { curatedOnly = !curatedOnly }
            )
            Text("${metas.size}", fontSize = 12.sp, color = Palette.mut)
        }
        RowGap(6)
        Column(
            Modifier
                .heightIn(max = 340.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            metas.take(400).forEach { m ->
                val sel = vm.settings.aimodel == m.mid && vm.settings.ai == m.pid
                val health = vm.modelHealth["${m.pid}::${m.mid}"]
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(if (sel) Color(0xFF18233C) else Palette.panel2)
                        .border(1.dp, if (sel) Palette.acc else Palette.line, RoundedCornerShape(10.dp))
                        .clickable { vm.setModelFor(m.pid, m.mid) }
                        .padding(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(m.label, fontSize = 13.sp, color = Palette.txt, maxLines = 1)
                        Text(m.providerName, fontSize = 11.sp, color = Palette.mut, maxLines = 1)
                        val tags = buildList {
                            if (m.nokey) add("🆓 без ключа")
                            if (m.free) add("бесплатно")
                            if (m.paid) add("платно")
                            if (m.vision) add("👁 vision")
                            if (m.smart) add("🧠 умная")
                            if (m.orchestrator) add("🎛 оркестратор")
                            if (m.curated) add("проверено")
                        }
                        if (tags.isNotEmpty()) {
                            Text(tags.joinToString(" · "), fontSize = 10.sp, color = Palette.acc2, maxLines = 2)
                        }
                        health?.let { Text(it, fontSize = 10.sp, color = if (it.startsWith("отвечает")) Palette.ok else Palette.mut) }
                    }
                    GhostButton("⚡") { vm.verifyModel(m.pid, m.mid) }
                }
            }
            if (metas.isEmpty()) EmptyState("Ничего не найдено — ослабьте фильтры.")
        }
    }
}

@Composable
fun ResetDialog(vm: AppViewModel, onClose: () -> Unit) {
    AlertDialog(
        onDismissRequest = onClose,
        containerColor = Palette.panel,
        title = { Text("Сбросить проект и настройки?", color = Palette.txt) },
        text = { Text("Файлы страниц и нарезок будут удалены. Действие необратимо.", color = Palette.mut, fontSize = 13.sp) },
        confirmButton = {
            TextButton(onClick = { vm.resetAll(); onClose() }) { Text("Сбросить", color = Palette.bad) }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Отмена", color = Palette.mut) } }
    )
}
