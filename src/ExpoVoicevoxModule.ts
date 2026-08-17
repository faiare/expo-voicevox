import { NativeModule, requireNativeModule } from 'expo';

import type {
  ExpoVoicevoxModuleEvents,
  NormalizedVoicevoxInitializeOptions,
  NormalizedVoicevoxUserDictWord,
  VoicevoxAssetPaths,
} from './ExpoVoicevox.types';

declare class ExpoVoicevoxModule extends NativeModule<ExpoVoicevoxModuleEvents> {
  /** voicevox-core のバージョン。ネイティブライブラリがロードできているかの確認も兼ねる。 */
  getVersion(): string;
  /** `initialize()` が完了しているか。 */
  isInitialized(): boolean;
  /**
   * config plugin が配置したアセットを使える状態にして、絶対パスを返す。
   *
   * Android では初回だけ APK 内 assets を端末へ展開する（`assetSource: "download"` なら取得も行う）。
   * iOS の bundle モードではアプリのバンドルをそのまま読むので即座に返る。冪等。
   */
  prepareAssets(): Promise<VoicevoxAssetPaths>;
  /** ONNX Runtime・OpenJTalk・Synthesizer を用意し、音声モデルを読み込む。 */
  initialize(options: NormalizedVoicevoxInitializeOptions): Promise<void>;
  /**
   * 読み込み済みの音声モデルのメタ情報を、voicevox-core が返す JSON 文字列のまま返す。
   *
   * 構造化は `getCharacters()`（TS 側）で行い、iOS と Android で同じ解釈になるようにしている。
   */
  getMetasJson(): Promise<string>;
  /** テキストを合成し、書き出した WAV ファイルの絶対パスを返す。 */
  tts(text: string, styleId: number, enableInterrogativeUpspeak: boolean): Promise<string>;
  /** AquesTalk 風記法のカナを合成し、書き出した WAV ファイルの絶対パスを返す。 */
  ttsFromKana(kana: string, styleId: number, enableInterrogativeUpspeak: boolean): Promise<string>;
  /**
   * テキストから AudioQuery を生成し、voicevox-core の JSON 文字列のまま返す。
   *
   * 構造化と命名の変換は `src/audioQuery.ts` で行う。JSON のキーは voicevox-core の定義どおり
   * snake_case と camelCase の混在で、iOS / Android どちらも同じ形になるようにしてある。
   */
  createAudioQueryJson(text: string, styleId: number): Promise<string>;
  /** AquesTalk 風記法のカナから AudioQuery を生成する。 */
  createAudioQueryFromKanaJson(kana: string, styleId: number): Promise<string>;
  /** テキストから AccentPhrase 配列を生成し、JSON 文字列で返す。 */
  createAccentPhrasesJson(text: string, styleId: number): Promise<string>;
  /** AquesTalk 風記法のカナから AccentPhrase 配列を生成する。 */
  createAccentPhrasesFromKanaJson(kana: string, styleId: number): Promise<string>;
  /** AccentPhrase 配列の音素長と音高を、指定のスタイルで生成し直す。 */
  replaceMoraDataJson(accentPhrasesJson: string, styleId: number): Promise<string>;
  /** AccentPhrase 配列の音素長だけを生成し直す。 */
  replacePhonemeLengthJson(accentPhrasesJson: string, styleId: number): Promise<string>;
  /** AccentPhrase 配列の音高だけを生成し直す。 */
  replaceMoraPitchJson(accentPhrasesJson: string, styleId: number): Promise<string>;
  /** AccentPhrase 配列から AudioQuery を組み立てる。Synthesizer を必要としない。 */
  audioQueryFromAccentPhrasesJson(accentPhrasesJson: string): Promise<string>;
  /** AudioQuery の JSON を合成し、書き出した WAV ファイルの絶対パスを返す。 */
  synthesis(
    audioQueryJson: string,
    styleId: number,
    enableInterrogativeUpspeak: boolean
  ): Promise<string>;
  /** ユーザー辞書を作り直して OpenJTalk へ適用する。 */
  setUserDictWords(words: NormalizedVoicevoxUserDictWord[]): Promise<void>;
  /** VOICEVOX 形式の辞書ファイルを現在の辞書へ読み込み、適用し直す。 */
  loadUserDictFile(path: string): Promise<void>;
  /** 現在の辞書を VOICEVOX 形式で保存する。 */
  saveUserDictFile(path: string): Promise<void>;
  /** Synthesizer を破棄する。再度使うには `initialize()` が必要。 */
  finalize(): Promise<void>;
}

export default requireNativeModule<ExpoVoicevoxModule>('ExpoVoicevox');
