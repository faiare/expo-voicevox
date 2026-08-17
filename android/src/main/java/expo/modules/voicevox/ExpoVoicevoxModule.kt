package expo.modules.voicevox

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.UUID
import jp.hiroshiba.voicevoxcore.GlobalInfo

/** `initialize()` に渡される JS 側のオプション。 */
class VoicevoxInitializeOptions : Record {
  @Field val openJtalkDictDir: String = ""

  @Field val voiceModelPaths: List<String> = emptyList()

  @Field val cpuNumThreads: Int = 0
}

/** voicevox-core 由来のエラーを JS へ伝えるための例外。 */
class VoicevoxException(message: String, cause: Throwable? = null) : CodedException(message, cause)

class ExpoVoicevoxModule : Module() {
  private val engine = VoicevoxEngine()

  /** voicevox-core の Synthesizer は同時実行できないので、重い処理はこのロックで直列化する。 */
  private val engineLock = Any()

  override fun definition() = ModuleDefinition {
    Name("ExpoVoicevox")

    OnDestroy { synchronized(engineLock) { engine.releaseSynthesizer() } }

    Function("getVersion") { GlobalInfo.getVersion() }

    Function("isInitialized") { engine.isInitialized }

    AsyncFunction("initialize") { options: VoicevoxInitializeOptions ->
      synchronized(engineLock) {
        runWrappingErrors("voicevox-core の初期化に失敗しました") {
          engine.initialize(
            openJtalkDictDir = options.openJtalkDictDir,
            voiceModelPaths = options.voiceModelPaths,
            cpuNumThreads = options.cpuNumThreads
          )
        }
      }
    }

    AsyncFunction("getMetasJson") {
      synchronized(engineLock) {
        runWrappingErrors("メタ情報の取得に失敗しました") { engine.metasJson() }
      }
    }

    AsyncFunction("tts") { text: String, styleId: Int ->
      synchronized(engineLock) {
        runWrappingErrors("音声合成に失敗しました") { writeWavToCache(engine.tts(text, styleId)) }
      }
    }

    AsyncFunction("finalize") { synchronized(engineLock) { engine.releaseSynthesizer() } }
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
        ?: throw VoicevoxException("キャッシュディレクトリを取得できませんでした")
    val outputDir = File(cacheDir, "expo-voicevox")
    if (!outputDir.exists() && !outputDir.mkdirs()) {
      throw VoicevoxException("キャッシュディレクトリを作成できませんでした: ${outputDir.absolutePath}")
    }
    val outputFile = File(outputDir, "${UUID.randomUUID()}.wav")
    outputFile.writeBytes(wav)
    return outputFile.absolutePath
  }
}
