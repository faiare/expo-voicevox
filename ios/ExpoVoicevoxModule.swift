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

  /// 合成結果のキャッシュに使う上限バイト数。0 で無効。
  ///
  /// Int で受けると 32bit 環境で 2GB を超える指定が無言で壊れるので、JS の number をそのまま
  /// Double で受けて `cacheLimitBytes(_:)` で検証する。
  @Field
  var synthesisCacheBytes: Double = Double(VoicevoxWavCache.defaultLimitBytes)
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

  /// 再生役。合成とは別に動くので直列キューには載せない。
  private let player = VoicevoxPlayer()

  /// voicevox-core の Synthesizer は同時実行できないので、重い処理は 1 本の直列キューに載せる。
  private let engineQueue = DispatchQueue(label: "expo.modules.voicevox.engine")

  /// 合成結果の LRU キャッシュ。engineQueue の上でだけ触るので、自前のロックは持たない。
  private let wavCache = VoicevoxWavCache()

  public func definition() -> ModuleDefinition {
    Name("ExpoVoicevox")

    Events("onPrepareProgress", "onSpeechStateChange")

    OnCreate {
      // モジュールが player を所有するので、コールバック側は弱参照にして循環させない。
      self.player.onStateChange = { [weak self] id, state, reason in
        self?.sendEvent(
          "onSpeechStateChange",
          ["id": id, "state": state.rawValue, "reason": reason]
        )
      }
    }

    OnDestroy {
      // 停止は engineQueue に依存しないので先に済ませる（合成の実行中でも即座に黙る）。
      self.player.stop()
      // 合成の実行中に破棄されうるので、直列キューの上で解放する。
      self.engineQueue.sync {
        self.engine.release()
        self.wavCache.clear()
      }
    }

    Function("getVersion") { () -> String in
      VoicevoxEngine.version()
    }

    Function("isInitialized") { () -> Bool in
      self.engine.isInitialized
    }

    Function("isSpeaking") { () -> Bool in
      self.player.isSpeaking
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

      let limitBytes = try self.cacheLimitBytes(options.synthesisCacheBytes)
      try self.wrappingErrors {
        try self.engine.initialize(
          openJtalkDictDir: dictDir,
          voiceModelPaths: modelPaths,
          cpuNumThreads: cpuNumThreads
        )
      }
      // 読み込むモデルが変わりうるので、初期化のたびに作り直す。
      self.wavCache.limitBytes = limitBytes
      self.wavCache.clear()
    }
    .runOnQueue(engineQueue)

    AsyncFunction("getMetasJson") { () -> String in
      try self.wrappingErrors { try self.engine.metasJson() }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("tts") {
      (text: String, styleId: Int, enableInterrogativeUpspeak: Bool, directory: String,
        useCache: Bool) -> String in
      let key = VoicevoxWavCache.key(
        kind: "text",
        styleId: styleId,
        enableInterrogativeUpspeak: enableInterrogativeUpspeak,
        payload: text
      )
      return try self.synthesize(
        styleId: styleId, directory: directory, cacheKey: key, useCache: useCache
      ) { styleId in
        try self.engine.tts(
          text: text,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("ttsFromKana") {
      (kana: String, styleId: Int, enableInterrogativeUpspeak: Bool, directory: String,
        useCache: Bool) -> String in
      let key = VoicevoxWavCache.key(
        kind: "kana",
        styleId: styleId,
        enableInterrogativeUpspeak: enableInterrogativeUpspeak,
        payload: kana
      )
      return try self.synthesize(
        styleId: styleId, directory: directory, cacheKey: key, useCache: useCache
      ) { styleId in
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
      (audioQueryJson: String, styleId: Int, enableInterrogativeUpspeak: Bool, directory: String,
        useCache: Bool) -> String in
      let key = VoicevoxWavCache.key(
        kind: "query",
        styleId: styleId,
        enableInterrogativeUpspeak: enableInterrogativeUpspeak,
        payload: audioQueryJson
      )
      return try self.synthesize(
        styleId: styleId, directory: directory, cacheKey: key, useCache: useCache
      ) { styleId in
        try self.engine.synthesis(
          audioQueryJson: audioQueryJson,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("speak") {
      (text: String, styleId: Int, enableInterrogativeUpspeak: Bool, audioSession: String,
        useCache: Bool, promise: Promise) in
      let key = VoicevoxWavCache.key(
        kind: "text",
        styleId: styleId,
        enableInterrogativeUpspeak: enableInterrogativeUpspeak,
        payload: text
      )
      self.speakWav(
        styleId: styleId, audioSession: audioSession, cacheKey: key, useCache: useCache,
        promise: promise
      ) { styleId in
        try self.engine.tts(
          text: text,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("speakFromKana") {
      (kana: String, styleId: Int, enableInterrogativeUpspeak: Bool, audioSession: String,
        useCache: Bool, promise: Promise) in
      let key = VoicevoxWavCache.key(
        kind: "kana",
        styleId: styleId,
        enableInterrogativeUpspeak: enableInterrogativeUpspeak,
        payload: kana
      )
      self.speakWav(
        styleId: styleId, audioSession: audioSession, cacheKey: key, useCache: useCache,
        promise: promise
      ) { styleId in
        try self.engine.ttsFromKana(
          kana: kana,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("speakFromAudioQuery") {
      (audioQueryJson: String, styleId: Int, enableInterrogativeUpspeak: Bool,
        audioSession: String, useCache: Bool, promise: Promise) in
      let key = VoicevoxWavCache.key(
        kind: "query",
        styleId: styleId,
        enableInterrogativeUpspeak: enableInterrogativeUpspeak,
        payload: audioQueryJson
      )
      self.speakWav(
        styleId: styleId, audioSession: audioSession, cacheKey: key, useCache: useCache,
        promise: promise
      ) { styleId in
        try self.engine.synthesis(
          audioQueryJson: audioQueryJson,
          styleId: styleId,
          enableInterrogativeUpspeak: enableInterrogativeUpspeak
        )
      }
    }
    .runOnQueue(engineQueue)

    // 合成の実行中でも即座に止められるよう、直列キューには載せない。
    AsyncFunction("stopSpeaking") {
      self.player.stop()
    }

    AsyncFunction("setUserDictWords") { (words: [VoicevoxUserDictWordRecord]) in
      let converted = try words.map { try self.toUserDictWord($0) }
      try self.wrappingErrors { try self.engine.setUserDictWords(converted) }
      // 読みが変わるので、捨てないと古い発音のまま鳴ってしまう。
      self.wavCache.clear()
    }
    .runOnQueue(engineQueue)

    AsyncFunction("loadUserDictFile") { (path: String) in
      try self.wrappingErrors { try self.engine.loadUserDictFile(path: path) }
      // setUserDictWords と同じ理由で捨てる。
      self.wavCache.clear()
    }
    .runOnQueue(engineQueue)

    AsyncFunction("saveUserDictFile") { (path: String) in
      try self.wrappingErrors { try self.engine.saveUserDictFile(path: path) }
    }
    .runOnQueue(engineQueue)

    AsyncFunction("finalize") {
      self.engine.release()
      self.wavCache.clear()
    }
    .runOnQueue(engineQueue)

    // engineQueue に載るので合成の実行中は待たされる。同期関数にすると JS スレッドが
    // 合成の完了まで止まるため、どちらも AsyncFunction のままにしておくこと。
    AsyncFunction("clearSynthesisCache") {
      self.wavCache.clear()
    }
    .runOnQueue(engineQueue)

    AsyncFunction("getSynthesisCacheStats") { () -> [String: Any] in
      self.wavCache.statsDictionary
    }
    .runOnQueue(engineQueue)
  }

  /// JS の number を上限バイト数へ直す。
  ///
  /// 検証は JS 側にもあるが、ネイティブへ直接来た値で LRU が壊れないようここでも見る。
  private func cacheLimitBytes(_ raw: Double) throws -> Int {
    guard raw.isFinite, raw >= 0, let limit = Int(exactly: raw.rounded(.down)) else {
      throw VoicevoxException("synthesisCacheBytes is out of range: \(raw)")
    }
    return limit
  }

  /// キャッシュを引いてから合成する。engineQueue の上でだけ呼ぶこと。
  ///
  /// `useCache` が false のときは読みも書きもしない。一度きりの動的なテキストで LRU を
  /// 汚さないための逃げ道なので、「読むが書かない」にはしない。
  private func cachedWav(key: String, useCache: Bool, _ body: () throws -> Data) throws -> Data {
    if useCache, let hit = wavCache.value(forKey: key) {
      return hit
    }
    let wav = try body()
    if useCache {
      wavCache.setValue(wav, forKey: key)
    }
    return wav
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

  /// 合成系に共通する「styleId を検証し、WAV を指定のディレクトリへ書き出してパスを返す」流れ。
  private func synthesize(
    styleId: Int,
    directory: String,
    cacheKey: String,
    useCache: Bool,
    _ body: (UInt32) throws -> Data
  ) throws -> String {
    let styleId = try checkedStyleId(styleId)
    let searchPath = try searchPathDirectory(directory)
    return try wrappingErrors {
      let wav = try self.cachedWav(key: cacheKey, useCache: useCache) { try body(styleId) }
      return try self.writeWav(wav, to: searchPath)
    }
  }

  /// 再生系に共通する「engineQueue の上で合成し、再生はその外で始める」流れ。
  ///
  /// 再生の完了を engineQueue の中で待つと、鳴っているあいだ次の合成を始められない。
  /// `player.play` はメインキューへ投げて即座に戻り、Promise はそちらで解決する。
  private func speakWav(
    styleId: Int,
    audioSession: String,
    cacheKey: String,
    useCache: Bool,
    promise: Promise,
    _ body: (UInt32) throws -> Data
  ) {
    do {
      guard let session = VoicevoxAudioSessionMode(rawValue: audioSession) else {
        throw VoicevoxException("unknown audio session mode: \(audioSession)")
      }
      let styleId = try checkedStyleId(styleId)
      let id = player.begin()
      let wav: Data
      do {
        wav = try wrappingErrors {
          try self.cachedWav(key: cacheKey, useCache: useCache) { try body(styleId) }
        }
      } catch {
        // 合成に失敗したら自分の予約だけ畳む。鳴っている音は止めない。
        player.cancel(id: id)
        throw error
      }
      player.play(id: id, wav: wav, session: session) { result in
        switch result {
        case .success(let playback):
          promise.resolve(playback.dictionary)
        case .failure(let error):
          promise.reject(error)
        }
      }
    } catch {
      promise.reject(error)
    }
  }

  /// 書き出し先の指定を `FileManager` の検索パスへ変換する。
  private func searchPathDirectory(_ directory: String) throws -> FileManager.SearchPathDirectory {
    switch directory {
    case "cache":
      return .cachesDirectory
    // iCloud バックアップの対象。UIFileSharingEnabled 次第で Files アプリにも見える。
    case "document":
      return .documentDirectory
    default:
      throw VoicevoxException("unknown output directory: \(directory)")
    }
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

  /// 合成結果を指定のディレクトリへ書き出し、そのパスを返す。
  private func writeWav(_ wav: Data, to searchPath: FileManager.SearchPathDirectory) throws -> String
  {
    let baseDirectory = FileManager.default.urls(for: searchPath, in: .userDomainMask)[0]
    let outputDirectory = baseDirectory.appendingPathComponent("expo-voicevox", isDirectory: true)

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
