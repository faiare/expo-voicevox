# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの目的

`create-expo-module` で生成した直後の状態から、**voicevox-core を組み込んで Expo アプリに音声合成機能を提供する** ネイティブモジュール（npm パッケージ `@faiare/expo-voicevox`）を作る。

- 対象プラットフォームは **iOS / Android のみ**。`expo-module.config.json` の `platforms` も `["apple", "android"]` のみ。
- `src/ExpoVoicevoxModule.web.ts` はテンプレート由来の web スタブ。web はサポート対象外なので、API 追加時に web 実装を作り込む必要はない（バンドラの解決を壊さないためにファイル自体は残す）。
- 音声合成 API（`getVersion` / `isInitialized` / `initialize` / `getCharacters` / `tts` / `finalize`）は実装済み。アセットの取得と配置は `plugin/` の config plugin が担う。

## コマンド

パッケージマネージャは **npm**（`package-lock.json`）。

```bash
npm run build          # tsc: src/ -> build/
npm run build plugin   # tsc: plugin/src/ -> plugin/build/（config plugin）
npm run clean          # build/ を削除
npm run lint           # eslint src/ plugin/src/ scripts/
npm test               # jest (roots: src/)
npm test plugin        # jest (roots: plugin/src/、plugin/jest.config.js)
npm run prepare        # build/ と plugin/build/ を消して tsc 実行（publish 前フル build）
npm run setup:voicevox # voicevox-core のバイナリを取得（開発者用）
npm run gen:vvm-catalog # VVM のキャラクター対応表を再生成（メンテ用・要ネットワーク）
npm run open:ios       # example/ios を Xcode で開く
npm run open:android   # example/android を Android Studio で開く
```

**重要（エージェント実行時の落とし穴）**: `npm run build` と `npm test` は `internal/module_scripts/{build,test}.js` 経由で、TTY かつ `CI` / `EXPO_NONINTERACTIVE` 未設定の場合に `--watch` を**自動付与**する。非対話で回すときは必ず環境変数を付けること。

```bash
CI=1 npm run build
CI=1 npm test
CI=1 npm test -- -t "test name"   # 単一テストを名前で実行
CI=1 npm test -- src/__tests__/Foo.test.ts   # 単一ファイル
```

example アプリ（ネイティブビルドを伴う実機・シミュレータ確認）:

```bash
cd example
npx expo prebuild --clean   # config plugin の効果を確認するならこれを先に
npm run ios        # expo run:ios
npm run android    # expo run:android
npm start          # Metro のみ
```

**ネイティブは実機を起動しなくても検証できる**。エージェントで回すときはこの 3 つを使う。

```bash
# Kotlin: コンパイル + JVM ユニットテスト（VoicevoxArchive の tar.gz 展開）
cd example/android && ./gradlew :faiare-expo-voicevox:testDebugUnitTest --console=plain
# 結果は android/build/test-results/testDebugUnitTest/TEST-*.xml

# Swift: シミュレータ向けビルド（podspec が新ファイルを拾っているかも分かる）
cd example/ios && xcodebuild -workspace expovoicevoxexample.xcworkspace \
  -scheme expovoicevoxexample -sdk iphonesimulator -configuration Debug \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build

# .app にアセットが構造ごと入ったかの確認
find example/ios/build/Build/Products/*/*.app/voicevox -maxdepth 1
```

`swiftc -typecheck` を単体ファイルに掛けるだけでは escaping closure まわりのエラーを取りこぼす。**Swift は必ず `xcodebuild` まで通すこと。**

`src/` を変更したら **`npm run build` を先に実行**すること。`package.json` の `main` は `build/index.js` で、example は build 出力を解決する。

## アーキテクチャ

### 3層構造と名前の一致

JS からネイティブへの接続は「モジュール名文字列」1本で成立している。API を追加・改名するときは以下 5 箇所が揃っている必要がある。

