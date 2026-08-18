package expo.modules.voicevox

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/**
 * `VoicevoxAudioQueryPatch` は Gson しか使わないので JVM のユニットテストで検証できる
 * （`VoicevoxWavCache` と同じ方針）。iOS 側の `ios/VoicevoxAudioQueryPatch.swift` は
 * 同じ挙動になるよう手で揃えてあるので、規則を変えるときは両方を直すこと。
 */
class VoicevoxAudioQueryPatchTest {
  @Test
  fun `returns the query untouched when there are no overrides`() {
    assertEquals(QUERY, VoicevoxAudioQueryPatch.apply(QUERY, ""))
  }

  @Test
  fun `overwrites only the fields that were given`() {
    val patched =
      JsonParser.parseString(
          VoicevoxAudioQueryPatch.apply(QUERY, """{"speedScale":1.1,"prePhonemeLength":0}""")
        )
        .asJsonObject

    assertEquals(1.1, patched["speedScale"].asDouble, 0.0)
    assertEquals(0.0, patched["prePhonemeLength"].asDouble, 0.0)
    // 触っていないフィールドは元のまま。
    assertEquals(0.0, patched["pitchScale"].asDouble, 0.0)
    assertEquals(0.1, patched["postPhonemeLength"].asDouble, 0.0)
    assertEquals(24000, patched["outputSamplingRate"].asInt)
  }

  @Test
  fun `keeps the accent phrases as they are`() {
    val patched =
      JsonParser.parseString(VoicevoxAudioQueryPatch.apply(QUERY, """{"speedScale":2.0}"""))
        .asJsonObject

    // トップレベルしか触らない。アクセント句の編集は createAudioQuery / synthesis の担当。
    val moras = patched["accent_phrases"].asJsonArray[0].asJsonObject["moras"].asJsonArray
    assertEquals(1, moras.size())
    assertEquals("ア", moras[0].asJsonObject["text"].asString)
    assertTrue(moras[0].asJsonObject["consonant"].isJsonNull)
  }

  @Test
  fun `rejects a field the audio query does not have`() {
    // 綴りを間違えたまま黙って効かない、が一番たちが悪い。
    try {
      VoicevoxAudioQueryPatch.apply(QUERY, """{"speadScale":1.1}""")
      fail("expected an exception")
    } catch (error: VoicevoxException) {
      assertTrue(error.message!!.contains("speadScale"))
    }
  }

  @Test
  fun `rejects json that is not an object`() {
    for (broken in listOf("[]", "{", "\"nope\"")) {
      try {
        VoicevoxAudioQueryPatch.apply(QUERY, broken)
        fail("expected an exception for $broken")
      } catch (error: VoicevoxException) {
        assertTrue(error.message!!.isNotEmpty())
      }
    }
  }

  private companion object {
    /** voicevox-core が返す AudioQuery と同じ形（snake_case と camelCase の混在）。 */
    const val QUERY =
      """{"accent_phrases":[{"moras":[{"text":"ア","consonant":null,"consonant_length":null,""" +
        """"vowel":"a","vowel_length":0.1,"pitch":5.5}],"accent":1,"pause_mora":null,""" +
        """"is_interrogative":false}],"speedScale":1.0,"pitchScale":0.0,"intonationScale":1.0,""" +
        """"volumeScale":1.0,"prePhonemeLength":0.1,"postPhonemeLength":0.1,""" +
        """"outputSamplingRate":24000,"outputStereo":false,"kana":"ア'"}"""
  }
}
