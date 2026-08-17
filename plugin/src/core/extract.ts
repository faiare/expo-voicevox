/**
 * アーカイブをキャッシュ上へ 1 回だけ展開する。
 *
 * 展開は一時ディレクトリで行い、完了してから最終位置へ rename する。
 * 途中で中断しても「中途半端に展開されたディレクトリ」がキャッシュに残らない。
 */
import fs from 'node:fs';
import path from 'node:path';

import type { VoicevoxCache } from './cache';
import { ensureDir, rmrf } from './fsUtils';

const COMPLETE_MARKER = '.expo-voicevox-complete';

export type ExtractOptions = {
  cache: VoicevoxCache;
  /** 展開先を決めるキー。アーティファクトとバージョンごとに一意にする。 */
  key: string;
  archivePath: string;
  /** アーカイブを `destination` へ展開する。 */
  extract: (archivePath: string, destination: string) => void;
  log?: (message: string) => void;
};

/** 展開済みディレクトリの絶対パスを返す。 */
export function ensureExtracted(options: ExtractOptions): string {
  const { cache, key, archivePath, extract, log } = options;
  const destination = cache.extractedDir(key);
  const marker = path.join(destination, COMPLETE_MARKER);

  if (fs.existsSync(marker)) {
    return destination;
  }

  log?.(`extracting ${path.basename(archivePath)}`);
  rmrf(destination);

  const staging = `${destination}.staging`;
  rmrf(staging);
  ensureDir(staging);
  try {
    extract(archivePath, staging);
    fs.writeFileSync(path.join(staging, COMPLETE_MARKER), '', 'utf8');
    fs.renameSync(staging, destination);
  } catch (error) {
    rmrf(staging);
    throw error;
  }

  return destination;
}