| 層 | ファイル | 宣言 |
|---|---|---|
| JS ブリッジ | `src/ExpoVoicevoxModule.ts` | `requireNativeModule<ExpoVoicevoxModule>('ExpoVoicevox')` |
| iOS 実装 | `ios/ExpoVoicevoxModule.swift` | `Name("ExpoVoicevox")` |
| Android 実装 | `android/src/main/java/expo/modules/voicevox/ExpoVoicevoxModule.kt` | `Name("ExpoVoicevox")` |
| 登録 | `expo-module.config.json` | `apple.modules` / `android.modules` |
| 型 | `src/ExpoVoicevox.types.ts` | 公開型（`src/index.ts` から re-export） |

新しくネイティブモジュールクラスを追加した場合、`expo-module.config.json` への登録を忘れると autolinking されず JS 側で解決に失敗する。

### example とローカルモジュールの結線

`example/package.json` の `expo.autolinking.nativeModulesDir: ".."` により、example はリポジトリルートのモジュールを**ローカル参照**で autolink する。npm install 経由ではないので、ネイティブ側（podspec / build.gradle）を変更したら pod install や Gradle sync が必要。

### voicevox-core を組み込むときの勘所

- **iOS**: `ios/ExpoVoicevox.podspec` の `source_files` は `"*.{h,m,mm,swift}"`（`ios/` 直下のみ）。再帰 glob にすると `Frameworks/` 配下の `voicevox_core.h` までコンパイル対象に入るため意図的に絞ってある。**新しい Swift ファイルは `ios/` 直下に置くこと**（サブディレクトリだと拾われない）。xcframework は `vendored_frameworks` で持ち込む。`s.static_framework = true`、デプロイメントターゲットは iOS 16.4。
- **Android**: `android/build.gradle` は `expo-module-gradle-plugin` 前提の最小構成。ネイティブ共有ライブラリは `android/src/main/jniLibs/<abi>/` に置く。voicevox-core が配布しているのは **`arm64-v8a` と `x86_64` のみ**で、ABI の絞り込みは gradle.properties の `reactNativeArchitectures` で行う（`expo-build-properties` の `buildArchs` と同じ経路）。
- **モデル・辞書ファイル**: voicevox-core は VVM モデルと OpenJTalk 辞書を実行時にファイルパスで読む（Java API も `VoiceModelFile(String)` / `OpenJtalk(String)` のみで FD 版が無い）。iOS はフォルダ参照でバンドルに載せて `.app` 内をそのまま読むので展開不要、**Android は APK 内 assets に実パスが無いので `noBackupFilesDir` への展開が必須**。`filesDir` を使うと 173MB が Android Auto Backup（上限 25MB）の対象になって壊れるので使わない。
- **同期/非同期**: 合成処理は重い。`Function` ではなく `AsyncFunction`（iOS/Android 共通）で公開し、JS スレッドをブロックしないこと。

### config plugin（`plugin/`）

`app.json` の plugin config に使いたい声を書くだけで、`npx expo prebuild` がモデル・辞書・ネイティブバイナリの取得と配置まで済ませる。エントリは `app.plugin.js` →  `plugin/build/withVoicevox.js`。

**声の指定はキャラクター名 + スタイルの slug**（`"zundamon/normal"`）で、キャラクター名だけの指定は**エラーにする**。1 キャラクターの声が複数の `.vvm` に分かれている（ずんだもんのトークは `0.vvm` / `5.vvm` / `15.vvm` の 3 ファイル ≈ 176MB）ため、キャラクター名だけでは何 MB 取り込まれるか `app.json` から読み取れないから。

- **キャラクターの slug は VOICEVOX 公式サイトの product URL（`https://voicevox.hiroshiba.jp/product/<slug>/`）に合わせる**。独自にローマ字を当てると読みを誤る（雀松朱司は「すずめまつ」ではなく `wakamatsu`、黒沢冴白は「さはく」ではなく `kohaku`、†聖騎士 紅桜† は `horinaito_benizakura`）。
- 対応表は `npm run gen:vvm-catalog` が上流 README（`VOICEVOX/voicevox_vvm` の `scripts/make_docs.py` 生成物）から `plugin/src/vvm/catalog.generated.ts` を作る。手書きするのは `plugin/src/vvm/slugs.ts` だけ。**slug 未定義の名前が 1 つでもあると生成は失敗する**ので、VVM のバージョンを上げたときの取りこぼしは黙って通らない。
- 歌唱（`s0.vvm`）の声は、キャラクター名 + スタイルの組が必ずトーク側にも存在する。よって `kind: 'song'` を除外しても名前で引けなくなる声は無く、`zundamon/normal` は常にトークの `0.vvm` を指す。

