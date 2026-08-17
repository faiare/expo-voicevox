import { createRunOncePlugin, type ConfigPlugin } from 'expo/config-plugins';

import { withVoicevoxAndroid } from './android/withVoicevoxAndroid';
import { printTerms } from './core/terms';
import { withVoicevoxIos } from './ios/withVoicevoxIos';
import { resolveProps } from './resolveProps';
import type { ExpoVoicevoxPluginProps, ResolvedVoicevoxProps } from './types';
import { compareVvmName, formatBytes, isSongOnlyFile } from './vvm/resolveVoices';

const pkg = require('../../package.json') as { name: string; version: string };

/**
 * Google Play の配信サイズが気になり始めるおおよその閾値。
 * jniLibs(約 46MB) と辞書(圧縮後 約 22MB) を足すと 200MB 上限に近づくため。
 */
const ANDROID_BUNDLE_WARNING_BYTES = 100 * 1024 * 1024;

/** 解決結果を prebuild のログに出す。何 MB 取り込むのかを利用者に見せるため。 */
export function describeSelection(props: ResolvedVoicevoxProps): string {
  const lines: string[] = [];

  if (props.voiceModels.length === 0) {
    lines.push('voice models: none (expecting explicit paths passed to initialize())');
  } else {
    const total = props.voiceModels.reduce((sum, model) => sum + (model.size ?? 0), 0);
    const unknown = props.voiceModels.some((model) => model.size == null);
    lines.push(
      `voice models: ${props.voiceModels.length} file(s), ${unknown ? 'unknown size' : formatBytes(total)}`
    );
    for (const model of [...props.voiceModels].sort((a, b) =>
      compareVvmName(a.fileName, b.fileName)
    )) {
      const by = model.requestedBy.length > 0 ? model.requestedBy.join(', ') : '(named directly)';
      lines.push(`  ${model.fileName}  ${formatBytes(model.size)}  ${by}`);
    }
  }

  if (props.openJtalkDictionary) {
    lines.push(`OpenJTalk dictionary: ${props.versions.openJtalkDictDirName}`);
  }

  lines.push(
    `asset source: ${
      props.assetSource === 'bundle'
        ? 'bundle (embedded in the app)'
        : 'download (fetched on first launch)'
    }`
  );

  return lines.join('\n');
}

/** 設定として不正ではないが、そのままだと困りそうな点を集める。 */
export function collectWarnings(props: ResolvedVoicevoxProps): string[] {
  const warnings: string[] = [];

  for (const model of props.voiceModels) {
    if (isSongOnlyFile(model.fileName)) {
      warnings.push(
        `${model.fileName} only contains singing voices. expo-voicevox does not expose the ` +
          `singing synthesis API, so bundling it adds ${formatBytes(model.size)} that cannot be used.`
      );
    }
  }

  const total = props.voiceModels.reduce((sum, model) => sum + (model.size ?? 0), 0);
  if (props.assetSource === 'bundle' && total > ANDROID_BUNDLE_WARNING_BYTES) {
    warnings.push(
      `voice models total ${formatBytes(total)}. Together with the native libraries and the ` +
        "dictionary this approaches Google Play's 200MB delivery limit. " +
        'Consider assetSource: "download" for production builds.'
    );
  }

  return warnings;
}

/** 利用規約の告知をプロセス内で 1 回に絞るためのフラグ。 */
let termsPrinted = false;

const withVoicevox: ConfigPlugin<ExpoVoicevoxPluginProps | void> = (config, props) => {
  const resolved = resolveProps(props ?? {});

  for (const line of describeSelection(resolved).split('\n')) {
    console.log(`expo-voicevox: ${line}`);
  }
  for (const warning of collectWarnings(resolved)) {
    console.warn(`expo-voicevox: warning: ${warning}`);
  }
  // 音声モデルを同梱しない設定なら、クレジット表記の義務も発生しないので出さない。
  //
  // prebuild は設定を複数回解決する（platform ごと、--clean の前後）ので、
  // `createRunOncePlugin` だけでは 11 行の告知が何度も流れる。プロセス内で 1 回に絞る。
  if (resolved.voiceModels.length > 0 && !termsPrinted) {
    termsPrinted = true;
    printTerms((line) => console.log(`expo-voicevox: ${line}`));
  }

  config = withVoicevoxIos(config, resolved);
  config = withVoicevoxAndroid(config, resolved);
  return config;
};

export default createRunOncePlugin(withVoicevox, pkg.name, pkg.version);
