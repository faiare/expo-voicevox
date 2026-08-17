/**
 * ネイティブ側が読むマニフェスト。
 *
 * iOS と Android で同じ JSON を置く（iOS はバンドル内、Android は assets 内）ので、
 * 読み取りコードは 1 種類で済む。Info.plist を使わないのは、利用者のアプリが
 * 触るファイルを plugin が書き換えずに済ませたいのと、両プラットフォームで
 * 同じパーサを使えるようにするため。
 */
import crypto from 'node:crypto';

import { openJtalkDictSpec, lookupArtifact } from './core/artifacts';
import type { ResolvedVoicevoxProps, VoicevoxAssetSource } from './types';

export type VoicevoxManifestDownload = {
  /** `file` はそのまま保存、`targz` は展開する。 */
  kind: 'file' | 'targz';
  url: string;
  sha256: string | null;
  size: number | null;
  /** 保存または展開したあとにできるファイル名／ディレクトリ名。 */
  name: string;
};

export type VoicevoxRuntimeManifest = {
  manifestVersion: 1;
  assetSource: VoicevoxAssetSource;
  /** 辞書のディレクトリ名。plugin が辞書を用意しない設定なら null。 */
  openJtalkDictDirName: string | null;
  /** 用意した `.vvm` のファイル名。 */
  voiceModelNames: string[];
  /**
   * 内容から算出した短いハッシュ。
   * Android は展開先ディレクトリ名に使い、設定が変わったときだけ展開し直す。
   */
  revision: string;
  /** `assetSource: "download"` のときに端末が取得するもの。bundle なら空。 */
  downloads: VoicevoxManifestDownload[];
};

export function buildRuntimeManifest(props: ResolvedVoicevoxProps): VoicevoxRuntimeManifest {
  const openJtalkDictDirName = props.openJtalkDictionary
    ? props.versions.openJtalkDictDirName
    : null;
  const voiceModelNames = props.voiceModels.map((model) => model.fileName);

  const downloads: VoicevoxManifestDownload[] =
    props.assetSource === 'download'
      ? [
          ...props.voiceModels.map((model) => ({
            kind: 'file' as const,
            url: model.url,
            sha256: model.sha256,
            size: model.size,
            name: model.fileName,
          })),
          ...(props.openJtalkDictionary ? [openJtalkDictDownload(props)] : []),
        ]
      : [];

  const withoutRevision = {
    manifestVersion: 1 as const,
    assetSource: props.assetSource,
    openJtalkDictDirName,
    voiceModelNames,
    downloads,
  };

  return { ...withoutRevision, revision: revisionOf(withoutRevision) };
}

function openJtalkDictDownload(props: ResolvedVoicevoxProps): VoicevoxManifestDownload {
  const spec = openJtalkDictSpec(props.versions);
  const pinned = lookupArtifact(spec.url);
  return {
    kind: 'targz',
    url: spec.url,
    sha256: pinned.sha256,
    size: pinned.size,
    // 配布物の tar は `open_jtalk_dic_utf_8-1.11/` を先頭に持っているので、
    // ルートへ展開するだけでこの名前のディレクトリができる。
    name: props.versions.openJtalkDictDirName,
  };
}

/**
 * キーを再帰的に並べ替えた JSON。同じ設定なら必ず同じ文字列になる。
 *
 * `JSON.stringify` の replacer 配列は入れ子のキーにも効いてしまい、
 * トップレベルのキー名しか渡さないと `downloads[].url` などが消える。自前で並べ替える。
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/** 同じ設定なら必ず同じ値になるように、正規化した JSON から算出する。 */
function revisionOf(manifest: Omit<VoicevoxRuntimeManifest, 'revision'>): string {
  const canonical = JSON.stringify(canonicalize(manifest));
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function serializeManifest(manifest: VoicevoxRuntimeManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
