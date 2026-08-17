import { registerWebModule, NativeModule } from 'expo';

// ExpoVoicevoxModule is not available on the web platform.
class ExpoVoicevoxModule extends NativeModule<{}> {}

export default registerWebModule(ExpoVoicevoxModule, 'ExpoVoicevoxModule');
