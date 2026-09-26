package com.voicecomic.app.render

import com.voicecomic.app.audio.Pcm
import com.voicecomic.app.data.Bubble
import com.voicecomic.app.data.Page
import com.voicecomic.app.data.Role
import kotlin.math.max
import kotlin.math.min

data class Item(
    val page: Page,
    val pageIndex: Int,
    val bubble: Bubble?,
    val t: Double,
    val dur: Double,
    val kind: String // line | idle
)

data class Cam(val sx: Float, val sy: Float, val sw: Float, val sh: Float, val zoom: Float)

object Timeline {

    /** Пороги обрезки тишины для озвучки (единая точка правды, как TRIM в engine.js). */
    const val TRIM_THRESHOLD = 0.012
    const val TRIM_MARGIN = 0.05
    const val TRIM_MIN_DUR = 0.25

    fun build(pages: List<Page>, gapMs: Int): Pair<List<Item>, Double> {
        val gap = (gapMs / 1000.0)
        val items = ArrayList<Item>()
        var t = 0.0
        for ((pi, page) in pages.withIndex()) {
            if (page.bubbles.isEmpty()) {
                items.add(Item(page, pi, null, t, 1.8, "idle"))
                t += 1.8
                continue
            }
            t += 0.55
            for ((bi, b) in page.bubbles.withIndex()) {
                t += if (bi == 0) 0.25 else gap
                val dur = b.audio?.duration?.takeIf { it > 0 } ?: Pcm.estimateSpeakDuration(b.text)
                items.add(Item(page, pi, b, t, dur, "line"))
                t += dur
                t += gap * 0.6
            }
            t += 0.5
        }
        return items to (t + 0.9)
    }

    fun roleGain(role: Role?): Float {
        if (role == null) return 1f
        val pct = if (role.volumeNum in 1..1000) role.volumeNum.toDouble() else run {
            val m = Regex("^\\s*([+-]?\\d+(?:\\.\\d+)?)\\s*%\\s*$").find(role.volume)
            val v = m?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
            100 + v
        }
        return (pct / 100.0).coerceIn(0.0, 2.0).toFloat()
    }

    fun bubbleHasBox(b: Bubble, page: Page): Boolean {
        if (page.bubblesHaveBoxes.not()) return false
        return b.hasBox()
    }

    private fun smooth(a: Double): Double = a * a * (3 - 2 * a)

    private fun clampV(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))

    /** Камера Ken Burns: возвращает вырезку исходника в пикселях страницы. */
    fun cameraFor(item: Item, clock: Double, cw: Int, ch: Int, zoomMode: String): Cam {
        val pw = (if (item.page.w > 0) item.page.w else 1).toDouble()
        val ph = (if (item.page.h > 0) item.page.h else 1).toDouble()
        val cover = max(cw / pw, ch / ph)
        val b = item.bubble
        val hasBox = b != null && bubbleHasBox(b, item.page)

        if (hasBox && zoomMode != "none") {
            val bcx = b!!.x!! + b.w!! / 2
            val bcy = b.y!! + b.h!! / 2
            val crop = when (zoomMode) {
                "pan" -> cover * 1.15
                else -> {
                    val prog = smooth(min(1.0, max(0.0, (clock - item.t) / item.dur)))
                    val zoomFrom = cover * 1.2
                    val zoomTo = cover * max(
                        1.0,
                        min(2.6, max(cw / (b.w!! * 1.3 + 1), ch / (b.h!! * 1.3 + 1)))
                    )
                    zoomFrom + (zoomTo - zoomFrom) * prog
                }
            }
            val vw = cw / crop
            val vh = ch / crop
            val sx = clampV(bcx - vw / 2, 0.0, max(0.0, pw - vw))
            val sy = clampV(bcy - vh / 2, 0.0, max(0.0, ph - vh))
            return Cam(sx.toFloat(), sy.toFloat(), vw.toFloat(), vh.toFloat(), crop.toFloat())
        }

        val z = if (zoomMode == "none") cover else cover * 1.12
        val vw = cw / z
        val vh = ch / z
        var sx = (pw - vw) / 2
        var sy = (ph - vh) / 2
        if (zoomMode == "pan" || zoomMode == "smart") {
            val phase = smooth(((clock - item.t) / (if (item.dur > 0) item.dur else 1.0)).coerceIn(0.0, 1.0))
            if (ph > pw * 1.2) {
                val r = max(0.0, ph - vh)
                sy = clampV((phase - 0.5) * 2 * r * 0.6 + ph / 2 - vh / 2, 0.0, r)
            } else {
                val r = max(0.0, pw - vw)
                sx = clampV((phase - 0.5) * 2 * r * 0.8 + pw / 2 - vw / 2, 0.0, r)
            }
        }
        sx = clampV(sx, 0.0, max(0.0, pw - vw))
        sy = clampV(sy, 0.0, max(0.0, ph - vh))
        return Cam(sx.toFloat(), sy.toFloat(), vw.toFloat(), vh.toFloat(), z.toFloat())
    }

    fun currentItem(items: List<Item>, clock: Double): Item? {
        if (items.isEmpty()) return null
        var cur = items[0]
        for (it in items) {
            if (it.t <= clock) cur = it else break
        }
        return cur
    }

    fun resolveSize(res: String, pages: List<Page>): Pair<Int, Int> {
        if (res != "auto") {
            val p = res.split("x")
            return (p.getOrNull(0)?.toIntOrNull() ?: 1080) to (p.getOrNull(1)?.toIntOrNull() ?: 1920)
        }
        val p0 = pages.firstOrNull()
        val ratio = if (p0 != null && p0.h > 0 && p0.w > 0) p0.h.toDouble() / p0.w else 16.0 / 9
        val h = 1080
        var w = Math.round(h / ratio).toInt()
        w -= w % 2
        return w.coerceAtLeast(2) to h
    }
}
