package expo.modules.voicevox

import jp.hiroshiba.voicevoxcore.AccelerationMode
import jp.hiroshiba.voicevoxcore.CharacterMeta
import jp.hiroshiba.voicevoxcore.blocking.Onnxruntime
import jp.hiroshiba.voicevoxcore.blocking.OpenJtalk
import jp.hiroshiba.voicevoxcore.blocking.Synthesizer
import jp.hiroshiba.voicevoxcore.blocking.VoiceModelFile
import org.json.JSONArray
import org.json.JSONObject

/** `initialize()` より前に合成を要求されたときのエラー。 */
class VoicevoxNotInitializedException :
  IllegalStateException("voicevox-core が初期化されていません。先に initialize() を呼んでください")

/**
 * voicevox-core の公式 Java API（`jp.hiroshiba.voicevoxcore`）を包むエンジン。
 *
 * Android 向けの配布バイナリは `load-onnxruntime` でビルドされているため、
 * ONNX Runtime は `Onnxruntime.loadOnce()` が `jniLibs` の
 * `libvoicevox_onnxruntime.so` を dlopen して読み込む。
 *
 * このクラス自体はスレッドセーフではない。呼び出し側で直列化すること。
 */
class VoicevoxEngine {
  private var synthesizer: Synthesizer? = null

  val isInitialized: Boolean
    get() = synthesizer != null

  fun initialize(openJtalkDictDir: String, voiceModelPaths: List<String>, cpuNumThreads: Int) {
    // 再初期化に備えて、既存の Synthesizer は先に手放す。
    releaseSynthesizer()

    val onnxruntime = Onnxruntime.loadOnce().perform()
    val openJtalk = OpenJtalk(openJtalkDictDir)
    val synthesizer =
      Synthesizer.builder(onnxruntime, openJtalk)
        // モバイル向けビルドに GPU は無いので CPU を明示する。
        .accelerationMode(AccelerationMode.CPU)
        .cpuNumThreads(cpuNumThreads)
        .build()

    for (path in voiceModelPaths) {
      // VoiceModelFile は Closeable だが close() してはいけない。
      // close() が呼ぶ rsClose() が Rust 側の値を解放したあと、GC 時の finalize() が
      // rsDrop() を重ねて呼び「Uncaught exception thrown by finalizer:
      // java.lang.RuntimeException: Null pointer in rust value from Java」になる
      // （voicevoxcore-android 0.17.0 で確認）。
      // 読み込み後は参照を捨てて finalize() に任せれば、二重解放にならず解放もされる。
      val model = VoiceModelFile(path)
      synthesizer.loadVoiceModel(model).perform()
    }

    this.synthesizer = synthesizer
  }

  /**
   * 読み込み済みの音声モデルのメタ情報を JSON 文字列で返す。
   *
   * voicevox-core が生成する JSON と同じ形（`name` / `speaker_uuid` / `styles[].id,name,type`）に
   * 揃えてある。JS 側は iOS / Android どちらでも同じ解釈で読める。
   */
  fun metasJson(): String {
    val synthesizer = this.synthesizer ?: throw VoicevoxNotInitializedException()
    val metas = JSONArray()
    for (character in synthesizer.metas()) {
      metas.put(toJson(character))
    }
    return metas.toString()
  }

  /** テキストを合成して WAV バイト列（ヘッダ付き）を返す。 */
  fun tts(text: String, styleId: Int): ByteArray {
    val synthesizer = this.synthesizer ?: throw VoicevoxNotInitializedException()
    return synthesizer.tts(text, styleId).perform()
  }

  fun releaseSynthesizer() {
    // Java API は明示的な close を持たない（finalize で解放される）ため参照だけ落とす。
    synthesizer = null
  }

  private fun toJson(character: CharacterMeta): JSONObject {
    val styles = JSONArray()
    for (style in character.styles) {
      styles.put(
        JSONObject().apply {
          put("id", style.id)
          put("name", style.name)
          put("type", style.type.toString())
        }
      )
    }
    return JSONObject().apply {
      put("name", character.name)
      put("speaker_uuid", character.speakerUuid)
      put("version", character.version)
      put("styles", styles)
    }
  }
}
