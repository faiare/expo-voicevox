import Foundation
import voicevox_core

// `VoicevoxResultCode` / `VoicevoxAccelerationMode` は「enum タグ」と「int32_t の typedef」の
// 両方がヘッダに存在するため、Swift では型名として曖昧になる。値は Int32 として扱う。
private let voicevoxResultOk = Int32(VOICEVOX_RESULT_OK.rawValue)
private let voicevoxAccelerationModeCpu = Int32(VOICEVOX_ACCELERATION_MODE_CPU.rawValue)

/// voicevox-core が返したエラーコードとメッセージ。
struct VoicevoxCoreError: LocalizedError {
  let code: Int32
  let message: String

  var errorDescription: String? {
    "\(message) (voicevox result code: \(code))"
  }
}

/// ユーザー辞書へ登録する単語。JS 側で既定値を埋めてから渡ってくる。
struct UserDictWord {
  let surface: String
  let pronunciation: String
  let accentType: UInt
  /// `VoicevoxUserDictWordType`。結果コードと同じく型名が曖昧になるので Int32 で持つ。
  let wordType: Int32
  let priority: UInt8

  /// JS から来る品詞名を C の enum 値へ変換する。未知の名前なら nil。
  static func wordType(named name: String) -> Int32? {
    switch name {
    case "PROPER_NOUN": return Int32(VOICEVOX_USER_DICT_WORD_TYPE_PROPER_NOUN.rawValue)
    case "COMMON_NOUN": return Int32(VOICEVOX_USER_DICT_WORD_TYPE_COMMON_NOUN.rawValue)
    case "VERB": return Int32(VOICEVOX_USER_DICT_WORD_TYPE_VERB.rawValue)
    case "ADJECTIVE": return Int32(VOICEVOX_USER_DICT_WORD_TYPE_ADJECTIVE.rawValue)
    case "SUFFIX": return Int32(VOICEVOX_USER_DICT_WORD_TYPE_SUFFIX.rawValue)
    default: return nil
    }
  }
}

/// `initialize()` より前に合成を要求されたときのエラー。
struct VoicevoxNotInitializedError: LocalizedError {
  var errorDescription: String? {
    "voicevox-core が初期化されていません。先に initialize() を呼んでください"
  }
}

/**
 voicevox-core の C API を包むエンジン。

 iOS 向けの配布バイナリは `link-onnxruntime` でビルドされているため、
 ONNX Runtime は `voicevox_onnxruntime_init_once` で初期化する（`load_once` は存在しない）。

 このクラス自体はスレッドセーフではない。呼び出し側で直列化すること。
 */
final class VoicevoxEngine {
  /// `voicevox_onnxruntime_init_once` が返す共有インスタンス。解放用の API は無いので保持するだけ。
  private var onnxruntime: OpaquePointer?
  private var synthesizer: OpaquePointer?

  /// ユーザー辞書を後から適用するために保持する OpenJTalk。
  ///
  /// `OpenJtalkRc` は参照カウント方式で、`voicevox_synthesizer_new` に渡すとカウンタが増える。
  /// そのため Synthesizer 生成後に手放しても安全だが、`voicevox_open_jtalk_rc_use_user_dict` は
  /// このハンドルを必要とするので保持しておく。
  private var openJtalk: OpaquePointer?

  /// ユーザー辞書。`release()` では解放せず、再 `initialize()` をまたいで残す。
  private var userDict: OpaquePointer?

  var isInitialized: Bool {
    synthesizer != nil
  }

  deinit {
    release()
    if let userDict {
      voicevox_user_dict_delete(userDict)
    }
    userDict = nil
  }

  /// voicevox-core のバージョン。ライブラリのロード確認を兼ねる。
  static func version() -> String {
    guard let version = voicevox_get_version() else {
      return ""
    }
    return String(cString: version)
  }

