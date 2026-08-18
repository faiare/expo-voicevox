import Foundation

/// `initialize()` に渡す、端末上の絶対パス。
struct VoicevoxAssetPaths {
  let openJtalkDictDir: String
  let voiceModelPaths: [String]
}

/// `prepareAssets()` を走らせずに読める範囲のアセットの状態。
///
/// 「もう使える状態か」「使えないなら何 MB 取りに行くことになるか」を、取得も展開も始めずに
/// 知るための口。
struct VoicevoxAssetStatus {
  let configured: Bool
  let ready: Bool
  let assetSource: String
  let downloadBytes: Int64

  var dictionary: [String: Any] {
    [
      "configured": configured,
      "ready": ready,
      "assetSource": assetSource,
      "downloadBytes": downloadBytes,
    ]
  }
}

/// アセットの準備中に JS へ流す進捗。
struct VoicevoxPrepareProgress {
  let stage: String  // "download" | "extract"
  let current: String
  let completedBytes: Int64
  let totalBytes: Int64
  let completedFiles: Int
  let totalFiles: Int

  var dictionary: [String: Any] {
    [
      "stage": stage,
      "current": current,
      "completedBytes": completedBytes,
      "totalBytes": totalBytes,
      "completedFiles": completedFiles,
      "totalFiles": totalFiles,
    ]
  }
}

/// config plugin が置いたマニフェスト。iOS と Android で同じ JSON を読む。
struct VoicevoxManifest: Decodable {
  struct Download: Decodable {
    let kind: String  // "file" | "targz"
    let url: String
    let sha256: String?
    let size: Int?
    let name: String
  }

  let manifestVersion: Int
  let assetSource: String  // "bundle" | "download"
  let openJtalkDictDirName: String?
  let voiceModelNames: [String]
  let revision: String
  let downloads: [Download]
}

/// config plugin が配置したアセットを解決する。
///
/// bundle モードでは `.app` の中をそのまま読む。voicevox-core は辞書もモデルも
/// 読み取り専用で開くので、iOS では展開もコピーも要らない。
/// download モードだけ Application Support へ取得・展開する。
final class VoicevoxAssets {
  /// config plugin の `plugin/src/constants.ts` と同じ名前にすること。
  private static let resourceDirectoryName = "voicevox"
  private static let manifestFileName = "voicevox-manifest.json"
  private static let completeMarkerName = ".expo-voicevox-complete"

  enum AssetError: LocalizedError {
    case manifestMissing
    case manifestUnreadable(String)
    case unsupportedManifestVersion(Int)
    case dictionaryMissing(String)
    case voiceModelMissing(String)

    var errorDescription: String? {
      switch self {
      case .manifestMissing:
        return
          "expo-voicevox assets were not found in the app bundle. Add the expo-voicevox config plugin "
          + "to app.json and run `npx expo prebuild`, or pass openJtalkDictDir and voiceModelPaths to initialize()."
      case let .manifestUnreadable(reason):
        return "Could not read \(manifestFileName): \(reason)"
      case let .unsupportedManifestVersion(version):
        return
          "\(manifestFileName) has version \(version), which this build of expo-voicevox does not understand. "
          + "Run `npx expo prebuild` after updating the package."
      case let .dictionaryMissing(path):
        return "The OpenJTalk dictionary is missing at \(path)."
      case let .voiceModelMissing(path):
        return "A voice model is missing at \(path)."
      }
    }
  }

  static let shared = VoicevoxAssets()

  private let lock = NSLock()
  private var cached: VoicevoxAssetPaths?

  /// 中断の要求と、`status()` が読む `cached` を守る。
  ///
  /// `lock` とは別にするのが要点で、`cancel()` や `status()` が `lock` を取ると
  /// 準備が終わるまで戻らず、中断そのものができなくなる。
  private let stateLock = NSLock()
  private var cancelled = false
  private var readyPaths: VoicevoxAssetPaths?

  /// 進行中の `prepare` を中断させる。走っていなければ何もしない。
  ///
  /// 次の `prepare` は入口でこのフラグを下ろすので、中断したあとでもやり直せる。
  func cancel() {
    stateLock.withLock { cancelled = true }
  }

  private var isCancelled: Bool {
    stateLock.withLock { cancelled }
  }

  private func throwIfCancelled() throws {
    if isCancelled {
      throw VoicevoxCancelledException()
    }
  }

