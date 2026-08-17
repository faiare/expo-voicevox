/**
 * Android 側の mod。
 *
 * - dangerous mod: jar と .so をパッケージへ、アセットを `android/app/src/main/assets/voicevox/` へ
 * - gradle.properties: minSdkVersion と ABI の絞り込み
 *
 * `app/build.gradle` は触らない。`abiFilters` は gradle.properties の
 * `reactNativeArchitectures` で足りるうえ（expo-build-properties の `buildArchs` と同じ経路）、
 * 文字列パッチは prebuild の冪等性を壊しやすいため。
 *
 * `androidResources { noCompress }` も**あえて設定しない**。どのみち voicevox-core は実パスを
 * 要求するので `noBackupFilesDir` への展開が必要で、非圧縮にする利点が無い。
 * むしろ `sys.dic` は deflate で 21% まで縮む（103MB → 21.7MB）ので、
 * 圧縮したままの方が APK / AAB の配信サイズが 80MB 以上小さくなる。
 */
import { withDangerousMod, withGradleProperties, type ConfigPlugin } from 'expo/config-plugins';
import path from 'node:path';

import { placeAssets, type PlacementEntry } from '../assetPlacement';
import { VOICEVOX_RESOURCE_DIR } from '../constants';
import { createCache } from '../core/cache';
import {
  ensureAndroidJavaApi,
  ensureAndroidOnnxruntime,
  pruneUnusedAbis,
} from '../core/setupAndroid';
import { ensureOpenJtalkDictionary, ensureVoiceModels } from '../core/setupAssets';
import { packageRoot } from '../packageRoot';
import { buildRuntimeManifest, serializeManifest } from '../runtimeManifest';
import type { ResolvedVoicevoxProps } from '../types';

const MIN_SDK_KEY = 'android.minSdkVersion';
const ARCHITECTURES_KEY = 'reactNativeArchitectures';

type GradleProperties = { type: string; key?: string; value?: string }[];

function findProperty(properties: GradleProperties, key: string) {
  return properties.find((item) => item.type === 'property' && item.key === key);
}

function setProperty(properties: GradleProperties, key: string, value: string): void {
  const existing = findProperty(properties, key);
  if (existing) {
    existing.value = value;
  } else {
    properties.push({ type: 'property', key, value });
  }
}

export const withVoicevoxAndroid: ConfigPlugin<ResolvedVoicevoxProps> = (config, props) => {
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const log = (message: string) => console.log(`expo-voicevox: ${message}`);
      const cache = createCache(projectRoot, props.cacheDirectory);

      const context = {
        packageRoot,
        versions: props.versions,
        cache,
        skipIntegrityCheck: props.skipIntegrityCheck,
        abis: props.android.abis,
        log,
      };
      await ensureAndroidJavaApi(context);
      await ensureAndroidOnnxruntime(context);
      pruneUnusedAbis(packageRoot, props.android.abis, log);

      const entries: PlacementEntry[] = [];
      if (props.assetSource === 'bundle') {
        const assetContext = {
          versions: props.versions,
          cache,
          skipIntegrityCheck: props.skipIntegrityCheck,
          log,
        };
        entries.push(...(await ensureVoiceModels(assetContext, props.voiceModels)));
        if (props.openJtalkDictionary) {
          entries.push(await ensureOpenJtalkDictionary(assetContext));
        }
      }

      const assetsDir = path.join(platformProjectRoot, 'app', 'src', 'main', 'assets');
      placeAssets({
        targetDir: path.join(assetsDir, VOICEVOX_RESOURCE_DIR),
        entries,
        manifest: serializeManifest(buildRuntimeManifest(props)),
        log,
      });

      return config;
    },
  ]);

  config = withGradleProperties(config, (config) => {
    const properties = config.modResults as GradleProperties;

    // 既存の設定が要件を満たしているなら触らない（expo-build-properties との衝突を避ける）。
    const currentMinSdk = Number(findProperty(properties, MIN_SDK_KEY)?.value);
    if (!Number.isInteger(currentMinSdk) || currentMinSdk < props.android.minSdkVersion) {
      setProperty(properties, MIN_SDK_KEY, String(props.android.minSdkVersion));
    }

    // voicevox-core が配布していない ABI をビルドすると、その端末で必ず落ちる。
    // ここは既存値を尊重せず必ず上書きする。
    setProperty(properties, ARCHITECTURES_KEY, props.android.abis.join(','));

    return config;
  });

  return config;
};
