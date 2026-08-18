package expo.modules.voicevox

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.UUID
import jp.hiroshiba.voicevoxcore.GlobalInfo
import jp.hiroshiba.voicevoxcore.UserDictWord

/**
 * `initialize()` に渡される JS 側のオプション。
 *
 * パスが省略された（null の）場合は、config plugin が配置したアセットを自動で解決する。
 */
class VoicevoxInitializeOptions : Record {
  @Field val openJtalkDictDir: String? = null

  @Field val voiceModelPaths: List<String>? = null

  @Field val cpuNumThreads: Int = 0

  /**
   * 合成結果のキャッシュに使う上限バイト数。0 で無効。
   *
   * Int で受けると 2GB を超える指定が無言で壊れるので、JS の number をそのまま Double で受ける。
   */
  @Field val synthesisCacheBytes: Double = VoicevoxWavCache.DEFAULT_LIMIT_BYTES.toDouble()
}

/** ユーザー辞書へ登録する単語。既定値は JS 側で埋まっている。 */
class VoicevoxUserDictWordRecord : Record {
  @Field val surface: String = ""

  @Field val pronunciation: String = ""

  @Field val accentType: Int = 0

  @Field val wordType: String = "COMMON_NOUN"

  @Field val priority: Int = 5
}

/** voicevox-core 由来のエラーを JS へ伝えるための例外。 */
class VoicevoxException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class ExpoVoicevoxModule : Module() {
  private val engine = VoicevoxEngine()

  /** voicevox-core の Synthesizer は同時実行できないので、重い処理はこのロックで直列化する。 */
  private val engineLock = Any()

  /** 合成結果の LRU キャッシュ。[engineLock] の内側でだけ触るので、自前のロックは持たない。 */
  private val wavCache = VoicevoxWavCache()

  /** config plugin が配置したアセットの解決役。reactContext が要るので遅延生成する。 */
  private var assets: VoicevoxAssets? = null

  /**
   * 再生役。reactContext が要るので assets と同じく遅延生成する。
   *
   * `isSpeaking` が JS スレッドから engineLock を取らずに読むので `@Volatile`。
   * 生成は [playerInitLock] で守る（engineLock を使うと合成の完了まで待たされる）。
   */
  @Volatile private var player: VoicevoxPlayer? = null

  private val playerInitLock = Any()

