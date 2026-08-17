import Compression
import Foundation

/// tar.gz の展開。OpenJTalk 辞書が tar.gz でしか配布されていないため必要になる。
///
/// gzip は `Compression` フレームワークの `COMPRESSION_ZLIB`（raw deflate）へ
/// gzip ヘッダを自前で読み飛ばして流す。zlib を直接 import しないのは、
/// モジュールマップの用意が Xcode のバージョンに依存して不安定なため。
/// gzip の CRC32 は検証しない（アーカイブ全体の sha256 を先に検証しているため）。
enum VoicevoxArchive {
  enum ArchiveError: LocalizedError {
    case notGzip
    case truncated(String)
    case unsupportedEntry(String)
    case unsafePath(String)
    case decompressionFailed

    var errorDescription: String? {
      switch self {
      case .notGzip:
        return "The archive is not in gzip format."
      case let .truncated(what):
        return "The archive ended unexpectedly while reading \(what)."
      case let .unsupportedEntry(name):
        return "The archive contains an unsupported entry type: \(name)."
      case let .unsafePath(name):
        return "The archive contains an unsafe path: \(name)."
      case .decompressionFailed:
        return "Failed to decompress the archive."
      }
    }
  }

  /// `source` の tar.gz を `destination` 直下へ展開する。
  static func extractTarGz(source: URL, destination: URL) throws {
    let tarURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("expo-voicevox-\(UUID().uuidString).tar")
    defer { try? FileManager.default.removeItem(at: tarURL) }

    try gunzip(source: source, destination: tarURL)
    try extractTar(source: tarURL, destination: destination)
  }

  // MARK: - gzip

  private static let chunkSize = 1 << 20

  static func gunzip(source: URL, destination: URL) throws {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }

    let header = input.readData(ofLength: 10)
    guard header.count == 10, header[0] == 0x1F, header[1] == 0x8B, header[2] == 0x08 else {
      throw ArchiveError.notGzip
    }
    let flags = header[3]

    if flags & 0x04 != 0 {  // FEXTRA
      let lengthBytes = input.readData(ofLength: 2)
      guard lengthBytes.count == 2 else { throw ArchiveError.truncated("the gzip header") }
      let length = Int(lengthBytes[0]) | (Int(lengthBytes[1]) << 8)
      guard input.readData(ofLength: length).count == length else {
        throw ArchiveError.truncated("the gzip header")
      }
    }
    if flags & 0x08 != 0 { try skipZeroTerminatedString(input) }  // FNAME
    if flags & 0x10 != 0 { try skipZeroTerminatedString(input) }  // FCOMMENT
    if flags & 0x02 != 0 {  // FHCRC
      guard input.readData(ofLength: 2).count == 2 else {
        throw ArchiveError.truncated("the gzip header")
      }
    }

    FileManager.default.createFile(atPath: destination.path, contents: nil)
    let output = try FileHandle(forWritingTo: destination)
    defer { try? output.close() }

