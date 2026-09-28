package com.voicecomic.app.ocr

import android.graphics.Bitmap
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

data class OcrBubble(
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
    val text: String,
    val order: Float? = null
)

data class OcrResult(
    val bubbles: List<OcrBubble>,
    val raw: String,
    val boxes: Boolean,
    val w: Int,
    val h: Int
)

/** Прямоугольник с текстом — и слово, и пузырь после кластеризации. */
data class Box(val x: Float, val y: Float, val w: Float, val h: Float, val text: String)

/**
 * OCR на ML Kit (модели лежат в APK). Поведение повторяет ocr.js:
 * масштабирование до 1600 px, кластеризация слов в пузыри, порядок чтения.
 */
object MlKitOcr {

    private const val MAX_DIM = 1600

    private fun recognizerFor(lang: String): TextRecognizer = TextRecognition.getClient(
        when (lang) {
            "chi_sim" -> ChineseTextRecognizerOptions.Builder().build()
            "jpn" -> JapaneseTextRecognizerOptions.Builder().build()
            "kor" -> KoreanTextRecognizerOptions.Builder().build()
            else -> TextRecognizerOptions.DEFAULT_OPTIONS
        }
    )

    private fun scaleDown(bitmap: Bitmap): Pair<Bitmap, Float> {
        val maxSide = max(bitmap.width, bitmap.height)
        if (maxSide <= MAX_DIM) return bitmap to 1f
        val s = MAX_DIM.toDouble() / maxSide
        val w = max(1, (bitmap.width * s).roundToInt())
        val h = max(1, (bitmap.height * s).roundToInt())
        return Bitmap.createScaledBitmap(bitmap, w, h, true) to (w.toFloat() / bitmap.width)
    }

    suspend fun recognize(bitmap: Bitmap, lang: String): OcrResult {
        val (scaled, scale) = scaleDown(bitmap)
        val rec = recognizerFor(lang)
        val result = suspendCancellableCoroutine { cont ->
            rec.process(InputImage.fromBitmap(scaled, 0))
                .addOnSuccessListener { cont.resume(it) }
                .addOnFailureListener { cont.cancel(it) }
        }
        rec.close()

        val words = ArrayList<Box>()
        val sb = StringBuilder()
        for (block in result.textBlocks) {
            for (line in block.lines) {
                for (el in line.elements) {
                    val t = el.text.trim()
                    if (t.isEmpty()) continue
                    val r = el.boundingBox ?: continue
                    words.add(Box(r.left.toFloat(), r.top.toFloat(), r.width().toFloat(), r.height().toFloat(), t))
                }
                if (line.text.isNotBlank()) sb.appendLine(line.text)
            }
        }
        if (sb.isBlank() && result.text.isNotBlank()) sb.append(result.text)

        val rtl = lang == "jpn" || lang == "chi_sim" || lang == "kor"
        val vertical = lang == "jpn"
        val inv = if (scale == 0f) 1f else 1f / scale
        val ordered = sortReadingOrder(cluster(words, scaled.width, scaled.height), rtl, vertical)
        val bubbles = ordered.mapIndexed { i, b ->
            OcrBubble(b.x * inv, b.y * inv, b.w * inv, b.h * inv, b.text, i.toFloat() / max(1, ordered.size))
        }
        if (scaled !== bitmap) scaled.recycle()
        return OcrResult(bubbles, sb.toString().trim(), boxes = bubbles.isNotEmpty(), bitmap.width, bitmap.height)
    }

    /** Кластеризация слов в пузыри: union-find по близости (пороги из util.js). */
    fun cluster(words: List<Box>, pageW: Int, pageH: Int): List<Box> {
        val n = words.size
        if (n == 0) return emptyList()
        val thrX = max(14f, pageW * 0.055f)
        val thrY = max(12f, pageH * 0.028f)
        val parent = IntArray(n) { it }
        fun find(a: Int): Int {
            var x = a
            while (parent[x] != x) {
                parent[x] = parent[parent[x]]
                x = parent[x]
            }
            return x
        }

        for (i in 0 until n) {
            for (j in i + 1 until n) {
                val a = words[i]
                val b = words[j]
                val gapX = max(0f, max(a.x, b.x) - min(a.x + a.w, b.x + b.w))
                val gapY = max(0f, max(a.y, b.y) - min(a.y + a.h, b.y + b.h))
                if (gapX < thrX && gapY < thrY) {
                    val ra = find(i)
                    val rb = find(j)
                    if (ra != rb) parent[rb] = ra
                }
            }
        }
        val groups = HashMap<Int, MutableList<Box>>()
        for (i in 0 until n) groups.getOrPut(find(i)) { ArrayList() }.add(words[i])
        return groups.values.map { g ->
            var minX = Float.MAX_VALUE
            var minY = Float.MAX_VALUE
            var maxX = -Float.MAX_VALUE
            var maxY = -Float.MAX_VALUE
            for (w in g) {
                minX = min(minX, w.x); minY = min(minY, w.y)
                maxX = max(maxX, w.x + w.w); maxY = max(maxY, w.y + w.h)
            }
            val text = g.sortedWith(compareBy({ it.y }, { it.x })).joinToString(" ") { it.text }
                .replace(Regex("\\s+"), " ").trim()
            Box(minX, minY, maxX - minX, maxY - minY, text)
        }
    }

    /** Порядок чтения: 6 горизонтальных полос (или колонки для вертикального письма). */
    fun sortReadingOrder(bubbles: List<Box>, rtl: Boolean, vertical: Boolean, cols: Int = 2): List<Box> {
        if (bubbles.isEmpty()) return bubbles
        val pageW = bubbles.maxOf { it.x + it.w }.takeIf { it > 0 } ?: 1f
        val pageH = bubbles.maxOf { it.y + it.h }.takeIf { it > 0 } ?: 1f
        if (vertical) {
            val byCol = bubbles.sortedWith(compareBy({ (it.x / (pageW / cols)).toInt() }, { it.y }, { it.x }))
            return if (rtl) byCol.reversed() else byCol
        }
        return bubbles.sortedWith(
            compareBy({ min(5, ((it.y + it.h / 2) / (pageH / 6)).toInt()) }, { if (rtl) -(it.x + it.w) else it.x })
        )
    }
}
