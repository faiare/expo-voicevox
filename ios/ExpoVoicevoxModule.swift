import ExpoModulesCore

/// `initialize()` に渡される JS 側のオプション。
///
/// パスが省略された（null の）場合は、config plugin が配置したアセットを自動で解決する。
struct VoicevoxInitializeOptions: Record {
  @Field
  var openJtalkDictDir: String? = nil

  @Field
  var voiceModelPaths: [String]? = nil

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

    Events("onPrepareProgress")

    OnDestroy {
      self.engine.releaseSynthesizer()
    }

    Function("getVersion") { () -> String in
      VoicevoxEngine.version()
    }

    Function("isInitialized") { () -> Bool in
      self.engine.isInitialized
    }

    AsyncFunction("prepareAssets") { () -> [String: Any] in
      let paths = try self.prepareAssets()
      return [
        "openJtalkDictDir": paths.openJtalkDictDir,
        "voiceModelPaths": paths.voiceModelPaths,
      ]
    }
    .runOnQueue(engineQueue)

    AsyncFunction("initialize") { (options: VoicevoxInitializeOptions) in
      guard let cpuNumThreads = UInt16(exactly: options.cpuNumThreads) else {
        throw VoicevoxException("cpuNumThreads is out of range: \(options.cpuNumThreads)")
      }

      // 明示パスが両方そろっているときはアセットの準備を一切走らせない
      // （自前でモデルを管理している利用者に余計なダウンロードをさせないため）。
      let dictDir: String
      let modelPaths: [String]
      if let explicitDict = options.openJtalkDictDir, let explicitModels = options.voiceModelPaths {
        dictDir = explicitDict
        modelPaths = explicitModels
      } else {
        let prepared = try self.prepareAssets()
        dictDir = options.openJtalkDictDir ?? prepared.openJtalkDictDir
        modelPaths = options.voiceModelPaths ?? prepared.voiceModelPaths
      }

      do {
        try self.engine.initialize(
          openJtalkDictDir: dictDir,
          voiceModelPaths: modelPaths,
          cpuNumThreads: cpuNumThreads
        )
      } catch let error as VoicevoxException {
        throw error
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
        throw VoicevoxException("styleId is out of range: \(styleId)")
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

  /// config plugin が配置したアセットを使える状態にする。進捗は JS へイベントで流す。
  private func prepareAssets() throws -> VoicevoxAssetPaths {
    do {
      return try VoicevoxAssets.shared.prepare { progress in
        self.sendEvent("onPrepareProgress", progress.dictionary)
      }
    } catch {
      throw VoicevoxException(error.localizedDescription)
    }
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
      throw VoicevoxException("failed to write the WAV file: \(error.localizedDescription)")
    }
  }
}