  func initialize(openJtalkDictDir: String, voiceModelPaths: [String], cpuNumThreads: UInt16) throws {
    // 再初期化に備えて、既存の Synthesizer と OpenJTalk は先に破棄する。
    release()

    var onnxruntime: OpaquePointer?
    try check(voicevox_onnxruntime_init_once(&onnxruntime))
    guard let onnxruntime else {
      throw VoicevoxCoreError(code: 0, message: "failed to initialize the ONNX Runtime")
    }

    var openJtalk: OpaquePointer?
    try check(voicevox_open_jtalk_rc_new(openJtalkDictDir, &openJtalk))
    guard let openJtalk else {
      throw VoicevoxCoreError(code: 0, message: "failed to load the OpenJTalk dictionary")
    }

    var options = voicevox_make_default_initialize_options()
    // モバイル向けビルドに GPU は無いので CPU を明示する。
    options.acceleration_mode = voicevoxAccelerationModeCpu
    options.cpu_num_threads = cpuNumThreads

    var synthesizer: OpaquePointer?
    do {
      // 既に設定されているユーザー辞書があれば、Synthesizer を作る前に適用しておく。
      if let userDict {
        try check(voicevox_open_jtalk_rc_use_user_dict(openJtalk, userDict))
      }

      try check(voicevox_synthesizer_new(onnxruntime, openJtalk, options, &synthesizer))
      guard let synthesizer else {
        throw VoicevoxCoreError(code: 0, message: "failed to create the synthesizer")
      }

      for path in voiceModelPaths {
        try loadVoiceModel(into: synthesizer, path: path)
      }
    } catch {
      // 途中で失敗したら中途半端な状態を残さない。
      if let synthesizer {
        voicevox_synthesizer_delete(synthesizer)
      }
      voicevox_open_jtalk_rc_delete(openJtalk)
      throw error
    }

    self.onnxruntime = onnxruntime
    self.openJtalk = openJtalk
    self.synthesizer = synthesizer
  }

  /// 読み込み済みの音声モデルのメタ情報を JSON 文字列で返す。
  func metasJson() throws -> String {
    // この API だけは結果コードではなく `char *` を直接返すので `readJson` は使えない。
    let synthesizer = try requireSynthesizer()
    guard let json = voicevox_synthesizer_create_metas_json(synthesizer) else {
      throw VoicevoxCoreError(code: 0, message: "failed to read the voice metadata")
    }
    defer { voicevox_json_free(json) }
    return String(cString: json)
  }

  /// テキストを合成して WAV バイト列（ヘッダ付き）を返す。
  func tts(text: String, styleId: UInt32, enableInterrogativeUpspeak: Bool) throws -> Data {
    let synthesizer = try requireSynthesizer()

    var options = voicevox_make_default_tts_options()
    options.enable_interrogative_upspeak = enableInterrogativeUpspeak

    return try readWav { wavLength, wav in
      voicevox_synthesizer_tts(synthesizer, text, styleId, options, &wavLength, &wav)
    }
  }

  /// AquesTalk 風記法のカナを合成して WAV バイト列を返す。
  func ttsFromKana(kana: String, styleId: UInt32, enableInterrogativeUpspeak: Bool) throws -> Data {
    let synthesizer = try requireSynthesizer()

    var options = voicevox_make_default_tts_options()
    options.enable_interrogative_upspeak = enableInterrogativeUpspeak

    return try readWav { wavLength, wav in
      voicevox_synthesizer_tts_from_kana(synthesizer, kana, styleId, options, &wavLength, &wav)
    }
  }

