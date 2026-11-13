import AVFoundation
import ExpoModulesCore
import Foundation

/// 再生のあいだだけオーディオセッションをどう扱うか。JS の `VoicevoxAudioSessionMode` と対応する。
enum VoicevoxAudioSessionMode: String {
  case none
  case exclusive
  case duck
  case mix
}

/// 再生の状態。JS の `onSpeechStateChange` の `state` と対応する。
enum VoicevoxSpeechState: String {
  case started
  case finished
  case stopped
  case failed
}

/// 再生の開始結果。JS の `VoicevoxUtterance` と対応する。
struct VoicevoxPlaybackResult {
  let id: Int
  let durationMillis: Int
  let started: Bool

  var dictionary: [String: Any] {
    ["id": id, "durationMillis": durationMillis, "started": started]
  }
}

/// メモリ上の WAV を `AVAudioPlayer` で鳴らす。
///
/// 合成用の直列キュー（`ExpoVoicevoxModule` の `engineQueue`）とは完全に分離してある。再生の
/// 完了をそのキューの中で待つと、鳴っているあいだずっと次の合成を始められないため。
///
/// **`AVAudioPlayer` と `AVAudioSession` の操作は、すべて専用スレッド（`VoicevoxPlayerThread`）の
/// 上で行う。** メインでも GCD のキューでもいけない理由がそれぞれある。
///
/// - メインで `AVAudioPlayer` を生成・`prepareToPlay()` すると、AudioQueue の確保
///   （`AVAudioPlayerCpp::allocAudioQueue`）が OS の内部でセッションを暗黙に有効化し、
///   `-[AVAudioSession setActive:withOptions:error:]` がメインで走る。明示的な `setActive` を
///   どこに移してもこれは消えず、Xcode の Thread Performance Checker が「AVAudioSession Hang Risk」を
///   出す（セッションを触らない `audioSession: 'none'` でも起きる）。`stop()` も同様に内部で
///   セッションを触りうるので、プレイヤーへの操作はまとめてメインから外す。
/// - delegate がどのスレッドに届くかは文書化されていない。iOS 27 のシミュレータでは GCD キューで
///   生成してもメインに届いたが、「生成したスレッドの run loop に届く」と書かれた資料もあり、
///   run loop の無い GCD キューで作ると完了通知（`audioPlayerDidFinishPlaying`）を取りこぼすおそれが
///   ある。専用スレッドは run loop を回し続けるので、どちらの振る舞いでも届く。delegate が
///   どこに届いても、処理は専用スレッドへ戻してから行う。
///
/// 1 本のスレッドで直列に動くので、「前の発話の停止・deactivate → 次の発話の activate → 再生」の
/// 順序は積んだ順のまま保たれる。非同期版の `activate(options:completionHandler:)` は iOS 27 から
/// なので使っていない。
final class VoicevoxPlayer: NSObject, AVAudioPlayerDelegate {
  /// 状態は JS スレッドから `isSpeaking` で同期的に読まれるので、スレッドではなくロックで守る。
  private let stateLock = NSLock()
  private var lastId = 0
  /// 「いま有効な発話」。`begin()` で予約し、追い越されたら書き換わる。
  private var pendingId = 0
  private var playingId = 0
  private var playing = false

  private let thread = VoicevoxPlayerThread(name: "expo.modules.voicevox.player")

  /// 専用スレッドの上でだけ触ること。
  private var player: AVAudioPlayer?
  /// セッションを有効化した発話の ID（0 なら有効化していない）。専用スレッドの上でだけ触ること。
  ///
  /// `audioSession: 'none'` の発話や、有効化の前に失敗した発話の終わりに deactivate しないための印。
  private var sessionOwnerId = 0

  /// 状態が変わったときにモジュールへ知らせる。モジュールが JS へ `sendEvent` する。
  /// 専用スレッドの上で呼ばれる。
  var onStateChange: ((Int, VoicevoxSpeechState, String) -> Void)?

  var isSpeaking: Bool {
    stateLock.withLock { playing }
  }

  override init() {
    super.init()
    thread.start()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    thread.finish()
  }

  /// 発話 ID を採番して予約する。
  ///
  /// まだ何も止めない。合成に失敗したときに、鳴っていた音を止め損にしないため。
  func begin() -> Int {
    stateLock.withLock {
      lastId += 1
      pendingId = lastId
      return lastId
    }
  }

