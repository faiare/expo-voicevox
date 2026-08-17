package expo.modules.voicevox

import com.google.gson.GsonBuilder
import com.google.gson.reflect.TypeToken
import jp.hiroshiba.voicevoxcore.AccentPhrase
import jp.hiroshiba.voicevoxcore.AccelerationMode
import jp.hiroshiba.voicevoxcore.AudioQuery
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

/** Gson は総称型を実行時に持てないので、`List<AccentPhrase>` の型情報を用意しておく。 */
private val ACCENT_PHRASE_LIST_TYPE = object : TypeToken<List<AccentPhrase>>() {}.type

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

  /**
   * AudioQuery と JS の橋渡しに使う Gson。
   *
   * 命名規則は**既定（フィールド名そのまま）で正しい**。voicevox-core の JSON は
   * snake_case と camelCase の混在で、snake_case にすべき 5 個には
   * `AudioQuery` / `AccentPhrase` / `Mora` に `@SerializedName` が付いている。
   * `FieldNamingPolicy` を触ると `speedScale` などまで snake_case になって iOS と食い違う。
   *
   * null を省略しないのは、`Mora.consonant` と `consonantLength` の有無が
   * iOS 側の JSON と揃うようにするため。
   */
  private val gson = GsonBuilder().serializeNulls().create()

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
    val metas = JSONArray()
    for (character in requireSynthesizer().metas()) {
      metas.put(toJson(character))
    }
    return metas.toString()
  }

  /** テキストを合成して WAV バイト列（ヘッダ付き）を返す。 */
  fun tts(text: String, styleId: Int, enableInterrogativeUpspeak: Boolean): ByteArray =
    requireSynthesizer().tts(text, styleId).interrogativeUpspeak(enableInterrogativeUpspeak).perform()

  /** AquesTalk 風記法のカナを合成して WAV バイト列を返す。 */
  fun ttsFromKana(kana: String, styleId: Int, enableInterrogativeUpspeak: Boolean): ByteArray =
    requireSynthesizer()
      .ttsFromKana(kana, styleId)
      .interrogativeUpspeak(enableInterrogativeUpspeak)
      .perform()

  /** テキストから AudioQuery を生成し、JSON 文字列で返す。 */
  fun createAudioQueryJson(text: String, styleId: Int): String =
    gson.toJson(requireSynthesizer().createAudioQuery(text, styleId))

  /** AquesTalk 風記法のカナから AudioQuery を生成し、JSON 文字列で返す。 */
  fun createAudioQueryFromKanaJson(kana: String, styleId: Int): String =
    gson.toJson(requireSynthesizer().createAudioQueryFromKana(kana, styleId))

  /** テキストから AccentPhrase 配列を生成し、JSON 文字列で返す。 */
  fun createAccentPhrasesJson(text: String, styleId: Int): String =
    gson.toJson(requireSynthesizer().createAccentPhrases(text, styleId))

  /** AquesTalk 風記法のカナから AccentPhrase 配列を生成し、JSON 文字列で返す。 */
  fun createAccentPhrasesFromKanaJson(kana: String, styleId: Int): String =
    gson.toJson(requireSynthesizer().createAccentPhrasesFromKana(kana, styleId))

  /** AccentPhrase 配列の音素長と音高を生成し直す。 */
  fun replaceMoraDataJson(accentPhrasesJson: String, styleId: Int): String =
    gson.toJson(requireSynthesizer().replaceMoraData(parseAccentPhrases(accentPhrasesJson), styleId))

  /** AccentPhrase 配列の音素長だけを生成し直す。 */
  fun replacePhonemeLengthJson(accentPhrasesJson: String, styleId: Int): String =
    gson.toJson(
      requireSynthesizer().replacePhonemeLength(parseAccentPhrases(accentPhrasesJson), styleId)
    )

  /** AccentPhrase 配列の音高だけを生成し直す。 */
  fun replaceMoraPitchJson(accentPhrasesJson: String, styleId: Int): String =
    gson.toJson(
      requireSynthesizer().replaceMoraPitch(parseAccentPhrases(accentPhrasesJson), styleId)
    )

  /**
   * AccentPhrase 配列から AudioQuery を組み立てる。
   *
   * 推論を行わないので Synthesizer を必要としない（iOS 側も自由関数になっている）。
   */
  fun audioQueryFromAccentPhrasesJson(accentPhrasesJson: String): String =
    gson.toJson(AudioQuery.fromAccentPhrases(parseAccentPhrases(accentPhrasesJson)))

  /** AudioQuery の JSON を合成して WAV バイト列を返す。 */
  fun synthesis(
    audioQueryJson: String,
    styleId: Int,
    enableInterrogativeUpspeak: Boolean
  ): ByteArray {
    val synthesizer = requireSynthesizer()
    val audioQuery =
      gson.fromJson(audioQueryJson, AudioQuery::class.java)
        ?: throw IllegalArgumentException("audioQuery is not a valid AudioQuery JSON")
    return synthesizer
      .synthesis(audioQuery, styleId)
      .interrogativeUpspeak(enableInterrogativeUpspeak)
      .perform()
  }

  fun releaseSynthesizer() {
    // Java API は明示的な close を持たない（finalize で解放される）ため参照だけ落とす。
    synthesizer = null
  }

  private fun requireSynthesizer(): Synthesizer =
    synthesizer ?: throw VoicevoxNotInitializedException()

  private fun parseAccentPhrases(json: String): List<AccentPhrase> =
    gson.fromJson<List<AccentPhrase>>(json, ACCENT_PHRASE_LIST_TYPE)
      ?: throw IllegalArgumentException("accentPhrases is not a valid AccentPhrase JSON array")

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
