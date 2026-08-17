/**
 * iOS のネイティブバイナリ（xcframework 2 つ）をパッケージの `ios/Frameworks/` に用意する。
 *
 * config plugin の dangerous mod と `npm run setup:voicevox` の両方から呼ばれる。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { iosArtifactSpecs, lookupArtifact } from './artifacts';
import type { VoicevoxCache } from './cache';
import { downloadToCache } from './download';
import { ensureExtracted } from './extract';
import { copyTree, ensureDir, exists, findEntry, rmrf, unzip } from './fsUtils';
import type { VoicevoxVersions } from '../types';

export type SetupContext = {
  /** `expo-voicevox` パッケージのルート。 */
  packageRoot: string;
  versions: VoicevoxVersions;
  cache: VoicevoxCache;
  skipIntegrityCheck: boolean;
  /** 配置済みでも取り直す。 */
  force?: boolean;
  log?: (message: string) => void;
};

const FRAMEWORK_NAMES = {
  [`core`]: 'voicevox_core.xcframework',
  [`ort`]: 'voicevox_onnxruntime.xcframework',
} as const;

export function iosFrameworksDir(packageRoot: string): string {
  return path.join(packageRoot, 'ios', 'Frameworks');
}

/**
 * xcframework 内の CFBundleIdentifier からアンダースコアを取り除く。
 *
 * voicevox_onnxruntime の framework は `jp.hiroshiba.voicevox.voicevox_onnxruntime` を名乗っているが、
 * Apple のバンドル識別子には英数字・ハイフン・ピリオドしか使えないため、Xcode の署名段階で
 * "had an invalid CFBundleIdentifier in its Info.plist" となってビルドが失敗する。
 * dylib は @rpath のパスで解決されるので、識別子を変えても実行には影響しない。
 *
 * `plutil` は macOS 専用。Linux で prebuild した場合は何もしない（そのままでは Xcode で
 * ビルドできないが、Xcode ビルド自体が macOS でしかできないので実害はない）。
 */
export function sanitizeBundleIdentifiers(
  xcframeworkPath: string,
  log?: (message: string) => void
): void {
  if (process.platform !== 'darwin') {
    return;
  }
  const stack = [xcframeworkPath];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.name !== 'Info.plist') {
        continue;
      }
      let identifier: string;
      try {
        identifier = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', entryPath], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
      } catch {
        // CFBundleIdentifier を持たない Info.plist（xcframework 直下のものなど）。
        continue;
      }
      if (!identifier.includes('_')) {
        continue;
      }
      const sanitized = identifier.replaceAll('_', '-');
      execFileSync('plutil', ['-replace', 'CFBundleIdentifier', '-string', sanitized, entryPath], {
        stdio: 'ignore',
      });
      log?.(`rewrote CFBundleIdentifier: ${identifier} -> ${sanitized}`);
    }
  }
}

/** `ios/Frameworks/` に xcframework 2 つを用意する。配置済みなら何もしない。 */
export async function ensureIosFrameworks(context: SetupContext): Promise<void> {
  const { packageRoot, versions, cache, skipIntegrityCheck, force = false, log } = context;
  const frameworksDir = iosFrameworksDir(packageRoot);
  const specs = iosArtifactSpecs(versions);
  const names = [FRAMEWORK_NAMES.core, FRAMEWORK_NAMES.ort];

  for (const [index, spec] of specs.entries()) {
    const name = names[index];
    const target = path.join(frameworksDir, name);
    if (!force && exists(target)) {
      log?.(`skip: ${name} is already in place`);
      continue;
    }

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
      extract: unzip,
      log,
    });

    const source = findEntry(extracted, name);
    if (!source) {
      throw new Error(`${name} was not found in the extracted ${spec.label}`);
    }

    rmrf(target);
    ensureDir(frameworksDir);
    copyTree(source, target);
    sanitizeBundleIdentifiers(target, log);
    log?.(`placed ios/Frameworks/${name}`);
  }
}
