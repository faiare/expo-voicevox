package expo.modules.voicevox

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.UUID
import jp.hiroshiba.voicevoxcore.GlobalInfo

/**
 * `initialize()` に渡される JS 側のオプション。
 *
 * パスが省略された（null の）場合は、config plugin が配置したアセットを自動で解決する。
 */
class VoicevoxInitializeOptions : Record {
  @Field val openJtalkDictDir: String? = null

  @Field val voiceModelPaths: List<String>? = null

  @Field val cpuNumThreads: Int = 0
}

/** voicevox-core 由来のエラーを JS へ伝えるための例外。 */
class VoicevoxException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class ExpoVoicevoxModule : Module() {
  private val engine = VoicevoxEngine()

  /** voicevox-core の Synthesizer は同時実行できないので、重い処理はこのロックで直列化する。 */
  private val engineLock = Any()

  /** config plugin が配置したアセットの解決役。reactContext が要るので遅延生成する。 */
  private var assets: VoicevoxAssets? = null

  override fun definition() = ModuleDefinition {
    Name("ExpoVoicevox")

    Events("onPrepareProgress")

    OnDestroy { synchronized(engineLock) { engine.releaseSynthesizer() } }

    Function("getVersion") { GlobalInfo.getVersion() }

    Function("isInitialized") { engine.isInitialized }

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

        runWrappingErrors("failed to initialize voicevox-core") {
          engine.initialize(
            openJtalkDictDir = dictDir,
            voiceModelPaths = modelPaths,
            cpuNumThreads = options.cpuNumThreads
          )
        }
      }
    }

    AsyncFunction("getMetasJson") {
      synchronized(engineLock) {
        runWrappingErrors("failed to read the voice metadata") { engine.metasJson() }
      }
    }

    AsyncFunction("tts") { text: String, styleId: Int, enableInterrogativeUpspeak: Boolean ->
      synchronized(engineLock) {
        runWrappingErrors("speech synthesis failed") {
          writeWavToCache(engine.tts(text, styleId, enableInterrogativeUpspeak))
        }
      }
    }

    AsyncFunction("ttsFromKana") { kana: String, styleId: Int, enableInterrogativeUpspeak: Boolean ->
      synchronized(engineLock) {
        runWrappingErrors("speech synthesis failed") {
          writeWavToCache(engine.ttsFromKana(kana, styleId, enableInterrogativeUpspeak))
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
      enableInterrogativeUpspeak: Boolean ->
      synchronized(engineLock) {
        runWrappingErrors("speech synthesis failed") {
          writeWavToCache(engine.synthesis(audioQueryJson, styleId, enableInterrogativeUpspeak))
        }
      }
    }

    AsyncFunction("finalize") { synchronized(engineLock) { engine.releaseSynthesizer() } }
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

  /** 合成結果をキャッシュディレクトリへ書き出し、そのパスを返す。 */
  private fun writeWavToCache(wav: ByteArray): String {
    val cacheDir =
      appContext.reactContext?.cacheDir
        ?: throw VoicevoxException("the cache directory is not available")
    val outputDir = File(cacheDir, "expo-voicevox")
    if (!outputDir.exists() && !outputDir.mkdirs()) {
      throw VoicevoxException("could not create the cache directory: ${outputDir.absolutePath}")
    }
    val outputFile = File(outputDir, "${UUID.randomUUID()}.wav")
    outputFile.writeBytes(wav)
    return outputFile.absolutePath
  }
}
