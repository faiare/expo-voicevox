/**
 * ファイル操作の共通処理。
 * `scripts/fetch-voicevox-core.mjs` にあったものをここへ移し、config plugin と共用する。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function exists(target: string): boolean {
  return fs.existsSync(target);
}

export function rmrf(target: string): void {
  fs.rmSync(target, { recursive: true, force: true });
}

export function ensureDir(target: string): void {
  fs.mkdirSync(target, { recursive: true });
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) {
    return 'unknown size';
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function run(command: string, args: string[]): void {
  execFileSync(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
}

function hasCommand(command: string): boolean {
  try {
    execFileSync('command', ['-v', command], { stdio: 'ignore', shell: '/bin/sh' });
    return true;
  } catch {
    return false;
  }
}

/**
 * zip を展開する。
 *
 * `unzip` は macOS と多くの Linux にあるが、Windows やスリムなコンテナには無い。
 * bsdtar（Windows 10 以降の `tar` もこれ）は zip を読めるのでフォールバックにする。
 */
export function unzip(archivePath: string, destinationDir: string): void {
  ensureDir(destinationDir);
  if (hasCommand('unzip')) {
    run('unzip', ['-q', '-o', archivePath, '-d', destinationDir]);
    return;
  }
  run('tar', ['-xf', archivePath, '-C', destinationDir]);
}

export function untar(archivePath: string, destinationDir: string): void {
  ensureDir(destinationDir);
  run('tar', ['xzf', archivePath, '-C', destinationDir]);
}

/**
 * 展開先のディレクトリの中から、名前が一致する最初のエントリを再帰的に探す。
 * 配布物によってはトップレベルにバージョン付きのディレクトリが 1 段挟まるため。
 */
export function findEntry(searchRoot: string, name: string): string | null {
  const stack = [searchRoot];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.name === name) {
        return entryPath;
      }
      if (entry.isDirectory()) {
        stack.push(entryPath);
      }
    }
  }
  return null;
}

/**
 * ディレクトリを丸ごとコピーする。
 *
 * `COPYFILE_FICLONE` を渡すと APFS / Btrfs では copy-on-write クローンになり、
 * 173MB のアセットを `expo prebuild --clean` のたびに実コピーせずに済む。
 * 対応していないファイルシステムでは通常のコピーに自動でフォールバックする
 * （`COPYFILE_FICLONE_FORCE` だと失敗してしまうので使わない）。
 */
export function copyTree(source: string, destination: string): void {
  fs.cpSync(source, destination, {
    recursive: true,
    mode: fs.constants.COPYFILE_FICLONE,
  });
}

export function copyFile(source: string, destination: string): void {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_FICLONE);
}

export async function withTempDir<T>(fn: (tempDir: string) => Promise<T> | T): Promise<T> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-voicevox-'));
  try {
    return await fn(tempDir);
  } finally {
    rmrf(tempDir);
  }
}

/** ディレクトリ内の全ファイルを、ディレクトリからの相対パスで列挙する。 */
export function listFilesRecursively(root: string): string[] {
  const results: string[] = [];
  const walk = (current: string, prefix: string) => {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(current, entry.name), relative);
      } else if (entry.isFile()) {
        results.push(relative);
      }
    }
  };
  walk(root, '');
  return results;
}
