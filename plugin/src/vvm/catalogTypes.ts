/** `catalog.generated.ts` が使う型。生成ファイルを差し替えても型はここに残る。 */

/** 声の種別。`song` は歌唱、`nemo` は VOICEVOX Nemo。 */
export type VvmVoiceKind = 'talk' | 'song' | 'nemo';

export type VvmCatalogFile = {
  /** バイト数。 */
  size: number;
  /** GitHub リリースが digest を持っていれば sha256、無ければ null。 */
  sha256: string | null;
};

export type VvmCatalogVoice = {
  /** キャラクターの slug（例 "zundamon"）。 */
  character: string;
  /** スタイルの slug（例 "normal"）。同一キャラクター内で一意。 */
  style: string;
  /** 収録されている `.vvm` のファイル名（例 "0.vvm"）。 */
  file: string;
  /** voicevox-core の styleId。`tts()` に渡す値。 */
  styleId: number;
  kind: VvmVoiceKind;
  /** 日本語のキャラクター名。エラーメッセージとログ用。 */
  characterName: string;
  /** 日本語のスタイル名。エラーメッセージとログ用。 */
  styleName: string;
};

export type VvmCatalog = {
  /** この表を生成した VVM リリースのタグ。 */
  version: string;
  files: Record<string, VvmCatalogFile>;
  voices: VvmCatalogVoice[];
};
