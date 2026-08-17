// config plugin は Node で動くので、React Native 用ではなく node プリセットを使う。
// `npm test plugin` は `--rootDir plugin --config plugin/jest.config.js` を渡してくるので、
// <rootDir> はこのファイルのあるディレクトリ（= plugin/）になる。
//
// transform を上書きしているのは jest-expo の node プリセットの都合。
// getNodePreset() は babel-jest のオプションを caller だけで置き換えるため、
// 素の jest-expo プリセットが入れている babel-preset-expo が落ちて TypeScript を解釈できなくなる。
module.exports = {
  preset: 'jest-expo/node',
  roots: ['<rootDir>/src'],
  testEnvironment: 'node',
  transform: {
    '\\.[jt]sx?$': ['babel-jest', { babelrc: false, configFile: false, presets: ['babel-preset-expo'] }],
  },
};
