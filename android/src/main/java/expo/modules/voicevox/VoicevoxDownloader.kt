package expo.modules.voicevox

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * `assetSource: "download"` のときに音声モデルと辞書を取得する。
 *
 * 呼び出し元（`AsyncFunction`）は既にバックグラウンドスレッドなので同期実装でよい。
 */
object VoicevoxDownloader {
  private const val BUFFER_SIZE = 1 shl 16
  private const val CONNECT_TIMEOUT_MS = 30_000
  private const val READ_TIMEOUT_MS = 60_000

  /** 進捗の通知。[totalBytes] は Content-Length が無ければ 0。 */
  fun interface ProgressListener {
    fun onProgress(bytesWritten: Long, totalBytes: Long)
  }

  /**
   * [url] を [destination] へ保存し、期待値があれば検証する。
   * ダウンロード中は `.part` に書き、検証を通ってから rename する。
   *
   * [isCancelled] は 1 バッファごとに見る。173MB を 1 本で落とすので、
   * ファイル単位のチェックでは中断が効かない。
   */
  fun download(
    url: String,
    destination: File,
    expectedSize: Long?,
    expectedSha256: String?,
    isCancelled: () -> Boolean = { false },
    onProgress: ProgressListener
  ) {
    destination.parentFile?.let { if (!it.exists() && !it.mkdirs()) {
      throw IOException("could not create ${it.absolutePath}")
    } }

    val part = File(destination.parentFile, "${destination.name}.part")
    part.delete()

    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      connectTimeout = CONNECT_TIMEOUT_MS
      readTimeout = READ_TIMEOUT_MS
      instanceFollowRedirects = true
    }

    val digest = MessageDigest.getInstance("SHA-256")
    var written = 0L

    try {
      val status = connection.responseCode
      if (status !in 200..299) {
        throw IOException("failed to download $url: HTTP $status")
      }
      val total = connection.contentLengthLong.coerceAtLeast(0L)

      connection.inputStream.use { input ->
        part.outputStream().buffered(BUFFER_SIZE).use { output ->
          val buffer = ByteArray(BUFFER_SIZE)
          while (true) {
            if (isCancelled()) {
              throw VoicevoxCancelledException()
            }
            val read = input.read(buffer)
            if (read < 0) break
            output.write(buffer, 0, read)
            digest.update(buffer, 0, read)
            written += read
            onProgress.onProgress(written, total)
          }
        }
      }
    } catch (error: Throwable) {
      part.delete()
      throw error
    } finally {
      connection.disconnect()
    }

    if (expectedSize != null && written != expectedSize) {
      part.delete()
      throw IOException(
        "downloaded $url has an unexpected size: expected $expectedSize bytes, got $written"
      )
    }
    if (expectedSha256 != null) {
      val actual = digest.digest().joinToString("") { "%02x".format(it) }
      if (!actual.equals(expectedSha256, ignoreCase = true)) {
        part.delete()
        throw IOException(
          "downloaded $url has an unexpected sha256: expected $expectedSha256, got $actual"
        )
      }
    }

    destination.delete()
    if (!part.renameTo(destination)) {
      part.delete()
      throw IOException("could not move the downloaded file to ${destination.absolutePath}")
    }
  }
}