  /// 取得も展開も始めずに読める範囲の状態を返す。
  ///
  /// `lock` を取らないので、準備の実行中でも即座に返る（そのあいだは `ready = false`）。
  func status() -> VoicevoxAssetStatus {
    guard
      let bundleDirectory = bundleResourceDirectory(),
      let manifest = try? readManifest(in: bundleDirectory)
    else {
      // マニフェストが無い = config plugin が入っていない。エラーにはしない
      // （「まだ設定していない」を知るための API なので）。
      return VoicevoxAssetStatus(
        configured: false, ready: false, assetSource: "bundle", downloadBytes: 0)
    }
    let downloadBytes = manifest.downloads.reduce(Int64(0)) { $0 + Int64($1.size ?? 0) }
    guard manifest.manifestVersion == 1 else {
      return VoicevoxAssetStatus(
        configured: true, ready: false, assetSource: manifest.assetSource,
        downloadBytes: downloadBytes)
    }

    if stateLock.withLock({ readyPaths }) != nil {
      return VoicevoxAssetStatus(
        configured: true, ready: true, assetSource: manifest.assetSource,
        downloadBytes: downloadBytes)
    }

    let ready: Bool
    if manifest.assetSource == "download" {
      // bundle と違い、初回は取得も展開もしていない。完了マーカーの有無で見る。
      if let directory = try? downloadDirectory(revision: manifest.revision),
        FileManager.default.fileExists(
          atPath: directory.appendingPathComponent(Self.completeMarkerName).path) {
        ready = (try? resolvePaths(manifest: manifest, root: directory)) != nil
      } else {
        ready = false
      }
    } else {
      // bundle モードは .app の中をそのまま読むので、揃っていれば常に使える。
      ready = (try? resolvePaths(manifest: manifest, root: bundleDirectory)) != nil
    }
    return VoicevoxAssetStatus(
      configured: true, ready: ready, assetSource: manifest.assetSource,
      downloadBytes: downloadBytes)
  }

  /// アセットを使える状態にして絶対パスを返す。2 回目以降は何もしない。
  func prepare(onProgress: @escaping (VoicevoxPrepareProgress) -> Void) throws -> VoicevoxAssetPaths {
    lock.lock()
    defer { lock.unlock() }

    if let cached {
      return cached
    }
    // 前回の中断を引きずらない。
    stateLock.withLock { cancelled = false }

    guard let bundleDirectory = bundleResourceDirectory() else {
      throw AssetError.manifestMissing
    }
    let manifest = try readManifest(in: bundleDirectory)
    guard manifest.manifestVersion == 1 else {
      throw AssetError.unsupportedManifestVersion(manifest.manifestVersion)
    }

    let root =
      manifest.assetSource == "download"
      ? try downloadAssets(manifest, onProgress: onProgress)
      : bundleDirectory

    let paths = try resolvePaths(manifest: manifest, root: root)
    cached = paths
    stateLock.withLock { readyPaths = paths }
    return paths
  }

  // MARK: - マニフェスト

  private func bundleResourceDirectory() -> URL? {
    guard let resources = Bundle.main.resourceURL else {
      return nil
    }
    let directory = resources.appendingPathComponent(
      Self.resourceDirectoryName, isDirectory: true)
    return FileManager.default.fileExists(atPath: directory.path) ? directory : nil
  }

  private func readManifest(in directory: URL) throws -> VoicevoxManifest {
    let url = directory.appendingPathComponent(Self.manifestFileName)
    guard let data = try? Data(contentsOf: url) else {
      throw AssetError.manifestMissing
    }
    do {
      return try JSONDecoder().decode(VoicevoxManifest.self, from: data)
    } catch {
      throw AssetError.manifestUnreadable(error.localizedDescription)
    }
  }

  private func resolvePaths(manifest: VoicevoxManifest, root: URL) throws -> VoicevoxAssetPaths {
    guard let dictDirName = manifest.openJtalkDictDirName else {
      throw AssetError.dictionaryMissing(
        "the plugin was configured with openJtalkDictionary: false")
    }
    let dictDir = root.appendingPathComponent(dictDirName, isDirectory: true)
    guard FileManager.default.fileExists(atPath: dictDir.path) else {
      throw AssetError.dictionaryMissing(dictDir.path)
    }

    var modelPaths: [String] = []
    for name in manifest.voiceModelNames {
      let model = root.appendingPathComponent(name)
      guard FileManager.default.fileExists(atPath: model.path) else {
        throw AssetError.voiceModelMissing(model.path)
      }
      // voicevox-core は file:// を受け付けないので素のパスを渡す。
      modelPaths.append(model.path)
    }

    return VoicevoxAssetPaths(openJtalkDictDir: dictDir.path, voiceModelPaths: modelPaths)
  }