  /// 予約がまだ最新なら再生を始める。追い越されていたら `started: false` を返す。
  ///
  /// 専用スレッドへ投げて即座に戻るので、呼び出し元（`engineQueue`）は待たされない。
  /// `completion` は専用スレッドの上で 1 回だけ呼ばれる。
  func play(
    id: Int,
    wav: Data,
    session: VoicevoxAudioSessionMode,
    completion: @escaping (Result<VoicevoxPlaybackResult, Error>) -> Void
  ) {
    let accepted = thread.perform {
      self.startOnThread(id: id, wav: wav, session: session, completion: completion)
    }
    if !accepted {
      completion(.failure(VoicevoxException("the audio player has been shut down")))
    }
  }

  /// 合成に失敗した発話の予約を取り消す。
  ///
  /// 鳴っている音には触らない。この発話はまだ再生を始めていないし、合成に失敗したことを理由に
  /// 前の発話を止めるのは筋が違うため（`play` が「新しい音が鳴り出す瞬間に前を止める」形に
  /// なっているのと同じ理由）。すでに別の `speak()` に予約を奪われていたら何もしない。
  func cancel(id: Int) {
    stateLock.withLock {
      if pendingId == id {
        pendingId = 0
      }
    }
  }

  /// 予約と再生の両方を取り消す。何も鳴っていなければ何もしない。
  func stop() {
    stateLock.withLock { pendingId = 0 }
    thread.perform { self.stopOnThread() }
  }

  /// 鳴っている音を止めて専用スレッドを畳む。以後の `play` は失敗する。モジュールの破棄時に呼ぶ。
  func shutdown() {
    stateLock.withLock { pendingId = 0 }
    thread.perform { self.stopOnThread() }
    thread.finish()
  }

  /// それまでに積まれた処理（停止に伴う deactivate など）が専用スレッドで済んでから `block` を呼ぶ。
  /// テストが「後始末まで終わった」ことを待つためのもの。
  func barrier(_ block: @escaping () -> Void) {
    if !thread.perform(block) {
      block()
    }
  }

  // MARK: - AVAudioPlayerDelegate

  // どのスレッドに届くかは OS 任せなので、専用スレッドへ戻してから状態を触る。

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    thread.perform {
      self.playerDidEnd(
        player,
        state: flag ? .finished : .failed,
        reason: flag ? "" : "the audio player stopped early"
      )
    }
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    let reason = error?.localizedDescription ?? "the WAV data could not be decoded"
    thread.perform {
      self.playerDidEnd(player, state: .failed, reason: reason)
    }
  }

  // MARK: - Private

  private func isPending(_ id: Int) -> Bool {
    stateLock.withLock { pendingId == id }
  }

  /// 専用スレッドの上でだけ呼ぶこと。
  private func startOnThread(
    id: Int,
    wav: Data,
    session: VoicevoxAudioSessionMode,
    completion: @escaping (Result<VoicevoxPlaybackResult, Error>) -> Void
  ) {
    guard isPending(id) else {
      completion(.success(VoicevoxPlaybackResult(id: id, durationMillis: 0, started: false)))
      return
    }

    // 前の発話はここで止める。同じスレッドで直列に動くので、その deactivate は下の activate より
    // 必ず先に終わる。
    stopOnThread()

    do {
      try activateSession(session, for: id)
    } catch {
      completion(.failure(error))
      return
    }
    // 有効化はブロッキングなので、その間に別の発話か stop() に追い越されうる。
    // その場合は鳴らさずに有効化を取り消す。
    guard isPending(id) else {
      deactivateSession(for: id)
      completion(.success(VoicevoxPlaybackResult(id: id, durationMillis: 0, started: false)))
      return
    }

    do {
      let player = try AVAudioPlayer(data: wav)
      player.delegate = self
      // AudioQueue の確保がセッションを暗黙に有効化する。メインで呼んではいけない理由はこれ。
      player.prepareToPlay()
      guard player.play() else {
        throw VoicevoxException("could not start the audio player")
      }
      self.player = player
      stateLock.withLock {
        playingId = id
        playing = true
      }
      onStateChange?(id, .started, "")
      completion(
        .success(
          VoicevoxPlaybackResult(
            id: id,
            durationMillis: Int((player.duration * 1000).rounded()),
            started: true
          )
        )
      )
    } catch {
      player = nil
      // 有効化には成功しているので、鳴らせなかった分はここで戻す。
      deactivateSession(for: id)
      completion(.failure(error))
    }
  }

  /// delegate から戻ってきた終了を反映する。専用スレッドの上でだけ呼ぶこと。
  private func playerDidEnd(_ ended: AVAudioPlayer, state: VoicevoxSpeechState, reason: String) {
    // 専用スレッドへ戻るまでのあいだに stop() や次の発話で差し替わっていたら、古い通知なので捨てる。
    guard ended === player else {
      return
    }
    player = nil
    finish(state: state, reason: reason)
  }

  /// 鳴っている発話を止める。専用スレッドの上でだけ呼ぶこと。
  private func stopOnThread() {
    guard let player else {
      return
    }
    // stop() では delegate が呼ばれないので、自分で状態を畳む。
    player.stop()
    self.player = nil
    finish(state: .stopped, reason: "")
  }

  /// 発話を終わらせて 1 回だけ通知する。専用スレッドの上でだけ呼ぶこと。
  ///
  /// 通知はロックの外で行う。JS のリスナーが同期的に `speak()` を呼び返してもデッドロックしないため。
  private func finish(state: VoicevoxSpeechState, reason: String) {
    let finished: Int? = stateLock.withLock {
      guard playing else {
        return nil
      }
      playing = false
      let id = playingId
      playingId = 0
      return id
    }
    guard let finished else {
      return
    }
    deactivateSession(for: finished)
    onStateChange?(finished, state, reason)
  }

  @objc private func handleInterruption(_ notification: Notification) {
    guard
      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
      AVAudioSession.InterruptionType(rawValue: raw) == .began
    else {
      return
    }
    // 割り込みでは AVAudioPlayer が勝手に止まるだけで delegate は呼ばれない。状態を残さないよう自分で畳む。
    thread.perform { self.stopOnThread() }
  }

  /// 専用スレッドの上でだけ呼ぶこと。
  private func activateSession(_ mode: VoicevoxAudioSessionMode, for id: Int) throws {
    let options: AVAudioSession.CategoryOptions
    switch mode {
    case .none:
      return
    case .exclusive:
      options = []
    case .duck:
      options = [.duckOthers]
    case .mix:
      options = [.mixWithOthers]
    }
    let session = AVAudioSession.sharedInstance()
    // .playback にすると消音スイッチが入っていても鳴る。
    try session.setCategory(.playback, mode: .default, options: options)
    try session.setActive(true)
    sessionOwnerId = id
  }

  /// 元のカテゴリには戻さない。プロセス全体で共有される設定なので、戻すと再生のあいだに
  /// 他のライブラリが変えた設定を踏み潰す。触られたくない利用者は `audioSession: 'none'` を使う。
  ///
  /// `id` の発話がセッションを有効化していれば無効化する。専用スレッドの上でだけ呼ぶこと。
  private func deactivateSession(for id: Int) {
    guard sessionOwnerId == id, id != 0 else {
      return
    }
    sessionOwnerId = 0
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }
}

