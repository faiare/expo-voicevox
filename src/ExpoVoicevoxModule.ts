import { NativeModule, requireNativeModule } from 'expo';

declare class ExpoVoicevoxModule extends NativeModule<{}> {}

export default requireNativeModule<ExpoVoicevoxModule>('ExpoVoicevox');
