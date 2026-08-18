package expo.modules.voicevox

import android.content.Context
import android.os.StatFs
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/** `initialize()` に渡す、端末上の絶対パス。 */
data class VoicevoxAssetPaths(val openJtalkDictDir: String, val voiceModelPaths: List<String>)

/**
 * `prepareAssets()` を走らせずに読める範囲のアセットの状態。
 *
 * 「もう使える状態か」「使えないなら何 MB 取りに行くことになるか」を、取得も展開も始めずに
 * 知るための口。
 */
data class VoicevoxAssetStatus(
  val configured: Boolean,
  val ready: Boolean,
  val assetSource: String,
  val downloadBytes: Long
) {
  fun toResultMap(): Map<String, Any> =
    mapOf(
      "configured" to configured,
      "ready" to ready,
      "assetSource" to assetSource,
      "downloadBytes" to downloadBytes
    )
}

/** アセットの準備中に JS へ流す進捗。 */
data class VoicevoxPrepareProgress(
  val stage: String, // "download" | "extract"
  val current: String,
  val completedBytes: Long,
  val totalBytes: Long,
  val completedFiles: Int,
  val totalFiles: Int
) {
  fun toEventMap(): Map<String, Any> =
    mapOf(
      "stage" to stage,
      "current" to current,
      "completedBytes" to completedBytes,
      "totalBytes" to totalBytes,
      "completedFiles" to completedFiles,
      "totalFiles" to totalFiles
    )
}

/** config plugin が置いたマニフェスト。iOS と Android で同じ JSON を読む。 */
private data class VoicevoxManifest(
  val manifestVersion: Int,
  val assetSource: String,
  val openJtalkDictDirName: String?,
  val voiceModelNames: List<String>,
  val revision: String,
  val downloads: List<Download>
) {
  data class Download(
    val kind: String, // "file" | "targz"
    val url: String,
    val sha256: String?,
    val size: Long?,
    val name: String
  )

  companion object {
    fun parse(json: String): VoicevoxManifest {
      val root = JSONObject(json)
      val models = root.getJSONArray("voiceModelNames")
      val downloads = root.getJSONArray("downloads")
      return VoicevoxManifest(
        manifestVersion = root.getInt("manifestVersion"),
        assetSource = root.getString("assetSource"),
        openJtalkDictDirName =
          if (root.isNull("openJtalkDictDirName")) null else root.getString("openJtalkDictDirName"),
        voiceModelNames = (0 until models.length()).map { models.getString(it) },
        revision = root.getString("revision"),
        downloads =
          (0 until downloads.length()).map { index ->
            val entry = downloads.getJSONObject(index)
            Download(
              kind = entry.getString("kind"),
              url = entry.getString("url"),
              sha256 = if (entry.isNull("sha256")) null else entry.getString("sha256"),
              size = if (entry.isNull("size")) null else entry.getLong("size"),
              name = entry.getString("name")
            )
          }
      )
    }
  }
}

/**
 * config plugin が配置したアセットを解決する。
 *
 * voicevox-core は辞書もモデルもファイルパスでしか読めない（Java API も
 * `OpenJtalk(String)` / `VoiceModelFile(String)` のみで FD 版が無い）。
 * APK 内の assets には実パスが無いため、bundle モードでも端末のストレージへ展開する。
 *
 * 展開先を `filesDir` ではなく `noBackupFilesDir` にしているのは、170MB 超が
 * Android Auto Backup（上限 25MB）や端末間データ転送の対象になると壊れるため。
 * `noBackupFilesDir` はバックアップ対象外であることが保証されているので、
 * 利用者アプリの `dataExtractionRules` を書き換えずに済む。
 */
class VoicevoxAssets(private val context: Context) {
  private companion object {
    /** config plugin の `plugin/src/constants.ts` と同じ名前にすること。 */
    const val RESOURCE_DIR = "voicevox"
    const val MANIFEST_FILE = "voicevox-manifest.json"
    const val COMPLETE_MARKER = ".expo-voicevox-complete"
    const val BUFFER_SIZE = 1 shl 16

    /** ダウンロードしたアーカイブと展開結果が同時に存在するので、必要量は 2 倍強を見る。 */
    const val DOWNLOAD_SPACE_FACTOR = 2.2
  }

  private val lock = Any()

  /** [status] が [lock] を取らずに読むので `@Volatile`（取ると準備の完了まで待たされる）。 */
  @Volatile private var cached: VoicevoxAssetPaths? = null

  /**
   * 中断の要求。[cancel] は [lock] を取らずに立てる（取ると準備が終わるまで戻らず、
   * 中断の意味が無くなる）。
   */
  private val cancelled = AtomicBoolean(false)

