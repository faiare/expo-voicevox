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
///
/// 逆に `AVAudioSession` の `setCategory` / `setActive` はメインで呼んではいけない。どちらも
/// ブロッキングで、メインで呼ぶと Xcode の Thread Performance Checker が「AVAudioSession Hang
/// Risk」を出す（実際にメインが数百 ms 止まり得る）。これらは `sessionQueue` に載せる。
/// 非同期版の `activate(options:completionHandler:)` は iOS 27 からなので使っていない。
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
  /// `setCategory` / `setActive` を載せる直列キュー。
  ///
  /// 直列なので「前の発話の deactivate → 次の発話の activate」の順序が積んだ順のまま保たれる。
  private let sessionQueue = DispatchQueue(label: "expo.modules.voicevox.audio-session")
  /// セッションを有効化した発話の ID（0 なら有効化していない）。`sessionQueue` の上でだけ触ること。
  ///
  /// deactivate はこの ID と一致したときだけ行う。有効化の最中に追い越された発話の deactivate が、
  /// 追い越した発話の activate より後に積まれても、後者のセッションを落とさないため。
  private var sessionOwnerId = 0

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
      guard self.isPending(id) else {
        completion(.success(VoicevoxPlaybackResult(id: id, durationMillis: 0, started: false)))
        return
      }

      // 前の発話はここで止める。止めたときの deactivate は sessionQueue に積まれるので、
      // 下で積む activate より必ず先に処理される。
      self.stopOnMain()

      // セッションを触らない場合も sessionQueue を 1 回通す。前の発話の deactivate が
      // 終わる前に鳴らし始めると、鳴り出した直後のセッションを落としかねないため。
      self.sessionQueue.async {
        let activation = Result { try self.activateSession(session, for: id) }
        DispatchQueue.main.async {
          self.startOnMain(id: id, wav: wav, activation: activation, completion: completion)
        }
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

  private func isPending(_ id: Int) -> Bool {
    stateLock.withLock { pendingId == id }
  }

  /// セッションの準備を終えた発話を鳴らし始める。メインキューの上でだけ呼ぶこと。
  private func startOnMain(
    id: Int,
    wav: Data,
    activation: Result<Void, Error>,
    completion: @escaping (Result<VoicevoxPlaybackResult, Error>) -> Void
  ) {
    if case .failure(let error) = activation {
      completion(.failure(error))
      return
    }
    // 有効化している間に別の発話か stop() に追い越されていたら、鳴らさずに有効化を取り消す。
    guard isPending(id) else {
      deactivateSession(for: id)
      completion(.success(VoicevoxPlaybackResult(id: id, durationMillis: 0, started: false)))
      return
    }
    // 前の発話は play() の入口で止めてある。予約が最新である発話は 1 つしかないので、
    // 有効化を待つあいだに別の音が鳴り始めていることは無い。
    do {
      let player = try AVAudioPlayer(data: wav)
      player.delegate = self
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
    DispatchQueue.main.async { self.stopOnMain() }
  }

  /// `sessionQueue` の上でだけ呼ぶこと。
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
  /// `id` の発話がセッションを有効化していれば無効化する。どのスレッドから呼んでもよい
  /// （`sessionQueue` に積んで即座に戻る）。
  ///
  /// 有効化していない発話（`audioSession: 'none'` や、有効化の前に失敗したもの）や、すでに
  /// 別の発話に持ち主が移っていた場合は何もしない。
  private func deactivateSession(for id: Int) {
    sessionQueue.async {
      guard self.sessionOwnerId == id, id != 0 else {
        return
      }
      self.sessionOwnerId = 0
      try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
  }
}
