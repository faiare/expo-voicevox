package expo.modules.voicevox

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * `VoicevoxWavCache` は java.util しか使わないので、Android 端末を用意せず JVM の
 * ユニットテストで検証できる（`VoicevoxWav` / `VoicevoxArchive` と同じ方針）。
 *
 * iOS 側の `ios/VoicevoxWavCache.swift` は同じ挙動になるよう手で揃えてある。追い出しの規則を
 * 変えるときは両方を直すこと。
 */
class VoicevoxWavCacheTest {
  @Test
  fun `returns what was stored and counts hits and misses`() {
    val cache = VoicevoxWavCache(1_000)

    assertNull(cache.get("a"))
    assertEquals(0L, cache.hits)
    assertEquals(1L, cache.misses)

    cache.put("a", wav(10))
    assertArrayEquals(wav(10), cache.get("a"))
    assertEquals(1L, cache.hits)
    assertEquals(1L, cache.misses)
    assertEquals(10L, cache.bytes)
    assertEquals(1, cache.entryCount)
  }

  @Test
  fun `evicts the least recently used entry first`() {
    val cache = VoicevoxWavCache(30)
    cache.put("a", wav(10))
    cache.put("b", wav(10))
    cache.put("c", wav(10))

    // a を触って最近使った側へ回す。次に溢れるのは b。
    cache.get("a")
    cache.put("d", wav(10))

    assertNull(cache.get("b"))
    assertArrayEquals(wav(10), cache.get("a"))
    assertArrayEquals(wav(10), cache.get("c"))
    assertArrayEquals(wav(10), cache.get("d"))
    assertEquals(30L, cache.bytes)
  }

  @Test
  fun `evicts as many entries as it takes to fit`() {
    val cache = VoicevoxWavCache(100)
    cache.put("a", wav(20))
    cache.put("b", wav(20))
    cache.put("c", wav(20))

    // 70 バイトを入れるには a と b の 2 件を追い出す必要がある。
    cache.put("big", wav(70))

    assertNull(cache.get("a"))
    assertNull(cache.get("b"))
    assertArrayEquals(wav(20), cache.get("c"))
    assertArrayEquals(wav(70), cache.get("big"))
    assertEquals(90L, cache.bytes)
    assertEquals(2, cache.entryCount)
  }

  @Test
  fun `does not store an entry that is larger than the limit`() {
    val cache = VoicevoxWavCache(100)
    cache.put("kept", wav(50))
    cache.put("huge", wav(101))

    // 1 件で全部を追い出させない。既存のエントリはそのまま残る。
    assertNull(cache.get("huge"))
    assertArrayEquals(wav(50), cache.get("kept"))
    assertEquals(50L, cache.bytes)
  }

  @Test
  fun `drops the stale entry when the replacement is too large`() {
    val cache = VoicevoxWavCache(100)
    cache.put("a", wav(50))
    cache.put("a", wav(101))

    // 古い値を残すと、上書きしたつもりの呼び出し元に古い音が返ってしまう。
    assertNull(cache.get("a"))
    assertEquals(0L, cache.bytes)
    assertEquals(0, cache.entryCount)
  }

  @Test
  fun `does not double count when the same key is replaced`() {
    val cache = VoicevoxWavCache(100)
    cache.put("a", wav(30))
    cache.put("a", wav(40))

    assertEquals(40L, cache.bytes)
    assertEquals(1, cache.entryCount)
    assertArrayEquals(wav(40), cache.get("a"))
  }

  @Test
  fun `trims as soon as the limit is lowered`() {
    val cache = VoicevoxWavCache(100)
    cache.put("a", wav(30))
    cache.put("b", wav(30))
    cache.put("c", wav(30))

    cache.limitBytes = 60

    assertNull(cache.get("a"))
    assertEquals(60L, cache.bytes)
    assertEquals(2, cache.entryCount)
  }

  @Test
  fun `stores nothing when the limit is zero`() {
    val cache = VoicevoxWavCache(0)
    cache.put("a", wav(1))

    assertNull(cache.get("a"))
    assertEquals(0L, cache.bytes)
    assertEquals(0, cache.entryCount)
  }

  @Test
  fun `treats a negative limit as zero`() {
    val cache = VoicevoxWavCache(-1)
    assertEquals(0L, cache.limitBytes)

    cache.limitBytes = -100
    assertEquals(0L, cache.limitBytes)
  }

  @Test
  fun `clear resets the entries and the counters`() {
    val cache = VoicevoxWavCache(100)
    cache.put("a", wav(30))
    cache.get("a")
    cache.get("missing")

    cache.clear()

    assertEquals(0, cache.entryCount)
    assertEquals(0L, cache.bytes)
    // 統計はキャッシュを捨てた時点からの値にする（消す前の当たり外れを引きずらせない）。
    assertEquals(0L, cache.hits)
    assertEquals(0L, cache.misses)
  }

  @Test
  fun `exposes the stats the JS side reads`() {
    val cache = VoicevoxWavCache(100)
    cache.put("a", wav(30))
    cache.get("a")
    cache.get("missing")

    // JS は数値としてしか見ないが、キーの綴りが変わると黙って undefined になるので 1 つずつ見る。
    val stats = cache.toStatsMap()
    assertEquals(setOf("entryCount", "bytes", "limitBytes", "hits", "misses"), stats.keys)
    assertEquals(1, stats["entryCount"])
    assertEquals(30L, stats["bytes"])
    assertEquals(100L, stats["limitBytes"])
    assertEquals(1L, stats["hits"])
    assertEquals(1L, stats["misses"])
  }

  @Test
  fun `builds a key that separates the fixed fields from the payload`() {
    assertEquals(
      "text 3 1 こんにちは",
      VoicevoxWavCache.key("text", 3, true, "こんにちは")
    )
    // 語尾上げの有無・スタイル・種別のどれが違ってもキーは別になる。
    val base = VoicevoxWavCache.key("text", 3, true, "あ")
    assertNotEquals(base, VoicevoxWavCache.key("text", 3, false, "あ"))
    assertNotEquals(base, VoicevoxWavCache.key("text", 4, true, "あ"))
    assertNotEquals(base, VoicevoxWavCache.key("kana", 3, true, "あ"))
  }

  private fun wav(size: Int): ByteArray = ByteArray(size) { (it % 251).toByte() }
}
