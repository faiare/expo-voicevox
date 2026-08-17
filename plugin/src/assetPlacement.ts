/**
 * キャッシュにあるアセットをネイティブプロジェクトへ配置する。
 *
 * iOS と Android で置き場所は違うが、
 * 「マニフェスト + ファイル一式を 1 つのディレクトリへ揃える」処理は同じなのでここに集約する。
 *
 * 差分チェックはしない。`expo prebuild` は毎回ネイティブディレクトリを作り直す
 * （ログの "Cleared ios code"）ので、前回の配置は残っておらず比較する意味が無いため。
 * コピーは `COPYFILE_FICLONE` 経由なので APFS では copy-on-write クローンになり、
 * 173MB でも実データのコピーは発生しない。
 */
import fs from 'node:fs';
import path from 'node:path';

import { VOICEVOX_MANIFEST_FILE } from './constants';
import { copyTree, ensureDir, rmrf } from './core/fsUtils';

export type PlacementEntry = {
  /** 配置先での名前。ファイルでもディレクトリでもよい。 */
  name: string;
  /** キャッシュ上の絶対パス。 */
  sourcePath: string;
};

export type PlacementOptions = {
  /** アセットを揃えるディレクトリ。中身は毎回この関数が作り直す。 */
  targetDir: string;
  entries: PlacementEntry[];
  /** `voicevox-manifest.json` として書き込む内容。 */
  manifest: string;
  log?: (message: string) => void;
};

export function placeAssets(options: PlacementOptions): void {
  const { targetDir, entries, manifest, log } = options;

  rmrf(targetDir);
  ensureDir(targetDir);
  for (const entry of entries) {
    copyTree(entry.sourcePath, path.join(targetDir, entry.name));
  }
  fs.writeFileSync(path.join(targetDir, VOICEVOX_MANIFEST_FILE), manifest, 'utf8');

  log?.(`placed ${entries.length} asset(s) in ${targetDir}`);
}
