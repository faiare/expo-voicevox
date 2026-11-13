#!/usr/bin/env node
/**
 * iOS のネイティブ単体テスト（`ios/Tests`、podspec の test_spec 'Tests'）をシミュレータで回す。
 *
 * 前提は example の prebuild と pod install が済んでいること。`example/plugins/withExpoVoicevoxTestSpecs.js`
 * が Podfile に `:testspecs` を足すので、pod install のあとに `ExpoVoicevox-Unit-Tests` スキームができる。
 *
 * 端末名は決め打ちしない（ランナーや手元の Xcode が上がると消える）。起動中の iPhone があればそれを、
 * 無ければ最も新しいランタイムの iPhone を使う。`IOS_SIMULATOR_UDID` で明示もできる。
 *
 * 使い方:
 *   npm run test:ios
 *   IOS_SIMULATOR_UDID=XXXXXXXX-... npm run test:ios
 */

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IOS_DIR = path.join(ROOT, 'example', 'ios');
const WORKSPACE = 'expovoicevoxexample.xcworkspace';
const SCHEME = 'ExpoVoicevox-Unit-Tests';

function pickSimulator() {
  if (process.env.IOS_SIMULATOR_UDID) {
    return process.env.IOS_SIMULATOR_UDID;
  }
  const json = execFileSync('xcrun', ['simctl', 'list', 'devices', 'available', '--json'], {
    encoding: 'utf8',
  });
  const candidates = Object.entries(JSON.parse(json).devices)
    .filter(([runtime]) => runtime.includes('.SimRuntime.iOS-'))
    .flatMap(([runtime, devices]) => {
      const version = runtime.split('.SimRuntime.iOS-')[1].split('-').map(Number);
      return devices
        .filter((device) => device.name.startsWith('iPhone'))
        .map((device) => ({ ...device, version }));
    });
  const booted = candidates.find((device) => device.state === 'Booted');
  if (booted) {
    return booted.udid;
  }
  candidates.sort(
    (a, b) => b.version[0] - a.version[0] || (b.version[1] ?? 0) - (a.version[1] ?? 0)
  );
  if (candidates.length === 0) {
    throw new Error('no available iPhone simulator was found');
  }
  return candidates[0].udid;
}

if (!fs.existsSync(path.join(IOS_DIR, WORKSPACE))) {
  console.error(
    'example/ios が見つからない。先に `cd example && npx expo prebuild --platform ios` と pod install を済ませること。'
  );
  process.exit(1);
}

const udid = pickSimulator();
console.log(`[test:ios] simulator ${udid}`);
const result = spawnSync(
  'xcodebuild',
  [
    'test',
    '-workspace',
    WORKSPACE,
    '-scheme',
    SCHEME,
    '-destination',
    `platform=iOS Simulator,id=${udid}`,
    '-derivedDataPath',
    'build',
    'CODE_SIGNING_ALLOWED=NO',
  ],
  { cwd: IOS_DIR, stdio: 'inherit' }
);
process.exit(result.status ?? 1);
