#!/usr/bin/env node
/**
 * voicevox-core のネイティブバイナリ・音声モデル・辞書を取得して配置する。
 *
 * リポジトリにはコミットせず（.gitignore 済み）、開発者が各自 `npm run setup:voicevox` で用意する。
 *
 * 配置先:
 *   ios/Frameworks/voicevox_core.xcframework
 *   ios/Frameworks/voicevox_onnxruntime.xcframework
 *   android/vendor/maven/jp/hiroshiba/voicevoxcore/...        (ローカル Maven リポジトリ)
 *   android/src/main/jniLibs/{arm64-v8a,x86_64}/libvoicevox_onnxruntime.so
 *   example/assets/voicevox/0.vvm
 *   example/assets/voicevox/open_jtalk_dic_utf_8-1.11/
 *
 * macOS / Linux 前提（unzip と tar を使う）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// バージョン
// ---------------------------------------------------------------------------

/** voicevox_core 本体。C API / xcframework / java_packages.zip の出どころ。 */
const CORE_VERSION = '0.17.0';

/**
 * VOICEVOX ONNX Runtime。iOS と Android で使うバージョンが違う。
 *
 * iOS は 1.17.3 でなければならない。voicevox_core 0.17.0 の iOS バイナリは
 * `@rpath/voicevox_onnxruntime.framework` を compatibility version 1.17.3 で要求するが、
 * 1.23.2 の framework は LC_ID_DYLIB の compatibility version が 0.0.0 なので dyld に弾かれる。
 */
const ORT_VERSION_IOS = '1.17.3';

/**
 * Android は 1.23.2（voicevox_core 0.17.0 の推奨バージョン）。
 *
 * `load-onnxruntime` 方式でファイル名（バージョン無し）を dlopen するだけなので、
 * リンク時のバージョン一致は不要（core が受け付けるマイナーバージョンは 17 以上 29 以下）。
 *
 * 1.17.3 は LOAD セグメントの p_align が 4KB のままで、Android 15 以降の 16KB ページサイズ端末で
 * ページサイズ互換モードに落ちる。1.23.2 は 16KB アラインでビルドされている。
 */
const ORT_VERSION_ANDROID = '1.23.2';

/** 音声モデル（VVM）。 */
const VVM_VERSION = '0.17.0';

/** OpenJTalk のシステム辞書。 */
const OPEN_JTALK_DIC_TAG = 'v1.11.1';
const OPEN_JTALK_DIC_DIR_NAME = 'open_jtalk_dic_utf_8-1.11';

const CORE_RELEASE = `https://github.com/VOICEVOX/voicevox_core/releases/download/${CORE_VERSION}`;
const ortRelease = (version) =>
  `https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-${version}`;
const VVM_RELEASE = `https://github.com/VOICEVOX/voicevox_vvm/releases/download/${VVM_VERSION}`;
const OPEN_JTALK_RELEASE = `https://github.com/r9y9/open_jtalk/releases/download/${OPEN_JTALK_DIC_TAG}`;

// ---------------------------------------------------------------------------
// 配置先
// ---------------------------------------------------------------------------

const IOS_FRAMEWORKS_DIR = path.join(ROOT, 'ios', 'Frameworks');
const ANDROID_LIBS_DIR = path.join(ROOT, 'android', 'libs');
const ANDROID_JNI_LIBS_DIR = path.join(ROOT, 'android', 'src', 'main', 'jniLibs');
const EXAMPLE_ASSETS_DIR = path.join(ROOT, 'example', 'assets', 'voicevox');

const ANDROID_JAR_NAME = `voicevoxcore-android-${CORE_VERSION}.jar`;

/** Android の ABI 名 -> ONNX Runtime のアセット名に使われる表記。 */
const ANDROID_ABIS = {
  'arm64-v8a': 'arm64',
  x86_64: 'x64',
};

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------

const FORCE = process.argv.includes('--force');

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function exists(targetPath) {
  return fs.existsSync(targetPath);
}

