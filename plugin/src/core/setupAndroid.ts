/**
 * Android のネイティブバイナリ（Java API の jar と .so）をパッケージの
 * `android/libs/` と `android/src/main/jniLibs/<abi>/` に用意する。
 */
import fs from 'node:fs';
import path from 'node:path';

import { androidArtifactSpecs, lookupArtifact } from './artifacts';
import { downloadToCache } from './download';
import { ensureExtracted } from './extract';
import { copyFile, ensureDir, exists, findEntry, rmrf, untar, unzip } from './fsUtils';
import type { SetupContext } from './setupIos';
import { ANDROID_JAR_NAME } from './versions';
import type { VoicevoxAndroidAbi } from '../types';

export type AndroidSetupContext = SetupContext & { abis: VoicevoxAndroidAbi[] };

export function androidLibsDir(packageRoot: string): string {
  return path.join(packageRoot, 'android', 'libs');
}

export function androidJniLibsDir(packageRoot: string): string {
  return path.join(packageRoot, 'android', 'src', 'main', 'jniLibs');
}

/**
 * 公式 Java API の AAR を展開して jar と JNI ライブラリを取り込む。
 *
 * voicevoxcore-android は Maven Central へ公開されていない（VOICEVOX/voicevox_core#651）。
 * ローカル Maven リポジトリとして参照すると、このモジュールのビルドは通るものの
 * アプリ側の runtime classpath 解決でリポジトリが見えず
 * "Could not find jp.hiroshiba.voicevoxcore:voicevoxcore-android" になる。
 * AAR の中身は classes.jar と jni/ だけ（リソースなし）なので、展開して直接取り込む。
 *
 * `libc++_shared.so` は React Native が同梱しているのでここでは取り込まない。
 */
export async function ensureAndroidJavaApi(context: AndroidSetupContext): Promise<void> {
  const { packageRoot, versions, cache, skipIntegrityCheck, abis, force = false, log } = context;
  const jarName = ANDROID_JAR_NAME(versions.core);
  const jarTarget = path.join(androidLibsDir(packageRoot), jarName);
  const jniTargets = abis.map((abi) =>
    path.join(androidJniLibsDir(packageRoot), abi, 'libvoicevox_core_java_api.so')
  );

  if (!force && exists(jarTarget) && jniTargets.every(exists)) {
    log?.('skip: voicevoxcore-android is already in place');
    return;
  }

  const [spec] = androidArtifactSpecs(versions, abis);
  const pinned = lookupArtifact(spec.url);
  const download = await downloadToCache({
    url: spec.url,
    cache,
    sha256: pinned.sha256,
    size: pinned.size,
    skipIntegrityCheck,
    log,
  });

  // java_packages.zip の中に AAR が入っており、AAR 自体も zip なので 2 段展開する。
  const packages = ensureExtracted({
    cache,
    key: spec.key,
    archivePath: download.filePath,
    extract: unzip,
    log,
  });
  const aar = findEntry(packages, `voicevoxcore-android-${versions.core}.aar`);
  if (!aar) {
    throw new Error('the voicevoxcore-android AAR was not found in java_packages.zip');
  }
  const aarContents = ensureExtracted({
    cache,
    key: `${spec.key}-aar`,
    archivePath: aar,
    extract: unzip,
    log,
  });

  rmrf(androidLibsDir(packageRoot));
  ensureDir(androidLibsDir(packageRoot));
  copyFile(path.join(aarContents, 'classes.jar'), jarTarget);
  log?.(`placed android/libs/${jarName}`);

  for (const abi of abis) {
    const source = path.join(aarContents, 'jni', abi, 'libvoicevox_core_java_api.so');
    if (!exists(source)) {
      throw new Error(`the AAR has no libvoicevox_core_java_api.so for ${abi}`);
    }
    copyFile(
      source,
      path.join(androidJniLibsDir(packageRoot), abi, 'libvoicevox_core_java_api.so')
    );
    log?.(`placed android/src/main/jniLibs/${abi}/libvoicevox_core_java_api.so`);
  }
}

/** ONNX Runtime の .so を jniLibs へ。 */
export async function ensureAndroidOnnxruntime(context: AndroidSetupContext): Promise<void> {
  const { packageRoot, versions, cache, skipIntegrityCheck, abis, force = false, log } = context;
  const specs = androidArtifactSpecs(versions, abis).slice(1);

  for (const [index, spec] of specs.entries()) {
    const abi = abis[index];
    const target = path.join(androidJniLibsDir(packageRoot), abi, 'libvoicevox_onnxruntime.so');
    if (!force && exists(target)) {
      log?.(`skip: libvoicevox_onnxruntime.so (${abi}) is already in place`);
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
      extract: untar,
      log,
    });

    const source = findEntry(extracted, 'libvoicevox_onnxruntime.so');
    if (!source) {
      throw new Error(`libvoicevox_onnxruntime.so was not found in the extracted archive (${abi})`);
    }
    copyFile(source, target);
    log?.(`placed android/src/main/jniLibs/${abi}/libvoicevox_onnxruntime.so`);
  }
}

/**
 * plugin config で外された ABI のディレクトリを取り除く。
 *
 * `arm64-v8a` だけを指定した利用者のアプリに x86_64 の .so（24MB）を持ち込まないため。
 */
export function pruneUnusedAbis(
  packageRoot: string,
  abis: VoicevoxAndroidAbi[],
  log?: (message: string) => void
): void {
  const jniLibs = androidJniLibsDir(packageRoot);
  if (!exists(jniLibs)) {
    return;
  }
  for (const entry of fs.readdirSync(jniLibs, { withFileTypes: true })) {
    if (entry.isDirectory() && !(abis as string[]).includes(entry.name)) {
      rmrf(path.join(jniLibs, entry.name));
      log?.(`removed android/src/main/jniLibs/${entry.name} (not listed in abis)`);
    }
  }
}