  /**
   * 進行中の [prepare] を中断させる。走っていなければ何もしない。
   *
   * 次の [prepare] は入口でこのフラグを下ろすので、中断したあとでもやり直せる。
   */
  fun cancel() {
    cancelled.set(true)
  }

  /**
   * 取得も展開も始めずに読める範囲の状態を返す。
   *
   * [lock] を取らないので、準備の実行中でも即座に返る（そのあいだは `ready = false`）。
   */
  fun status(): VoicevoxAssetStatus {
    val manifest =
      try {
        readManifest()
      } catch (error: Throwable) {
        // マニフェストが無い = config plugin が入っていない。エラーにはしない
        // （「まだ設定していない」を知るための API なので）。
        return VoicevoxAssetStatus(
          configured = false,
          ready = false,
          assetSource = "bundle",
          downloadBytes = 0
        )
      }
    val downloadBytes = manifest.downloads.sumOf { it.size ?: 0L }
    if (manifest.manifestVersion != 1) {
      return VoicevoxAssetStatus(true, false, manifest.assetSource, downloadBytes)
    }

    val root = File(File(context.noBackupFilesDir, "expo-voicevox"), manifest.revision)
    val ready =
      cached != null ||
        (File(root, COMPLETE_MARKER).exists() &&
          runCatching { resolvePaths(manifest, root) }.isSuccess)
    return VoicevoxAssetStatus(true, ready, manifest.assetSource, downloadBytes)
  }

  /** アセットを使える状態にして絶対パスを返す。2 回目以降は何もしない。 */
  fun prepare(onProgress: (VoicevoxPrepareProgress) -> Unit): VoicevoxAssetPaths =
    synchronized(lock) {
      cached?.let {
        return it
      }
      // 前回の中断を引きずらない。
      cancelled.set(false)

      val manifest = readManifest()
      if (manifest.manifestVersion != 1) {
        throw VoicevoxException(
          "$MANIFEST_FILE has version ${manifest.manifestVersion}, which this build of " +
            "expo-voicevox does not understand. Run `npx expo prebuild` after updating the package."
        )
      }

      val root = File(File(context.noBackupFilesDir, "expo-voicevox"), manifest.revision)
      if (!File(root, COMPLETE_MARKER).exists()) {
        materialize(root, manifest, onProgress)
      }

      resolvePaths(manifest, root).also { cached = it }
    }

  /** 展開はステージング用ディレクトリで行い、完了してから rename する。 */
  private fun materialize(
    root: File,
    manifest: VoicevoxManifest,
    onProgress: (VoicevoxPrepareProgress) -> Unit
  ) {
    // 設定が変わったら古い revision のディレクトリは要らない。
    root.parentFile?.listFiles()?.forEach { entry ->
      if (entry.name != manifest.revision) entry.deleteRecursively()
    }

    val staging = File(root.parentFile, "${manifest.revision}.staging")
    staging.deleteRecursively()
    if (!staging.mkdirs()) {
      throw VoicevoxException("could not create ${staging.absolutePath}")
    }

    try {
      when (manifest.assetSource) {
        "download" -> downloadInto(staging, manifest, onProgress)
        else -> copyBundledInto(staging, onProgress)
      }
      File(staging, COMPLETE_MARKER).createNewFile()
      root.deleteRecursively()
      if (!staging.renameTo(root)) {
        throw VoicevoxException("could not move ${staging.absolutePath} to ${root.absolutePath}")
      }
    } catch (error: Throwable) {
      staging.deleteRecursively()
      throw error
    }
  }

  private fun readManifest(): VoicevoxManifest {
    val json =
      try {
        context.assets.open("$RESOURCE_DIR/$MANIFEST_FILE").use {
          it.readBytes().toString(Charsets.UTF_8)
        }
      } catch (error: FileNotFoundException) {
        throw VoicevoxException(
          "expo-voicevox assets were not found in the app. Add the expo-voicevox config plugin to " +
            "app.json and run `npx expo prebuild`, or pass openJtalkDictDir and voiceModelPaths " +
            "to initialize().",
          error
        )
      }
    return try {
      VoicevoxManifest.parse(json)
    } catch (error: Throwable) {
      throw VoicevoxException("could not read $MANIFEST_FILE: ${error.message}", error)
    }
  }

  private fun resolvePaths(manifest: VoicevoxManifest, root: File): VoicevoxAssetPaths {
    val dictDirName =
      manifest.openJtalkDictDirName
        ?: throw VoicevoxException(
          "the OpenJTalk dictionary is missing (the plugin was configured with " +
            "openJtalkDictionary: false)"
        )
    val dictDir = File(root, dictDirName)
    if (!dictDir.isDirectory) {
      throw VoicevoxException("the OpenJTalk dictionary is missing at ${dictDir.absolutePath}")
    }

    val modelPaths =
      manifest.voiceModelNames.map { name ->
        val model = File(root, name)
        if (!model.isFile) {
          throw VoicevoxException("a voice model is missing at ${model.absolutePath}")
        }
        model.absolutePath
      }

    return VoicevoxAssetPaths(dictDir.absolutePath, modelPaths)
  }