#### エージェント向けの落とし穴

- **`package.json` の `files` を指定すると `.npmignore` は完全に無視される**（npm-packlist はこの許可リストだけを見る）。`ios` / `android` をディレクトリごと書くと、plugin が prebuild 時に取得する `ios/Frameworks` `android/libs` `android/src/main/jniLibs` や Gradle の `android/build` まで tarball に入り 100MB を超える。必要なパスだけを列挙すること。変更したら必ず `npm pack --dry-run --json --ignore-scripts` で中身を確認する（正常値: 50 ファイル前後 / 40KB 前後）。
- **`plugin/tsconfig.json` の `tsBuildInfoFile` は `./build/` の中を指すこと**。既定では `plugin/tsconfig.tsbuildinfo` に出るため、`internal/module_scripts/prepare.js` が `plugin/build` を消しても `tsc --build` が「最新」と判断して何も出力せず、**publish 時に `plugin/build` が空になる**。
- **`plugin/jest.config.js` は `transform` を上書きしている**。`jest-expo/node` プリセット（`getNodePreset()`）は babel-jest のオプションを `caller` だけで置き換えるため、素の jest-expo プリセットが入れている `babel-preset-expo` が落ちて TypeScript を解釈できなくなる。
- **config plugin から `resolveFrom(projectRoot, '@faiare/expo-voicevox')` は使えない**。`example/package.json` の `nativeModulesDir: ".."` は autolinking 専用でモジュール解決には効かず、example から `@faiare/expo-voicevox` は resolve できない。パッケージルートは `__dirname` 基準で求めること。同じ理由で `example/app.json` の plugin 指定は `"../app.plugin.js"` という相対パス形式になる（利用者向けの README には `"@faiare/expo-voicevox"` 形式を書く）。
- **パッケージ名がスコープ付きなので Gradle のプロジェクト名は `faiare-expo-voicevox`**（autolinking の `convertPackageToProjectName` が `@` を落として `/` をハイフンにする）。iOS の pod 名は podspec 由来なので `ExpoVoicevox` のまま。ログ接頭辞・キャッシュディレクトリ名（`~/.cache/expo-voicevox`）・Android の展開先（`noBackupFilesDir/expo-voicevox`）はパス/表示文字列なのでスコープを付けていない。

### バージョン注意

- モジュール本体の devDependencies は expo `^57.0.13` / react-native `0.82.1` / TypeScript `^5.9.2`、example は react-native `0.86.2` / TypeScript `~6.0.3` と**食い違っている**（テンプレート生成時の差）。型エラーやビルド差異が出たらまずここを疑う。
- Android は新アーキテクチャ有効（`newArchEnabled=true`）、Hermes 有効。

### Expo のドキュメント参照

`example/AGENTS.md` に「Expo は仕様が変わっている。コードを書く前に https://docs.expo.dev/versions/v57.0.0/ のバージョン固定ドキュメントを読むこと」と明記されている。Expo Modules API を触る際はこれに従う。

## コードスタイル

- ESLint は `eslint-config-universe` の flat config。`src/` は native + web、`plugin/src/` と `scripts/` は node 設定。`build` / `plugin/build` / `plugin/src/vvm/catalog.generated.ts`（生成物）は無視対象。
- Prettier: printWidth 100 / singleQuote / bracketSameLine / trailingComma es5。
- tsconfig は `strict` に加え `noUnusedLocals`・`noImplicitReturns`・`noFallthroughCasesInSwitch` が有効。
