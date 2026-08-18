package expo.modules.voicevox

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonSyntaxException

/**
 * AudioQuery の JSON に、`speedScale` などの上書きを重ねる。
 *
 * `speak(text, styleId, { speedScale = 1.1 })` のように JS が合成パラメータを直接指定したとき、
 * ネイティブ側は `Synthesizer.tts` ではなく「AudioQuery を作る → ここで書き換える →
 * `Synthesizer.synthesis`」の経路を通る。tts はこの 2 つを内部で繋いでいるだけなので、
 * 上書きが無ければ出力は完全に一致する。
 *
 * 上書きはトップレベルのフィールドしか触らない（`accent_phrases` の中には入らない）。
 * アクセント句やモーラ単位の編集は `createAudioQuery()` と `synthesis()` の担当。
 *
 * Gson だけで書いてあるので JVM のユニットテストで検証できる（`VoicevoxWavCache` と同じ方針）。
 * iOS 側の `ios/VoicevoxAudioQueryPatch.swift` と 1:1 に対応させてある。
 */
object VoicevoxAudioQueryPatch {
  /** [paramsJson] が空文字なら [audioQueryJson] をそのまま返す。 */
  fun apply(audioQueryJson: String, paramsJson: String): String {
    if (paramsJson.isEmpty()) {
      return audioQueryJson
    }
    val query = parseObject(audioQueryJson, "could not read the audio query JSON")
    val params = parseObject(paramsJson, "could not read the synthesis parameters")

    for ((key, value) in params.entrySet()) {
      // voicevox-core が返す AudioQuery には全フィールドが必ず入っている。無いキーを足すと
      // 綴りを間違えたまま黙って効かないので、ここで弾く。
      if (!query.has(key)) {
        throw VoicevoxException("unknown audio query field: $key")
      }
      query.add(key, value)
    }
    return query.toString()
  }

  private fun parseObject(json: String, message: String): JsonObject =
    try {
      JsonParser.parseString(json).asJsonObject
    } catch (error: JsonSyntaxException) {
      throw VoicevoxException(message, error)
    } catch (error: IllegalStateException) {
      throw VoicevoxException(message, error)
    }
}
