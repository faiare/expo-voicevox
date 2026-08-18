package expo.modules.voicevox

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import java.util.concurrent.atomic.AtomicInteger

/** 再生のあいだだけオーディオフォーカスをどう扱うか。JS の `VoicevoxAudioSessionMode` と対応する。 */
enum class VoicevoxAudioSessionMode(val jsValue: String) {
  NONE("none"),
  EXCLUSIVE("exclusive"),
  DUCK("duck"),
  MIX("mix");

  companion object {
    fun parse(raw: String): VoicevoxAudioSessionMode? = values().find { it.jsValue == raw }
  }
}

/** 再生の状態。JS の `onSpeechStateChange` の `state` と対応する。 */
enum class VoicevoxSpeechState(val jsValue: String) {
  STARTED("started"),
  FINISHED("finished"),
  STOPPED("stopped"),
  FAILED("failed")
}

/** 再生の開始結果。JS の `VoicevoxUtterance` と対応する。 */
data class VoicevoxPlaybackResult(val id: Int, val durationMillis: Long, val started: Boolean) {
  fun toResultMap(): Map<String, Any> =
    mapOf("id" to id, "durationMillis" to durationMillis, "started" to started)
}

/**
 * メモリ上の WAV を [AudioTrack] で鳴らす。
 *
 * 合成用のロック（`ExpoVoicevoxModule` の `engineLock`）とは完全に分離してある。再生の完了を
 * そのロックの中で待つと、鳴っているあいだずっと次の合成を始められないため。書き込みと
 * 完了待ちは発話ごとの専用スレッドで行い、[play] は即座に戻る。
 *
 * [AudioTrack] は生成したスレッドではなく、この専用スレッドが所有して解放する。書き込み中の
 * track を別スレッドから `release()` すると落ちるので、停止側は `pause()` + `flush()` までしか
 * やらない（[stopLocked] を参照）。
 */
class VoicevoxPlayer(private val context: Context) {
  private val ids = AtomicInteger(0)
  private val playerLock = Any()

  /** 「いま有効な発話」。[begin] で予約し、追い越されたら書き換わる。 */
  private var pendingId = 0
  private var playingId = 0
  private var track: AudioTrack? = null
  private var focusRequest: AudioFocusRequest? = null

  /**
   * JS スレッドから engineLock も playerLock も取らずに読まれるので `@Volatile`。
   *
   * 書き込みは常に [playerLock] の中で起きるが、それだけでは読み側への可視性が保証されない。
   */
  @Volatile
  var isSpeaking = false
    private set

  /** 状態が変わったときにモジュールへ知らせる。モジュールが JS へ `sendEvent` する。 */
  var onStateChange: ((Int, VoicevoxSpeechState, String) -> Unit)? = null

  /**
   * 発話 ID を採番して予約する。
   *
   * まだ何も止めない。合成に失敗したときに、鳴っていた音を止め損にしないため。
   */
  fun begin(): Int {
    val id = ids.incrementAndGet()
    synchronized(playerLock) { pendingId = id }
    return id
  }

  /**
   * 予約がまだ最新なら再生を始める。追い越されていたら `started = false` を返す。
   *
   * 書き込みと完了待ちは専用スレッドに任せるので、この関数は音を鳴らし始めた時点で戻る。
   */
  fun play(id: Int, wav: ByteArray, mode: VoicevoxAudioSessionMode): VoicevoxPlaybackResult {
    // ヘッダの解析はロックの外で済ませる。
    val format = VoicevoxWav.parse(wav)
    val notifications = mutableListOf<Triple<Int, VoicevoxSpeechState, String>>()

    try {
      synchronized(playerLock) {
        if (pendingId != id) {
          return VoicevoxPlaybackResult(id, 0, false)
        }
        // 前の発話はここで止める（新しい音が出る直前まで鳴らしておく）。
        val stopped = stopLocked()
        if (stopped != 0) {
          notifications.add(Triple(stopped, VoicevoxSpeechState.STOPPED, ""))
        }

        val created = startTrackLocked(format, mode)
        track = created
        playingId = id
        isSpeaking = true
        Thread({ pump(id, wav, format, created) }, "expo-voicevox-player").start()
        notifications.add(Triple(id, VoicevoxSpeechState.STARTED, ""))
      }
    } finally {
      // リスナーが同期的に speak() を呼び返してもデッドロックしないよう、ロックの外で通知する。
      notifications.forEach { (id, state, reason) -> onStateChange?.invoke(id, state, reason) }
    }

    return VoicevoxPlaybackResult(id, format.durationMillis, true)
  }