function rmrf(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 配置済みならスキップしてよいかを判定する。--force が指定されていれば常に再取得する。
 */
function shouldSkip(targetPath, label) {
  if (FORCE) {
    return false;
  }
  if (exists(targetPath)) {
    log(`  skip: ${label} は配置済み (${path.relative(ROOT, targetPath)})`);
    return true;
  }
  return false;
}

async function download(url, destination) {
  log(`  取得中: ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`ダウンロードに失敗しました (${response.status} ${response.statusText}): ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, buffer);
  log(`  取得完了: ${path.basename(destination)} (${formatBytes(buffer.length)})`);
  return destination;
}

function unzip(archivePath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  run('unzip', ['-q', '-o', archivePath, '-d', destinationDir]);
}

function untar(archivePath, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  run('tar', ['xzf', archivePath, '-C', destinationDir]);
}

/**
 * 展開先のディレクトリの中から、名前が一致する最初のエントリを再帰的に探す。
 * 配布物によってはトップレベルにバージョン付きのディレクトリが1段挟まるため。
 */
function findEntry(searchRoot, name) {
  const stack = [searchRoot];
  while (stack.length > 0) {
    const current = stack.pop();
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
 * xcframework 内の CFBundleIdentifier からアンダースコアを取り除く。
 *
 * voicevox_onnxruntime の framework は `jp.hiroshiba.voicevox.voicevox_onnxruntime` を名乗っているが、
 * Apple のバンドル識別子には英数字・ハイフン・ピリオドしか使えないため、Xcode の署名段階で
 * "had an invalid CFBundleIdentifier in its Info.plist" となってビルドが失敗する。
 * dylib は @rpath のパスで解決されるので、識別子を変えても実行には影響しない。
 */
function sanitizeBundleIdentifiers(xcframeworkPath) {
  const stack = [xcframeworkPath];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.name !== 'Info.plist') {
        continue;
      }
      let identifier;
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
      run('plutil', ['-replace', 'CFBundleIdentifier', '-string', sanitized, entryPath], {
        stdio: 'ignore',
      });
      log(`  CFBundleIdentifier を修正: ${identifier} -> ${sanitized}`);
    }
  }
}

function withTempDir(fn) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expo-voicevox-setup-'));
  try {
    return fn(tempDir);
  } finally {
    rmrf(tempDir);
  }
}

// ---------------------------------------------------------------------------
// 各ステップ
// ---------------------------------------------------------------------------

/** iOS: voicevox_core.xcframework */
async function setupIosCore() {
  const target = path.join(IOS_FRAMEWORKS_DIR, 'voicevox_core.xcframework');
  if (shouldSkip(target, 'voicevox_core.xcframework')) {
    return;
  }
  await withTempDir(async (tempDir) => {
    const archive = await download(
      `${CORE_RELEASE}/voicevox_core-xcframework-${CORE_VERSION}.zip`,
      path.join(tempDir, 'core.zip')
    );
    unzip(archive, tempDir);
    const extracted = findEntry(tempDir, 'voicevox_core.xcframework');
    if (!extracted) {
      throw new Error('voicevox_core.xcframework が展開結果に見つかりません');
    }
    rmrf(target);
    fs.mkdirSync(IOS_FRAMEWORKS_DIR, { recursive: true });
    fs.cpSync(extracted, target, { recursive: true });
  });
  sanitizeBundleIdentifiers(target);
  log(`  配置: ${path.relative(ROOT, target)}`);
}

/** iOS: voicevox_onnxruntime.xcframework */
async function setupIosOnnxruntime() {
  const target = path.join(IOS_FRAMEWORKS_DIR, 'voicevox_onnxruntime.xcframework');
  if (shouldSkip(target, 'voicevox_onnxruntime.xcframework')) {
    return;
  }
  await withTempDir(async (tempDir) => {
    const archive = await download(
      `${ortRelease(ORT_VERSION_IOS)}/voicevox_onnxruntime-ios-xcframework-${ORT_VERSION_IOS}.zip`,
      path.join(tempDir, 'ort.zip')
    );
    unzip(archive, tempDir);
    const extracted = findEntry(tempDir, 'voicevox_onnxruntime.xcframework');
    if (!extracted) {
      throw new Error('voicevox_onnxruntime.xcframework が展開結果に見つかりません');
    }
    rmrf(target);
    fs.mkdirSync(IOS_FRAMEWORKS_DIR, { recursive: true });
    fs.cpSync(extracted, target, { recursive: true });
  });
  sanitizeBundleIdentifiers(target);
  log(`  配置: ${path.relative(ROOT, target)}`);
}

