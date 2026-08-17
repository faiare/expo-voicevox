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
};
