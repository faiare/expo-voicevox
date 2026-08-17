/**
 * iOS 側の mod をまとめる。
 *
 * - dangerous mod: xcframework をパッケージへ、アセットを `ios/voicevox/` へ配置
 * - xcodeproject mod: `ios/voicevox/` をフォルダ参照として Copy Bundle Resources へ登録
 * - Podfile properties: deployment target
 *
 * dangerous mod は `pod install` より前に走るので、`vendored_frameworks` の解決に間に合う。
 * dangerous と xcodeproject の実行順は保証されないが、pbxproj 側はパス文字列しか使わないので
 * 順序に依存しない。
 */
import { withDangerousMod, withPodfileProperties, type ConfigPlugin } from 'expo/config-plugins';
import path from 'node:path';

import { withVoicevoxFolderReference } from './withVoicevoxFolderReference';
import { placeAssets, type PlacementEntry } from '../assetPlacement';
import { VOICEVOX_RESOURCE_DIR } from '../constants';
import { createCache } from '../core/cache';
import { ensureOpenJtalkDictionary, ensureVoiceModels } from '../core/setupAssets';
import { ensureIosFrameworks } from '../core/setupIos';
import { packageRoot } from '../packageRoot';
import { isDeploymentTargetAtLeast } from '../resolveProps';
import { buildRuntimeManifest, serializeManifest } from '../runtimeManifest';
import type { ResolvedVoicevoxProps } from '../types';

export const withVoicevoxIos: ConfigPlugin<ResolvedVoicevoxProps> = (config, props) => {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const log = (message: string) => console.log(`expo-voicevox: ${message}`);
      const cache = createCache(projectRoot, props.cacheDirectory);

      await ensureIosFrameworks({
        packageRoot,
        versions: props.versions,
        cache,
        skipIntegrityCheck: props.skipIntegrityCheck,
        log,
      });

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

      placeAssets({
        targetDir: path.join(platformProjectRoot, VOICEVOX_RESOURCE_DIR),
        entries,
        manifest: serializeManifest(buildRuntimeManifest(props)),
        log,
      });

      return config;
    },
  ]);

  config = withVoicevoxFolderReference(config);

  config = withPodfileProperties(config, (config) => {
    const current = config.modResults['ios.deploymentTarget'];
    // 既存の設定が要件を満たしているなら触らない（expo-build-properties との衝突を避ける）。
    if (!current || !isDeploymentTargetAtLeast(current, props.ios.deploymentTarget)) {
      config.modResults['ios.deploymentTarget'] = props.ios.deploymentTarget;
    }
    return config;
  });

  return config;
};
