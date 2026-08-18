package expo.modules.voicevox

import java.io.ByteArrayOutputStream
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * `VoicevoxWav` は java.io と ByteArray しか使わないので、Android 端末を用意せず
 * JVM のユニットテストで検証できる（`VoicevoxArchive` と同じ方針）。
 *
 * 本物の tar を読ませている `VoicevoxArchiveTest` と違い、WAV はここで組み立てる。
 * voicevox-core の実出力（16 バイト `fmt ` + `data` の 44 バイトヘッダ）だけを試しても、
 * 44 バイト決め打ちを避けるために入れた分岐が 1 つも通らないため。
 */
class VoicevoxWavTest {
  @Test
  fun `parses the 44 byte header voicevox emits`() {
    val wav = VoicevoxWav.parse(buildWav())

    assertEquals(24_000, wav.sampleRate)
    assertEquals(1, wav.channelCount)
    assertEquals(16, wav.bitsPerSample)
    assertEquals(44, wav.dataOffset)
    assertEquals(480, wav.dataSize)
    assertEquals(2, wav.bytesPerFrame)
  }

  @Test
  fun `computes the frame count and the duration`() {
    // 24kHz モノラル 16bit の 1 秒ぶん。
    val mono = VoicevoxWav.parse(buildWav(dataSize = 24_000 * 2))
    assertEquals(24_000, mono.frameCount)
    assertEquals(1_000L, mono.durationMillis)

    // 48kHz ステレオでは 1 フレーム 4 バイト。
    val stereo =
      VoicevoxWav.parse(buildWav(sampleRate = 48_000, channelCount = 2, dataSize = 48_000 * 4))
    assertEquals(4, stereo.bytesPerFrame)
    assertEquals(48_000, stereo.frameCount)
    assertEquals(1_000L, stereo.durationMillis)
  }

  @Test
  fun `skips chunks between fmt and data`() {
    val extras =
      listOf(
        "LIST" to ByteArray(26) { 'x'.code.toByte() },
        "fact" to ByteArray(4),
        "JUNK" to ByteArray(8)
      )

    val wav = VoicevoxWav.parse(buildWav(extraChunks = extras))

    // 44 + (8+26) + (8+4) + (8+8)
    assertEquals(106, wav.dataOffset)
    assertEquals(480, wav.dataSize)
  }

  @Test
  fun `accepts an 18 byte fmt chunk`() {
    val wav = VoicevoxWav.parse(buildWav(fmtBody = pcmFmtBody() + le16(0)))

    assertEquals(24_000, wav.sampleRate)
    assertEquals(46, wav.dataOffset)
  }

  @Test
  fun `accepts WAVE_FORMAT_EXTENSIBLE with a PCM subformat`() {
    val wav = VoicevoxWav.parse(buildWav(fmtBody = extensibleFmtBody(subFormat = 1)))

    assertEquals(24_000, wav.sampleRate)
    assertEquals(16, wav.bitsPerSample)
    assertEquals(68, wav.dataOffset)
  }

  @Test
  fun `skips the pad byte after an odd sized chunk`() {
    // 奇数サイズのチャンクの後ろには 1 バイトのパディングが入る。飛ばさないと
    // 次のチャンク ID が 1 バイトずれて "data" を見失う。
    val wav = VoicevoxWav.parse(buildWav(extraChunks = listOf("LIST" to ByteArray(5)), pad = true))

    assertEquals(58, wav.dataOffset)
    assertEquals(480, wav.dataSize)
  }

  @Test
  fun `clamps a data size that exceeds the buffer`() {
    // 長さが決まる前に書き出された WAV は data のサイズに 0xFFFFFFFF が入ることがある。
    val wav = VoicevoxWav.parse(buildWav(dataSize = 480, declaredDataSize = -1))

    assertEquals(480, wav.dataSize)
  }

  @Test
  fun `drops a partial trailing frame`() {
    // ステレオ 16bit は 1 フレーム 4 バイト。10 バイトは 2 フレーム + 2 バイト。
    val wav = VoicevoxWav.parse(buildWav(channelCount = 2, dataSize = 10))

    assertEquals(8, wav.dataSize)
    assertEquals(2, wav.frameCount)
  }

  @Test
  fun `rejects a truncated header`() {
    assertRejects("too short", ByteArray(11))
  }

  @Test
  fun `rejects a non RIFF file`() {
    val bytes = buildWav()
    "RIFX".toByteArray(Charsets.US_ASCII).copyInto(bytes, 0)

    assertRejects("not a RIFF file", bytes)
  }

  @Test
  fun `rejects a non WAVE file`() {
    val bytes = buildWav()
    "AVI ".toByteArray(Charsets.US_ASCII).copyInto(bytes, 8)

    assertRejects("not a WAVE file", bytes)
  }

  @Test
  fun `rejects data before fmt`() {
    assertRejects("before the fmt chunk", buildWav(dataFirst = true))
  }

