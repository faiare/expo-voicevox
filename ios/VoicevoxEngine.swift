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

  var isInitialized: Bool {
    synthesizer != nil
  }

  deinit {
    releaseSynthesizer()
  }

  /// voicevox-core のバージョン。ライブラリのロード確認を兼ねる。
  static func version() -> String {
    guard let version = voicevox_get_version() else {
      return ""
    }
    return String(cString: version)
  }

  func initialize(openJtalkDictDir: String, voiceModelPaths: [String], cpuNumThreads: UInt16) throws {
    // 再初期化に備えて、既存の Synthesizer は先に破棄する。
    releaseSynthesizer()

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
    // Synthesizer が内部で参照を保持するため、生成後は解放してよい。
    defer { voicevox_open_jtalk_rc_delete(openJtalk) }

    var options = voicevox_make_default_initialize_options()
    // モバイル向けビルドに GPU は無いので CPU を明示する。
    options.acceleration_mode = voicevoxAccelerationModeCpu
    options.cpu_num_threads = cpuNumThreads

    var synthesizer: OpaquePointer?
    try check(voicevox_synthesizer_new(onnxruntime, openJtalk, options, &synthesizer))
    guard let synthesizer else {
      throw VoicevoxCoreError(code: 0, message: "failed to create the synthesizer")
    }

    do {
      for path in voiceModelPaths {
        try loadVoiceModel(into: synthesizer, path: path)
      }
    } catch {
      // 途中で失敗したら中途半端な Synthesizer を残さない。
      voicevox_synthesizer_delete(synthesizer)
      throw error
    }

    self.onnxruntime = onnxruntime
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

  func releaseSynthesizer() {
    if let synthesizer {
      voicevox_synthesizer_delete(synthesizer)
    }
    synthesizer = nil
    // onnxruntime は init_once で得た共有参照であり、解放する API が無いので参照だけ落とす。
    onnxruntime = nil
  }

  // MARK: - Private

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
