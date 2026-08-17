import { registerWebModule, NativeModule } from 'expo';

import type { ExpoVoicevoxModuleEvents } from './ExpoVoicevox.types';

const UNSUPPORTED = 'expo-voicevox does not support web (iOS and Android only).';

// ExpoVoicevoxModule is not available on the web platform.
class ExpoVoicevoxModule extends NativeModule<ExpoVoicevoxModuleEvents> {
  getVersion(): string {
    throw new Error(UNSUPPORTED);
  }
  isInitialized(): boolean {
    return false;
  }
  async prepareAssets(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async initialize(): Promise<void> {
    throw new Error(UNSUPPORTED);
  }
  async getMetasJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async tts(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async ttsFromKana(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async createAudioQueryJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async createAudioQueryFromKanaJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async synthesis(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async createAccentPhrasesJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async createAccentPhrasesFromKanaJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async replaceMoraDataJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async replacePhonemeLengthJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async replaceMoraPitchJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async audioQueryFromAccentPhrasesJson(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async setUserDictWords(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async loadUserDictFile(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async saveUserDictFile(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async finalize(): Promise<void> {
    // 何も確保していないので何もしない。
  }
}

export default registerWebModule(ExpoVoicevoxModule, 'ExpoVoicevoxModule');
