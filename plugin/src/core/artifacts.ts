/**
 * ダウンロード対象の一覧と、ピン留めした size / sha256 の引き当て。
 *
 * ピン留め表（`artifacts.generated.ts`）は `npm run refresh:artifact-digests` が作る。
 * これがあるので **prebuild 時に GitHub API を叩かずに済む**（レート制限に当たらない）。
 * VVM のサイズと sha256 は `vvm/catalog.generated.ts` 側にある。
 */
import { ARTIFACT_DIGESTS } from './artifacts.generated';
import {
  androidJavaPackagesUrl,
  androidOnnxruntimeUrl,
  iosCoreXcframeworkUrl,
  iosOnnxruntimeXcframeworkUrl,
  openJtalkDictUrl,
} from './versions';
import type { VoicevoxAndroidAbi, VoicevoxArtifact, VoicevoxVersions } from '../types';

export type ArtifactSpec = {
  /** キャッシュの展開先を決めるキー。 */
  key: string;
  /** ログに出す名前。 */
  label: string;
  url: string;
};

/** ピン留め表から size と sha256 を引く。無ければ null（検証をスキップして警告する）。 */
export function lookupArtifact(url: string): VoicevoxArtifact {
  const pinned = ARTIFACT_DIGESTS[url];
  return { url, size: pinned?.size ?? null, sha256: pinned?.sha256 ?? null };
}

export function iosArtifactSpecs(versions: VoicevoxVersions): ArtifactSpec[] {
  return [
    {
      key: `core-${versions.core}`,
      label: `voicevox_core.xcframework (${versions.core})`,
      url: iosCoreXcframeworkUrl(versions.core),
    },
    {
      key: `ort-ios-${versions.onnxruntime.ios}`,
      label: `voicevox_onnxruntime.xcframework (${versions.onnxruntime.ios})`,
      url: iosOnnxruntimeXcframeworkUrl(versions.onnxruntime.ios),
    },
  ];
}

export function androidArtifactSpecs(
  versions: VoicevoxVersions,
  abis: VoicevoxAndroidAbi[]
): ArtifactSpec[] {
  return [
    {
      key: `java-${versions.core}`,
      label: `voicevoxcore-android (${versions.core})`,
      url: androidJavaPackagesUrl(versions.core),
    },
    ...abis.map((abi) => ({
      key: `ort-android-${versions.onnxruntime.android}-${abi}`,
      label: `libvoicevox_onnxruntime.so (${abi}, ${versions.onnxruntime.android})`,
      url: androidOnnxruntimeUrl(versions.onnxruntime.android, abi),
    })),
  ];
}

export function openJtalkDictSpec(versions: VoicevoxVersions): ArtifactSpec {
  return {
    key: `openjtalk-${versions.openJtalkDictTag}`,
    label: `OpenJTalk dictionary (${versions.openJtalkDictDirName})`,
    url: openJtalkDictUrl(versions.openJtalkDictTag, versions.openJtalkDictDirName),
  };
}
