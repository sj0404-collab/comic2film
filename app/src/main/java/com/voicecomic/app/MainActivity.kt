package com.voicecomic.app

import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.voicecomic.app.importer.FileKinds
import com.voicecomic.app.ui.AppTheme
import com.voicecomic.app.ui.ChatScreen
import com.voicecomic.app.ui.ImportScreen
import com.voicecomic.app.ui.ModelPickerDialog
import com.voicecomic.app.ui.PageEditorDialog
import com.voicecomic.app.ui.Palette
import com.voicecomic.app.ui.PreviewDialog
import com.voicecomic.app.ui.RenderScreen
import com.voicecomic.app.ui.ResetDialog
import com.voicecomic.app.ui.RolesScreen
import com.voicecomic.app.ui.ScriptScreen
import com.voicecomic.app.ui.SettingsScreen
import kotlinx.coroutines.delay

private val TABS = listOf(
    "📥" to "Импорт", "🎬" to "Сценарий", "💬" to "Чат",
    "🎭" to "Голоса", "🎞" to "Монтаж", "⚙" to "Опции"
)

class MainActivity : ComponentActivity() {

    private val vm: AppViewModel by viewModels()

    private val pickFiles = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        handlePicked(uris)
    }
    private val pickProject =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri -> uri?.let { vm.importProjectJson(it) } }

    private fun displayName(uri: Uri): String {
        contentResolver.query(uri, null, null, null, null)?.use {
            val i = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (i >= 0 && it.moveToFirst()) return it.getString(i) ?: ""
        }
        return uri.lastPathSegment ?: ""
    }

    private fun handlePicked(uris: List<Uri>) {
        val kind = vm.pickRequest
        vm.pickRequest = null
        if (uris.isEmpty()) return
        when (kind) {
            "clips" -> vm.importClips(uris)
            "project" -> vm.importProjectJson(uris.first())
            "chatfiles" -> vm.attachChatFiles(uris, ::displayName)
            else -> {
                val names = uris.associateWith { displayName(it) }
                val pages = uris.filter { u ->
                    val n = names[u] ?: ""
                    FileKinds.isImageName(n) || FileKinds.isPdfName(n) || FileKinds.isArchiveName(n)
                }
                val clips = uris.filterNot { it in pages }
                if (pages.isEmpty() && clips.isEmpty()) {
                    vm.say("Не получилось определить тип файлов", "err")
                } else {
                    if (pages.isNotEmpty()) vm.importPages(pages)
                    if (clips.isNotEmpty()) vm.importClips(clips)
                }
            }
        }
    }

    private fun launch(kind: String) {
        vm.pickRequest = kind
        when (kind) {
            "project" -> pickProject.launch(arrayOf("application/json", "text/plain", "*/*"))
            "music" -> pickFiles.launch(arrayOf("audio/*", "video/*"))
            "clips" -> pickFiles.launch(arrayOf("audio/*", "video/*", "application/*"))
            "chatfiles" -> pickFiles.launch(arrayOf("image/*", "text/*", "application/json", "*/*"))
            else -> pickFiles.launch(arrayOf("*/*"))
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AppTheme { AppRoot(vm, ::launch) }
        }
    }
}

@Composable
fun AppRoot(vm: AppViewModel, launch: (String) -> Unit) {
    var tab by remember { mutableIntStateOf(0) }
    var showReset by remember { mutableStateOf(false) }

    LaunchedEffect(vm.pickRequest) {
        if (vm.pickRequest != null) launch(vm.pickRequest!!)
    }
    LaunchedEffect(vm.confirmReset) { if (vm.confirmReset) showReset = true }

    Scaffold(
        containerColor = Palette.bg,
        bottomBar = {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Palette.bg.copy(alpha = 0.96f))
                    .windowInsetsPadding(WindowInsets.navigationBars)
                    .padding(vertical = 8.dp)
            ) {
                TABS.forEachIndexed { i, (icon, label) ->
                    Column(
                        Modifier
                            .weight(1f)
                            .clickable { tab = i }
                            .padding(vertical = 2.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(icon, fontSize = 19.sp)
                        Text(
                            label,
                            fontSize = 11.sp,
                            color = if (i == tab) Palette.acc else Palette.mut,
                            fontWeight = if (i == tab) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                }
            }
        }
    ) { padding ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .background(Palette.bg)
                    .padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("🎬", fontSize = 24.sp)
                Text(" VoiceComic", fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, color = Palette.txt)
                Text(
                    "  комиксы → озвученное видео",
                    fontSize = 11.sp, color = Palette.mut, modifier = Modifier.weight(1f)
                )
                Text("＋", fontSize = 20.sp, color = Palette.txt, modifier = Modifier.clickable { showReset = true }.padding(4.dp))
            }

            Box(Modifier.weight(1f)) {
                when (tab) {
                    0 -> ImportScreen(vm) { launch(it) }
                    1 -> ScriptScreen(vm) { launch(it) }
                    2 -> ChatScreen(vm) { launch(it) }
                    3 -> RolesScreen(vm) { launch(it) }
                    4 -> RenderScreen(vm)
                    else -> SettingsScreen(vm) { launch(it) }
                }
            }
        }
    }

    if (vm.previewOpen) {
        PreviewDialog(vm) { vm.previewOpen = false; vm.stopPreview() }
    }
    if (vm.modelPickerOpen) {
        ModelPickerDialog(vm) { vm.modelPickerOpen = false }
    }
    vm.openPageId?.let { id ->
        vm.project.pages.firstOrNull { it.id == id }?.let { page ->
            PageEditorDialog(vm, page) { vm.openPageId = null }
        }
    }
    if (showReset) {
        ResetDialog(vm) { showReset = false }
    }

    vm.toast?.let { t ->
        LaunchedEffect(t.text) {
            delay(if (t.kind == "err") 5000 else 2800)
            vm.toast = null
        }
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
            Column(
                Modifier
                    .padding(16.dp)
                    .background(Palette.panel2, RoundedCornerShape(12.dp))
                    .border(
                        1.dp,
                        when (t.kind) {
                            "ok" -> Palette.ok
                            "err" -> Palette.bad
                            else -> Palette.acc
                        },
                        RoundedCornerShape(12.dp)
                    )
                    .padding(horizontal = 16.dp, vertical = 10.dp)
            ) { Text(t.text, fontSize = 14.sp, color = Palette.txt) }
        }
    }
}
