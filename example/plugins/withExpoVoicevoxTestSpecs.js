// example 専用の config plugin。ExpoVoicevox の XCTest（ios/Tests、podspec の test_spec 'Tests'）を
// Pods に組み込み、`ExpoVoicevox-Unit-Tests` スキームで回せるようにする。
//
// autolinking の `use_expo_modules!` は test_spec を拾わない（`includeTests: true` にすると
// 他の Expo モジュールの test_spec まで入る）。そこで「すでに Podfile にある pod は autolinking が
// 飛ばす」という挙動を使い、ExpoVoicevox だけを `:testspecs` 付きで先に宣言する。
// `:path` は autolinking が付けるもの（Podfile.lock の `../../ios`）と同じにしてある。
//
// 利用者向けの config plugin（app.plugin.js）には入れない。npm の tarball に ios/Tests は含まれない。
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# expo-voicevox: test specs';
const LINE = `  pod 'ExpoVoicevox', :path => '../../ios', :testspecs => ['Tests'] ${MARKER}`;

module.exports = function withExpoVoicevoxTestSpecs(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(MARKER)) {
        return config;
      }
      const anchor = /^(\s*)use_expo_modules!.*$/m;
      if (!anchor.test(contents)) {
        throw new Error(
          'withExpoVoicevoxTestSpecs: use_expo_modules! was not found in the Podfile'
        );
      }
      fs.writeFileSync(
        podfile,
        contents.replace(anchor, (line) => `${LINE}\n${line}`)
      );
      return config;
    },
  ]);
};
