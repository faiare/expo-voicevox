// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// npm v7+ will install ../node_modules/react and ../node_modules/react-native because of peerDependencies.
// To prevent the incompatible react-native between ./node_modules/react-native and ../node_modules/react-native,
// excludes the one from the parent folder when bundling.
config.resolver.blockList = [
  ...Array.from(config.resolver.blockList ?? []),
  // On windows the path will resolve with `\`. We need to escape it with `\\` for the RegExp.
  new RegExp(path.resolve('..', 'node_modules', 'react').replace(/\\/g, '\\\\')),
  new RegExp(path.resolve('..', 'node_modules', 'react-native').replace(/\\/g, '\\\\')),
];

config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, './node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

config.resolver.extraNodeModules = {
  'expo-voicevox': '..',
};

// voicevox-core のモデル（.vvm）と OpenJTalk 辞書（.dic / .bin / .def / COPYING.txt）を
// バンドルアセットとして扱えるようにする。実行時にファイルシステムへ展開して使う。
config.resolver.assetExts = [
  ...new Set([...config.resolver.assetExts, 'vvm', 'dic', 'bin', 'def', 'txt']),
];

config.watchFolders = [path.resolve(__dirname, '..')];

config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: false,
    inlineRequires: true,
  },
});

module.exports = config;
