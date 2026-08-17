/**
 * キャッシュ付きのダウンロード。
 *
 * 100MB 級のファイルを扱うので、全量をメモリに載せずストリームでファイルへ書く。
 * 書き込み中は `.part` にしておき、検証を通ったものだけを rename する
 * （中断しても壊れたファイルがキャッシュに残らない）。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { cacheFileNameFor, type VoicevoxCache } from './cache';
import { ensureDir, formatBytes } from './fsUtils';

export type DownloadOptions = {
  url: string;
  cache: VoicevoxCache;
  /** 期待する sha256。null なら検証せず、計算結果を返すだけ。 */
  sha256: string | null;
  /** 期待するバイト数。null なら検証しない。 */
  size: number | null;
  /** true にすると sha256 検証をスキップする（社内ミラー用）。 */
  skipIntegrityCheck?: boolean;
  log?: (message: string) => void;
};

export type DownloadResult = {
  /** キャッシュ上の絶対パス。 */
  filePath: string;
  /** 実際のバイト数。 */
  size: number;
  /** 実際の sha256。 */
  sha256: string;
  /** キャッシュに既にあったか。 */
  cached: boolean;
};

/** 検証済みマーカー。毎回 100MB を再ハッシュしないために size と mtime を記録する。 */
type VerifiedMarker = { size: number; mtimeMs: number; sha256: string };

function markerPathFor(filePath: string): string {
  return `${filePath}.verified`;
}

function readMarker(filePath: string): VerifiedMarker | null {
  const markerPath = markerPathFor(filePath);
  if (!fs.existsSync(markerPath) || !fs.existsSync(filePath)) {
    return null;
  }
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as VerifiedMarker;
    const stat = fs.statSync(filePath);
    if (marker.size === stat.size && marker.mtimeMs === stat.mtimeMs) {
      return marker;
    }
  } catch {
    // 壊れたマーカーは無視して取り直す。
  }
  return null;
}

function writeMarker(filePath: string, sha256: string): void {
  const stat = fs.statSync(filePath);
  const marker: VerifiedMarker = { size: stat.size, mtimeMs: stat.mtimeMs, sha256 };
  fs.writeFileSync(markerPathFor(filePath), JSON.stringify(marker), 'utf8');
}

async function fetchToFile(
  url: string,
  destination: string
): Promise<{ sha256: string; size: number }> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status} ${response.statusText}): ${url}`);
  }

  ensureDir(path.dirname(destination));
  const partPath = `${destination}.part`;
  const hash = crypto.createHash('sha256');
  let size = 0;

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    size += chunk.length;
  });

  try {
    await pipeline(source, fs.createWriteStream(partPath));
  } catch (error) {
    fs.rmSync(partPath, { force: true });
    throw error;
  }

  fs.renameSync(partPath, destination);
  return { sha256: hash.digest('hex'), size };
}

function verify(
  actual: { sha256: string; size: number },
  expected: { sha256: string | null; size: number | null },
  url: string,
  skipIntegrityCheck: boolean
): void {
  if (expected.size != null && actual.size !== expected.size) {
    throw new Error(
      `downloaded file has an unexpected size: ${url}\n` +
        `  expected ${expected.size} bytes, got ${actual.size} bytes`
    );
  }
  if (!skipIntegrityCheck && expected.sha256 != null && actual.sha256 !== expected.sha256) {
    throw new Error(
      `downloaded file has an unexpected sha256: ${url}\n` +
        `  expected ${expected.sha256}\n  got      ${actual.sha256}`
    );
  }
}

/**
 * キャッシュにあればそれを返し、無ければ取得して検証する。
 * 検証に失敗した場合は 1 度だけ取り直す（途中で切れた・プロキシが壊した場合に効く）。
 */
export async function downloadToCache(options: DownloadOptions): Promise<DownloadResult> {
  const { url, cache, sha256, size, skipIntegrityCheck = false, log } = options;
  const filePath = path.join(cache.downloads, cacheFileNameFor(url));

  const marker = readMarker(filePath);
  if (marker) {
    const matchesExpectation =
      (size == null || marker.size === size) &&
      (skipIntegrityCheck || sha256 == null || marker.sha256 === sha256);
    if (matchesExpectation) {
      return { filePath, size: marker.size, sha256: marker.sha256, cached: true };
    }
    // 期待値が変わった（バージョンを上げた等）ので取り直す。
    fs.rmSync(markerPathFor(filePath), { force: true });
    fs.rmSync(filePath, { force: true });
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    log?.(`downloading ${url}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
    const actual = await fetchToFile(url, filePath);
    try {
      verify(actual, { sha256, size }, url, skipIntegrityCheck);
      writeMarker(filePath, actual.sha256);
      log?.(`downloaded ${path.basename(new URL(url).pathname)} (${formatBytes(actual.size)})`);
      return { filePath, size: actual.size, sha256: actual.sha256, cached: false };
    } catch (error) {
      lastError = error;
      fs.rmSync(filePath, { force: true });
    }
  }
  throw lastError;
}