  @Test
  fun `rejects a file without a data chunk`() {
    assertRejects("no data chunk", buildWav(omitData = true))
  }

  @Test
  fun `rejects a fmt chunk that is too short`() {
    assertRejects("fmt chunk is too short", buildWav(fmtBody = pcmFmtBody().copyOf(14)))
  }

  @Test
  fun `rejects IEEE float samples`() {
    assertRejects("unsupported WAV format: 3", buildWav(fmtBody = pcmFmtBody(audioFormat = 3)))
  }

  @Test
  fun `rejects an extensible chunk whose subformat is not PCM`() {
    assertRejects(
      "unsupported WAV format: 3",
      buildWav(fmtBody = extensibleFmtBody(subFormat = 3))
    )
  }

  @Test
  fun `rejects 8 bit and 24 bit samples`() {
    assertRejects("unsupported bit depth: 8", buildWav(bitsPerSample = 8))
    assertRejects("unsupported bit depth: 24", buildWav(bitsPerSample = 24))
  }

  @Test
  fun `rejects more than two channels`() {
    assertRejects("unsupported channel count: 6", buildWav(channelCount = 6))
  }

  @Test
  fun `rejects a zero sample rate`() {
    assertRejects("unsupported sample rate: 0", buildWav(sampleRate = 0))
  }

  @Test
  fun `rejects an empty data chunk`() {
    assertRejects("data chunk is empty", buildWav(dataSize = 0))
  }

  // ---------------------------------------------------------------------------
  // WAV の組み立て
  // ---------------------------------------------------------------------------

  private fun assertRejects(expected: String, bytes: ByteArray) {
    try {
      VoicevoxWav.parse(bytes)
      fail("expected an IOException containing: $expected")
    } catch (error: IOException) {
      assertTrue("actual message: ${error.message}", error.message!!.contains(expected))
    }
  }

  private fun le16(value: Int): ByteArray =
    byteArrayOf((value and 0xFF).toByte(), ((value ushr 8) and 0xFF).toByte())

  private fun le32(value: Int): ByteArray =
    byteArrayOf(
      (value and 0xFF).toByte(),
      ((value ushr 8) and 0xFF).toByte(),
      ((value ushr 16) and 0xFF).toByte(),
      ((value ushr 24) and 0xFF).toByte()
    )

  /** 標準的な 16 バイトの PCM `fmt ` 本体。 */
  private fun pcmFmtBody(
    audioFormat: Int = 1,
    channelCount: Int = 1,
    sampleRate: Int = 24_000,
    bitsPerSample: Int = 16
  ): ByteArray {
    val blockAlign = channelCount * (bitsPerSample / 8)
    return le16(audioFormat) +
      le16(channelCount) +
      le32(sampleRate) +
      le32(sampleRate * blockAlign) +
      le16(blockAlign) +
      le16(bitsPerSample)
  }

  /** 40 バイトの WAVE_FORMAT_EXTENSIBLE な `fmt ` 本体。 */
  private fun extensibleFmtBody(subFormat: Int): ByteArray =
    pcmFmtBody(audioFormat = 0xFFFE) +
      le16(22) + // cbSize
      le16(16) + // validBitsPerSample
      le32(0x3) + // channelMask
      le16(subFormat) + // SubFormat GUID の先頭 2 バイトが実フォーマット
      ByteArray(14)

  private fun chunk(id: String, body: ByteArray, declaredSize: Int? = null): ByteArray =
    id.toByteArray(Charsets.US_ASCII) + le32(declaredSize ?: body.size) + body

  private fun buildWav(
    sampleRate: Int = 24_000,
    channelCount: Int = 1,
    bitsPerSample: Int = 16,
    fmtBody: ByteArray? = null,
    extraChunks: List<Pair<String, ByteArray>> = emptyList(),
    dataSize: Int = 480,
    declaredDataSize: Int? = null,
    pad: Boolean = false,
    dataFirst: Boolean = false,
    omitData: Boolean = false
  ): ByteArray {
    val fmt =
      chunk(
        "fmt ",
        fmtBody
          ?: pcmFmtBody(
            channelCount = channelCount,
            sampleRate = sampleRate,
            bitsPerSample = bitsPerSample
          )
      )
    val data = chunk("data", ByteArray(dataSize) { (it % 251).toByte() }, declaredDataSize)

    val body = ByteArrayOutputStream()
    if (dataFirst) {
      body.write(data)
      body.write(fmt)
    } else {
      body.write(fmt)
      extraChunks.forEach { (id, content) ->
        body.write(chunk(id, content))
        // 奇数サイズのチャンクの後ろのパディング。
        if (pad && content.size % 2 == 1) {
          body.write(0)
        }
      }
      if (!omitData) {
        body.write(data)
      }
    }

    val payload = body.toByteArray()
    return "RIFF".toByteArray(Charsets.US_ASCII) +
      le32(4 + payload.size) +
      "WAVE".toByteArray(Charsets.US_ASCII) +
      payload
  }
}