  /**
   * 合成に失敗した発話の予約を取り消す。
   *
   * 鳴っている音には触らない。この発話はまだ再生を始めていないし、合成に失敗したことを理由に
   * 前の発話を止めるのは筋が違うため（[play] が「新しい音が鳴り出す瞬間に前を止める」形に
   * なっているのと同じ理由）。すでに別の speak() に予約を奪われていたら何もしない。
   */
  fun cancel(id: Int) {
    synchronized(playerLock) {
      if (pendingId == id) {
        pendingId = 0
      }
    }
  }

  /** 予約と再生の両方を取り消す。何も鳴っていなければ何もしない。 */
  fun stop() {
    val stopped =
      synchronized(playerLock) {
        pendingId = 0
        stopLocked()
      }
    if (stopped != 0) {
      onStateChange?.invoke(stopped, VoicevoxSpeechState.STOPPED, "")
    }
  }

  /** モジュールの破棄時に呼ぶ。 */
  fun release() = stop()

  // ---------------------------------------------------------------------------

  /** [playerLock] を握った状態で呼ぶこと。 */
  private fun startTrackLocked(format: VoicevoxWav, mode: VoicevoxAudioSessionMode): AudioTrack {
    requestFocusLocked(mode)
    val created =
      try {
        createTrack(format)
      } catch (error: Throwable) {
        abandonFocusLocked()
        throw error
      }
    try {
      if (created.state != AudioTrack.STATE_INITIALIZED) {
        throw IllegalStateException("the audio track could not be initialized")
      }
      created.play()
    } catch (error: Throwable) {
      created.release()
      abandonFocusLocked()
      throw error
    }
    return created
  }

