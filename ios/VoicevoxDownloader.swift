import CryptoKit
import Foundation

/// `assetSource: "download"` のときに音声モデルと辞書を取得する。
///
/// 呼び出し元（`AsyncFunction`）は既にバックグラウンドキューにいるので、
/// セマフォで同期的に待つ形にして呼び出し側を単純に保つ。
final class VoicevoxDownloader: NSObject {
  enum DownloadError: LocalizedError {
    case failed(url: String, reason: String)
    case sizeMismatch(url: String, expected: Int, actual: Int)
    case digestMismatch(url: String, expected: String, actual: String)

    var errorDescription: String? {
      switch self {
      case let .failed(url, reason):
        return "Failed to download \(url): \(reason)"
      case let .sizeMismatch(url, expected, actual):
        return "Downloaded \(url) has an unexpected size: expected \(expected) bytes, got \(actual)."
      case let .digestMismatch(url, expected, actual):
        return "Downloaded \(url) has an unexpected sha256: expected \(expected), got \(actual)."
      }
    }
  }

  /// 進捗の通知。`totalBytes` はサーバが Content-Length を返さない場合 0 になる。
  typealias ProgressHandler = (_ bytesWritten: Int64, _ totalBytes: Int64) -> Void

  private let progressHandler: ProgressHandler
  private var session: URLSession!
  private var temporaryURL: URL?
  private var failure: Error?
  private let semaphore = DispatchSemaphore(value: 0)

  private init(onProgress: @escaping ProgressHandler) {
    self.progressHandler = onProgress
    super.init()
    let queue = OperationQueue()
    queue.maxConcurrentOperationCount = 1
    session = URLSession(configuration: .default, delegate: self, delegateQueue: queue)
  }

  /// `url` を `destination` へ保存し、期待値があれば検証する。
  static func download(
    url: URL,
    to destination: URL,
    expectedSize: Int?,
    expectedSha256: String?,
    onProgress: @escaping ProgressHandler
  ) throws {
    let downloader = VoicevoxDownloader(onProgress: onProgress)
    defer { downloader.session.invalidateAndCancel() }

    let task = downloader.session.downloadTask(with: url)
    task.resume()
    downloader.semaphore.wait()

    if let failure = downloader.failure {
      throw failure
    }
    guard let temporaryURL = downloader.temporaryURL else {
      throw DownloadError.failed(url: url.absoluteString, reason: "no data was received")
    }
    defer { try? FileManager.default.removeItem(at: temporaryURL) }

    let attributes = try FileManager.default.attributesOfItem(atPath: temporaryURL.path)
    let size = (attributes[.size] as? Int) ?? 0
    if let expectedSize, size != expectedSize {
      throw DownloadError.sizeMismatch(url: url.absoluteString, expected: expectedSize, actual: size)
    }
    if let expectedSha256 {
      let actual = try sha256(of: temporaryURL)
      if actual != expectedSha256.lowercased() {
        throw DownloadError.digestMismatch(
          url: url.absoluteString, expected: expectedSha256, actual: actual)
      }
    }

    try FileManager.default.createDirectory(
      at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
    try? FileManager.default.removeItem(at: destination)
    try FileManager.default.moveItem(at: temporaryURL, to: destination)
    downloader.temporaryURL = nil
  }

  /// 100MB 級のファイルを一度にメモリへ載せないよう、チャンクで読みながら計算する。
  static func sha256(of url: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }

    var hasher = SHA256()
    while true {
      let chunk = handle.readData(ofLength: 1 << 20)
      if chunk.isEmpty { break }
      hasher.update(data: chunk)
    }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
  }
}

extension VoicevoxDownloader: URLSessionDownloadDelegate {
  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didFinishDownloadingTo location: URL
  ) {
    if let response = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(response.statusCode) {
      failure = DownloadError.failed(
        url: downloadTask.originalRequest?.url?.absoluteString ?? "",
        reason: "HTTP \(response.statusCode)")
      semaphore.signal()
      return
    }
    // デリゲートから戻ると `location` は消えるので、先に自分の場所へ移す。
    let kept = FileManager.default.temporaryDirectory
      .appendingPathComponent("expo-voicevox-\(UUID().uuidString)")
    do {
      try FileManager.default.moveItem(at: location, to: kept)
      temporaryURL = kept
    } catch {
      failure = error
    }
    semaphore.signal()
  }

  func urlSession(
    _ session: URLSession,
    downloadTask: URLSessionDownloadTask,
    didWriteData bytesWritten: Int64,
    totalBytesWritten: Int64,
    totalBytesExpectedToWrite: Int64
  ) {
    progressHandler(totalBytesWritten, max(totalBytesExpectedToWrite, 0))
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let error else { return }
    failure = DownloadError.failed(
      url: task.originalRequest?.url?.absoluteString ?? "",
      reason: error.localizedDescription)
    semaphore.signal()
  }
}
