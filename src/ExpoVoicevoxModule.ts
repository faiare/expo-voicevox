import { NativeModule, requireNativeModule } from 'expo';

import type { NormalizedVoicevoxInitializeOptions } from './ExpoVoicevox.types';

declare class ExpoVoicevoxModule extends NativeModule<{}> {
  /** voicevox-core のバージョン。ネイティブライブラリがロードできているかの確認も兼ねる。 */
  getVersion(): string;
  /** `initialize()` が完了しているか。 */
  isInitialized(): boolean;
  /** ONNX Runtime・OpenJTalk・Synthesizer を用意し、音声モデルを読み込む。 */
  initialize(options: NormalizedVoicevoxInitializeOptions): Promise<void>;
  /**
   * 読み込み済みの音声モデルのメタ情報を、voicevox-core が返す JSON 文字列のまま返す。
   *
   * 構造化は `getCharacters()`（TS 側）で行い、iOS と Android で同じ解釈になるようにしている。
   */
  getMetasJson(): Promise<string>;
  /** テキストを合成し、書き出した WAV ファイルの絶対パスを返す。 */
  tts(text: string, styleId: number): Promise<string>;
  /** Synthesizer を破棄する。再度使うには `initialize()` が必要。 */
  finalize(): Promise<void>;
}

export default requireNativeModule<ExpoVoicevoxModule>('ExpoVoicevox');
