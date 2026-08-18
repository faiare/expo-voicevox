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
/// `AVAudioPlayer` の delegate は「生成したスレッドの run loop」に配送される。`DispatchQueue`
/// で作ったワーカーには run loop が無いので、そこで生成すると
/// `audioPlayerDidFinishPlaying(_:successfully:)` が永久に呼ばれず、再生完了を検知できなくなる。
/// **生成・`play()`・`stop()` はすべてメインキューの上で行うこと。**
final class VoicevoxPlayer: NSObject, AVAudioPlayerDelegate {
  /// 状態は JS スレッドから `isSpeaking` で同期的に読まれるので、キューではなくロックで守る。
  ///
  /// `DispatchQueue.main.sync` で借りると、メインスレッドから呼ばれたときに固まる。
  private let stateLock = NSLock()
  private var lastId = 0
  /// 「いま有効な発話」。`begin()` で予約し、追い越されたら書き換わる。
  private var pendingId = 0
  private var playingId = 0
  private var playing = false

  /// メインキューの上でだけ触ること。
  private var player: AVAudioPlayer?
  /// メインキューの上でだけ触ること。
  private var activeSession: VoicevoxAudioSessionMode = .none

  /// 状態が変わったときにモジュールへ知らせる。モジュールが JS へ `sendEvent` する。
  var onStateChange: ((Int, VoicevoxSpeechState, String) -> Void)?

  var isSpeaking: Bool {
    stateLock.withLock { playing }
  }

  override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleInterruption(_:)),
      name: AVAudioSession.interruptionNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
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
  /// メインキューへ投げて即座に戻るので、呼び出し元（`engineQueue`）は待たされない。
  /// `completion` はメインキューの上で 1 回だけ呼ばれる。
  func play(
    id: Int,
    wav: Data,
    session: VoicevoxAudioSessionMode,
    completion: @escaping (Result<VoicevoxPlaybackResult, Error>) -> Void
  ) {
    DispatchQueue.main.async {
      guard self.stateLock.withLock({ self.pendingId == id }) else {
        completion(.success(VoicevoxPlaybackResult(id: id, durationMillis: 0, started: false)))
        return
      }

      // 前の発話はここで止める（新しい音が出る直前まで鳴らしておく）。
      self.stopOnMain()

      do {
        try self.activateSession(session)
        let player = try AVAudioPlayer(data: wav)
        player.delegate = self
        player.prepareToPlay()
        guard player.play() else {
          throw VoicevoxException("could not start the audio player")
        }
        self.player = player
        self.activeSession = session
        self.stateLock.withLock {
          self.playingId = id
          self.playing = true
        }
        self.onStateChange?(id, .started, "")
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
        self.player = nil
        self.deactivateSession()
        completion(.failure(error))
      }
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
    DispatchQueue.main.async { self.stopOnMain() }
  }

  // MARK: - AVAudioPlayerDelegate

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    self.player = nil
    finish(state: flag ? .finished : .failed, reason: flag ? "" : "the audio player stopped early")
  }

  func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
    self.player = nil
    finish(state: .failed, reason: error?.localizedDescription ?? "the WAV data could not be decoded")
  }

  // MARK: - Private

  /// 鳴っている発話を止める。メインキューの上でだけ呼ぶこと。
  private func stopOnMain() {
    guard let player else {
      return
    }
    // stop() では delegate が呼ばれないので、自分で状態を畳む。
    player.stop()
    self.player = nil
    finish(state: .stopped, reason: "")
  }

  /// 発話を終わらせて 1 回だけ通知する。メインキューの上でだけ呼ぶこと。
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
    deactivateSession()
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
    DispatchQueue.main.async { self.stopOnMain() }
  }

  /// メインキューの上でだけ呼ぶこと。
  private func activateSession(_ mode: VoicevoxAudioSessionMode) throws {
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
  }

  /// 元のカテゴリには戻さない。プロセス全体で共有される設定なので、戻すと再生のあいだに
  /// 他のライブラリが変えた設定を踏み潰す。触られたくない利用者は `audioSession: 'none'` を使う。
  ///
  /// メインキューの上でだけ呼ぶこと。
  private func deactivateSession() {
    guard activeSession != .none else {
      return
    }
    activeSession = .none
    try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
  }
}
