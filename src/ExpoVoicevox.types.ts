// config plugin の props の型は `plugin/src/types.ts` にある。
// ここから re-export しないのは、tsconfig の rootDir が `src/` なので
// `src/` の外を import すると `npm run build` が通らなくなるため。
// `app.config.ts` で型付きに書きたい場合は次のように import する。
//   import type { ExpoVoicevoxPluginProps } from 'expo-voicevox/plugin/build/types';

/**
 * `initialize()` に渡すオプション。
 *
 * パスを省略すると、config plugin（`app.json` の `plugins`）が配置したアセットを
 * ネイティブ側が自動で解決する。自前でモデルを管理する場合だけ絶対パスを渡す。
 */
export type VoicevoxInitializeOptions = {
  /**
   * OpenJTalk のシステム辞書ディレクトリ（`open_jtalk_dic_utf_8-1.11`）の絶対パス。
   * 省略時は config plugin が配置したものを使う。
   */
  openJtalkDictDir?: string;
  /**
   * 読み込む音声モデル（`.vvm`）の絶対パス。
   * 省略時は config plugin が配置したものを使う。
   */
  voiceModelPaths?: string[];
  /** 推論に使う CPU スレッド数。0 で環境に合わせて自動決定する（既定）。 */
  cpuNumThreads?: number;
};

/**
 * `initialize()` がネイティブへ渡す形。
 *
 * `null` は「config plugin が配置したものを使え」の意味で、ネイティブ側が解決する。
 */
export type NormalizedVoicevoxInitializeOptions = {
  openJtalkDictDir: string | null;
  voiceModelPaths: string[] | null;
  cpuNumThreads: number;
};

/** 端末上に用意されたアセットの絶対パス。 */
export type VoicevoxAssetPaths = {
  openJtalkDictDir: string;
  voiceModelPaths: string[];
};

/**
 * アセットの準備中に届く進捗。
 *
 * iOS の `assetSource: "bundle"` ではアプリのバンドルをそのまま読むので 1 件も届かない。
 * Android は APK 内 assets に実パスが無いため、初回だけ展開の進捗が流れる。
 */
export type VoicevoxPrepareProgress = {
  stage: 'download' | 'extract';
  /** 処理中のファイル名。完了時は空文字。 */
  current: string;
  completedBytes: number;
  /** 総バイト数。分からない場合は 0。 */
  totalBytes: number;
  completedFiles: number;
  totalFiles: number;
};

export type ExpoVoicevoxModuleEvents = {
  onPrepareProgress: (progress: VoicevoxPrepareProgress) => void;
  onSpeechStateChange: (change: VoicevoxSpeechStateChange) => void;
};

/** 音声モデルに含まれるスタイル。`id` が合成時に指定する styleId。 */
export type VoicevoxStyle = {
  id: number;
  name: string;
  /** `talk` / `streaming_talk` / `singing_teacher` など。トーク合成に使えるのは talk 系のみ。 */
  type: string;
};

/** 読み込み済みの音声モデルに含まれるキャラクター。 */
export type VoicevoxCharacter = {
  name: string;
  speakerUuid: string;
  styles: VoicevoxStyle[];
};

/**
 * モーラ（子音 + 母音）。
 *
 * `consonant` と `consonantLength` は「両方ある」か「両方 null」かのどちらかでなければならない
 * （母音だけのモーラは null になる）。片方だけ埋めると voicevox-core が検証で弾く。
 */
export type VoicevoxMora = {
  text: string;
  consonant: string | null;
  consonantLength: number | null;
  vowel: string;
  vowelLength: number;
  pitch: number;
};

/** アクセント句。`accent` はアクセント核の位置（1 始まり、0 は平板）。 */
export type VoicevoxAccentPhrase = {
  moras: VoicevoxMora[];
  accent: number;
  /** 句のあとの無音。無ければ null。 */
  pauseMora: VoicevoxMora | null;
  isInterrogative: boolean;
};

/**
 * 合成のパラメータ一式。
 *
 * `createAudioQuery()` で作り、フィールドを書き換えてから `synthesis()` に渡す。
 * 各 `*Scale` は 1.0 が既定値、`*PhonemeLength` は秒。
 */
export type VoicevoxAudioQuery = {
  accentPhrases: VoicevoxAccentPhrase[];
  /** 話速。 */
  speedScale: number;
  /** 音高。 */
  pitchScale: number;
  /** 抑揚。 */
  intonationScale: number;
  /** 音量。 */
  volumeScale: number;
  /** 開始の無音の長さ（秒）。 */
  prePhonemeLength: number;
  /** 終了の無音の長さ（秒）。 */
  postPhonemeLength: number;
  outputSamplingRate: number;
  outputStereo: boolean;
  /** AquesTalk 風記法。voicevox-core が生成したものはここに読みが入る。 */
  kana: string | null;
};

/** ユーザー辞書の単語の品詞。 */
export type VoicevoxUserDictWordType =
  'PROPER_NOUN' | 'COMMON_NOUN' | 'VERB' | 'ADJECTIVE' | 'SUFFIX';