/// run loop を回し続ける専用スレッド。`VoicevoxPlayer` の操作をすべてここで直列に行う。
///
/// GCD のキューには run loop が無いので、run loop に配送されるコールバックを受けられない。
/// `perform` で積んだブロックは積んだ順に 1 つずつ実行される。
final class VoicevoxPlayerThread: Thread {
  private let lock = NSLock()
  private let ready = DispatchSemaphore(value: 0)
  /// `main()` が用意する。`ready` を待ってから読むこと。
  private var runLoop: CFRunLoop?
  private var closed = false

  init(name: String) {
    super.init()
    self.name = name
    qualityOfService = .userInitiated
  }

  override func start() {
    super.start()
    // perform が積めるよう、run loop が用意されるまで待つ（起動直後に 1 回だけ）。
    ready.wait()
  }

  override func main() {
    let runLoop = CFRunLoopGetCurrent()
    // 入力源の無い run loop は即座に抜けるので、何もしない source を足して回し続ける。
    var context = CFRunLoopSourceContext()
    let keepAlive = CFRunLoopSourceCreate(kCFAllocatorDefault, 0, &context)
    CFRunLoopAddSource(runLoop, keepAlive, .defaultMode)
    lock.withLock { self.runLoop = runLoop }
    ready.signal()

    while !isCancelled {
      CFRunLoopRunInMode(.defaultMode, 60, false)
    }
    CFRunLoopRemoveSource(runLoop, keepAlive, .defaultMode)
  }

  /// `block` を専用スレッドで実行するよう積む。畳んだあとなら積まずに false を返す。
  @discardableResult
  func perform(_ block: @escaping () -> Void) -> Bool {
    let runLoop: CFRunLoop? = lock.withLock { closed ? nil : self.runLoop }
    guard let runLoop else {
      return false
    }
    CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, block)
    CFRunLoopWakeUp(runLoop)
    return true
  }

  /// それまでに積まれたブロックを実行し終えてからスレッドを終わらせる。2 回目以降は何もしない。
  func finish() {
    let runLoop: CFRunLoop? = lock.withLock {
      guard !closed else { return nil }
      closed = true
      return self.runLoop
    }
    guard let runLoop else {
      return
    }
    CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue) {
      Thread.current.cancel()
      CFRunLoopStop(CFRunLoopGetCurrent())
    }
    CFRunLoopWakeUp(runLoop)
  }
}