  // MARK: - download モード

  /// 取得先。再取得できるデータなので iCloud バックアップの対象から外す。
  private func downloadDirectory(revision: String) throws -> URL {
    let support = try FileManager.default.url(
      for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    return
      support
      .appendingPathComponent("expo-voicevox", isDirectory: true)
      .appendingPathComponent(revision, isDirectory: true)
  }

  private func downloadAssets(
    _ manifest: VoicevoxManifest,
    onProgress: @escaping (VoicevoxPrepareProgress) -> Void
  ) throws -> URL {
    let directory = try downloadDirectory(revision: manifest.revision)
    let marker = directory.appendingPathComponent(Self.completeMarkerName)
    if FileManager.default.fileExists(atPath: marker.path) {
      return directory
    }

    // 設定が変わったら古い revision のディレクトリは要らない。
    removeOtherRevisions(keeping: manifest.revision, in: directory.deletingLastPathComponent())

    let staging = directory.appendingPathExtension("staging")
    try? FileManager.default.removeItem(at: staging)
    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)

    // 中断や失敗で 100MB 級の残骸を置き去りにしない。次回は作り直しから始める。
    do {
      try downloadEntries(manifest, into: staging, onProgress: onProgress)
    } catch {
      try? FileManager.default.removeItem(at: staging)
      throw error
    }

    FileManager.default.createFile(
      atPath: staging.appendingPathComponent(Self.completeMarkerName).path, contents: nil)

    try? FileManager.default.removeItem(at: directory)
    try FileManager.default.moveItem(at: staging, to: directory)
    try excludeFromBackup(directory)

    onProgress(
      VoicevoxPrepareProgress(
        stage: "extract", current: "", completedBytes: 0, totalBytes: 0,
        completedFiles: manifest.downloads.count, totalFiles: manifest.downloads.count))
    return directory
  }

  private func downloadEntries(
    _ manifest: VoicevoxManifest,
    into staging: URL,
    onProgress: @escaping (VoicevoxPrepareProgress) -> Void
  ) throws {
    let total = manifest.downloads.count
    for (index, entry) in manifest.downloads.enumerated() {
      try throwIfCancelled()
      guard let url = URL(string: entry.url) else {
        throw VoicevoxDownloader.DownloadError.failed(url: entry.url, reason: "invalid URL")
      }

      let temporary = staging.appendingPathComponent("\(entry.name).part")
      try VoicevoxDownloader.download(
        url: url,
        to: temporary,
        expectedSize: entry.size,
        expectedSha256: entry.sha256,
        isCancelled: { [weak self] in self?.isCancelled ?? false }
      ) { written, expected in
        onProgress(
          VoicevoxPrepareProgress(
            stage: "download", current: entry.name,
            completedBytes: written, totalBytes: expected,
            completedFiles: index, totalFiles: total))
      }

      if entry.kind == "targz" {
        onProgress(
          VoicevoxPrepareProgress(
            stage: "extract", current: entry.name,
            completedBytes: 0, totalBytes: 0,
            completedFiles: index, totalFiles: total))
        try VoicevoxArchive.extractTarGz(
          source: temporary, destination: staging,
          isCancelled: { [weak self] in self?.isCancelled ?? false })
        try FileManager.default.removeItem(at: temporary)
      } else {
        try FileManager.default.moveItem(
          at: temporary, to: staging.appendingPathComponent(entry.name))
      }
    }
  }

  private func removeOtherRevisions(keeping revision: String, in parent: URL) {
    guard
      let entries = try? FileManager.default.contentsOfDirectory(
        at: parent, includingPropertiesForKeys: nil)
    else {
      return
    }
    for entry in entries where entry.lastPathComponent != revision {
      try? FileManager.default.removeItem(at: entry)
    }
  }

  /// 再取得できる大容量データを iCloud に載せると App Store のレビューで弾かれる。
  private func excludeFromBackup(_ url: URL) throws {
    var mutable = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try mutable.setResourceValues(values)
  }
}