  // ---------------------------------------------------------------------------
  // bundle モード
  // ---------------------------------------------------------------------------

  private fun copyBundledInto(destination: File, onProgress: (VoicevoxPrepareProgress) -> Unit) {
    val entries = listAssets(RESOURCE_DIR).filterNot { it == "$RESOURCE_DIR/$MANIFEST_FILE" }

    // APK 内の assets は deflate されており展開後のサイズが事前に分からない。
    // 173MB を数えるためだけに全部読み直すのは無駄なので、
    // 事前チェックはせず、書き込みが失敗したときに空き容量を添えて伝える。
    entries.forEachIndexed { index, assetPath ->
      val relative = assetPath.removePrefix("$RESOURCE_DIR/")
      onProgress(VoicevoxPrepareProgress("extract", relative, 0, 0, index, entries.size))

      val target = File(destination, relative)
      target.parentFile?.let {
        if (!it.exists() && !it.mkdirs()) {
          throw VoicevoxException("could not create ${it.absolutePath}")
        }
      }
      try {
        context.assets.open(assetPath).use { input ->
          target.outputStream().buffered(BUFFER_SIZE).use { output -> copyCancellable(input, output) }
        }
      } catch (error: IOException) {
        throw VoicevoxException(
          "failed to unpack $relative (${availableBytes() / 1024 / 1024}MB free): ${error.message}",
          error
        )
      }
    }
    onProgress(VoicevoxPrepareProgress("extract", "", 0, 0, entries.size, entries.size))
  }

  /**
   * `InputStream.copyTo` の代わり。1 バッファごとに中断を見る。
   *
   * 0.vvm だけで 56MB あるので、ファイル単位のチェックでは中断が数秒待たされる。
   */
  private fun copyCancellable(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(BUFFER_SIZE)
    while (true) {
      throwIfCancelled()
      val read = input.read(buffer)
      if (read < 0) {
        return
      }
      output.write(buffer, 0, read)
    }
  }

  private fun throwIfCancelled() {
    if (cancelled.get()) {
      throw VoicevoxCancelledException()
    }
  }

  /**
   * assets 配下のファイルを再帰的に列挙する。
   *
   * `AssetManager.list()` はファイルに対しても空配列を返すので、空配列＝ファイルとみなす
   * （voicevox のアセットに空ディレクトリは無い）。
   */
  private fun listAssets(path: String): List<String> {
    val children = context.assets.list(path) ?: return emptyList()
    if (children.isEmpty()) {
      return listOf(path)
    }
    return children.flatMap { listAssets("$path/$it") }
  }

  // ---------------------------------------------------------------------------
  // download モード
  // ---------------------------------------------------------------------------

  private fun downloadInto(
    destination: File,
    manifest: VoicevoxManifest,
    onProgress: (VoicevoxPrepareProgress) -> Unit
  ) {
    // download モードはマニフェストにサイズが入っているので事前に確認できる。
    val known = manifest.downloads.sumOf { it.size ?: 0L }
    if (known > 0) {
      val required = (known * DOWNLOAD_SPACE_FACTOR).toLong()
      val available = availableBytes()
      if (available < required) {
        throw VoicevoxException(
          "not enough free storage to prepare the voicevox assets: " +
            "${required / 1024 / 1024}MB required, ${available / 1024 / 1024}MB available"
        )
      }
    }

    manifest.downloads.forEachIndexed { index, entry ->
      throwIfCancelled()
      val temporary = File(destination, "${entry.name}.download")
      VoicevoxDownloader.download(
        entry.url,
        temporary,
        entry.size,
        entry.sha256,
        { cancelled.get() }
      ) { written, total ->
        onProgress(
          VoicevoxPrepareProgress(
            "download",
            entry.name,
            written,
            total,
            index,
            manifest.downloads.size
          )
        )
      }

      if (entry.kind == "targz") {
        onProgress(
          VoicevoxPrepareProgress("extract", entry.name, 0, 0, index, manifest.downloads.size)
        )
        VoicevoxArchive.extractTarGz(temporary, destination) { cancelled.get() }
        temporary.delete()
      } else {
        val target = File(destination, entry.name)
        target.delete()
        if (!temporary.renameTo(target)) {
          throw VoicevoxException(
            "could not move ${temporary.absolutePath} to ${target.absolutePath}"
          )
        }
      }
    }
    onProgress(
      VoicevoxPrepareProgress("extract", "", 0, 0, manifest.downloads.size, manifest.downloads.size)
    )
  }

  private fun availableBytes(): Long = StatFs(context.noBackupFilesDir.absolutePath).availableBytes
}
