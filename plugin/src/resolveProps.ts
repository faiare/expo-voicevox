/**
 * `app.json` から受け取った props を検証し、既定値を埋めた 1 つの形に正規化する。
 * 以降の mod はここが返す `ResolvedVoicevoxProps` だけを見る。
 */
import {
  DEFAULT_CORE_VERSION,
  DEFAULT_OPEN_JTALK_DIC_DIR_NAME,
  DEFAULT_OPEN_JTALK_DIC_TAG,
  DEFAULT_ORT_VERSION_ANDROID,
  DEFAULT_ORT_VERSION_IOS,
  DEFAULT_VVM_VERSION,
  voiceModelUrl,
} from './core/versions';
import { VoicevoxPluginError } from './errors';
import type {
  ExpoVoicevoxPluginProps,
  ResolvedVoiceModel,
  ResolvedVoicevoxProps,
  VoicevoxAndroidAbi,
  VoicevoxAssetSource,
} from './types';
import { ANDROID_ABIS } from './types';
import { VVM_CATALOG_FILES, VVM_CATALOG_VERSION } from './vvm/catalog.generated';
import { resolveVoices } from './vvm/resolveVoices';

/** voicevoxcore-android が要求する最低 API レベル。 */
export const MINIMUM_ANDROID_SDK_VERSION = 26;

/**
 * voicevox_core.xcframework の MinimumOSVersion は 16.2 だが、Expo テンプレートの
 * 既定が 16.4 なのでそちらに合わせている。
 */
export const MINIMUM_IOS_DEPLOYMENT_TARGET = '16.4';

const ASSET_SOURCES: VoicevoxAssetSource[] = ['bundle', 'download'];

const DEFAULT_VOICES = ['zundamon/normal'];

function parseDeploymentTarget(value: string): number {
  const matched = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!matched) {
    throw new VoicevoxPluginError(
      `could not parse ios.deploymentTarget "${value}". Use a form like "16.4".`
    );
  }
  return Number(matched[1]) + Number(matched[2] ?? 0) / 100;
}

/** `a` が `b` 以上か。"16.4" と "16.10" を正しく比べる。 */
export function isDeploymentTargetAtLeast(a: string, b: string): boolean {
  return parseDeploymentTarget(a) >= parseDeploymentTarget(b);
}

function resolveAbis(input: unknown): VoicevoxAndroidAbi[] {
  if (input === undefined) {
    return [...ANDROID_ABIS];
  }
  if (!Array.isArray(input) || input.length === 0) {
    throw new VoicevoxPluginError(
      `android.abis must list at least one of ${ANDROID_ABIS.join(' / ')}.`
    );
  }
  const abis = input.map((abi) => {
    if (typeof abi !== 'string' || !(ANDROID_ABIS as readonly string[]).includes(abi)) {
      throw new VoicevoxPluginError(
        `android.abis cannot contain "${abi}". voicevox-core only ships ` +
          `${ANDROID_ABIS.join(' and ')}.`
      );
    }
    return abi as VoicevoxAndroidAbi;
  });
  return [...new Set(abis)];
}

function resolveVoiceModels(
  voices: ExpoVoicevoxPluginProps['voices'],
  voiceModelVersion: string
): ResolvedVoiceModel[] {
  if (voices !== undefined && !Array.isArray(voices)) {
    throw new VoicevoxPluginError('voices must be an array.');
  }
  const selected = resolveVoices(voices ?? DEFAULT_VOICES, voiceModelVersion);
  const catalogUsable = voiceModelVersion === VVM_CATALOG_VERSION;

  return selected.map((model) => {
    const known = catalogUsable ? VVM_CATALOG_FILES[model.fileName] : undefined;
    return {
      fileName: model.fileName,
      requestedBy: model.requestedBy,
      url: voiceModelUrl(voiceModelVersion, model.fileName),
      size: known?.size ?? null,
      sha256: known?.sha256 ?? null,
    };
  });
}

export function resolveProps(props: ExpoVoicevoxPluginProps = {}): ResolvedVoicevoxProps {
  const assetSource = props.assetSource ?? 'bundle';
  if (!ASSET_SOURCES.includes(assetSource)) {
    throw new VoicevoxPluginError(
      `assetSource must be ${ASSET_SOURCES.map((s) => `"${s}"`).join(' or ')} (got "${assetSource}").`
    );
  }

  const openJtalkDictionary = props.openJtalkDictionary ?? true;
  if (typeof openJtalkDictionary !== 'boolean') {
    throw new VoicevoxPluginError('openJtalkDictionary must be true or false.');
  }

  const voiceModelVersion = props.voiceModelVersion ?? DEFAULT_VVM_VERSION;
  const voiceModels = resolveVoiceModels(props.voices, voiceModelVersion);

  if (voiceModels.length === 0 && !openJtalkDictionary) {
    throw new VoicevoxPluginError(
      'voices is empty and openJtalkDictionary is false, so the plugin has nothing to place.\n' +
        '  To manage the assets yourself, drop these props and pass explicit paths to initialize().'
    );
  }

  const minSdkVersion = props.android?.minSdkVersion ?? MINIMUM_ANDROID_SDK_VERSION;
  if (!Number.isInteger(minSdkVersion) || minSdkVersion < MINIMUM_ANDROID_SDK_VERSION) {
    throw new VoicevoxPluginError(
      `android.minSdkVersion must be ${MINIMUM_ANDROID_SDK_VERSION} or higher ` +
        `(required by voicevoxcore-android; got ${minSdkVersion}).`
    );
  }

  const deploymentTarget = props.ios?.deploymentTarget ?? MINIMUM_IOS_DEPLOYMENT_TARGET;
  if (!isDeploymentTargetAtLeast(deploymentTarget, MINIMUM_IOS_DEPLOYMENT_TARGET)) {
    throw new VoicevoxPluginError(
      `ios.deploymentTarget must be ${MINIMUM_IOS_DEPLOYMENT_TARGET} or higher ` +
        `(required by voicevox_core.xcframework; got ${deploymentTarget}).`
    );
  }

  return {
    assetSource,
    voiceModels,
    openJtalkDictionary,
    versions: {
      core: props.coreVersion ?? DEFAULT_CORE_VERSION,
      voiceModel: voiceModelVersion,
      onnxruntime: {
        ios: props.onnxruntimeVersion?.ios ?? DEFAULT_ORT_VERSION_IOS,
        android: props.onnxruntimeVersion?.android ?? DEFAULT_ORT_VERSION_ANDROID,
      },
      openJtalkDictTag: DEFAULT_OPEN_JTALK_DIC_TAG,
      openJtalkDictDirName: DEFAULT_OPEN_JTALK_DIC_DIR_NAME,
    },
    android: { abis: resolveAbis(props.android?.abis), minSdkVersion },
    ios: { deploymentTarget },
    cacheDirectory: props.cacheDirectory ?? null,
    skipIntegrityCheck: props.skipIntegrityCheck ?? false,
  };
}