  override fun definition() = ModuleDefinition {
    Name("ExpoVoicevox")

    Events("onPrepareProgress", "onSpeechStateChange")

    OnDestroy {
      // 停止は engineLock に依存しないので先に済ませる（合成の実行中でも即座に黙る）。
      player?.release()
      synchronized(engineLock) {
        engine.release()
        wavCache.clear()
      }
    }

    Function("getVersion") { GlobalInfo.getVersion() }

    Function("isInitialized") { engine.isInitialized }

    // 再生役がまだ無いなら鳴っているはずがない。ここで作ると reactContext 待ちで例外になる。
    Function("isSpeaking") { player?.isSpeaking ?: false }

    AsyncFunction("prepareAssets") {
      synchronized(engineLock) {
        val paths = prepareAssets()
        mapOf(
          "openJtalkDictDir" to paths.openJtalkDictDir,
          "voiceModelPaths" to paths.voiceModelPaths
        )
      }
    }

    AsyncFunction("initialize") { options: VoicevoxInitializeOptions ->
      synchronized(engineLock) {
        // 明示パスが両方そろっているときはアセットの準備を一切走らせない
        // （自前でモデルを管理している利用者に余計なダウンロードをさせないため）。
        val explicitDict = options.openJtalkDictDir
        val explicitModels = options.voiceModelPaths
        val dictDir: String
        val modelPaths: List<String>
        if (explicitDict != null && explicitModels != null) {
          dictDir = explicitDict
          modelPaths = explicitModels
        } else {
          val prepared = prepareAssets()
          dictDir = explicitDict ?: prepared.openJtalkDictDir
          modelPaths = explicitModels ?: prepared.voiceModelPaths
        }

        val limitBytes = cacheLimitBytes(options.synthesisCacheBytes)
        runWrappingErrors("failed to initialize voicevox-core") {
          engine.initialize(
            openJtalkDictDir = dictDir,
            voiceModelPaths = modelPaths,
            cpuNumThreads = options.cpuNumThreads
          )
        }
        // 読み込むモデルが変わりうるので、初期化のたびに作り直す。
        wavCache.limitBytes = limitBytes
        wavCache.clear()
      }
    }

    AsyncFunction("getMetasJson") {
      synchronized(engineLock) {
        runWrappingErrors("failed to read the voice metadata") { engine.metasJson() }
      }
    }

    AsyncFunction("tts") {
      text: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      directory: String,
      useCache: Boolean ->
      // 書き出し先の検証とキーの組み立てはロックの外で済ませる。
      val outputDir = outputDirectory(directory)
      val key = VoicevoxWavCache.key("text", styleId, enableInterrogativeUpspeak, text)
      synchronized(engineLock) {
        runWrappingErrors("speech synthesis failed") {
          val wav =
            cachedWav(key, useCache) { engine.tts(text, styleId, enableInterrogativeUpspeak) }
          writeWav(wav, outputDir)
        }
      }
    }

    AsyncFunction("ttsFromKana") {
      kana: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      directory: String,
      useCache: Boolean ->
      val outputDir = outputDirectory(directory)
      val key = VoicevoxWavCache.key("kana", styleId, enableInterrogativeUpspeak, kana)
      synchronized(engineLock) {
        runWrappingErrors("speech synthesis failed") {
          val wav =
            cachedWav(key, useCache) {
              engine.ttsFromKana(kana, styleId, enableInterrogativeUpspeak)
            }
          writeWav(wav, outputDir)
        }
      }
    }

    AsyncFunction("createAudioQueryJson") { text: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to create the audio query") {
          engine.createAudioQueryJson(text, styleId)
        }
      }
    }

    AsyncFunction("createAudioQueryFromKanaJson") { kana: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to create the audio query") {
          engine.createAudioQueryFromKanaJson(kana, styleId)
        }
      }
    }

    AsyncFunction("createAccentPhrasesJson") { text: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to create the accent phrases") {
          engine.createAccentPhrasesJson(text, styleId)
        }
      }
    }

    AsyncFunction("createAccentPhrasesFromKanaJson") { kana: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to create the accent phrases") {
          engine.createAccentPhrasesFromKanaJson(kana, styleId)
        }
      }
    }

    AsyncFunction("replaceMoraDataJson") { accentPhrasesJson: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to replace the mora data") {
          engine.replaceMoraDataJson(accentPhrasesJson, styleId)
        }
      }
    }

    AsyncFunction("replacePhonemeLengthJson") { accentPhrasesJson: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to replace the phoneme length") {
          engine.replacePhonemeLengthJson(accentPhrasesJson, styleId)
        }
      }
    }

    AsyncFunction("replaceMoraPitchJson") { accentPhrasesJson: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("failed to replace the mora pitch") {
          engine.replaceMoraPitchJson(accentPhrasesJson, styleId)
        }
      }
    }

    // 推論を伴わないので直列化する必要が無い。
    AsyncFunction("audioQueryFromAccentPhrasesJson") { accentPhrasesJson: String ->
      runWrappingErrors("failed to build the audio query") {
        engine.audioQueryFromAccentPhrasesJson(accentPhrasesJson)
      }
    }

    AsyncFunction("synthesis") {
      audioQueryJson: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      directory: String,
      useCache: Boolean ->
      val outputDir = outputDirectory(directory)
      val key = VoicevoxWavCache.key("query", styleId, enableInterrogativeUpspeak, audioQueryJson)
      synchronized(engineLock) {
        runWrappingErrors("speech synthesis failed") {
          val wav =
            cachedWav(key, useCache) {
              engine.synthesis(audioQueryJson, styleId, enableInterrogativeUpspeak)
            }
          writeWav(wav, outputDir)
        }
      }
    }

    AsyncFunction("speak") {
      text: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      audioSession: String,
      useCache: Boolean,
      promise: Promise ->
      val key = VoicevoxWavCache.key("text", styleId, enableInterrogativeUpspeak, text)
      speakWav(key, useCache, audioSession, promise) {
        engine.tts(text, styleId, enableInterrogativeUpspeak)
      }
    }

    AsyncFunction("speakFromKana") {
      kana: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      audioSession: String,
      useCache: Boolean,
      promise: Promise ->
      val key = VoicevoxWavCache.key("kana", styleId, enableInterrogativeUpspeak, kana)
      speakWav(key, useCache, audioSession, promise) {
        engine.ttsFromKana(kana, styleId, enableInterrogativeUpspeak)
      }
    }

    AsyncFunction("speakFromAudioQuery") {
      audioQueryJson: String,
      styleId: Int,
      enableInterrogativeUpspeak: Boolean,
      audioSession: String,
      useCache: Boolean,
      promise: Promise ->
      val key = VoicevoxWavCache.key("query", styleId, enableInterrogativeUpspeak, audioQueryJson)
      speakWav(key, useCache, audioSession, promise) {
        engine.synthesis(audioQueryJson, styleId, enableInterrogativeUpspeak)
      }
    }

    // 合成の実行中でも即座に止められるよう、engineLock は取らない。
    AsyncFunction("stopSpeaking") { requirePlayer().stop() }

    AsyncFunction("setUserDictWords") { words: List<VoicevoxUserDictWordRecord> ->
      val converted = words.map { toVoicevoxWord(it) }
      synchronized(engineLock) {
        runWrappingErrors("failed to update the user dictionary") {
          engine.setUserDictWords(converted)
        }
        // 読みが変わるので、捨てないと古い発音のまま鳴ってしまう。
        wavCache.clear()
      }
    }

    AsyncFunction("loadUserDictFile") { path: String ->
      synchronized(engineLock) {
        runWrappingErrors("failed to load the user dictionary") { engine.loadUserDictFile(path) }
        // setUserDictWords と同じ理由で捨てる。
        wavCache.clear()
      }
    }

    AsyncFunction("saveUserDictFile") { path: String ->
      synchronized(engineLock) {
        runWrappingErrors("failed to save the user dictionary") { engine.saveUserDictFile(path) }
      }
    }

    AsyncFunction("finalize") {
      synchronized(engineLock) {
        engine.release()
        wavCache.clear()
      }
    }

    // engineLock を取るので合成の実行中は待たされる。同期関数にすると JS スレッドが
    // 合成の完了まで止まるため、どちらも AsyncFunction のままにしておくこと。
    AsyncFunction("clearSynthesisCache") { synchronized(engineLock) { wavCache.clear() } }

    AsyncFunction("getSynthesisCacheStats") { synchronized(engineLock) { wavCache.toStatsMap() } }
  }

  /**
   * JS の number を上限バイト数へ直す。
   *
   * 検証は JS 側にもあるが、ネイティブへ直接来た値で LRU が壊れないようここでも見る。
   */
  private fun cacheLimitBytes(raw: Double): Long {
    if (!raw.isFinite() || raw < 0 || raw > Long.MAX_VALUE.toDouble()) {
      throw VoicevoxException("synthesisCacheBytes is out of range: $raw")
    }
    return raw.toLong()
  }

  /**
   * キャッシュを引いてから合成する。[engineLock] を握った状態で呼ぶこと。
   *
   * `useCache` が false のときは読みも書きもしない。一度きりの動的なテキストで LRU を
   * 汚さないための逃げ道なので、「読むが書かない」にはしない。
   */
  private fun cachedWav(key: String, useCache: Boolean, synthesize: () -> ByteArray): ByteArray {
    if (useCache) {
      wavCache.get(key)?.let {
        return it
      }
    }
    val wav = synthesize()
    if (useCache) {
      wavCache.put(key, wav)
    }
    return wav
  }

  private fun toVoicevoxWord(record: VoicevoxUserDictWordRecord): VoicevoxWord {
    // UserDictWord.Type は enum ではないので when で引く。
    val wordType =
      when (record.wordType) {
        "PROPER_NOUN" -> UserDictWord.Type.PROPER_NOUN
        "COMMON_NOUN" -> UserDictWord.Type.COMMON_NOUN
        "VERB" -> UserDictWord.Type.VERB
        "ADJECTIVE" -> UserDictWord.Type.ADJECTIVE
        "SUFFIX" -> UserDictWord.Type.SUFFIX
        else ->
          throw VoicevoxException("unknown user dictionary word type: ${record.wordType}")
      }
    return VoicevoxWord(
      surface = record.surface,
      pronunciation = record.pronunciation,
      accentType = record.accentType,
      wordType = wordType,
      priority = record.priority
    )
  }

  /** config plugin が配置したアセットを使える状態にする。進捗は JS へイベントで流す。 */
  private fun prepareAssets(): VoicevoxAssetPaths {
    val context =
      appContext.reactContext
        ?: throw VoicevoxException("the Android context is not available yet")
    val resolver = assets ?: VoicevoxAssets(context).also { assets = it }
    return runWrappingErrors("failed to prepare the voicevox assets") {
      resolver.prepare { progress -> sendEvent("onPrepareProgress", progress.toEventMap()) }
    }
  }

  /**
   * voicevox-core の型付き例外をそのまま JS へ流すと種類が多すぎるので、
   * メッセージを保ったまま 1 つの CodedException にまとめる。
   */
  private inline fun <T> runWrappingErrors(context: String, block: () -> T): T {
    try {
      return block()
    } catch (error: CodedException) {
      throw error
    } catch (error: Throwable) {
      val detail = error.message ?: error::class.java.simpleName
      throw VoicevoxException("$context: $detail", error)
    }
  }

  /**
   * 再生役を用意する。reactContext が要るので遅延生成する。
   *
   * AsyncFunction は同時に走りうるので、二重生成しないようロックの中で作る。取り逃すと
   * 誰も参照していない AudioTrack が鳴り続けて止められなくなる。
   */
  private fun requirePlayer(): VoicevoxPlayer =
    synchronized(playerInitLock) {
      player?.let {
        return it
      }
      val context =
        appContext.reactContext
          ?: throw VoicevoxException("the Android context is not available yet")
      val created = VoicevoxPlayer(context)
      created.onStateChange = { id, state, reason ->
        sendEvent(
          "onSpeechStateChange",
          mapOf("id" to id, "state" to state.jsValue, "reason" to reason)
        )
      }
      player = created
      created
    }

  /**
   * 再生系に共通する「engineLock の中で合成し、再生はロックの外で始める」流れ。
   *
   * 再生の完了をロックの中で待つと、鳴っているあいだ次の合成を始められない。
   * `VoicevoxPlayer.play` は専用スレッドを起こして即座に戻る。
   */
  private fun speakWav(
    key: String,
    useCache: Boolean,
    audioSession: String,
    promise: Promise,
    synthesize: () -> ByteArray
  ) {
    try {
      val mode =
        VoicevoxAudioSessionMode.parse(audioSession)
          ?: throw VoicevoxException("unknown audio session mode: $audioSession")
      val player = requirePlayer()
      val id = player.begin()
      val wav =
        try {
          synchronized(engineLock) {
            runWrappingErrors("speech synthesis failed") { cachedWav(key, useCache, synthesize) }
          }
        } catch (error: Throwable) {
          // 合成に失敗したら自分の予約だけ畳む。鳴っている音は止めない。
          player.cancel(id)
          throw error
        }
      val result = runWrappingErrors("playback failed") { player.play(id, wav, mode) }
      promise.resolve(result.toResultMap())
    } catch (error: CodedException) {
      promise.reject(error)
    } catch (error: Throwable) {
      promise.reject(
        VoicevoxException(error.message ?: error::class.java.simpleName, error)
      )
    }
  }

  /** 書き出し先の指定を実ディレクトリへ変換する。 */
  private fun outputDirectory(directory: String): File {
    val context =
      appContext.reactContext
        ?: throw VoicevoxException("the Android context is not available yet")
    return when (directory) {
      "cache" -> context.cacheDir
      // filesDir は Android Auto Backup（上限 25MB）の対象。WAV を貯め込むと上限に当たる。
      "document" -> context.filesDir
      else -> throw VoicevoxException("unknown output directory: $directory")
    }
  }

  /** 合成結果を指定のディレクトリへ書き出し、そのパスを返す。 */
  private fun writeWav(wav: ByteArray, baseDir: File): String {
    val outputDir = File(baseDir, "expo-voicevox")
    if (!outputDir.exists() && !outputDir.mkdirs()) {
      throw VoicevoxException("could not create the output directory: ${outputDir.absolutePath}")
    }
    val outputFile = File(outputDir, "${UUID.randomUUID()}.wav")
    outputFile.writeBytes(wav)
    return outputFile.absolutePath
  }
}
