import { registerWebModule, NativeModule } from 'expo';

const UNSUPPORTED = 'expo-voicevox は web をサポートしていません（iOS / Android のみ）';

// ExpoVoicevoxModule is not available on the web platform.
class ExpoVoicevoxModule extends NativeModule<{}> {
  getVersion(): string {
    throw new Error(UNSUPPORTED);
  }
  isInitialized(): boolean {
    return false;
  }
  async initialize(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }
  async getCharacters(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async tts(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async finalize(): Promise<void> {
    // 何も確保していないので何もしない。
  }
}

export default registerWebModule(ExpoVoicevoxModule, 'ExpoVoicevoxModule');
