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
      throw VoicevoxCoreError(code: 0, message: "ONNX Runtime の初期化に失敗しました")
    }

    var openJtalk: OpaquePointer?
    try check(voicevox_open_jtalk_rc_new(openJtalkDictDir, &openJtalk))
    guard let openJtalk else {
      throw VoicevoxCoreError(code: 0, message: "OpenJTalk 辞書の読み込みに失敗しました")
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
      throw VoicevoxCoreError(code: 0, message: "Synthesizer の生成に失敗しました")
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
    guard let synthesizer else {
      throw VoicevoxNotInitializedError()
    }
    guard let json = voicevox_synthesizer_create_metas_json(synthesizer) else {
      throw VoicevoxCoreError(code: 0, message: "メタ情報の取得に失敗しました")
    }
    defer { voicevox_json_free(json) }
    return String(cString: json)
  }

  /// テキストを合成して WAV バイト列（ヘッダ付き）を返す。
  func tts(text: String, styleId: UInt32) throws -> Data {
    guard let synthesizer else {
      throw VoicevoxNotInitializedError()
    }

    var wavLength: UInt = 0
    var wav: UnsafeMutablePointer<UInt8>?
    try check(
      voicevox_synthesizer_tts(
        synthesizer,
        text,
        styleId,
        voicevox_make_default_tts_options(),
        &wavLength,
        &wav
      )
    )
    guard let wav else {
      throw VoicevoxCoreError(code: 0, message: "音声合成の結果が空です")
    }
    defer { voicevox_wav_free(wav) }
    return Data(bytes: wav, count: Int(wavLength))
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

  private func loadVoiceModel(into synthesizer: OpaquePointer, path: String) throws {
    var model: OpaquePointer?
    try check(voicevox_voice_model_file_open(path, &model))
    guard let model else {
      throw VoicevoxCoreError(code: 0, message: "音声モデルを開けませんでした: \(path)")
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