    try inflate(input: input, output: output)
  }

  private static func skipZeroTerminatedString(_ handle: FileHandle) throws {
    while true {
      let byte = handle.readData(ofLength: 1)
      guard byte.count == 1 else { throw ArchiveError.truncated("the gzip header") }
      if byte[0] == 0 { return }
    }
  }

  /// raw deflate ストリームを展開する。gzip の 8 バイトのトレーラは終端検出後に無視される。
  ///
  /// 入出力とも自前で確保したバッファを使う。`compression_stream` は
  /// `compression_stream_process` を跨いで `src_ptr` を保持するため、
  /// `Data.withUnsafeBytes` のようにクロージャの中でしか有効でないポインタは渡せない。
  private static func inflate(input: FileHandle, output: FileHandle) throws {
    let streamPointer = UnsafeMutablePointer<compression_stream>.allocate(capacity: 1)
    defer { streamPointer.deallocate() }

    guard
      compression_stream_init(streamPointer, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB)
        == COMPRESSION_STATUS_OK
    else {
      throw ArchiveError.decompressionFailed
    }
    defer { compression_stream_destroy(streamPointer) }

    let sourceBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunkSize)
    defer { sourceBuffer.deallocate() }
    let outputBuffer = UnsafeMutablePointer<UInt8>.allocate(capacity: chunkSize)
    defer { outputBuffer.deallocate() }

    streamPointer.pointee.dst_ptr = outputBuffer
    streamPointer.pointee.dst_size = chunkSize
    streamPointer.pointee.src_ptr = UnsafePointer(sourceBuffer)
    streamPointer.pointee.src_size = 0

    var reachedEnd = false

    while true {
      if streamPointer.pointee.src_size == 0 && !reachedEnd {
        let data = input.readData(ofLength: chunkSize)
        if data.isEmpty {
          reachedEnd = true
        } else {
          data.copyBytes(to: sourceBuffer, count: data.count)
          streamPointer.pointee.src_ptr = UnsafePointer(sourceBuffer)
          streamPointer.pointee.src_size = data.count
        }
      }

      let flags = reachedEnd ? Int32(COMPRESSION_STREAM_FINALIZE.rawValue) : 0
      let status = compression_stream_process(streamPointer, flags)

      let produced = chunkSize - streamPointer.pointee.dst_size
      if produced > 0 {
        output.write(Data(bytes: outputBuffer, count: produced))
        streamPointer.pointee.dst_ptr = outputBuffer
        streamPointer.pointee.dst_size = chunkSize
      }

      switch status {
      case COMPRESSION_STATUS_END:
        return
      case COMPRESSION_STATUS_OK:
        continue
      default:
        throw ArchiveError.decompressionFailed
      }
    }
  }

  // MARK: - tar

  private static let blockSize = 512

  /// ustar の通常ファイルとディレクトリだけを扱う素朴な実装。
  /// voicevox が配布する辞書はこの 2 種類しか含まない。
  static func extractTar(source: URL, destination: URL) throws {
    let input = try FileHandle(forReadingFrom: source)
    defer { try? input.close() }

    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)

    var emptyBlocks = 0
    while true {
      let header = input.readData(ofLength: blockSize)
      if header.count < blockSize {
        // 終端ブロックが欠けている tar もあるので、ここは正常終了として扱う。
        return
      }
      if header.allSatisfy({ $0 == 0 }) {
        emptyBlocks += 1
        if emptyBlocks == 2 { return }
        continue
      }
      emptyBlocks = 0

      let name = string(in: header, offset: 0, length: 100)
      let prefix = string(in: header, offset: 345, length: 155)
      let fullName = prefix.isEmpty ? name : "\(prefix)/\(name)"
      let size = octal(in: header, offset: 124, length: 12)
      let typeFlag = header[156]

      let target = try safeURL(for: fullName, under: destination)

      switch typeFlag {
      case UInt8(ascii: "5"):
        try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
      case UInt8(ascii: "0"), 0:
        try FileManager.default.createDirectory(
          at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: target.path, contents: nil)
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }

        var remaining = size
        while remaining > 0 {
          let want = min(remaining, chunkSize)
          let data = input.readData(ofLength: want)
          guard data.count == want else { throw ArchiveError.truncated(fullName) }
          output.write(data)
          remaining -= want
        }
      case UInt8(ascii: "x"), UInt8(ascii: "g"):
        // pax の拡張ヘッダ。中身は使わないので読み飛ばす。
        _ = input.readData(ofLength: size)
      default:
        throw ArchiveError.unsupportedEntry(fullName)
      }

      // 各エントリの本体は 512 バイト境界までパディングされている。
      let padding = (blockSize - (size % blockSize)) % blockSize
      if padding > 0 {
        _ = input.readData(ofLength: padding)
      }
    }
  }

  /// `..` や絶対パスで展開先の外に書き出されるのを防ぐ。
  private static func safeURL(for name: String, under destination: URL) throws -> URL {
    let components = name.split(separator: "/").map(String.init)
    guard !name.hasPrefix("/"), !components.contains("..") else {
      throw ArchiveError.unsafePath(name)
    }
    return components.reduce(destination) { $0.appendingPathComponent($1) }
  }

  private static func string(in block: Data, offset: Int, length: Int) -> String {
    let bytes = block.subdata(in: offset..<(offset + length))
    let trimmed = bytes.prefix { $0 != 0 }
    return String(decoding: trimmed, as: UTF8.self).trimmingCharacters(in: .whitespaces)
  }

  private static func octal(in block: Data, offset: Int, length: Int) -> Int {
    let text = string(in: block, offset: offset, length: length)
    return Int(text, radix: 8) ?? 0
  }
}
