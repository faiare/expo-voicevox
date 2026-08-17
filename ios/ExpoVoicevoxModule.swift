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

/// ユーザー辞書へ登録する単語。既定値は JS 側で埋まっている。
struct VoicevoxUserDictWordRecord: Record {
  @Field
  var surface: String = ""

  @Field
  var pronunciation: String = ""

  @Field
  var accentType: Int = 0

  @Field
  var wordType: String = "COMMON_NOUN"

  @Field
  var priority: Int = 5
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
      // 合成の実行中に破棄されうるので、直列キューの上で解放する。
      self.engineQueue.sync { self.engine.release() }
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

      try self.wrappingErrors {
        try self.engine.initialize(
          openJtalkDictDir: dictDir,
          voiceModelPaths: modelPaths,
          cpuNumThreads: cpuNumThreads
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("getMetasJson") { () -> String in
      try self.wrappingErrors { try self.engine.metasJson() }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("tts") { (text: String, styleId: Int, enableInterrogativeUpspeak: Bool) -> String in
      try self.synthesize(styleId: styleId) { styleId in
        try self.engine.tts(
          text: text,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("ttsFromKana") {
      (kana: String, styleId: Int, enableInterrogativeUpspeak: Bool) -> String in
      try self.synthesize(styleId: styleId) { styleId in
        try self.engine.ttsFromKana(
          kana: kana,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("createAudioQueryJson") { (text: String, styleId: Int) -> String in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.createAudioQueryJson(text: text, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("createAudioQueryFromKanaJson") { (kana: String, styleId: Int) -> String in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.createAudioQueryFromKanaJson(kana: kana, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("createAccentPhrasesJson") { (text: String, styleId: Int) -> String in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.createAccentPhrasesJson(text: text, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("createAccentPhrasesFromKanaJson") { (kana: String, styleId: Int) -> String in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.createAccentPhrasesFromKanaJson(kana: kana, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("replaceMoraDataJson") { (accentPhrasesJson: String, styleId: Int) -> String in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.replaceMoraDataJson(accentPhrasesJson: accentPhrasesJson, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("replacePhonemeLengthJson") { (accentPhrasesJson: String, styleId: Int) -> String
      in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.replacePhonemeLengthJson(
          accentPhrasesJson: accentPhrasesJson, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("replaceMoraPitchJson") { (accentPhrasesJson: String, styleId: Int) -> String in
      let styleId = try self.checkedStyleId(styleId)
      return try self.wrappingErrors {
        try self.engine.replaceMoraPitchJson(accentPhrasesJson: accentPhrasesJson, styleId: styleId)
      }
    }
    .runOnQueue(engineQueue)

    // 推論を伴わないので直列キューに載せる必要が無い。
    AsyncFunction("audioQueryFromAccentPhrasesJson") { (accentPhrasesJson: String) -> String in
      try self.wrappingErrors {
        try VoicevoxEngine.audioQueryFromAccentPhrasesJson(accentPhrasesJson)
      }
    }

    AsyncFunction("synthesis") {
      (audioQueryJson: String, styleId: Int, enableInterrogativeUpspeak: Bool) -> String in
      try self.synthesize(styleId: styleId) { styleId in
        try self.engine.synthesis(
          audioQueryJson: audioQueryJson,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("setUserDictWords") { (words: [VoicevoxUserDictWordRecord]) in
      let converted = try words.map { try self.toUserDictWord($0) }
      try self.wrappingErrors { try self.engine.setUserDictWords(converted) }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("loadUserDictFile") { (path: String) in
      try self.wrappingErrors { try self.engine.loadUserDictFile(path: path) }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("saveUserDictFile") { (path: String) in
      try self.wrappingErrors { try self.engine.saveUserDictFile(path: path) }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("finalize") {
      self.engine.release()
    }
    .runOnQueue(engineQueue)
  }

  private func toUserDictWord(_ record: VoicevoxUserDictWordRecord) throws -> UserDictWord {
    // C の enum 定数は voicevox_core を import している VoicevoxEngine.swift 側で引く。
    guard let wordType = UserDictWord.wordType(named: record.wordType) else {
      throw VoicevoxException("unknown user dictionary word type: \(record.wordType)")
    }
    guard let accentType = UInt(exactly: record.accentType) else {
      throw VoicevoxException("accentType is out of range: \(record.accentType)")
    }
    guard let priority = UInt8(exactly: record.priority) else {
      throw VoicevoxException("priority is out of range: \(record.priority)")
    }
    return UserDictWord(
      surface: record.surface,
      pronunciation: record.pronunciation,
      accentType: accentType,
      wordType: wordType,
      priority: priority
    )
  }

  private func checkedStyleId(_ styleId: Int) throws -> UInt32 {
    guard let styleId = UInt32(exactly: styleId) else {
      throw VoicevoxException("styleId is out of range: \(styleId)")
    }
    return styleId
  }

  /// voicevox-core 由来のエラーを JS へ流せる形に包む。
  private func wrappingErrors<T>(_ body: () throws -> T) throws -> T {
    do {
      return try body()
    } catch let error as VoicevoxException {
      throw error
    } catch {
      throw VoicevoxException(error.localizedDescription)
    }
  }

  /// 合成系に共通する「styleId を検証し、WAV をキャッシュへ書き出してパスを返す」流れ。
  private func synthesize(styleId: Int, _ body: (UInt32) throws -> Data) throws -> String {
    let styleId = try checkedStyleId(styleId)
    return try wrappingErrors { try self.writeWavToCache(body(styleId)) }
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
