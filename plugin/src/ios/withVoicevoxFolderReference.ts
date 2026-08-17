/**
 * `ios/voicevox/` をフォルダ参照（Xcode の青フォルダ）として Copy Bundle Resources に登録する。
 *
 * ふつうのリソース追加だとファイルが `.app` 直下へ平坦に展開されてしまい、
 * `open_jtalk_dic_utf_8-1.11/` のディレクトリ構造が保てない。
 * `lastKnownFileType = folder` の PBXFileReference はディレクトリごと再帰コピーされる。
 *
 * 既存 API を使わず pbxproj を直接組み立てている理由:
 * - `IOSConfig.XcodeUtils.addResourceFileToGroup()` は `lastKnownFileType` を渡せない
 *   （内部の `createProjectFileForGroup` が `new pbxFile(filepath)` を opt なしで呼ぶ）。
 * - `xcode` の `project.addResourceFile(path, { lastKnownFileType: 'folder' })` は
 *   `correctForResourcesPath` が `pbxGroupByName('Resources').path` を触るが、
 *   Expo テンプレートの pbxproj に `Resources` という PBXGroup は無いので TypeError になる。
 * - `new pbxFile()` を経由すると `pbxFileReferenceObj` が `fileEncoding` を常に含め、
 *   writer の既定（`omitEmptyValues=false`）のせいで `fileEncoding = undefined;` という
 *   壊れた行が pbxproj に書き込まれる。
 *
 * 追加先はプロジェクトのメイングループにしている。アプリのグループ（`name = <ProjectName>`）は
 * ExpoModulesProviders 側にも同名のものがあり `findPBXGroupKey({ name })` で一意に選べないため。
 * メイングループは `path` を持たないので `path: 'voicevox'` は `ios/voicevox` を指す。
 */
import { withXcodeProject, type ConfigPlugin } from 'expo/config-plugins';

import { VOICEVOX_RESOURCE_DIR } from '../constants';
import { VoicevoxPluginError } from '../errors';

const BUILD_PHASE_COMMENT = `${VOICEVOX_RESOURCE_DIR} in Resources`;

export const withVoicevoxFolderReference: ConfigPlugin = (config) =>
  withXcodeProject(config, (config) => {
    const project = config.modResults;

    // `expo prebuild` を --clean 無しで繰り返しても二重登録しない。
    if (project.hasFile(VOICEVOX_RESOURCE_DIR)) {
      return config;
    }

    const target = project.getTarget('com.apple.product-type.application');
    if (!target) {
      throw new VoicevoxPluginError('could not find the application target in the Xcode project.');
    }

    const fileRef = project.generateUuid();
    const buildFile = project.generateUuid();

    const references = project.pbxFileReferenceSection();
    references[fileRef] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'folder',
      path: VOICEVOX_RESOURCE_DIR,
      sourceTree: '"<group>"',
      // 中身は 170MB を超えることがあるので Xcode のインデックス対象から外す。
      includeInIndex: 0,
    };
    references[`${fileRef}_comment`] = VOICEVOX_RESOURCE_DIR;

    const buildFiles = project.pbxBuildFileSection();
    buildFiles[buildFile] = {
      isa: 'PBXBuildFile',
      fileRef,
      fileRef_comment: VOICEVOX_RESOURCE_DIR,
    };
    buildFiles[`${buildFile}_comment`] = BUILD_PHASE_COMMENT;

    project
      .pbxResourcesBuildPhaseObj(target.uuid)
      .files.push({ value: buildFile, comment: BUILD_PHASE_COMMENT });

    project.addToPbxGroup(
      { fileRef, basename: VOICEVOX_RESOURCE_DIR },
      project.getFirstProject().firstProject.mainGroup
    );

    return config;
  });
