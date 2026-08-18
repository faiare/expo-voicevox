import Foundation

/// 合成済みの WAV を最近使った順に保持する LRU キャッシュ。
///
/// 上限は件数ではなく**合計バイト数**で測る。1 件の WAV は数十 KB から数 MB まで幅があり、
/// 件数で縛るとメモリ使用量の上限が読めないため。
///
/// `NSCache` は使わない。追い出しのタイミングが OS 任せでバイト単位の LRU にならず、
/// Android 側（`android/src/main/java/expo/modules/voicevox/VoicevoxWavCache.kt`）と
/// 挙動を揃えられないため。両者は 1:1 に対応させてある。
///
/// スレッド安全ではない。合成の入口は `ExpoVoicevoxModule` の `engineQueue` で直列化されており、
/// このキャッシュはその内側でだけ触られる。
final class VoicevoxWavCache {
  /// 32MB。24kHz モノラル 16bit ≒ 48KB/秒 なので約 11 分ぶん。
  static let defaultLimitBytes = 32 * 1024 * 1024

  private var entries: [String: Data] = [:]

  /// 古い順に並んだキー。末尾がいちばん最近使ったもの。
  ///
  /// 配列からの削除は O(n) だが、エントリ数はせいぜい数百で、操作は合成 1 回につき 1 度しか
  /// 起きない（合成そのものが数百 ms かかる）。連結リストを持ち込む価値は無い。
  private var order: [String] = []

  private var limit: Int

  /// 現在保持している WAV の合計バイト数。
  private(set) var bytes = 0

  /// `clear()` でリセットされる。
  private(set) var hits = 0

  /// `clear()` でリセットされる。
  private(set) var misses = 0

  init(limitBytes: Int = VoicevoxWavCache.defaultLimitBytes) {
    limit = max(0, limitBytes)
  }

  /// 上限。下げた瞬間に溢れたぶんを追い出す。0 にすると何も溜まらない。
  var limitBytes: Int {
    get { limit }
    set {
      limit = max(0, newValue)
      trim()
    }
  }

  var entryCount: Int {
    entries.count
  }

  func value(forKey key: String) -> Data? {
    guard let hit = entries[key] else {
      misses += 1
      return nil
    }
    hits += 1
    touch(key)
    return hit
  }

  /// 合成結果を格納する。
  ///
  /// 単体で上限を超える WAV は格納しない（1 件で他の全部を追い出してしまうため）。その場合でも
  /// 同じキーの古いエントリは残さない。
  func setValue(_ wav: Data, forKey key: String) {
    if let previous = entries.removeValue(forKey: key) {
      bytes -= previous.count
      removeFromOrder(key)
    }
    guard wav.count <= limit else {
      return
    }
    entries[key] = wav
    order.append(key)
    bytes += wav.count
    trim()
  }

  func clear() {
    entries.removeAll()
    order.removeAll()
    bytes = 0
    hits = 0
    misses = 0
  }

  /// JS へ返す形。`src/ExpoVoicevox.types.ts` の `VoicevoxSynthesisCacheStats` と対応する。
  var statsDictionary: [String: Any] {
    [
      "entryCount": entryCount,
      "bytes": bytes,
      "limitBytes": limit,
      "hits": hits,
      "misses": misses,
    ]
  }

  /// キャッシュキーを組み立てる。
  ///
  /// ペイロード（テキスト / カナ / AudioQuery の JSON）は自由形式なので必ず最後に置く。
  /// 前段のフィールドと衝突させないため。`params` は JS が固定順で組み立てた JSON 文字列で、
  /// 空白を含まないのでここで区切りに使える。書き出し先ディレクトリは合成結果に影響しないので
  /// キーに含めない。
  static func key(
    kind: String,
    styleId: Int,
    enableInterrogativeUpspeak: Bool,
    params: String,
    payload: String
  ) -> String {
    "\(kind) \(styleId) \(enableInterrogativeUpspeak ? 1 : 0) \(params) \(payload)"
  }

  // MARK: - Private

  private func touch(_ key: String) {
    removeFromOrder(key)
    order.append(key)
  }

  private func removeFromOrder(_ key: String) {
    guard let index = order.firstIndex(of: key) else {
      return
    }
    order.remove(at: index)
  }

  private func trim() {
    while bytes > limit, !order.isEmpty {
      let oldest = order.removeFirst()
      if let removed = entries.removeValue(forKey: oldest) {
        bytes -= removed.count
      }
    }
  }
}
