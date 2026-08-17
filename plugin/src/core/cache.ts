/**
 * ダウンロードしたアーカイブと展開結果の置き場所。
 *
 * `node_modules/.cache` を既定にしていないのは、`npm ci` や `rm -rf node_modules` で
 * 消えてしまううえ、モノレポではプロジェクトごとに 200MB が重複するため。
 * `~/.cache` なら複数プロジェクトで共有でき、node_modules を消しても生き残る。
 */
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import { ensureDir } from './fsUtils';

export const CACHE_DIR_ENV = 'EXPO_VOICEVOX_CACHE_DIR';

export type VoicevoxCache = {
  root: string;
  /** ダウンロードした生アーカイブの置き場所。 */
  downloads: string;
  /** 展開結果の置き場所。`key` はアーティファクトごとに一意な文字列。 */
  extractedDir(key: string): string;
};

/**
 * キャッシュディレクトリを決める。優先順は
 * 環境変数 > plugin config > `$XDG_CACHE_HOME` > `~/.cache`。
 */
export function resolveCacheRoot(projectRoot: string, configured: string | null): string {
  const fromEnv = process.env[CACHE_DIR_ENV];
  if (fromEnv) {
    return path.resolve(projectRoot, fromEnv);
  }
  if (configured) {
    return path.resolve(projectRoot, configured);
  }
  const xdg = process.env.XDG_CACHE_HOME;
  return path.join(xdg ? xdg : path.join(os.homedir(), '.cache'), 'expo-voicevox');
}

export function createCache(projectRoot: string, configured: string | null): VoicevoxCache {
  const root = resolveCacheRoot(projectRoot, configured);
  const downloads = path.join(root, 'downloads');
  ensureDir(downloads);
  return {
    root,
    downloads,
    extractedDir(key: string) {
      const dir = path.join(root, 'extracted', key);
      ensureDir(path.dirname(dir));
      return dir;
    },
  };
}

/**
 * URL からキャッシュ上のファイル名を作る。
 *
 * URL のハッシュを前置しているのは、別バージョンや別リポジトリで同じ basename
 * （`java_packages.zip` など）が衝突するのを避けるため。
 */
export function cacheFileNameFor(url: string): string {
  const digest = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  const basename = path.basename(new URL(url).pathname);
  return `${digest}-${basename}`;
}
