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
