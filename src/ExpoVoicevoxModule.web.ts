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
  async getAssetStatus(): Promise<{
    configured: boolean;
    ready: boolean;
    assetSource: 'bundle';
    downloadBytes: number;
  }> {
    // web は対象外なので「設定されていない」を返す。throw しないのは、この API 自体が
    // 「使える状態かを確かめる」ためのものだから。
    return { configured: false, ready: false, assetSource: 'bundle', downloadBytes: 0 };
  }
  async cancelPrepareAssets(): Promise<void> {
    // 何も準備していないので何もしない。
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
  async speak(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async speakFromKana(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async speakFromAudioQuery(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async precacheSpeech(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async precacheSpeechFromKana(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async precacheSpeechFromAudioQuery(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
  async stopSpeaking(): Promise<void> {
    // 何も鳴らしていないので何もしない。
  }
  isSpeaking(): boolean {
    return false;
  }
  async finalize(): Promise<void> {
    // 何も確保していないので何もしない。
  }
  async clearSynthesisCache(): Promise<void> {
    // 何も合成していないので何もしない。
  }
  async getSynthesisCacheStats(): Promise<never> {
    throw new Error(UNSUPPORTED);
  }
}

export default registerWebModule(ExpoVoicevoxModule, 'ExpoVoicevoxModule');
