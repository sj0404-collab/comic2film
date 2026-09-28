package com.voicecomic.app.importer

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import com.voicecomic.app.audio.MediaAudioDecoder
import com.voicecomic.app.audio.Pcm
import com.voicecomic.app.data.Clip
import com.voicecomic.app.data.ClipSeg
import com.voicecomic.app.data.newId
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.util.zip.ZipFile

/**
 * Импорт исходников: PDF (PdfRenderer), CBZ/ZIP, CBR/RAR (junrar), картинки,
 * а также нарезка аудио/видео на фразы по тишине.
 */
class Importer(
    private val context: Context,
    private val projectDir: File
) {
    companion object {
        const val MAX_PAGES = 700
        private const val PDF_MAX_DIM = 1900
        private const val PDF_MAX_SCALE = 2.2
    }

    class ImportedPage(val name: String, val file: File, val width: Int, val height: Int, val size: Long)

    class ImportedClip(val name: String, val id: String, val duration: Double, val sr: Int, val segs: List<ClipSeg>)

    private val pagesDir = File(projectDir, "pages").apply { mkdirs() }
    private val clipsDir = File(projectDir, "clips").apply { mkdirs() }

    suspend fun importPages(
        uris: List<Uri>,
        password: String = "",
        onProgress: (Double, String) -> Unit
    ): List<ImportedPage> = withContext(Dispatchers.IO) {
        val out = ArrayList<ImportedPage>()
        for ((i, uri) in uris.withIndex()) {
            onProgress(i.toDouble() / uris.size, "Разбор ${nameOf(uri)}…")
            val name = nameOf(uri)
            val tmp = cacheFile(uri)
            val pages = when {
                FileKinds.isPdfName(name) -> extractPdf(tmp, onProgress)
                FileKinds.ext(name) in listOf("zip", "cbz") -> extractZip(tmp, onProgress)
                FileKinds.ext(name) in listOf("rar", "cbr") -> extractRar(tmp, password, onProgress)
                FileKinds.isImageName(name) -> listOf(decodeImage(tmp, name))
                FileKinds.isArchiveName(name) ->
                    throw IllegalStateException("Архив ${FileKinds.ext(name)} не поддерживается: используйте ZIP/CBZ или RAR/CBR")
                else -> throw IllegalStateException("Формат не поддерживается для страниц: ${FileKinds.ext(name).ifEmpty { "без расширения" }}")
            }
            for (p in pages) out.add(p)
            if (out.size >= MAX_PAGES) break
        }
        onProgress(1.0, "Готово")
        out
    }

    private fun nameOf(uri: Uri): String {
        val c = context.contentResolver.query(uri, null, null, null, null)
        c?.use {
            val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (idx >= 0 && it.moveToFirst()) return it.getString(idx) ?: "file"
        }
        return uri.lastPathSegment ?: "file"
    }

    private fun cacheFile(uri: Uri): File {
        val name = nameOf(uri)
        val f = File(context.cacheDir, "import_" + newId().take(8) + "_" + name.replace(Regex("[^A-Za-z0-9._-]"), "_"))
        context.contentResolver.openInputStream(uri)?.use { ins ->
            f.outputStream().use { ins.copyTo(it) }
        } ?: throw IllegalStateException("Не удалось открыть файл: $name")
        return f
    }

    // ---------- изображения ----------

    private fun saveBitmap(name: String, mime: String, bmp: Bitmap): ImportedPage {
        val ext = when {
            mime == "image/png" -> "png"
            mime == "image/webp" -> "webp"
            mime == "image/gif" -> "gif"
            else -> "jpg"
        }
        val fileName = "${newId()}.$ext"
        val f = File(pagesDir, fileName)
        f.outputStream().use {
            bmp.compress(
                if (ext == "png") Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG,
                if (ext == "png") 100 else 92,
                it
            )
        }
        return ImportedPage(name, f, bmp.width, bmp.height, f.length())
    }

    private fun decodeImage(src: File, name: String): ImportedPage {
        val bytes = src.readBytes()
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        var rotation = 0
        runCatching {
            val exif = ExifInterface(src.absolutePath)
            rotation = when (
                exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            ) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90
                ExifInterface.ORIENTATION_ROTATE_180 -> 180
                ExifInterface.ORIENTATION_ROTATE_270 -> 270
                else -> 0
            }
        }
        val bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            ?: throw IllegalStateException("Не удалось декодировать изображение: $name")
        val rotated = if (rotation != 0) {
            val m = Matrix().apply { postRotate(rotation.toFloat()) }
            Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true).also { if (it !== bmp) bmp.recycle() }
        } else bmp
        val mime = FileKinds.guessMime(name, bytes.copyOfRange(0, 12))
        return saveBitmap(name, mime, rotated)
    }

    // ---------- PDF ----------

    private fun extractPdf(file: File, onProgress: (Double, String) -> Unit): List<ImportedPage> {
        val pages = ArrayList<ImportedPage>()
        val pfd = android.os.ParcelFileDescriptor.open(file, android.os.ParcelFileDescriptor.MODE_READ_ONLY)
        android.graphics.pdf.PdfRenderer(pfd).use { renderer ->
            val count = renderer.pageCount
            for (i in 0 until count) {
                if (pages.size >= MAX_PAGES) break
                onProgress(i.toDouble() / count, "Растеризация страницы ${i + 1}/$count")
                renderer.openPage(i).use { page ->
                    val w = page.width
                    val h = page.height
                    val scale = minOf(
                        PDF_MAX_DIM.toDouble() / w,
                        PDF_MAX_DIM.toDouble() / h,
                        PDF_MAX_SCALE
                    )
                    val bw = Math.ceil(w * scale).toInt().coerceAtLeast(1)
                    val bh = Math.ceil(h * scale).toInt().coerceAtLeast(1)
                    val bmp = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
                    bmp.eraseColor(android.graphics.Color.WHITE)
                    page.render(bmp, null, null, android.graphics.pdf.PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    pages.add(saveBitmap("page_${(i + 1).toString().padStart(3, '0')}.jpg", "image/jpeg", bmp))
                    bmp.recycle()
                }
            }
        }
        pfd.close()
        file.delete()
        return pages
    }

    // ---------- ZIP / CBZ ----------

    private fun extractZip(file: File, onProgress: (Double, String) -> Unit): List<ImportedPage> {
        val pages = ArrayList<ImportedPage>()
        ZipFile(file).use { zip ->
            val names = zip.entries().asSequence()
                .filter { !it.isDirectory && FileKinds.isImageName(it.name) }
                .map { it.name }
                .sortedWith { a, b -> FileKinds.naturalCompare(a, b) }
                .toList()
            names.forEachIndexed { i, name ->
                if (pages.size >= MAX_PAGES) return pages
                onProgress((i + 1).toDouble() / maxOf(1, names.size), "Распаковка $name")
                zip.getInputStream(zip.getEntry(name)).use { input ->
                    val bytes = input.readBytes()
                    val tmp = File(context.cacheDir, "z_" + newId().take(8))
                    tmp.writeBytes(bytes)
                    pages.add(decodeImage(tmp, name))
                    tmp.delete()
                }
            }
        }
        file.delete()
        return pages
    }

    // ---------- RAR / CBR ----------

    private fun extractRar(
        file: File,
        password: String,
        onProgress: (Double, String) -> Unit
    ): List<ImportedPage> {
        val pages = ArrayList<ImportedPage>()
        val archive = com.github.junrar.Archive(
            com.github.junrar.volume.FileVolumeManager(file),
            com.github.junrar.ArchiveOptions.builder()
                .password(password)
                .build()
        )
        val headers = archive.fileHeaders
            .filter { !it.isDirectory }
            .filter { FileKinds.isImageName(it.fileName) }
            .sortedBy { it.fileName }
        headers.forEachIndexed { i, header ->
            if (i >= MAX_PAGES) return pages
            onProgress(pages.size.toDouble() / maxOf(1, headers.size), "Распаковка ${header.fileName}")
            archive.getInputStream(header).use { input ->
                val bytes = input.readBytes()
                val tmp = File(context.cacheDir, "r_" + newId().take(8))
                tmp.writeBytes(bytes)
                pages.add(decodeImage(tmp, header.fileName))
                tmp.delete()
            }
        }
        archive.close()
        file.delete()
        return pages
    }

    // ---------- аудио / видео -> нарезки ----------

    suspend fun importClips(
        uris: List<Uri>,
        onProgress: (Double, String) -> Unit
    ): List<ImportedClip> = withContext(Dispatchers.IO) {
        val out = ArrayList<ImportedClip>()
        for ((i, uri) in uris.withIndex()) {
            val name = nameOf(uri)
            onProgress(i.toDouble() / uris.size, "Декод $name…")
            val tmp = cacheFile(uri)
            val decoded = MediaAudioDecoder.decode(tmp)
                ?: throw IllegalStateException("Не удалось прочитать звук: $name")
            onProgress(0.9, "Нарезка по тишине…")
            val trim = Pcm.trimSilence(decoded.samples, decoded.sr)
            val body = decoded.samples.copyOfRange(trim.start, trim.end)
            val segs = Pcm.sliceSegments(body, decoded.sr)
            val clipId = newId()
            val dir = File(clipsDir, clipId).apply { mkdirs() }
            val list = ArrayList<ClipSeg>()
            segs.forEachIndexed { si, s ->
                val from = (s.startS * decoded.sr).toInt()
                val count = ((s.endS - s.startS) * decoded.sr).toInt()
                val pcm = Pcm.floatToPcm16(body, from, count)
                val name2 = "seg-$si.wav"
                Pcm.writeWav(File(dir, name2), pcm, decoded.sr)
                list.add(
                    ClipSeg(
                        startS = s.startS + trim.start.toDouble() / decoded.sr,
                        endS = s.endS + trim.start.toDouble() / decoded.sr,
                        duration = s.endS - s.startS,
                        file = "clips/$clipId/$name2"
                    )
                )
            }
            tmp.delete()
            out.add(ImportedClip(name, clipId, decoded.duration, decoded.sr, list))
            onProgress(1.0, "Нарезка выполнена")
        }
        out
    }

}
