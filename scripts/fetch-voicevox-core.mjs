#!/usr/bin/env node
/**
 * voicevox-core のネイティブバイナリを取得して、このリポジトリの `ios/` `android/` に配置する。
 *
 * example は `nativeModulesDir: ".."` でリポジトリルートを直接 autolink するため、
 * ローカル開発ではここでバイナリを置いておく必要がある。
 * 利用者側では config plugin が prebuild 時に同じ処理を行うので、この手順は不要。
 *
 * 実処理は `plugin/src/core/` にあり config plugin と共通。バージョンと URL の定義は
 * `plugin/src/core/versions.ts` の 1 か所だけ。
 *
 * 配置先:
 *   ios/Frameworks/voicevox_core.xcframework
 *   ios/Frameworks/voicevox_onnxruntime.xcframework
 *   android/libs/voicevoxcore-android-<version>.jar
 *   android/src/main/jniLibs/<abi>/libvoicevox_core_java_api.so
 *   android/src/main/jniLibs/<abi>/libvoicevox_onnxruntime.so
 *
 * 音声モデルと OpenJTalk 辞書はここでは配置しない。app.json の設定に従って
 * config plugin がアプリのネイティブプロジェクトへ置く。
 *
 * 使い方:
 *   npm run setup:voicevox
 *   npm run setup:voicevox -- --force   # 配置済みでも取り直す
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const BUILD = path.join(ROOT, 'plugin', 'build');
if (!fs.existsSync(path.join(BUILD, 'core', 'setupIos.js'))) {
  throw new Error('plugin/build is missing. Run `npx tsc --build plugin` first.');
}

const { DEFAULT_VERSIONS } = require(path.join(BUILD, 'core', 'versions.js'));
const { ANDROID_ABIS } = require(path.join(BUILD, 'types.js'));
const { createCache } = require(path.join(BUILD, 'core', 'cache.js'));
const { ensureIosFrameworks } = require(path.join(BUILD, 'core', 'setupIos.js'));
const { ensureAndroidJavaApi, ensureAndroidOnnxruntime } = require(
  path.join(BUILD, 'core', 'setupAndroid.js')
);
const { printTerms } = require(path.join(BUILD, 'core', 'terms.js'));

const force = process.argv.includes('--force');
const log = (message) => process.stdout.write(`  ${message}\n`);

async function main() {
  const versions = DEFAULT_VERSIONS;
  process.stdout.write(
    `Fetching voicevox_core ${versions.core}\n` +
      `ONNX Runtime: iOS ${versions.onnxruntime.ios} / Android ${versions.onnxruntime.android}\n`
  );
  if (force) {
    process.stdout.write('(--force: re-fetching even files that are already in place)\n');
  }

  const context = {
    packageRoot: ROOT,
    versions,
    cache: createCache(ROOT, null),
    skipIntegrityCheck: false,
    abis: [...ANDROID_ABIS],
    force,
    log,
  };

  process.stdout.write('\n[1/3] iOS: xcframeworks\n');
  await ensureIosFrameworks(context);

  process.stdout.write('\n[2/3] Android: voicevoxcore-android (official Java API)\n');
  await ensureAndroidJavaApi(context);

  process.stdout.write('\n[3/3] Android: libvoicevox_onnxruntime.so\n');
  await ensureAndroidOnnxruntime(context);

  process.stdout.write('\n');
  printTerms((line) => process.stdout.write(`${line}\n`));
  process.stdout.write('\nDone.\n');
}

main().catch((error) => {
  process.stderr.write(`\nSetup failed: ${error.message}\n`);
  process.exitCode = 1;
});
