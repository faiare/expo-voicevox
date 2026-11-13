import AVFoundation
import XCTest

@testable import ExpoVoicevox

/// `VoicevoxPlayer` がメインスレッドで `AVAudioSession` を触らないことと、再生の完了を取りこぼさないことを確かめる。
///
/// `setActive` / `setCategory` はブロッキングで、メインで呼ぶと Xcode の Thread Performance Checker が
/// 「AVAudioSession Hang Risk」を出す。明示的に呼ぶものだけでなく、`AVAudioPlayer.prepareToPlay()` が
/// AudioQueue を確保するときに OS の内部で暗黙に呼ぶもの（`AudioSessionSetActive_Priv` 経由）も同じ
/// メソッドを通るので、swizzle で両方まとめて捕まえられる。
///
/// 逆に `AVAudioPlayer` を run loop の無いスレッドで動かすと delegate が届かず、`finished` が永久に
/// 来なくなる。セッションをメインから追い出す修正はこちらを壊しやすいので、同じテストで両方を見る。
final class VoicevoxPlayerTests: XCTestCase {
  private var player: VoicevoxPlayer!
  private var events: [(Int, VoicevoxSpeechState)] = []
  private let eventsLock = NSLock()

  override class func setUp() {
    super.setUp()
    SessionCallProbe.install()
  }

  override func setUp() {
    super.setUp()
    player = VoicevoxPlayer()
    player.onStateChange = { [weak self] id, state, _ in
      guard let self else { return }
      self.eventsLock.withLock { self.events.append((id, state)) }
    }
    SessionCallProbe.reset()
  }

  override func tearDown() {
    player.stop()
    player.shutdown()
    player = nil
    super.tearDown()
  }

  func testExclusiveSessionStaysOffTheMainThreadAndFinishes() throws {
    try assertPlaysToTheEnd(session: .exclusive)
  }

  /// セッションを触らないモードでも、`prepareToPlay()` が暗黙に有効化する。
  func testNoneSessionStaysOffTheMainThreadAndFinishes() throws {
    try assertPlaysToTheEnd(session: .none)
  }

  func testStopStaysOffTheMainThread() throws {
    let id = player.begin()
    let started = try playAndWait(id: id, wav: Self.silentWav(milliseconds: 3000), session: .duck)
    XCTAssertTrue(started.started)

    let stopped = expectState(.stopped, for: id)
    player.stop()
    wait(for: [stopped], timeout: 5)

    XCTAssertFalse(player.isSpeaking)
    try waitForPlayerThreadToDrain()
    XCTAssertEqual(SessionCallProbe.mainThreadCalls(), [], "AVAudioSession was touched on the main thread")
    XCTAssertGreaterThan(SessionCallProbe.totalCalls(), 0, "the probe did not observe any AVAudioSession call")
  }

  /// 後から来た発話が前の発話を止め、前の発話は `stopped`、後の発話は `finished` で終わる。
  func testNewerUtteranceReplacesTheOlderOne() throws {
    let first = player.begin()
    XCTAssertTrue(try playAndWait(id: first, wav: Self.silentWav(milliseconds: 3000), session: .mix).started)

    let firstStopped = expectState(.stopped, for: first)
    let second = player.begin()
    let secondFinished = expectState(.finished, for: second)
    XCTAssertTrue(try playAndWait(id: second, wav: Self.silentWav(milliseconds: 200), session: .mix).started)
    wait(for: [firstStopped, secondFinished], timeout: 10, enforceOrder: true)

    try waitForPlayerThreadToDrain()
    XCTAssertEqual(SessionCallProbe.mainThreadCalls(), [], "AVAudioSession was touched on the main thread")
  }

  /// 予約を奪われた発話は鳴らさずに `started: false` を返す。
  func testSupersededUtteranceDoesNotStart() throws {
    let stale = player.begin()
    _ = player.begin()
    let result = try playAndWait(id: stale, wav: Self.silentWav(milliseconds: 200), session: .exclusive)
    XCTAssertFalse(result.started)
    XCTAssertFalse(player.isSpeaking)
  }

  // MARK: - Helpers

  private func assertPlaysToTheEnd(session: VoicevoxAudioSessionMode) throws {
    let id = player.begin()
    let finished = expectState(.finished, for: id)
    let result = try playAndWait(id: id, wav: Self.silentWav(milliseconds: 300), session: session)
    XCTAssertTrue(result.started)
    XCTAssertEqual(Double(result.durationMillis), 300, accuracy: 5)

    // delegate が届かなければここで時間切れになる。
    wait(for: [finished], timeout: 10)
    XCTAssertFalse(player.isSpeaking)

    try waitForPlayerThreadToDrain()
    XCTAssertEqual(SessionCallProbe.mainThreadCalls(), [], "AVAudioSession was touched on the main thread")
    XCTAssertGreaterThan(SessionCallProbe.totalCalls(), 0, "the probe did not observe any AVAudioSession call")
  }