/** ユーザー辞書に登録する単語。 */
export type VoicevoxUserDictWord = {
  /** 表記。ネイティブ側で全角に正規化される。 */
  surface: string;
  /** 読み。全角カタカナで書く。 */
  pronunciation: string;
  /** アクセント核の位置（0 以上）。既定は 0。 */
  accentType?: number;
  /** 品詞。既定は `COMMON_NOUN`。 */
  wordType?: VoicevoxUserDictWordType;
  /** 0〜10。大きいほど優先される。既定は 5。 */
  priority?: number;
};

/** ネイティブへ渡す形。既定値は JS 側で埋めてしまい、両 OS の既定値に依存しない。 */
export type NormalizedVoicevoxUserDictWord = {
  surface: string;
  pronunciation: string;
  accentType: number;
  wordType: VoicevoxUserDictWordType;
  priority: number;
};

/**
 * WAV の書き出し先。
 *
 * `cache` は iOS の `.cachesDirectory` / Android の `cacheDir`。空き容量が逼迫すると
 * OS に消される代わりに、iCloud にも Android Auto Backup にも入らない。
 * `document` は iOS の `.documentDirectory` / Android の `filesDir`。消えない代わりに
 * バックアップの対象になる（Android Auto Backup の上限は 25MB）。
 */
export type VoicevoxOutputDirectory = 'cache' | 'document';

/** `tts()` / `synthesis()` / `ttsFromKana()` の合成オプション。 */
export type VoicevoxSynthesisOptions = {
  /**
   * 疑問文の語尾を自動で上げるか。既定は true。
   *
   * voicevox-core の既定値には依存せず、JS 側が常に明示してネイティブへ渡す
   * （iOS と Android で挙動を揃えるため）。
   *
   * `synthesis()` では、アクセント句の `isInterrogative` が立っている句に対して働く。
   */
  enableInterrogativeUpspeak?: boolean;
  /**
   * WAV の書き出し先。既定は `'cache'`。
   *
   * ファイルを作らずそのまま鳴らすだけなら `speak()` を使う。
   */
  directory?: VoicevoxOutputDirectory;
};

/**
 * 再生のあいだだけオーディオセッション（iOS）/ オーディオフォーカス（Android）をどう扱うか。
 *
 * 既定の `'none'` は何も触らない。expo-audio などで既にセッションを管理しているアプリと
 * 競合させないため。`'none'` 以外を選ぶと iOS ではカテゴリが `.playback` になり、
 * 消音スイッチが入っていても鳴るようになる。
 *
 * - `'exclusive'`: 他アプリの音を止める（iOS: `.playback` / Android: `AUDIOFOCUS_GAIN_TRANSIENT`）
 * - `'duck'`: 他アプリの音を小さくする（iOS: `.duckOthers` / Android: `..._MAY_DUCK`）
 * - `'mix'`: 重ねて鳴らす（iOS: `.mixWithOthers` / Android はフォーカスを取らないので `'none'` と同じ）
 *
 * iOS のカテゴリは再生後に元へ戻さない（`setActive(false)` だけを呼ぶ）。プロセス全体で
 * 共有される設定なので、戻すと再生中に他のライブラリが変えた設定を踏み潰すため。
 * 触られたくない場合は `'none'` のままにすること。
 */
export type VoicevoxAudioSessionMode = 'none' | 'exclusive' | 'duck' | 'mix';

/** `speak()` / `speakFromKana()` / `speakFromAudioQuery()` のオプション。 */
export type VoicevoxSpeakOptions = {
  /** 疑問文の語尾を自動で上げるか。既定は true。`VoicevoxSynthesisOptions` と同じ。 */
  enableInterrogativeUpspeak?: boolean;
  /** オーディオセッションの扱い。既定は `'none'`（何も触らない）。 */
  audioSession?: VoicevoxAudioSessionMode;
};

/** `speak()` が返す発話。 */
export type VoicevoxUtterance = {
  /** 発話 ID。`onSpeechStateChange` の `id` と対応する。 */
  id: number;
  /** 再生時間（ミリ秒）。`started` が false なら 0。 */
  durationMillis: number;
  /**
   * 実際に再生を始めたか。
   *
   * 合成しているあいだに別の `speak()` や `stopSpeaking()` に追い越されると false になる。
   * false のとき、この `id` のイベントは 1 件も届かない。
   */
  started: boolean;
};

/** 再生の状態。`'started'` 以外は発話の終わり方を表す。 */
export type VoicevoxSpeechState = 'started' | 'finished' | 'stopped' | 'failed';

/**
 * 再生状態の変化。
 *
 * `speak()` が `started: true` を返した発話には、`'started'` が 1 回と
 * `'finished'` / `'stopped'` / `'failed'` のいずれか 1 回が必ず届く。
 */
export type VoicevoxSpeechStateChange = {
  id: number;
  state: VoicevoxSpeechState;
  /** `state` が `'failed'` のときの理由。それ以外は空文字。 */
  reason: string;
};