/**
 * Android: 公式 Java API の AAR を展開して jar と JNI ライブラリを取り込む。
 *
 * voicevoxcore-android は Maven Central へ公開されていない（VOICEVOX/voicevox_core#651）。
 * ローカル Maven リポジトリとして参照すると、このモジュールのビルドは通るものの
 * アプリ側の runtime classpath 解決でリポジトリが見えず
 * "Could not find jp.hiroshiba.voicevoxcore:voicevoxcore-android" になる。
 * AAR の中身は classes.jar と jni/ だけ（リソースなし）なので、展開して直接取り込む。
 *
 * `libc++_shared.so` は React Native が同梱しているのでここでは取り込まない。
 */
async function setupAndroidAar() {
  const jarTarget = path.join(ANDROID_LIBS_DIR, ANDROID_JAR_NAME);
  const jniTargets = Object.keys(ANDROID_ABIS).map((abi) =>
    path.join(ANDROID_JNI_LIBS_DIR, abi, 'libvoicevox_core_java_api.so')
  );
  if (!FORCE && exists(jarTarget) && jniTargets.every(exists)) {
    log('  skip: voicevoxcore-android は配置済み');
    return;
  }

  await withTempDir(async (tempDir) => {
    const archive = await download(
      `${CORE_RELEASE}/java_packages.zip`,
      path.join(tempDir, 'java.zip')
    );
    const extractDir = path.join(tempDir, 'extracted');
    unzip(archive, extractDir);

    const aar = findEntry(extractDir, `voicevoxcore-android-${CORE_VERSION}.aar`);
    if (!aar) {
      throw new Error('java_packages.zip に voicevoxcore-android の AAR が見つかりません');
    }
    const aarDir = path.join(tempDir, 'aar');
    unzip(aar, aarDir);

    rmrf(ANDROID_LIBS_DIR);
    fs.mkdirSync(ANDROID_LIBS_DIR, { recursive: true });
    fs.copyFileSync(path.join(aarDir, 'classes.jar'), jarTarget);

    for (const abi of Object.keys(ANDROID_ABIS)) {
      const source = path.join(aarDir, 'jni', abi, 'libvoicevox_core_java_api.so');
      if (!exists(source)) {
        throw new Error(`AAR に ${abi} の libvoicevox_core_java_api.so がありません`);
      }
      const destination = path.join(ANDROID_JNI_LIBS_DIR, abi, 'libvoicevox_core_java_api.so');
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    }
  });
  log(`  配置: ${path.relative(ROOT, jarTarget)}`);
  log(`  配置: ${path.relative(ROOT, ANDROID_JNI_LIBS_DIR)}/<abi>/libvoicevox_core_java_api.so`);
}

/** Android: ONNX Runtime の .so を jniLibs へ */
async function setupAndroidOnnxruntime() {
  for (const [abi, assetArch] of Object.entries(ANDROID_ABIS)) {
    const target = path.join(ANDROID_JNI_LIBS_DIR, abi, 'libvoicevox_onnxruntime.so');
    if (shouldSkip(target, `libvoicevox_onnxruntime.so (${abi})`)) {
      continue;
    }
    await withTempDir(async (tempDir) => {
      const archive = await download(
        `${ortRelease(ORT_VERSION_ANDROID)}/voicevox_onnxruntime-android-${assetArch}-${ORT_VERSION_ANDROID}.tgz`,
        path.join(tempDir, 'ort.tgz')
      );
      untar(archive, tempDir);
      const extracted = findEntry(tempDir, 'libvoicevox_onnxruntime.so');
      if (!extracted) {
        throw new Error(`libvoicevox_onnxruntime.so が展開結果に見つかりません (${abi})`);
      }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(extracted, target);
    });
    log(`  配置: ${path.relative(ROOT, target)}`);
  }
}

