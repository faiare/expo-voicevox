// Reexport the native module. On web, it will be resolved to ExpoVoicevoxModule.web.ts
// and on native platforms to ExpoVoicevoxModule.ts
export { default } from './ExpoVoicevoxModule';
export * from './ExpoVoicevox.types';
