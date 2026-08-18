package expo.modules.voicevox

/**
 * 合成済みの WAV を最近使った順に保持する LRU キャッシュ。
 *
 * 上限は件数ではなく**合計バイト数**で測る。1 件の WAV は数十 KB から数 MB まで幅があり、
 * 件数で縛るとメモリ使用量の上限が読めないため。
 *
 * `android.util.LruCache` は使わない。Android API なので JVM ユニットテストで検証できず、
 * iOS 側（`ios/VoicevoxWavCache.swift`）と挙動を 1:1 に揃えられないため。この実装は
 * `java.util` だけに依存しており、[VoicevoxWav] や [VoicevoxArchive] と同じく
 * `android/src/test` の JVM ユニットテストで検証する。
 *
 * スレッド安全ではない。合成の入口は `ExpoVoicevoxModule` の `engineLock` で直列化されており、
 * このキャッシュはその内側でだけ触られる。
 */
class VoicevoxWavCache(initialLimitBytes: Long = DEFAULT_LIMIT_BYTES) {
  /** accessOrder = true。[get] のたびに末尾へ移り、追い出しは先頭（最も古いもの）から行う。 */
  private val entries = LinkedHashMap<String, ByteArray>(16, 0.75f, true)

  /** 現在保持している WAV の合計バイト数。 */
  var bytes: Long = 0
    private set

  /** [clear] でリセットされる。 */
  var hits: Long = 0
    private set

  /** [clear] でリセットされる。 */
  var misses: Long = 0
    private set

  /** 上限。下げた瞬間に溢れたぶんを追い出す。0 にすると何も溜まらない。 */
  var limitBytes: Long = initialLimitBytes.coerceAtLeast(0)
    set(value) {
      field = value.coerceAtLeast(0)
      trim()
    }

  val entryCount: Int
    get() = entries.size

  fun get(key: String): ByteArray? {
    val hit = entries[key]
    if (hit == null) {
      misses++
    } else {
      hits++
    }
    return hit
  }

  /**
   * 合成結果を格納する。
   *
   * 単体で上限を超える WAV は格納しない（1 件で他の全部を追い出してしまうため）。その場合でも
   * 同じキーの古いエントリは残さない。
   */
  fun put(key: String, wav: ByteArray) {
    val previous = entries.remove(key)
    if (previous != null) {
      bytes -= previous.size
    }
    if (wav.size > limitBytes) {
      return
    }
    entries[key] = wav
    bytes += wav.size
    trim()
  }

  fun clear() {
    entries.clear()
    bytes = 0
    hits = 0
    misses = 0
  }

  /** JS へ返す形。`src/ExpoVoicevox.types.ts` の `VoicevoxSynthesisCacheStats` と対応する。 */
  fun toStatsMap(): Map<String, Any> =
    mapOf(
      "entryCount" to entryCount,
      "bytes" to bytes,
      "limitBytes" to limitBytes,
      "hits" to hits,
      "misses" to misses
    )

  private fun trim() {
    val iterator = entries.entries.iterator()
    while (bytes > limitBytes && iterator.hasNext()) {
      bytes -= iterator.next().value.size
      iterator.remove()
    }
  }

  companion object {
    /** 32MB。24kHz モノラル 16bit ≒ 48KB/秒 なので約 11 分ぶん。 */
    const val DEFAULT_LIMIT_BYTES = 32L * 1024 * 1024

    /**
     * キャッシュキーを組み立てる。
     *
     * ペイロード（テキスト / カナ / AudioQuery の JSON）は自由形式なので必ず最後に置く。
     * 前段の固定長フィールドと衝突させないため。書き出し先ディレクトリは合成結果に影響しないので
     * キーに含めない。
     */
    fun key(
      kind: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      payload: String
    ): String = "$kind $styleId ${if (enableInterrogativeUpspeak) 1 else 0} $payload"
  }
}
