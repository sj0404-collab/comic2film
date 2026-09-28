package com.voicecomic.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Палитра 1:1 из css/ui.css. */
object Palette {
    val bg = Color(0xFF0F1420)
    val bg2 = Color(0xFF161D2E)
    val panel = Color(0xFF1B2438)
    val panel2 = Color(0xFF202A41)
    val line = Color(0xFF2C3A5E)
    val txt = Color(0xFFE8EDF7)
    val mut = Color(0xFF93A0B8)
    val acc = Color(0xFF5B8CFF)
    val acc2 = Color(0xFF8F6BFF)
    val ok = Color(0xFF3ECF9A)
    val warn = Color(0xFFFFB454)
    val bad = Color(0xFFFF6B7A)

    fun hex(s: String): Color = runCatching { Color(android.graphics.Color.parseColor(s)) }.getOrDefault(mut)
}

val AppGradient = Brush.linearGradient(listOf(Palette.acc, Palette.acc2))

@Composable
fun AppTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = androidx.compose.material3.darkColorScheme(
            primary = Palette.acc,
            onPrimary = Color(0xFF06121F),
            secondary = Palette.acc2,
            background = Palette.bg,
            onBackground = Palette.txt,
            surface = Palette.panel,
            onSurface = Palette.txt,
            surfaceVariant = Palette.panel2,
            onSurfaceVariant = Palette.mut,
            outline = Palette.line,
            error = Palette.bad,
        ),
        content = content
    )
}

@Composable
fun Card(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScopeAlias.() -> Unit
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.line, RoundedCornerShape(14.dp))
            .padding(14.dp)
    ) { content(ColumnScopeAlias) }
}

/** Обёртка, чтобы вложенные лямбды не тянуть ColumnScope. */
object ColumnScopeAlias

@Composable
fun CardTitle(text: String) {
    Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Palette.txt)
    Spacer(Modifier.height(8.dp))
}

@Composable
fun Muted(text: String, size: Int = 13) {
    Text(text, fontSize = size.sp, color = Palette.mut, lineHeight = (size * 1.45f).sp)
}

@Composable
fun Hint(text: String) {
    Text(text, fontSize = 12.sp, color = Palette.mut)
}

@Composable
fun PrimaryButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(if (enabled) AppGradient else Brush.linearGradient(listOf(Palette.panel2, Palette.panel2)))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 12.dp, vertical = 9.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = if (enabled) Color(0xFF06121F) else Palette.mut)
    }
}

@Composable
fun GhostButton(
    text: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit
) {
    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(Palette.panel)
            .border(1.dp, Palette.line, RoundedCornerShape(10.dp))
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, fontSize = 14.sp, color = if (enabled) Palette.txt else Palette.mut)
    }
}

@Composable
fun DangerButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, Palette.bad, RoundedCornerShape(10.dp))
            .clickable { onClick() }
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) { Text(text, fontSize = 14.sp, color = Palette.bad) }
}

@Composable
fun BigButton(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(if (enabled) AppGradient else Brush.linearGradient(listOf(Palette.panel2, Palette.panel2)))
            .clickable(enabled = enabled) { onClick() }
            .padding(vertical = 14.dp, horizontal = 18.dp),
        contentAlignment = Alignment.Center
    ) {
        Text(text, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = if (enabled) Color(0xFF06121F) else Palette.mut)
    }
}

@Composable
fun IconButton(text: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Text(
        text, fontSize = 20.sp, color = Palette.txt, modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .clickable { onClick() }
            .padding(6.dp)
    )
}

@Composable
fun Pill(text: String, active: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (active) Palette.acc else Palette.panel2)
            .border(1.dp, if (active) Palette.acc else Palette.line, RoundedCornerShape(999.dp))
            .clickable { onClick() }
            .padding(horizontal = 10.dp, vertical = 6.dp)
    ) {
        Text(
            text, fontSize = 12.sp,
            fontWeight = if (active) FontWeight.Bold else FontWeight.Normal,
            color = if (active) Color(0xFF06121F) else Palette.txt
        )
    }
}

@Composable
fun Segmented(
    options: List<String>,
    selected: Int,
    modifier: Modifier = Modifier,
    onSelect: (Int) -> Unit
) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .border(1.dp, Palette.line, RoundedCornerShape(10.dp))
    ) {
        options.forEachIndexed { i, opt ->
            Box(
                Modifier
                    .weight(1f)
                    .background(if (i == selected) Palette.acc else Color.Transparent)
                    .clickable { onSelect(i) }
                    .padding(vertical = 7.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    opt, fontSize = 13.sp,
                    fontWeight = if (i == selected) FontWeight.Bold else FontWeight.Normal,
                    color = if (i == selected) Color(0xFF06121F) else Palette.txt
                )
            }
        }
    }
}

@Composable
fun LabeledRow(label: String, content: @Composable () -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        Text(label, fontSize = 13.sp, color = Palette.mut)
        Spacer(Modifier.height(4.dp))
        content()
        Spacer(Modifier.height(6.dp))
    }
}

@Composable
fun ProgressBar(frac: Double, message: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(10.dp)
                .clip(RoundedCornerShape(6.dp))
                .background(Palette.bg2)
                .border(1.dp, Palette.line, RoundedCornerShape(6.dp))
        ) {
            Box(
                Modifier
                    .fillMaxWidth(frac.toFloat().coerceIn(0f, 1f))
                    .height(10.dp)
                    .background(AppGradient)
            )
        }
        Spacer(Modifier.height(4.dp))
        Muted(message, 12)
    }
}

@Composable
fun EmptyState(text: String) {
    Column(
        Modifier.fillMaxWidth().padding(vertical = 24.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) { Text(text, fontSize = 14.sp, color = Palette.mut) }
}

@Composable
fun RowGap(height: Int = 8) = Spacer(Modifier.height(height.dp))

@Composable
fun WidthGap(width: Int = 8) = Spacer(Modifier.width(width.dp))

@Composable
fun Dot(color: Color, size: Int = 9) {
    Box(Modifier.size(size.dp).clip(RoundedCornerShape(999.dp)).background(color))
}
