#!/usr/bin/env node
/**
 * npm の `expo` が、このリポジトリの追随しているメジャーより新しいメジャーを出していないか調べる。
 *
 * Expo の SDK メジャーが上がるたびに Expo Modules API・react-native・新アーキ周りの追随作業が
 * 発生するが、それに気付く経路がこれまで人の記憶しか無かった。`.github/workflows/expo-major-watch.yml`
 * から週次で呼ばれ、上がっていれば作業チケットとしての issue が 1 本立つ。
 *
 * 「現在のバージョン」は `package.json` の devDependencies.expo だけを見る。別の場所に控えを
 * 置くと追随したあとも鳴り続けるので、判定の元は 1 か所に寄せてある。
 *
 * 使い方:
 *   npm run check:expo-major                          # 実際の npm を見る
 *   EXPO_LATEST_OVERRIDE=58.0.0 npm run check:expo-major   # メジャーが上がった状況を再現する
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = path.join(ROOT, 'package.json');

/**
 * 単一バージョンの manifest だけを取る。フルの packument（https://registry.npmjs.org/expo）は
 * 950 バージョン分を超える JSON なので、latest を知りたいだけの用途では使わない。
 */
const LATEST_URL = 'https://registry.npmjs.org/expo/latest';

/** `1.2.3`（プレリリース・ビルドメタデータ無し）だけを安定版と見なす。 */
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;

/** `^57.0.13` や `~57.0.13` からメジャーだけを取り出す。semver は依存に無いので自前で読む。 */
function parseMajor(spec, label) {
  const match = /^\s*[\^~>=<v\s]*(\d+)\./.exec(spec);
  if (!match) {
    throw new Error(`${label} からメジャーバージョンを読み取れませんでした: ${spec}`);
  }
  return Number(match[1]);
}

async function fetchLatestVersion() {
  const response = await fetch(LATEST_URL, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`fetch failed (${response.status} ${response.statusText}): ${LATEST_URL}`);
  }
  const manifest = await response.json();
  if (typeof manifest.version !== 'string') {
    throw new Error(`npm のレスポンスに version がありません: ${LATEST_URL}`);
  }
  return manifest.version;
}

/** GitHub Actions のステップ出力に流す。ローカル実行では GITHUB_OUTPUT が無いので何もしない。 */
function writeStepOutputs(outputs) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) {
    return;
  }
  const lines = Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}\n`)
    .join('');
  fs.appendFileSync(file, lines);
}

async function main() {
  const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'));
  const range = pkg.devDependencies?.expo;
  if (!range) {
    throw new Error('package.json の devDependencies.expo が見つかりません。');
  }
  const currentMajor = parseMajor(range, 'package.json の devDependencies.expo');

  const override = process.env.EXPO_LATEST_OVERRIDE?.trim();
  const latestVersion = override || (await fetchLatestVersion());

  process.stdout.write(`current: ${currentMajor} (devDependencies.expo = ${range})\n`);
  process.stdout.write(`latest:  ${latestVersion}${override ? ' (EXPO_LATEST_OVERRIDE)' : ''}\n`);

  // latest dist-tag は安定版を指す（プレリリースは next / canary 側）が、上流の運用が変わって
  // 57.0.0-canary-... のような値が来たときに issue を立てないよう明示的に弾く。
  if (!STABLE_VERSION.test(latestVersion)) {
    process.stdout.write('安定版ではないので何もしません。\n');
    writeStepOutputs({ needs_issue: 'false' });
    return;
  }

  const latestMajor = parseMajor(latestVersion, 'npm の expo@latest');
  const needsIssue = latestMajor > currentMajor;

  process.stdout.write(
    needsIssue
      ? `Expo SDK ${latestMajor} が出ています（追随しているのは ${currentMajor}）。\n`
      : `追随済みです（issue は作りません）。\n`
  );

  writeStepOutputs({
    needs_issue: String(needsIssue),
    current_major: String(currentMajor),
    latest_major: String(latestMajor),
    latest_version: latestVersion,
  });
}

main().catch((error) => {
  process.stderr.write(`\nFailed to check the latest Expo major: ${error.message}\n`);
  process.exitCode = 1;
});
