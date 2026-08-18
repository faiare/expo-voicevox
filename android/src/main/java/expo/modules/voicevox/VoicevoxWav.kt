package expo.modules.voicevox

import java.io.IOException

/**
 * WAV（RIFF/WAVE）のヘッダを読んで、PCM 本体の位置とフォーマットを取り出す。
 *
 * voicevox-core が実際に出すのは 16 バイトの `fmt ` チャンク + `data` の 44 バイトヘッダだが、
 * 44 バイト決め打ちにはしていない。`synthesis()` は AudioQuery の `outputSamplingRate` /
 * `outputStereo` を反映するのでサンプルレートもチャンネル数も変わるうえ、RIFF は `fmt ` と
 * `data` のあいだに `LIST` / `fact` / `JUNK` を挟めるため。上流の出力が変わったときに
 * 無音になるより、ヘッダを読んだほうが安い。
 *
 * java.io だけで書いてあるので、端末を用意せず JVM のユニットテストで検証できる
 * （`VoicevoxArchive` と同じ方針）。
 */
data class VoicevoxWav(
  val sampleRate: Int,
  val channelCount: Int,
  val bitsPerSample: Int,
  /** PCM データの開始オフセット。 */
  val dataOffset: Int,
  /** PCM データのバイト数。フレーム境界に丸めてある。 */
  val dataSize: Int
) {
  val bytesPerFrame: Int
    get() = channelCount * (bitsPerSample / 8)

  val frameCount: Int
    get() = dataSize / bytesPerFrame

  val durationMillis: Long
    get() = frameCount * 1000L / sampleRate

  companion object {
    private const val RIFF_HEADER_SIZE = 12
    private const val CHUNK_HEADER_SIZE = 8
    private const val MIN_FMT_SIZE = 16
    private const val EXTENSIBLE_FMT_SIZE = 40
    private const val FORMAT_PCM = 1
    private const val FORMAT_EXTENSIBLE = 0xFFFE
    private const val MAX_SAMPLE_RATE = 384_000

    /** [bytes] の WAV ヘッダを解析する。読めない形なら [IOException]。 */
    fun parse(bytes: ByteArray): VoicevoxWav {
      if (bytes.size < RIFF_HEADER_SIZE) {
        throw IOException("the WAV data is too short: ${bytes.size} bytes")
      }
      // RIFX（ビッグエンディアン）は voicevox-core が出さないので受け付けない。
      val riff = bytes.ascii(0, 4)
      if (riff != "RIFF") {
        throw IOException("not a RIFF file: $riff")
      }
      val wave = bytes.ascii(8, 4)
      if (wave != "WAVE") {
        throw IOException("not a WAVE file: $wave")
      }

      var sampleRate = 0
      var channelCount = 0
      var bitsPerSample = 0
      var seenFormat = false

      var offset = RIFF_HEADER_SIZE
      while (offset + CHUNK_HEADER_SIZE <= bytes.size) {
        val id = bytes.ascii(offset, 4)
        val declared = bytes.uint32(offset + 4)
        val body = offset + CHUNK_HEADER_SIZE
        // 宣言サイズが残量を超える WAV は珍しくない（長さが決まる前に書き出したものは
        // 0 や 0xFFFFFFFF が入る）。読み取りは残量で頭打ちにする。
        val size = minOf(declared, (bytes.size - body).toLong()).toInt()

        when (id) {
          "fmt " -> {
            if (size < MIN_FMT_SIZE) {
              throw IOException("the fmt chunk is too short: $size bytes")
            }
            val declaredFormat = bytes.uint16(body)
            channelCount = bytes.uint16(body + 2)
            sampleRate = bytes.int32(body + 4)
            bitsPerSample = bytes.uint16(body + 14)
            // WAVE_FORMAT_EXTENSIBLE は SubFormat GUID の先頭 2 バイトが実フォーマット。
            val format =
              if (declaredFormat == FORMAT_EXTENSIBLE && size >= EXTENSIBLE_FMT_SIZE) {
                bytes.uint16(body + 24)
              } else {
                declaredFormat
              }
            if (format != FORMAT_PCM) {
              throw IOException("unsupported WAV format: $format (only PCM is supported)")
            }
            seenFormat = true
          }
          "data" -> {
            if (!seenFormat) {
              throw IOException("the data chunk appears before the fmt chunk")
            }
            validate(sampleRate, channelCount, bitsPerSample)
            val bytesPerFrame = channelCount * (bitsPerSample / 8)
            if (size < bytesPerFrame) {
              throw IOException("the data chunk is empty")
            }
            return VoicevoxWav(
              sampleRate = sampleRate,
              channelCount = channelCount,
              bitsPerSample = bitsPerSample,
              dataOffset = body,
              // 半端なフレームは AudioTrack へ渡さない。
              dataSize = size - size % bytesPerFrame
            )
          }
        }
        // RIFF のチャンクは偶数バイト境界に揃う。奇数サイズならパディングを 1 バイト飛ばす。
        offset = body + size + (size and 1)
      }
      throw IOException("the WAV data has no data chunk")
    }

    private fun validate(sampleRate: Int, channelCount: Int, bitsPerSample: Int) {
      if (sampleRate !in 1..MAX_SAMPLE_RATE) {
        throw IOException("unsupported sample rate: $sampleRate")
      }
      if (channelCount !in 1..2) {
        throw IOException("unsupported channel count: $channelCount")
      }
      // AudioTrack へ流すのは 16bit PCM だけ。voicevox-core は常に 16bit を出す。
      if (bitsPerSample != 16) {
        throw IOException("unsupported bit depth: $bitsPerSample")
      }
    }

    private fun ByteArray.ascii(offset: Int, length: Int): String =
      String(this, offset, length, Charsets.US_ASCII)

    private fun ByteArray.uint16(offset: Int): Int =
      (this[offset].toInt() and 0xFF) or ((this[offset + 1].toInt() and 0xFF) shl 8)

    private fun ByteArray.int32(offset: Int): Int =
      (this[offset].toInt() and 0xFF) or
        ((this[offset + 1].toInt() and 0xFF) shl 8) or
        ((this[offset + 2].toInt() and 0xFF) shl 16) or
        ((this[offset + 3].toInt() and 0xFF) shl 24)

    private fun ByteArray.uint32(offset: Int): Long = int32(offset).toLong() and 0xFFFF_FFFFL
  }
}