  private func playAndWait(
    id: Int,
    wav: Data,
    session: VoicevoxAudioSessionMode
  ) throws -> VoicevoxPlaybackResult {
    let done = expectation(description: "play completion #\(id)")
    var outcome: Result<VoicevoxPlaybackResult, Error>?
    player.play(id: id, wav: wav, session: session) { result in
      outcome = result
      done.fulfill()
    }
    wait(for: [done], timeout: 10)
    return try XCTUnwrap(outcome).get()
  }

  private func expectState(_ state: VoicevoxSpeechState, for id: Int) -> XCTestExpectation {
    let expectation = expectation(description: "#\(id) \(state.rawValue)")
    let previous = player.onStateChange
    player.onStateChange = { eventId, eventState, reason in
      previous?(eventId, eventState, reason)
      if eventId == id, eventState == state {
        expectation.fulfill()
      }
    }
    return expectation
  }

  /// 終了時の deactivate は専用スレッドに積まれるので、それが走り終わるまで待ってから記録を読む。
  private func waitForPlayerThreadToDrain() throws {
    let drained = expectation(description: "player thread drained")
    player.barrier { drained.fulfill() }
    wait(for: [drained], timeout: 10)
  }

  /// 16bit / mono / 24kHz の無音 WAV。VOICEVOX の既定出力と同じ形式。
  static func silentWav(milliseconds: Int) -> Data {
    let sampleRate = 24_000
    let frames = sampleRate * milliseconds / 1000
    let dataSize = frames * 2
    var data = Data()
    func append<T: FixedWidthInteger>(_ value: T) {
      withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }
    data.append(contentsOf: Array("RIFF".utf8))
    append(UInt32(36 + dataSize))
    data.append(contentsOf: Array("WAVE".utf8))
    data.append(contentsOf: Array("fmt ".utf8))
    append(UInt32(16))
    append(UInt16(1))  // PCM
    append(UInt16(1))  // mono
    append(UInt32(sampleRate))
    append(UInt32(sampleRate * 2))
    append(UInt16(2))
    append(UInt16(16))
    data.append(contentsOf: Array("data".utf8))
    append(UInt32(dataSize))
    data.append(Data(count: dataSize))
    return data
  }
}

/// `AVAudioSession` の `setActive` / `setCategory` を差し替え、どのスレッドから呼ばれたかを記録する。
private enum SessionCallProbe {
  private static let lock = NSLock()
  private static var mainCalls: [String] = []
  private static var allCalls = 0
  private static var installed = false

  static func install() {
    lock.withLock {
      guard !installed else { return }
      installed = true
      // `setActive:error:` は Swift から見えない（unavailable）ので、selector は文字列で引く。
      let pairs: [(String, String)] = [
        ("setActive:withOptions:error:", "probe_setActive:withOptions:error:"),
        ("setActive:error:", "probe_setActive:error:"),
        ("setCategory:mode:options:error:", "probe_setCategory:mode:options:error:"),
      ]
      for (original, replacement) in pairs {
        guard
          let originalMethod = class_getInstanceMethod(
            AVAudioSession.self, NSSelectorFromString(original)),
          let replacementMethod = class_getInstanceMethod(
            AVAudioSession.self, NSSelectorFromString(replacement))
        else {
          fatalError("could not swizzle \(original)")
        }
        method_exchangeImplementations(originalMethod, replacementMethod)
      }
    }
  }

  static func record(_ name: String) {
    let isMain = Thread.isMainThread
    let symbols = isMain ? Thread.callStackSymbols.prefix(12).joined(separator: "\n") : ""
    lock.withLock {
      allCalls += 1
      if isMain {
        mainCalls.append("\(name)\n\(symbols)")
      }
    }
  }

  static func reset() {
    lock.withLock {
      mainCalls = []
      allCalls = 0
    }
  }

  static func mainThreadCalls() -> [String] {
    lock.withLock { mainCalls }
  }

  static func totalCalls() -> Int {
    lock.withLock { allCalls }
  }
}

extension AVAudioSession {
  // 差し替え後はこれらの名前が元の実装を指すので、自分自身を呼ぶと元のメソッドに届く。
  @objc(probe_setActive:withOptions:error:)
  fileprivate func probe_setActive(_ active: Bool, options: AVAudioSession.SetActiveOptions) throws {
    SessionCallProbe.record("setActive(\(active), options:)")
    try probe_setActive(active, options: options)
  }

  @objc(probe_setActive:error:)
  fileprivate func probe_setActive(_ active: Bool) throws {
    SessionCallProbe.record("setActive(\(active))")
    try probe_setActive(active)
  }

  @objc(probe_setCategory:mode:options:error:)
  fileprivate func probe_setCategory(
    _ category: AVAudioSession.Category,
    mode: AVAudioSession.Mode,
    options: AVAudioSession.CategoryOptions
  ) throws {
    SessionCallProbe.record("setCategory(\(category.rawValue))")
    try probe_setCategory(category, mode: mode, options: options)
  }
}