/** example: 音声モデル 0.vvm と利用規約 */
async function setupVoiceModel() {
  const target = path.join(EXAMPLE_ASSETS_DIR, '0.vvm');
  if (!shouldSkip(target, '0.vvm')) {
    await download(`${VVM_RELEASE}/0.vvm`, target);
  }
  for (const name of ['TERMS.txt', 'README.txt']) {
    const termsTarget = path.join(EXAMPLE_ASSETS_DIR, `vvm-${name}`);
    if (!shouldSkip(termsTarget, `音声モデルの ${name}`)) {
      await download(`${VVM_RELEASE}/${name}`, termsTarget);
    }
  }
}

/**
 * example: OpenJTalk のシステム辞書。
 *
 * ライセンスファイル `COPYING` は拡張子が無く Metro が asset として扱えないため、
 * `COPYING.txt` にリネームして配置する（実行時に `COPYING` へ戻す）。
 */
async function setupOpenJtalkDict() {
  const target = path.join(EXAMPLE_ASSETS_DIR, OPEN_JTALK_DIC_DIR_NAME);
  if (shouldSkip(path.join(target, 'sys.dic'), 'OpenJTalk 辞書')) {
    return;
  }
  await withTempDir(async (tempDir) => {
    const archive = await download(
      `${OPEN_JTALK_RELEASE}/${OPEN_JTALK_DIC_DIR_NAME}.tar.gz`,
      path.join(tempDir, 'dict.tar.gz')
    );
    untar(archive, tempDir);
    const extracted = findEntry(tempDir, OPEN_JTALK_DIC_DIR_NAME);
    if (!extracted) {
      throw new Error('OpenJTalk 辞書のディレクトリが展開結果に見つかりません');
    }
    rmrf(target);
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(extracted, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const destinationName = entry.name === 'COPYING' ? 'COPYING.txt' : entry.name;
      fs.copyFileSync(path.join(extracted, entry.name), path.join(target, destinationName));
    }
  });
  log(`  配置: ${path.relative(ROOT, target)}`);
}

function printTerms() {
  log('');
  log('─'.repeat(72));
  log('利用規約について');
  log('─'.repeat(72));
  log('  voicevox_core 本体          : MIT License');
  log('  VOICEVOX 音声モデル (VVM)   : 独自の利用規約（example/assets/voicevox/vvm-TERMS.txt）');
  log('  VOICEVOX ONNX Runtime       : 独自の利用規約');
  log('  OpenJTalk 辞書              : BSD-3-Clause（著作権表示の再掲が必要）');
  log('');
  log('  音声モデルと ONNX Runtime の規約は、VOICEVOX を利用したことがわかる');
  log('  クレジット表記をアプリ側に入れることを求めています。');
  log('  0.vvm に含まれるキャラクターは 四国めたん / ずんだもん / 春日部つむぎ / 雨晴はう で、');
  log('  いずれも「VOICEVOX:<キャラ名>」のクレジット表記で商用・非商用ともに利用できます。');
  log('─'.repeat(72));
}

// ---------------------------------------------------------------------------

async function main() {
  log(`voicevox_core ${CORE_VERSION} / VVM ${VVM_VERSION} を取得します`);
  log(`ONNX Runtime: iOS ${ORT_VERSION_IOS} / Android ${ORT_VERSION_ANDROID}`);
  if (FORCE) {
    log('(--force: 配置済みのファイルも再取得します)');
  }

  log('\n[1/5] iOS: voicevox_core.xcframework');
  await setupIosCore();

  log('\n[2/5] iOS: voicevox_onnxruntime.xcframework');
  await setupIosOnnxruntime();

  log('\n[3/5] Android: voicevoxcore-android（公式 Java API）');
  await setupAndroidAar();

  log('\n[4/5] Android: libvoicevox_onnxruntime.so');
  await setupAndroidOnnxruntime();

  log('\n[5/5] example: 音声モデルと OpenJTalk 辞書');
  await setupVoiceModel();
  await setupOpenJtalkDict();

  printTerms();
  log('\n完了しました。');
}

main().catch((error) => {
  process.stderr.write(`\nセットアップに失敗しました: ${error.message}\n`);
  process.exitCode = 1;
});
