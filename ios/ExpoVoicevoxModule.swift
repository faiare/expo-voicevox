import ExpoModulesCore

/// `initialize()` に渡される JS 側のオプション。
struct VoicevoxInitializeOptions: Record {
  @Field
  var openJtalkDictDir: String = ""

  @Field
  var voiceModelPaths: [String] = []

  @Field
  var cpuNumThreads: Int = 0
}

/// voicevox-core 由来のエラーを JS へ伝えるための例外。
final class VoicevoxException: GenericException<String> {
  override var reason: String {
    param
  }
}

public class ExpoVoicevoxModule: Module {
  private let engine = VoicevoxEngine()

  /// voicevox-core の Synthesizer は同時実行できないので、重い処理は 1 本の直列キューに載せる。
  private let engineQueue = DispatchQueue(label: "expo.modules.voicevox.engine")

  public func definition() -> ModuleDefinition {
    Name("ExpoVoicevox")

    OnDestroy {
      self.engine.releaseSynthesizer()
    }

    Function("getVersion") { () -> String in
      VoicevoxEngine.version()
    }

    Function("isInitialized") { () -> Bool in
      self.engine.isInitialized
    }

    AsyncFunction("initialize") { (options: VoicevoxInitializeOptions) in
      guard let cpuNumThreads = UInt16(exactly: options.cpuNumThreads) else {
        throw VoicevoxException("cpuNumThreads が範囲外です: \(options.cpuNumThreads)")
      }
      do {
        try self.engine.initialize(
          openJtalkDictDir: options.openJtalkDictDir,
          voiceModelPaths: options.voiceModelPaths,
          cpuNumThreads: cpuNumThreads
        )
      } catch {
        throw VoicevoxException(error.localizedDescription)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("getMetasJson") { () -> String in
      do {
        return try self.engine.metasJson()
      } catch {
        throw VoicevoxException(error.localizedDescription)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("tts") { (text: String, styleId: Int) -> String in
      guard let styleId = UInt32(exactly: styleId) else {
        throw VoicevoxException("styleId が範囲外です: \(styleId)")
      }
      do {
        let wav = try self.engine.tts(text: text, styleId: styleId)
        return try self.writeWavToCache(wav)
      } catch let error as VoicevoxException {
        throw error
      } catch {
        throw VoicevoxException(error.localizedDescription)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("finalize") {
      self.engine.releaseSynthesizer()
    }
    .runOnQueue(engineQueue)
  }

  /// 合成結果をキャッシュディレクトリへ書き出し、そのパスを返す。
  private func writeWavToCache(_ wav: Data) throws -> String {
    let cacheDirectory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    let outputDirectory = cacheDirectory.appendingPathComponent("expo-voicevox", isDirectory: true)

    do {
      try FileManager.default.createDirectory(
        at: outputDirectory,
        withIntermediateDirectories: true
      )
      let outputUrl = outputDirectory.appendingPathComponent("\(UUID().uuidString).wav")
      try wav.write(to: outputUrl, options: .atomic)
      return outputUrl.path
    } catch {
      throw VoicevoxException("WAV の書き出しに失敗しました: \(error.localizedDescription)")
    }
  }
}
