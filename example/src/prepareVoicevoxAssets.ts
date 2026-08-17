import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * voicevox-core は音声モデルも辞書も「ファイルパス」で読むため、バンドルされたアセットを
 * 一度ファイルシステムへ展開する必要がある。
 *
 * Metro は動的な require を解決できないので、必要なファイルをここで静的に列挙している。
 * OpenJTalk 辞書のうち実行時に読まれるのは sys.dic / unk.dic / matrix.bin / char.bin だが、
 * 配布物と同じ内容にしておくため .def と COPYING も含める。
 */
const VOICE_MODEL_ASSETS = {
  '0.vvm': require('../assets/voicevox/0.vvm'),
};

const DICT_ASSETS = {
  'sys.dic': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/sys.dic'),
  'unk.dic': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/unk.dic'),
  'matrix.bin': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/matrix.bin'),
  'char.bin': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/char.bin'),
  'left-id.def': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/left-id.def'),
  'right-id.def': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/right-id.def'),
  'pos-id.def': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/pos-id.def'),
  'rewrite.def': require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/rewrite.def'),
  // Metro が拡張子なしのファイルを扱えないため、セットアップスクリプトが .txt を付けている。
  // voicevox-core は読まないが、配布物と同じ構成にするため元の名前で書き戻す。
  COPYING: require('../assets/voicevox/open_jtalk_dic_utf_8-1.11/COPYING.txt'),
};

const ROOT_DIR_NAME = 'voicevox';
const DICT_DIR_NAME = 'open_jtalk_dic_utf_8-1.11';

export type PreparedVoicevoxAssets = {
  openJtalkDictDir: string;
  voiceModelPaths: string[];
};

export type PrepareProgress = {
  /** 展開が終わったファイル数。 */
  completed: number;
  /** 展開対象のファイル総数。 */
  total: number;
  /** いま処理しているファイル名。 */
  current: string;
};

/**
 * バンドルされた音声モデルと辞書をドキュメントディレクトリへ展開し、
 * `initialize()` に渡せる絶対パスを返す。
 *
 * 合計で 160MB 前後あるので初回はそれなりに時間がかかる。
 * 2 回目以降はサイズが一致していればコピーをスキップする。
 */
export async function prepareVoicevoxAssets(
  onProgress?: (progress: PrepareProgress) => void
): Promise<PreparedVoicevoxAssets> {
  const rootDir = new Directory(Paths.document, ROOT_DIR_NAME);
  if (!rootDir.exists) {
    rootDir.create({ intermediates: true });
  }

  const dictDir = new Directory(rootDir, DICT_DIR_NAME);
  if (!dictDir.exists) {
    dictDir.create({ intermediates: true });
  }

  const jobs: { name: string; module: number; directory: Directory }[] = [
    ...Object.entries(VOICE_MODEL_ASSETS).map(([name, module]) => ({
      name,
      module,
      directory: rootDir,
    })),
    ...Object.entries(DICT_ASSETS).map(([name, module]) => ({
      name,
      module,
      directory: dictDir,
    })),
  ];

  let completed = 0;
  for (const job of jobs) {
    onProgress?.({ completed, total: jobs.length, current: job.name });
    await copyAssetIfNeeded(job.module, job.directory, job.name);
    completed += 1;
  }
  onProgress?.({ completed, total: jobs.length, current: '完了' });

  return {
    openJtalkDictDir: toFileSystemPath(dictDir.uri),
    voiceModelPaths: Object.keys(VOICE_MODEL_ASSETS).map((name) =>
      toFileSystemPath(new File(rootDir, name).uri)
    ),
  };
}

async function copyAssetIfNeeded(module: number, directory: Directory, name: string): Promise<void> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();

  if (!asset.localUri) {
    throw new Error(`アセットを取得できませんでした: ${name}`);
  }

  const source = new File(asset.localUri);
  const destination = new File(directory, name);

  // 同じサイズで既にあるならコピーし直さない（辞書は 100MB 近くあるため）。
  if (destination.exists && destination.size === source.size) {
    return;
  }
  if (destination.exists) {
    destination.delete();
  }
  await source.copy(destination);
}

/** voicevox-core は `file://` ではなく素のパスを受け取るので、スキームを外す。 */
function toFileSystemPath(uri: string): string {
  const path = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  return path.endsWith('/') ? path.slice(0, -1) : path;
}
