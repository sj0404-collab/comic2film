package com.voicecomic.app.audio

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okio.ByteString
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Edge-TTS через WSS — нативный клиент вместо voices.js.
 * Протокол и все константы перенесены один в один (см. комментарии про 403 и заголовки).
 */
class EdgeTts(private val client: OkHttpClient) {

    companion object {
        private const val HOST = "speech.platform.bing.com"
        private const val PATH = "/consumer/speech/synthesize/readaloud"
        private const val OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
        private val CLIENT = OkHttpClient.Builder()
            .readTimeout(65, TimeUnit.SECONDS)
            .connectTimeout(20, TimeUnit.SECONDS)
            .build()
    }

    data class Word(val offsetMs: Double, val durMs: Double, val text: String)

    class Synthesis(val mp3: ByteArray, val words: List<Word>)

    private val http = if (client === CLIENT) CLIENT else client

    /** RFC-1123 с «+0000» вместо GMT — сервер не принимает другие форматы. */
    private fun nowEdgeString(): String {
        val f = SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss", Locale.US)
        f.timeZone = TimeZone.getTimeZone("UTC")
        return f.format(Date()) + " GMT+0000"
    }

    fun voiceLocale(voiceId: String): String {
        val m = Regex("^\\s*([a-z]{2,3})-([A-Za-z]{2}|[0-9]{3})\\b").find(voiceId)
        return if (m != null) "${m.groupValues[1]}-${m.groupValues[2]}" else "en-US"
    }

    fun ssml(text: String, voice: String, pitch: String, rate: String, volume: String, style: String): String {
        val lang = voiceLocale(voice)
        val body = escape(text)
        val prosody = "<prosody pitch='$pitch' rate='$rate' volume='$volume'>$body</prosody>"
        val inner = if (style.isNotEmpty()) {
            "<mstts:express-as style='$style' styledegree='1'>$prosody</mstts:express-as>"
        } else prosody
        val mstts = if (style.isNotEmpty()) " xmlns:mstts='http://www.w3.org/2001/mstts'" else ""
        return "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis'$mstts xml:lang='$lang'>" +
            "<voice name='$voice'>$inner</voice></speak>"
    }

    private fun escape(s: String): String {
        val sb = StringBuilder(s.length + 16)
        for (ch in s) {
            val c = ch.code
            val drop = (c in 0x00..0x08) || (c in 0x0B..0x0C) || (c in 0x0E..0x1F)
            when {
                drop -> sb.append(' ')
                ch == '&' -> sb.append("&amp;")
                ch == '<' -> sb.append("&lt;")
                ch == '>' -> sb.append("&gt;")
                ch == '"' -> sb.append("&quot;")
                ch == '\'' -> sb.append("&apos;")
                else -> sb.append(ch)
            }
        }
        return sb.toString()
    }

    suspend fun synthesize(
        text: String,
        voice: String,
        pitch: String = "+0Hz",
        rate: String = "+0%",
        volume: String = "+0%",
        style: String = ""
    ): Synthesis = withContext(Dispatchers.IO) {
        val requestId = com.voicecomic.app.data.newId()
        val gec = Gec.value()
        val url = "wss://$HOST$PATH/edge/v1" +
            "?TrustedClientToken=${Gec.TRUSTED_CLIENT_TOKEN}" +
            "&ConnectionId=$requestId" +
            "&Sec-MS-GEC=$gec" +
            "&Sec-MS-GEC-Version=${Gec.GEC_VERSION}"
        val request = Request.Builder().url(url)
            .header("Origin", "https://$HOST")
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/${Gec.CHROMIUM}.0.0.0 Safari/537.36 Edg/${Gec.CHROMIUM}.0.0.0")
            .build()

        val audio = ByteArrayOutputStream()
        val words = ArrayList<Word>()
        val done = kotlinx.coroutines.CompletableDeferred<Synthesis>()
        var ended = false

        val socket = http.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val ts = nowEdgeString()
                webSocket.send(
                    "X-Timestamp:$ts\r\nContent-Type:application/json; charset=utf-8\r\n" +
                        "Path:speech.config\r\n\r\n" +
                        "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{" +
                        "\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"true\"}," +
                        "\"outputFormat\":\"$OUTPUT_FORMAT\"}}}}}\r\n"
                )
                webSocket.send(
                    "X-RequestId:$requestId\r\nContent-Type:application/ssml+xml\r\n" +
                        "X-Timestamp:${nowEdgeString()}\r\nPath:ssml\r\n\r\n" +
                        ssml(text, voice, pitch, rate, volume, style)
                )
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                when {
                    text.contains("audio.metadata") -> {
                        val idx = text.indexOf("\r\n\r\n")
                        if (idx >= 0) {
                            runCatching {
                                val root = Json.parseToJsonElement(text.substring(idx + 4)).jsonObject
                                for (m in (root["Metadata"] as? JsonArray).orEmpty()) {
                                    val o = m.jsonObject
                                    if (o["Type"]?.jsonPrimitive?.content == "WordBoundary") {
                                        val d = o["Data"]!!.jsonObject
                                        val off = (d["Offset"]?.jsonPrimitive?.content ?: "0").toDouble() / 10000.0
                                        val dur = (d["Duration"]?.jsonPrimitive?.content ?: "0").toDouble() / 10000.0
                                        val t = d["text"]?.jsonObject?.get("Text")?.jsonPrimitive?.content ?: ""
                                        words.add(Word(off, dur, t))
                                    }
                                }
                            }
                        }
                    }

                    text.contains("Path:turn.end") && !ended -> {
                        ended = true
                        done.complete(Synthesis(audio.toByteArray(), words))
                    }

                    text.contains("Path:response") && text.contains("path:false") ->
                        if (!done.isCompleted) {
                            done.completeExceptionally(IllegalStateException("Edge-TTS отклонил запрос (неверный голос)"))
                        }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val b = bytes.toByteArray()
                if (b.size < 2) return
                val hl = ((b[0].toInt() and 0xff) shl 8) or (b[1].toInt() and 0xff)
                val from = 2 + hl + 2
                if (from <= b.size) audio.write(b, from, b.size - from)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                if (!done.isCompleted) {
                    done.completeExceptionally(
                        IllegalStateException("Edge-TTS: сеть недоступна или сервер не ответил", t)
                    )
                }
            }
        })

        val watchdog = Thread {
            Thread.sleep(65_000)
            if (!done.isCompleted) {
                socket.close(1000, "timeout")
                done.completeExceptionally(IllegalStateException("Тайм-аут синтеза (проверьте интернет)"))
            }
        }.apply { isDaemon = true; start() }

        try {
            val res = done.await()
            res
        } finally {
            watchdog.interrupt()
            socket.close(1000, "done")
        }
    }
}
