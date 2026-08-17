/**
 * `app.json` の plugin config で受け取る型。
 *
 * `src/ExpoVoicevox.types.ts` から re-export しているので、`app.config.ts` 派は
 * `import type { ExpoVoicevoxPluginProps } from '@faiare/expo-voicevox'` で型付きで書ける。
 */

/** voicevox-core が公式に配布している Android の ABI。他は配布されていない。 */
export const ANDROID_ABIS = ['arm64-v8a', 'x86_64'] as const;

export type VoicevoxAndroidAbi = (typeof ANDROID_ABIS)[number];

/**
 * アセット（音声モデルと OpenJTalk 辞書）の配布方法。
 *
 * - `bundle`: prebuild 時にアプリへ埋め込む。オフラインで動くが配信サイズが増える。
 * - `download`: URL とハッシュだけ埋め込み、初回起動時に端末が取得する。
 */
export type VoicevoxAssetSource = 'bundle' | 'download';

/**
 * 使いたい声の指定。キャラクターとスタイルは半角英数の slug で書く。
 *
 * 1 キャラの声は複数の `.vvm` に分かれているため、**スタイルまで必須**にしている。
 * キャラ名だけでは何 MB 取り込まれるかが `app.json` から読み取れないため。
 *
 * ```jsonc
 * "voices": [
 *   "zundamon/normal",
 *   { "character": "shikoku-metan", "styles": ["normal", "sexy"] },
 *   { "file": "n0.vvm" }
 * ]
 * ```
 */
export type VoicevoxVoiceSpec = string | { character: string; styles: string[] } | { file: string };

export type ExpoVoicevoxPluginProps = {
  /** 同梱する声。既定は `["zundamon/normal"]`。 */
  voices?: VoicevoxVoiceSpec[];
  /** 既定は `"bundle"`。 */
  assetSource?: VoicevoxAssetSource;
  /** OpenJTalk 辞書を同梱するか。自前で用意する場合のみ false。既定 true。 */
  openJtalkDictionary?: boolean;

  /** voicevox_core 本体（xcframework / java_packages.zip）のバージョン。既定 "0.17.0"。 */
  coreVersion?: string;
  /**
   * VVM リリースのタグ。既定 "0.17.0"。
   *
   * 既定以外にすると同梱のカタログが使えなくなり、`voices` はファイル直接指定
   * （`{ file: "0.vvm" }`）のみになる。
   */
  voiceModelVersion?: string;
  /**
   * VOICEVOX ONNX Runtime。既定 `{ ios: "1.17.3", android: "1.23.2" }`。
   *
   * iOS と Android で別バージョンなのは意図的。変更は非推奨（README 参照）。
   */
  onnxruntimeVersion?: { ios?: string; android?: string };

  android?: {
    /** 既定 `["arm64-v8a", "x86_64"]`。ここに無い ABI は jniLibs から取り除かれる。 */
    abis?: VoicevoxAndroidAbi[];
    /** 既定 26。既存の設定がこれ以上なら尊重する。 */
    minSdkVersion?: number;
  };
  ios?: {
    /** 既定 "16.4"。既存の設定がこれ以上なら尊重する。 */
    deploymentTarget?: string;
  };

  /**
   * ダウンロードキャッシュの場所。プロジェクトルートからの相対パスも可。
   * 既定は `$XDG_CACHE_HOME/expo-voicevox`（未設定なら `~/.cache/expo-voicevox`）。
   * 環境変数 `EXPO_VOICEVOX_CACHE_DIR` が最優先。
   */
  cacheDirectory?: string | null;
  /** sha256 検証をスキップする。社内ミラー用の逃げ道で、通常は false のまま。 */
  skipIntegrityCheck?: boolean;
};

// ---------------------------------------------------------------------------
// 正規化後（plugin 内部でのみ使う）
// ---------------------------------------------------------------------------

export type VoicevoxVersions = {
  core: string;
  voiceModel: string;
  onnxruntime: { ios: string; android: string };
  openJtalkDictTag: string;
  openJtalkDictDirName: string;
};

/**
 * ダウンロード対象 1 件。
 *
 * `size` / `sha256` は同梱のカタログ・ピン留め表から引く。利用者がバージョンを
 * 上書きした場合は分からないので null になり、その場合は検証をスキップして警告する。
 */
export type VoicevoxArtifact = {
  url: string;
  size: number | null;
  sha256: string | null;
};

export type ResolvedVoiceModel = VoicevoxArtifact & {
  /** 例 "0.vvm"。 */
  fileName: string;
  /** この `.vvm` を要求した声（ログとエラー表示用）。ファイル直接指定なら空配列。 */
  requestedBy: string[];
};

export type ResolvedVoicevoxProps = {
  assetSource: VoicevoxAssetSource;
  voiceModels: ResolvedVoiceModel[];
  openJtalkDictionary: boolean;
  versions: VoicevoxVersions;
  android: { abis: VoicevoxAndroidAbi[]; minSdkVersion: number };
  ios: { deploymentTarget: string };
  cacheDirectory: string | null;
  skipIntegrityCheck: boolean;
};
