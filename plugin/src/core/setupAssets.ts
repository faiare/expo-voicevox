/**
 * 音声モデル（`.vvm`）と OpenJTalk 辞書をキャッシュへ用意する。
 *
 * ここではキャッシュに置くだけで、ネイティブプロジェクトへの配置は
 * iOS / Android それぞれの mod が行う。
 */
import path from 'node:path';

import { lookupArtifact, openJtalkDictSpec } from './artifacts';
import type { VoicevoxCache } from './cache';
import { downloadToCache } from './download';
import { ensureExtracted } from './extract';
import { findEntry, untar } from './fsUtils';
import { voiceModelUrl } from './versions';
import type { ResolvedVoiceModel, VoicevoxVersions } from '../types';

export type AssetSetupContext = {
  versions: VoicevoxVersions;
  cache: VoicevoxCache;
  skipIntegrityCheck: boolean;
  log?: (message: string) => void;
};

/** VVM リリースに同梱されている利用規約。同梱してクレジット表記の根拠を残す。 */
export const VOICE_MODEL_LICENSE_FILES = ['TERMS.txt', 'README.txt'];

export type PreparedAsset = {
  /** アプリへ配置するときのファイル名（またはディレクトリ名）。 */
  name: string;
  /** キャッシュ上の絶対パス。 */
  sourcePath: string;
};

/** `.vvm` をキャッシュへ用意し、配置元のパスを返す。 */
export async function ensureVoiceModels(
  context: AssetSetupContext,
  models: ResolvedVoiceModel[]
): Promise<PreparedAsset[]> {
  const { cache, skipIntegrityCheck, log } = context;
  const prepared: PreparedAsset[] = [];

  for (const model of models) {
    const download = await downloadToCache({
      url: model.url,
      cache,
      sha256: model.sha256,
      size: model.size,
      skipIntegrityCheck,
      log,
    });
    prepared.push({ name: model.fileName, sourcePath: download.filePath });
  }

  return prepared;
}

/**
 * 音声モデルの利用規約をキャッシュへ用意し、配置元のパスを返す。
 *
 * `assetSource` に関係なくアプリへ同梱する。数 KB のテキストしかないうえ、
 * クレジット表記の条件がキャラクターごとに違うので、端末上に必ず現物がある状態にしておく。
 */
export async function ensureVoiceModelLicenses(
  context: AssetSetupContext
): Promise<PreparedAsset[]> {
  const { cache, skipIntegrityCheck, versions, log } = context;
  const prepared: PreparedAsset[] = [];

  for (const fileName of VOICE_MODEL_LICENSE_FILES) {
    const url = voiceModelUrl(versions.voiceModel, fileName);
    const pinned = lookupArtifact(url);
    const download = await downloadToCache({
      url,
      cache,
      sha256: pinned.sha256,
      size: pinned.size,
      skipIntegrityCheck,
      log,
    });
    prepared.push({ name: fileName, sourcePath: download.filePath });
  }

  return prepared;
}

/**
 * OpenJTalk のシステム辞書をキャッシュへ展開し、そのディレクトリを返す。
 *
 * 以前は Metro が拡張子なしのファイルを扱えないため `COPYING` を `COPYING.txt` に
 * リネームしていたが、config plugin 経由では Metro を通らないので配布物のまま置く。
 */
export async function ensureOpenJtalkDictionary(
  context: AssetSetupContext
): Promise<PreparedAsset> {
  const { cache, skipIntegrityCheck, versions, log } = context;
  const spec = openJtalkDictSpec(versions);
  const pinned = lookupArtifact(spec.url);

  const download = await downloadToCache({
    url: spec.url,
    cache,
    sha256: pinned.sha256,
    size: pinned.size,
    skipIntegrityCheck,
    log,
  });
  const extracted = ensureExtracted({
    cache,
    key: spec.key,
    archivePath: download.filePath,
    extract: untar,
    log,
  });

  const dictDir = findEntry(extracted, versions.openJtalkDictDirName);
  if (!dictDir) {
    throw new Error(
      `${versions.openJtalkDictDirName} was not found in the extracted ${path.basename(spec.url)}`
    );
  }
  return { name: versions.openJtalkDictDirName, sourcePath: dictDir };
}
