import Foundation

/// AudioQuery の JSON に、`speedScale` などの上書きを重ねる。
///
/// `speak(text, styleId, { speedScale: 1.1 })` のように JS が合成パラメータを直接指定したとき、
/// ネイティブ側は `voicevox_synthesizer_tts` ではなく「AudioQuery を作る → ここで書き換える →
/// `voicevox_synthesizer_synthesis`」の経路を通る。tts はこの 2 つを内部で繋いでいるだけなので、
/// 出力は上書きが無ければ完全に一致する。
///
/// 上書きはトップレベルのフィールドしか触らない（`accent_phrases` の中には入らない）。
/// アクセント句やモーラ単位の編集は `createAudioQuery()` と `synthesis()` の担当。
///
/// Android 側の `VoicevoxAudioQueryPatch.kt` と 1:1 に対応させてある。
enum VoicevoxAudioQueryPatch {
  /// `paramsJson` が空文字なら `audioQueryJson` をそのまま返す。
  static func apply(_ paramsJson: String, to audioQueryJson: String) throws -> String {
    guard !paramsJson.isEmpty else {
      return audioQueryJson
    }
    guard
      let queryData = audioQueryJson.data(using: .utf8),
      var query = try? JSONSerialization.jsonObject(with: queryData) as? [String: Any]
    else {
      throw VoicevoxException("could not read the audio query JSON")
    }
    guard
      let paramsData = paramsJson.data(using: .utf8),
      let params = try? JSONSerialization.jsonObject(with: paramsData) as? [String: Any]
    else {
      throw VoicevoxException("could not read the synthesis parameters")
    }

    for (key, value) in params {
      // voicevox-core が返す AudioQuery には全フィールドが必ず入っている。無いキーを足すと
      // 綴りを間違えたまま黙って効かないので、ここで弾く。
      guard query[key] != nil else {
        throw VoicevoxException("unknown audio query field: \(key)")
      }
      query[key] = value
    }

    guard
      let patched = try? JSONSerialization.data(withJSONObject: query),
      let json = String(data: patched, encoding: .utf8)
    else {
      throw VoicevoxException("could not rebuild the audio query JSON")
    }
    return json
  }
}