  /// テキストから AudioQuery を生成し、JSON 文字列で返す。
  func createAudioQueryJson(text: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_create_audio_query(synthesizer, text, styleId, &output)
    }
  }

  /// AquesTalk 風記法のカナから AudioQuery を生成し、JSON 文字列で返す。
  func createAudioQueryFromKanaJson(kana: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_create_audio_query_from_kana(synthesizer, kana, styleId, &output)
    }
  }

  /// テキストから AccentPhrase 配列を生成し、JSON 文字列で返す。
  func createAccentPhrasesJson(text: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_create_accent_phrases(synthesizer, text, styleId, &output)
    }
  }

  /// AquesTalk 風記法のカナから AccentPhrase 配列を生成し、JSON 文字列で返す。
  func createAccentPhrasesFromKanaJson(kana: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_create_accent_phrases_from_kana(synthesizer, kana, styleId, &output)
    }
  }

  /// AccentPhrase 配列の音素長と音高を生成し直す。
  func replaceMoraDataJson(accentPhrasesJson: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_replace_mora_data(synthesizer, accentPhrasesJson, styleId, &output)
    }
  }

  /// AccentPhrase 配列の音素長だけを生成し直す。
  func replacePhonemeLengthJson(accentPhrasesJson: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_replace_phoneme_length(synthesizer, accentPhrasesJson, styleId, &output)
    }
  }

  /// AccentPhrase 配列の音高だけを生成し直す。
  func replaceMoraPitchJson(accentPhrasesJson: String, styleId: UInt32) throws -> String {
    let synthesizer = try requireSynthesizer()
    return try readJson { output in
      voicevox_synthesizer_replace_mora_pitch(synthesizer, accentPhrasesJson, styleId, &output)
    }
  }

  /// AccentPhrase 配列から AudioQuery を組み立てる。
  ///
  /// 推論を行わないので Synthesizer を必要としない（C API も自由関数になっている）。
  static func audioQueryFromAccentPhrasesJson(_ accentPhrasesJson: String) throws -> String {
    var output: UnsafeMutablePointer<CChar>?
    let code = voicevox_audio_query_create_from_accent_phrases(accentPhrasesJson, &output)
    guard code == voicevoxResultOk else {
      let message = voicevox_error_result_to_message(code).map { String(cString: $0) } ?? "不明なエラー"
      throw VoicevoxCoreError(code: code, message: message)
    }
    guard let output else {
      throw VoicevoxCoreError(code: 0, message: "voicevox-core returned no JSON")
    }
    defer { voicevox_json_free(output) }
    return String(cString: output)
  }

  /// AudioQuery の JSON を合成して WAV バイト列を返す。
  func synthesis(
    audioQueryJson: String,
    styleId: UInt32,
    enableInterrogativeUpspeak: Bool
  ) throws -> Data {
    let synthesizer = try requireSynthesizer()

    var options = voicevox_make_default_synthesis_options()
    options.enable_interrogative_upspeak = enableInterrogativeUpspeak

    return try readWav { wavLength, wav in
      voicevox_synthesizer_synthesis(
        synthesizer, audioQueryJson, styleId, options, &wavLength, &wav)
    }
  }

  /// ユーザー辞書の単語を差し替え、OpenJTalk へ適用し直す。
  ///
  /// 辞書は作り直す。voicevox-core は単語の削除に UUID を要求するが、その UUID は
  /// 辞書を作り直すたびに振り直されるので JS へ渡す意味が無く、全置換の方が扱いが単純になる。
  func setUserDictWords(_ words: [UserDictWord]) throws {
    guard let newDict = voicevox_user_dict_new() else {
      throw VoicevoxCoreError(code: 0, message: "failed to create the user dictionary")
    }

    do {
      for word in words {
        try addWord(word, to: newDict)
      }
      // 適用に失敗したら差し替えないので、旧辞書がそのまま生き続ける。
      try applyUserDict(newDict)
    } catch {
      voicevox_user_dict_delete(newDict)
      throw error
    }

    // 適用が終わってから旧辞書を捨てる。破棄済みの辞書に触るとプロセスごと落ちる。
    if let userDict {
      voicevox_user_dict_delete(userDict)
    }
    userDict = newDict
  }

  /// 辞書ファイルを現在の辞書へ読み込み、適用し直す。
  func loadUserDictFile(path: String) throws {
    let dict = try requireUserDict()
    try check(voicevox_user_dict_load(dict, path))
    try applyUserDict(dict)
  }

  /// 現在の辞書をファイルへ保存する。
  func saveUserDictFile(path: String) throws {
    try check(voicevox_user_dict_save(try requireUserDict(), path))
  }

  /// Synthesizer と OpenJTalk を破棄する。ユーザー辞書は次の `initialize()` のために残す。
  func release() {
    if let synthesizer {
      voicevox_synthesizer_delete(synthesizer)
    }
    synthesizer = nil
    if let openJtalk {
      voicevox_open_jtalk_rc_delete(openJtalk)
    }
    openJtalk = nil
    // onnxruntime は init_once で得た共有参照であり、解放する API が無いので参照だけ落とす。
    onnxruntime = nil
  }

  // MARK: - Private

  private func requireUserDict() throws -> OpaquePointer {
    if let userDict {
      return userDict
    }
    guard let created = voicevox_user_dict_new() else {
      throw VoicevoxCoreError(code: 0, message: "failed to create the user dictionary")
    }
    userDict = created
    return created
  }

  private func addWord(_ word: UserDictWord, to dict: OpaquePointer) throws {
    var native = voicevox_user_dict_word_make(word.surface, word.pronunciation, word.accentType)
    native.word_type = word.wordType
    native.priority = word.priority
    // UUID は辞書を作り直すたびに変わるので受け取らずに捨てる。
    var uuid = (UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0),
                UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0), UInt8(0))
    try check(voicevox_user_dict_add_word(dict, &native, &uuid))
  }

  /// OpenJTalk がまだ無ければ何もしない。`initialize()` の中で改めて適用される。
  private func applyUserDict(_ dict: OpaquePointer) throws {
    guard let openJtalk else {
      return
    }
    try check(voicevox_open_jtalk_rc_use_user_dict(openJtalk, dict))
  }

  private func requireSynthesizer() throws -> OpaquePointer {
    guard let synthesizer else {
      throw VoicevoxNotInitializedError()
    }
    return synthesizer
  }

  /// `char **` へ JSON を書き出す API を呼び、必ず `voicevox_json_free` してから String にする。
  private func readJson(_ body: (inout UnsafeMutablePointer<CChar>?) -> Int32) throws -> String {
    var output: UnsafeMutablePointer<CChar>?
    try check(body(&output))
    guard let output else {
      throw VoicevoxCoreError(code: 0, message: "voicevox-core returned no JSON")
    }
    defer { voicevox_json_free(output) }
    return String(cString: output)
  }

  /// WAV を書き出す API を呼び、必ず `voicevox_wav_free` してから Data にする。
  private func readWav(
    _ body: (inout UInt, inout UnsafeMutablePointer<UInt8>?) -> Int32
  ) throws -> Data {
    var wavLength: UInt = 0
    var wav: UnsafeMutablePointer<UInt8>?
    try check(body(&wavLength, &wav))
    guard let wav else {
      throw VoicevoxCoreError(code: 0, message: "speech synthesis produced no audio")
    }
    defer { voicevox_wav_free(wav) }
    return Data(bytes: wav, count: Int(wavLength))
  }

  private func loadVoiceModel(into synthesizer: OpaquePointer, path: String) throws {
    var model: OpaquePointer?
    try check(voicevox_voice_model_file_open(path, &model))
    guard let model else {
      throw VoicevoxCoreError(code: 0, message: "could not open the voice model: \(path)")
    }
    defer { voicevox_voice_model_file_delete(model) }

    try check(
      voicevox_synthesizer_load_voice_model(
        synthesizer,
        model,
        voicevox_make_default_load_voice_model_options()
      )
    )
  }

  private func check(_ code: Int32) throws {
    guard code != voicevoxResultOk else {
      return
    }
    let message = voicevox_error_result_to_message(code).map { String(cString: $0) } ?? "不明なエラー"
    throw VoicevoxCoreError(code: code, message: message)
  }
}
