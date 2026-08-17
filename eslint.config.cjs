const { defineConfig } = require('eslint/config');
const universe = require('eslint-config-universe/flat/native');
const universeNode = require('eslint-config-universe/flat/node');
const universeWeb = require('eslint-config-universe/flat/web');

module.exports = defineConfig([
  // catalog.generated.ts は `npm run gen:vvm-catalog` の出力なので整形の対象にしない。
  { ignores: ['build', 'plugin/build', 'plugin/src/vvm/catalog.generated.ts'] },
  // src/ は React Native 側。
  { files: ['src/**/*.{ts,tsx}'], extends: [universe, universeWeb] },
  // config plugin とメンテ用スクリプトは Node で動く。
  { files: ['plugin/src/**/*.ts', 'scripts/**/*.mjs'], extends: [universeNode] },
]);
