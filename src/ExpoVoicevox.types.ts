/**
 * `initialize()` に渡すオプション。
 *
 * voicevox-core は音声モデルも辞書も実行時にファイルパスで読むため、
 * 呼び出し側が端末のファイルシステム上に展開したうえで絶対パスを渡す必要がある。
 */
export type VoicevoxInitializeOptions = {
  /** OpenJTalk のシステム辞書ディレクトリ（`open_jtalk_dic_utf_8-1.11`）の絶対パス。 */
  openJtalkDictDir: string;
  /** 読み込む音声モデル（`.vvm`）の絶対パス。最低 1 件必要。 */
  voiceModelPaths: string[];
  /** 推論に使う CPU スレッド数。0 で環境に合わせて自動決定する（既定）。 */
  cpuNumThreads?: number;
};

/** `initialize()` がネイティブへ渡す、既定値を埋めたあとのオプション。 */
export type NormalizedVoicevoxInitializeOptions = Required<VoicevoxInitializeOptions>;

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