  private fun createTrack(format: VoicevoxWav): AudioTrack {
    val channelMask =
      if (format.channelCount == 2) AudioFormat.CHANNEL_OUT_STEREO
      else AudioFormat.CHANNEL_OUT_MONO
    val minBuffer =
      AudioTrack.getMinBufferSize(format.sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
    // ERROR / ERROR_BAD_VALUE のときは 0.5 秒ぶんで代用する。
    val bufferSize =
      if (minBuffer > 0) minBuffer * 2 else format.sampleRate * format.bytesPerFrame / 2

    return AudioTrack.Builder()
      .setAudioAttributes(audioAttributes())
      .setAudioFormat(
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(format.sampleRate)
          .setChannelMask(channelMask)
          .build()
      )
      .setBufferSizeInBytes(bufferSize)
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private fun audioAttributes(): AudioAttributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()

  /**
   * PCM を書き込み、鳴り終わるまで待つ。発話ごとの専用スレッドの上でだけ呼ぶこと。
   *
   * MODE_STREAM の `stop()` は「書き込み済みの残りを鳴らし切ってから止まる」（drain）ので、
   * 完了は `playbackHeadPosition` が総フレーム数に届いたかで判定する。
   * `setNotificationMarkerPosition` は Looper 付きの Handler が要るうえ、`flush()` で
   * ヘッド位置がリセットされるとマーカーが飛ばないので使わない。
   */
  private fun pump(id: Int, wav: ByteArray, format: VoicevoxWav, track: AudioTrack) {
    var state = VoicevoxSpeechState.FINISHED
    var reason = ""
    try {
      var written = 0
      while (written < format.dataSize && isCurrent(id)) {
        val chunk = minOf(CHUNK_SIZE, format.dataSize - written)
        val count = track.write(wav, format.dataOffset + written, chunk, AudioTrack.WRITE_BLOCKING)
        // flush されると短い戻り値で返る。理由は isCurrent で見分ける。
        if (count <= 0) {
          break
        }
        written += count
      }

      if (!isCurrent(id)) {
        state = VoicevoxSpeechState.STOPPED
      } else if (written < format.dataSize) {
        state = VoicevoxSpeechState.FAILED
        reason = "the audio track stopped accepting data at $written/${format.dataSize} bytes"
      } else {
        track.stop()
        // ヘッドが進まない端末で永久に待たないよう、再生時間 + 余裕で頭打ちにする。
        val deadline =
          System.nanoTime() + (format.durationMillis + DRAIN_MARGIN_MILLIS) * 1_000_000L
        while (isCurrent(id) &&
          track.playbackHeadPosition < format.frameCount &&
          System.nanoTime() < deadline) {
          Thread.sleep(POLL_INTERVAL_MILLIS)
        }
        if (!isCurrent(id)) {
          state = VoicevoxSpeechState.STOPPED
        }
      }
    } catch (error: InterruptedException) {
      state = VoicevoxSpeechState.STOPPED
      Thread.currentThread().interrupt()
    } catch (error: Throwable) {
      state = VoicevoxSpeechState.FAILED
      reason = error.message ?: error::class.java.simpleName
    }
    finish(id, state, reason, track)
  }

  private fun isCurrent(id: Int): Boolean = synchronized(playerLock) { playingId == id }

  /**
   * 専用スレッドの終わりから呼ぶ。すでに [stop] で畳まれていれば通知しない
   * （止めた側がすでに `'stopped'` を送っているため）。
   */
  private fun finish(id: Int, state: VoicevoxSpeechState, reason: String, track: AudioTrack) {
    val notify =
      synchronized(playerLock) {
        val current = playingId == id
        if (current) {
          playingId = 0
          isSpeaking = false
          abandonFocusLocked()
        }
        // ロックの中で参照を切ってから release する。停止側が release 済みの
        // track に pause() / flush() をしないようにするため。
        if (this.track === track) {
          this.track = null
        }
        current
      }
    track.release()
    if (notify) {
      onStateChange?.invoke(id, state, reason)
    }
  }

  /**
   * 鳴っている発話を止める。[playerLock] を握った状態で呼ぶこと。止めた発話 ID を返す（無ければ 0）。
   *
   * `release()` はしない。書き込み中の track を別スレッドから解放すると落ちるので、解放は
   * その track を持っている専用スレッド（[finish]）に任せる。`pause()` + `flush()` にするのは、
   * `stop()` だと書き込み済みの残りを鳴らし切ってしまうため。
   */
  private fun stopLocked(): Int {
    val current = track ?: return 0
    val id = playingId
    playingId = 0
    isSpeaking = false
    track = null
    runCatching {
      current.pause()
      current.flush()
    }
    abandonFocusLocked()
    return id
  }

  private fun audioManager(): AudioManager =
    context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

  /** [playerLock] を握った状態で呼ぶこと。 */
  private fun requestFocusLocked(mode: VoicevoxAudioSessionMode) {
    val gain =
      when (mode) {
        // MIX は Android ではフォーカスを取らない（= NONE と同じ）。iOS だけ挙動が変わる。
        VoicevoxAudioSessionMode.NONE, VoicevoxAudioSessionMode.MIX -> return
        VoicevoxAudioSessionMode.EXCLUSIVE -> AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        VoicevoxAudioSessionMode.DUCK -> AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK
      }
    // AudioFocusRequest は API 26 から。minSdk 26 なので分岐は要らない。
    val request =
      AudioFocusRequest.Builder(gain)
        .setAudioAttributes(audioAttributes())
        .setOnAudioFocusChangeListener { change ->
          if (change == AudioManager.AUDIOFOCUS_LOSS ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
            stop()
          }
          // MAY_DUCK は API 26 以降 OS が自動で音量を下げるので、こちらは何もしない。
        }
        .build()
    audioManager().requestAudioFocus(request)
    focusRequest = request
  }

  /** [playerLock] を握った状態で呼ぶこと。 */
  private fun abandonFocusLocked() {
    focusRequest?.let { audioManager().abandonAudioFocusRequest(it) }
    focusRequest = null
  }

  private companion object {
    const val CHUNK_SIZE = 1 shl 14
    const val POLL_INTERVAL_MILLIS = 10L
    const val DRAIN_MARGIN_MILLIS = 1_000L
  }
}
