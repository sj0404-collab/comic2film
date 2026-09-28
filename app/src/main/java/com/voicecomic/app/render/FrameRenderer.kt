package com.voicecomic.app.render

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.Role
import com.voicecomic.app.data.Settings
import kotlin.math.max
import kotlin.math.min

/**
 * Отрисовка кадра: вырезка страницы по камере + пузырь или субтитры.
 * Порт drawCaption/cameraFor из engine.js на android.graphics.
 */
class FrameRenderer(val outW: Int, val outH: Int) {

    private val src = Rect()
    private val dst = Rect(0, 0, outW, outH)
    private val rect = RectF()
    private val imagePaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG)
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create("sans-serif", Typeface.NORMAL) }

    fun drawFrame(canvas: Canvas, page: android.graphics.Bitmap?, item: Item, clock: Double, settings: Settings, zoom: String) {
        canvas.drawColor(Color.BLACK)
        val cam = Timeline.cameraFor(item, clock, outW, outH, zoom)
        if (page != null) {
            val pw = if (item.page.w > 0) item.page.w else page.width
            val ph = if (item.page.h > 0) item.page.h else page.height
            src.set(
                cam.sx.toInt().coerceIn(0, max(1, pw - 1)),
                cam.sy.toInt().coerceIn(0, max(1, ph - 1)),
                (cam.sx + cam.sw).toInt().coerceIn(1, pw),
                (cam.sy + cam.sh).toInt().coerceIn(1, ph)
            )
            if (src.width() > 0 && src.height() > 0) {
                canvas.drawBitmap(page, src, dst, imagePaint)
            }
        }
        drawCaption(canvas, item, settings, cam)
    }

    var roleResolver: (Item) -> Role? = { null }

    private fun drawCaption(canvas: Canvas, item: Item, settings: Settings, cam: Cam) {
        val role = roleResolver(item)
        val b = item.bubble ?: return
        val hasBox = Timeline.bubbleHasBox(b, item.page)
        val mode = if (hasBox) (settings.caption.ifEmpty { "bubble" }) else (if (settings.caption == "none") "none" else "sub")
        if (mode == "none") return

        val main: String
        val second: String
        when (settings.biling) {
            "tr" -> {
                main = b.tr.ifBlank { b.text }
                second = if (b.tr.isNotBlank()) b.text else ""
            }

            "origtr" -> {
                main = b.text
                second = b.tr
            }

            else -> {
                main = b.text
                second = ""
            }
        }
        if (mode == "bubble" && hasBox) drawBubble(canvas, b, main, role, cam)
        else drawSubtitle(canvas, main, second, role)
    }

    private fun measureM(size: Float): Float = run {
        text.textSize = size
        text.measureText("М")
    }

    private fun drawBubble(canvas: Canvas, b: Bubble, shown: String, role: Role?, cam: Cam) {
        // координаты пузыря живут в пикселях страницы — переводим их через камеру
        val kx = outW / cam.sw
        val ky = outH / cam.sh
        val x = (b.x!! - cam.sx) * kx
        val y = (b.y!! - cam.sy) * ky
        val w = b.w!! * kx
        val h = b.h!! * ky
        fill.color = Color.argb(235, 255, 255, 255)
        rect.set(x, y, x + w, y + h)
        val r = min(10f, min(w / 2, h / 2))
        canvas.drawRoundRect(rect, r, r, fill)
        stroke.color = parseColor(role?.color ?: "#555555")
        stroke.strokeWidth = max(2f, min(6f, outW / 300f))
        canvas.drawRoundRect(rect, r, r, stroke)

        val pad = max(4f, w * 0.04f)
        val size = max(13f, w / 14f)
        text.textSize = size
        text.color = Color.parseColor("#111111")
        text.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        val lineH = measureM(size) * 1.4f
        val maxLines = max(1, ((h - 2 * pad) / lineH).toInt())
        val lines = wrap(shown, w - 2 * pad, size)
        canvas.save()
        canvas.clipRect(x, y, x + w, y + h)
        lines.take(maxLines).forEachIndexed { i, ln ->
            canvas.drawText(ln, x + pad, y + pad + lineH * (i + 0.8f), text)
        }
        canvas.restore()

        if (role != null) {
            val label = (role.emoji + " " + role.name).trim()
            text.textSize = max(11f, outW / 130f)
            text.typeface = Typeface.create("sans-serif", Typeface.BOLD)
            text.color = parseColor(role.color)
            canvas.drawText(label, x + pad, max(2f, y - measureM(text.textSize) * 1.3f), text)
        }
    }

    private fun drawSubtitle(canvas: Canvas, main: String, second: String, role: Role?) {
        val lineH = max(26f, outH * 0.055f)
        val bandH = lineH * (if (second.isNotEmpty()) 2.1f else 1.25f) + 26f
        val top = outH - bandH
        fill.color = Color.argb(140, 0, 0, 0)
        canvas.drawRect(0f, top, outW.toFloat(), outH.toFloat(), fill)
        val fs = max(18f, outH * 0.042f)

        if (role != null) {
            text.typeface = Typeface.create("sans-serif", Typeface.BOLD)
            text.textSize = fs
            text.color = parseColor(role.color)
            val label = (role.emoji + " " + role.name).trim()
            canvas.drawText(label, outW / 2f - measureCentred(label, fs), top + 14f + fs * 0.6f, text)
        }
        text.typeface = Typeface.create("sans-serif", Typeface.BOLD)
        text.textSize = fs
        text.color = Color.WHITE
        val maxW = outW * 0.92f
        val lines = wrap(main, maxW, fs)
        var y = outH - (if (second.isNotEmpty()) bandH * 0.62f else bandH * 0.55f)
        lines.take(3).forEach { ln ->
            canvas.drawText(ln, outW / 2f - measureCentred(ln, fs), y, text)
            y += fs * 1.25f
        }
        if (second.isNotEmpty()) {
            text.typeface = Typeface.create("sans-serif", Typeface.NORMAL)
            text.textSize = fs * 0.72f
            text.color = Color.parseColor("#cfd8e8")
            canvas.drawText(
                wrap(second, maxW, text.textSize).take(2).joinToString(" "),
                outW / 2f - measureCentred(second, text.textSize),
                outH - lineH + text.textSize,
                text
            )
        }
    }

    private fun measureCentred(s: String, size: Float): Float {
        text.textSize = size
        return text.measureText(s) / 2f
    }

    /** Жадный перенос по пробелам — как wrapLines в util.js. */
    fun wrap(s: String, maxW: Float, size: Float): List<String> {
        text.textSize = size
        val out = ArrayList<String>()
        for (paragraph in s.split('\n')) {
            var line = StringBuilder()
            for (word in paragraph.split(Regex("\\s+"))) {
                if (word.isEmpty()) continue
                val probe = if (line.isEmpty()) word else "$line $word"
                if (text.measureText(probe) > maxW && line.isNotEmpty()) {
                    out.add(line.toString())
                    line = StringBuilder(word)
                } else {
                    line = StringBuilder(probe)
                }
            }
            if (line.isNotEmpty()) out.add(line.toString())
        }
        return out
    }

    companion object {
        fun parseColor(hex: String): Int = runCatching { Color.parseColor(hex) }.getOrDefault(Color.GRAY)
    }
}
