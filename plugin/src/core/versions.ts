/**
 * voicevox-core 一式のバージョンと配布 URL。
 *
 * ここがバージョン定義の唯一の場所で、config plugin も `npm run setup:voicevox` も
 * このモジュールを見る。
 */
import type { VoicevoxAndroidAbi, VoicevoxVersions } from '../types';

/** voicevox_core 本体。C API / xcframework / java_packages.zip の出どころ。 */
export const DEFAULT_CORE_VERSION = '0.17.0';

/**
 * VOICEVOX ONNX Runtime。iOS と Android で使うバージョンが違う。
 *
 * iOS は 1.17.3 でなければならない。voicevox_core 0.17.0 の iOS バイナリは
 * `@rpath/voicevox_onnxruntime.framework` を compatibility version 1.17.3 で要求するが、
 * 1.23.2 の framework は LC_ID_DYLIB の compatibility version が 0.0.0 なので dyld に弾かれる。
 */
export const DEFAULT_ORT_VERSION_IOS = '1.17.3';

/**
 * Android は 1.23.2（voicevox_core 0.17.0 の推奨バージョン）。
 *
 * `load-onnxruntime` 方式でファイル名（バージョン無し）を dlopen するだけなので、
 * リンク時のバージョン一致は不要（core が受け付けるマイナーバージョンは 17 以上 29 以下）。
 *
 * 1.17.3 は LOAD セグメントの p_align が 4KB のままで、Android 15 以降の 16KB ページサイズ端末で
 * ページサイズ互換モードに落ちる。1.23.2 は 16KB アラインでビルドされている。
 */
export const DEFAULT_ORT_VERSION_ANDROID = '1.23.2';

/** 音声モデル（VVM）。 */
export const DEFAULT_VVM_VERSION = '0.17.0';

/** OpenJTalk のシステム辞書。 */
export const DEFAULT_OPEN_JTALK_DIC_TAG = 'v1.11.1';
export const DEFAULT_OPEN_JTALK_DIC_DIR_NAME = 'open_jtalk_dic_utf_8-1.11';

export const DEFAULT_VERSIONS: VoicevoxVersions = {
  core: DEFAULT_CORE_VERSION,
  voiceModel: DEFAULT_VVM_VERSION,
  onnxruntime: { ios: DEFAULT_ORT_VERSION_IOS, android: DEFAULT_ORT_VERSION_ANDROID },
  openJtalkDictTag: DEFAULT_OPEN_JTALK_DIC_TAG,
  openJtalkDictDirName: DEFAULT_OPEN_JTALK_DIC_DIR_NAME,
};

/** Android の ABI 名 -> ONNX Runtime のアセット名に使われる表記。 */
export const ANDROID_ABI_TO_ORT_ARCH: Record<VoicevoxAndroidAbi, string> = {
  'arm64-v8a': 'arm64',
  x86_64: 'x64',
};

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

const coreRelease = (version: string) =>
  `https://github.com/VOICEVOX/voicevox_core/releases/download/${version}`;

const ortRelease = (version: string) =>
  `https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-${version}`;

const vvmRelease = (version: string) =>
  `https://github.com/VOICEVOX/voicevox_vvm/releases/download/${version}`;

const openJtalkRelease = (tag: string) =>
  `https://github.com/r9y9/open_jtalk/releases/download/${tag}`;

export function iosCoreXcframeworkUrl(coreVersion: string): string {
  return `${coreRelease(coreVersion)}/voicevox_core-xcframework-${coreVersion}.zip`;
}

export function iosOnnxruntimeXcframeworkUrl(ortVersion: string): string {
  return `${ortRelease(ortVersion)}/voicevox_onnxruntime-ios-xcframework-${ortVersion}.zip`;
}

export function androidJavaPackagesUrl(coreVersion: string): string {
  return `${coreRelease(coreVersion)}/java_packages.zip`;
}

export function androidOnnxruntimeUrl(ortVersion: string, abi: VoicevoxAndroidAbi): string {
  const arch = ANDROID_ABI_TO_ORT_ARCH[abi];
  return `${ortRelease(ortVersion)}/voicevox_onnxruntime-android-${arch}-${ortVersion}.tgz`;
}

export function voiceModelUrl(vvmVersion: string, fileName: string): string {
  return `${vvmRelease(vvmVersion)}/${fileName}`;
}

export function openJtalkDictUrl(tag: string, dirName: string): string {
  return `${openJtalkRelease(tag)}/${dirName}.tar.gz`;
}

/** VVM リリースの README（キャラクター対応表の生成元）。 */
export function voiceModelReadmeUrl(vvmVersion: string): string {
  return `https://raw.githubusercontent.com/VOICEVOX/voicevox_vvm/${vvmVersion}/README.md`;
}

export const ANDROID_JAR_NAME = (coreVersion: string) => `voicevoxcore-android-${coreVersion}.jar`;
