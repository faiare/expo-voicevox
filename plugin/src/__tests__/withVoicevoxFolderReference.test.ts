/**
 * フォルダ参照の追加を実 pbxproj で検証する。
 *
 * `fixtures/project.pbxproj` は example を `npx expo prebuild` して得たものから
 * plugin が足す 4 行を取り除いたもの（＝ plugin 適用前の状態）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { withVoicevoxFolderReference } from '../ios/withVoicevoxFolderReference';

const xcode = require('xcode');

const FIXTURE = path.join(__dirname, 'fixtures', 'project.pbxproj');

type AnyConfig = Record<string, any>;

/**
 * mod を組み立てて指定回数適用し、書き出した pbxproj を返す。
 *
 * `withMod` が包む action は非同期で、最後に `modRequest.nextMod` を呼ぶ。
 * 実際の prebuild では mod コンパイラがこれを渡すので、テストでは恒等関数を入れる。
 */
async function apply(times = 1): Promise<{ text: string; project: any }> {
  const project = xcode.project(FIXTURE);
  project.parseSync();

  let config: AnyConfig = { name: 'expovoicevoxexample', slug: 'expovoicevoxexample' };
  config = withVoicevoxFolderReference(config as any) as AnyConfig;
  const action = config.mods.ios.xcodeproj;

  let current: AnyConfig = {
    ...config,
    modResults: project,
    modRequest: { nextMod: (value: AnyConfig) => value },
  };
  for (let i = 0; i < times; i += 1) {
    current = await action(current);
  }

  return { text: current.modResults.writeSync(), project: current.modResults };
}

describe('withVoicevoxFolderReference', () => {
  it('フィクスチャには適用前の状態が入っている', () => {
    const text = fs.readFileSync(FIXTURE, 'utf8');
    expect(text).not.toMatch(/\/\* voicevox \*\//);
    expect(text).not.toMatch(/voicevox in Resources/);
  });

  it('lastKnownFileType = folder の PBXFileReference を追加する', async () => {
    const { text } = await apply();

    expect(text).toMatch(/lastKnownFileType = folder;/);
    expect(text).toMatch(/path = voicevox;/);
    // Xcode のインデックス対象から外している（中身が 170MB を超えるため）。
    expect(text).toMatch(
      /includeInIndex = 0;[\s\S]*?path = voicevox;|path = voicevox;[\s\S]*?includeInIndex = 0;/
    );
  });

  it('アプリターゲットの Resources ビルドフェーズへ入れる', async () => {
    const { text, project } = await apply();

    expect(text).toMatch(/voicevox in Resources/);

    const target = project.getTarget('com.apple.product-type.application');
    const files = project.pbxResourcesBuildPhaseObj(target.uuid).files;
    expect(files.filter((file: any) => file.comment === 'voicevox in Resources')).toHaveLength(1);
  });

  it('メイングループの children に入る', async () => {
    const { project } = await apply();

    const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
    const children = project.getPBXGroupByKey(mainGroupKey).children;
    expect(children.filter((child: any) => child.comment === 'voicevox')).toHaveLength(1);
  });

  it('pbxproj に undefined を書き込まない', async () => {
    // `new pbxFile()` を経由すると fileEncoding が undefined のまま出力されてしまう。
    // その回避を続けているかの回帰テスト。
    const { text } = await apply();

    expect(text).not.toMatch(/= undefined;/);
  });

  it('2 回適用しても増えない', async () => {
    // UUID は毎回ランダムなので文字列そのものは比べられない。件数で確認する。
    const once = await apply(1);
    const twice = await apply(2);

    const counts = ({ text, project }: { text: string; project: any }) => {
      const target = project.getTarget('com.apple.product-type.application');
      const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
      return {
        buildPhase: project
          .pbxResourcesBuildPhaseObj(target.uuid)
          .files.filter((file: any) => file.comment === 'voicevox in Resources').length,
        groupChildren: project
          .getPBXGroupByKey(mainGroupKey)
          .children.filter((child: any) => child.comment === 'voicevox').length,
        fileReferences: (text.match(/lastKnownFileType = folder;/g) ?? []).length,
      };
    };

    expect(counts(twice)).toEqual(counts(once));
    expect(counts(once)).toEqual({ buildPhase: 1, groupChildren: 1, fileReferences: 1 });
  });
});
