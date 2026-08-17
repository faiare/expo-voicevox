package expo.modules.voicevox

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.zip.GZIPInputStream

/**
 * tar.gz の展開。OpenJTalk 辞書が tar.gz でしか配布されていないため必要になる。
 *
 * gzip は JDK の [GZIPInputStream] をそのまま使い、tar は ustar の通常ファイルと
 * ディレクトリだけを読む素朴な実装。voicevox が配布する辞書はこの 2 種類しか含まない。
 */
object VoicevoxArchive {
  private const val BLOCK_SIZE = 512
  private const val BUFFER_SIZE = 1 shl 16

  /** [source] の tar.gz を [destination] 直下へ展開する。 */
  fun extractTarGz(source: File, destination: File) {
    GZIPInputStream(source.inputStream().buffered(BUFFER_SIZE)).use { extractTar(it, destination) }
  }

  fun extractTar(input: InputStream, destination: File) {
    if (!destination.exists() && !destination.mkdirs()) {
      throw IOException("could not create ${destination.absolutePath}")
    }

    val header = ByteArray(BLOCK_SIZE)
    val buffer = ByteArray(BUFFER_SIZE)
    var emptyBlocks = 0

    while (true) {
      if (!input.readFully(header)) {
        // 終端ブロックが欠けている tar もあるので正常終了として扱う。
        return
      }
      if (header.all { it.toInt() == 0 }) {
        emptyBlocks += 1
        if (emptyBlocks == 2) return
        continue
      }
      emptyBlocks = 0

      val name = header.string(0, 100)
      val prefix = header.string(345, 155)
      val fullName = if (prefix.isEmpty()) name else "$prefix/$name"
      val size = header.octal(124, 12)
      val typeFlag = header[156].toInt().toChar()

      val target = destination.resolveSafely(fullName)

      when (typeFlag) {
        '5' -> if (!target.exists() && !target.mkdirs()) {
          throw IOException("could not create ${target.absolutePath}")
        }
        // 通常ファイルの typeflag は '0'。古い tar は NUL を使う。
        '0', '\u0000' -> {
          target.parentFile?.let { if (!it.exists() && !it.mkdirs()) {
            throw IOException("could not create ${it.absolutePath}")
          } }
          target.outputStream().buffered(BUFFER_SIZE).use { output ->
            var remaining = size
            while (remaining > 0) {
              val want = minOf(remaining, buffer.size.toLong()).toInt()
              val read = input.read(buffer, 0, want)
              if (read <= 0) throw IOException("the archive ended while reading $fullName")
              output.write(buffer, 0, read)
              remaining -= read
            }
          }
        }
        // pax の拡張ヘッダ。中身は使わないので読み飛ばす。
        'x', 'g' -> input.skipFully(size)
        else -> throw IOException("unsupported tar entry type '$typeFlag' for $fullName")
      }

      // 各エントリの本体は 512 バイト境界までパディングされている。
      val padding = ((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE)
      if (padding > 0) input.skipFully(padding)
    }
  }

  /** `..` や絶対パスで展開先の外に書き出されるのを防ぐ。 */
  private fun File.resolveSafely(name: String): File {
    val parts = name.split('/').filter { it.isNotEmpty() }
    if (name.startsWith("/") || parts.contains("..")) {
      throw IOException("the archive contains an unsafe path: $name")
    }
    return parts.fold(this) { current, part -> File(current, part) }
  }

  private fun ByteArray.string(offset: Int, length: Int): String {
    var end = offset
    while (end < offset + length && this[end].toInt() != 0) end += 1
    return String(this, offset, end - offset, Charsets.UTF_8).trim()
  }

  private fun ByteArray.octal(offset: Int, length: Int): Long =
    string(offset, length).takeIf { it.isNotEmpty() }?.toLongOrNull(8) ?: 0L

  /** [buffer] を埋めるまで読む。1 バイトも読めずに EOF なら false（tar の終端）。 */
  private fun InputStream.readFully(buffer: ByteArray): Boolean {
    var filled = 0
    while (filled < buffer.size) {
      val read = read(buffer, filled, buffer.size - filled)
      if (read < 0) {
        if (filled == 0) return false
        throw IOException("the archive ended unexpectedly")
      }
      filled += read
    }
    return true
  }

  private fun InputStream.skipFully(count: Long) {
    var remaining = count
    while (remaining > 0) {
      val skipped = skip(remaining)
      if (skipped <= 0) {
        if (read() < 0) throw IOException("the archive ended unexpectedly")
        remaining -= 1
      } else {
        remaining -= skipped
      }
    }
  }
}
