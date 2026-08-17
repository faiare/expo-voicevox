import path from 'node:path';

/**
 * `expo-voicevox` パッケージのルート。
 *
 * ビルド後は `plugin/build/packageRoot.js` に置かれるので 2 つ上がパッケージルート。
 *
 * `resolveFrom(projectRoot, 'expo-voicevox')` を使わないのは、このリポジトリの example が
 * `expo.autolinking.nativeModulesDir: ".."` でリポジトリルートを autolink しているだけで、
 * Node のモジュール解決からは `expo-voicevox` が見えないため
 * （`require.resolve('expo-voicevox', { paths: ['example'] })` は失敗する）。
 * `__dirname` 基準なら npm 経由でもローカル開発でも同じように解決できる。
 */
export const packageRoot = path.resolve(__dirname, '..', '..');
