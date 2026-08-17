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
  async finalize(): Promise<void> {
    // 何も確保していないので何もしない。
  }
}

export default registerWebModule(ExpoVoicevoxModule, 'ExpoVoicevoxModule');
