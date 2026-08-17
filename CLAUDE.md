# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの目的

`create-expo-module` で生成した直後の状態から、**voicevox-core を組み込んで Expo アプリに音声合成機能を提供する** ネイティブモジュール（npm パッケージ `expo-voicevox`）を作る。

- 対象プラットフォームは **iOS / Android のみ**。`expo-module.config.json` の `platforms` も `["apple", "android"]` のみ。
- `src/ExpoVoicevoxModule.web.ts` はテンプレート由来の web スタブ。web はサポート対象外なので、API 追加時に web 実装を作り込む必要はない（バンドラの解決を壊さないためにファイル自体は残す）。
- 現時点の実装は空。TS 側・Swift 側・Kotlin 側すべて `Name("ExpoVoicevox")` を宣言するだけのひな形。

## コマンド

パッケージマネージャは **npm**（`package-lock.json`）。

```bash
npm run build          # tsc: src/ -> build/
npm run clean          # build/ を削除
npm run lint           # eslint src/
npm test               # jest (roots: src/)
npm run prepare        # build/ を消して tsc 実行（publish 前フル build）
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
npm run ios        # expo run:ios
npm run android    # expo run:android
npm start          # Metro のみ
```

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

- **iOS**: `ios/ExpoVoicevox.podspec` の `source_files` が `"**/*.{h,m,mm,swift,hpp,cpp}"` と再帰 glob になっている。voicevox-core のヘッダ／ソースを `ios/` 配下に置くと意図せず全部コンパイル対象に入る。バイナリ配布（xcframework）は `vendored_frameworks` で持ち込み、`source_files` は必要に応じて絞る。`s.static_framework = true` が既に指定済み。デプロイメントターゲットは iOS 16.4（example の Podfile も同じ）。
- **Android**: `android/build.gradle` は `expo-module-gradle-plugin` 前提の最小構成で、`compileSdk` などは Expo 側の catalog から来る。ネイティブ共有ライブラリは `android/src/main/jniLibs/<abi>/` に配置する。example の `reactNativeArchitectures` は `armeabi-v7a,arm64-v8a,x86,x86_64` なので、必要 ABI が欠けると実機／エミュレータのどちらかで落ちる。
- **モデル・辞書ファイル**: voicevox-core は VVM モデルと OpenJTalk 辞書を実行時にファイルパスで読む。アセットをどう同梱してどこに展開するか（iOS: バンドルリソース、Android: assets からのコピー）が設計上の最大の分岐点になる。
- **同期/非同期**: 合成処理は重い。`Function` ではなく `AsyncFunction`（iOS/Android 共通）で公開し、JS スレッドをブロックしないこと。

### バージョン注意

- モジュール本体の devDependencies は expo `^57.0.13` / react-native `0.82.1` / TypeScript `^5.9.2`、example は react-native `0.86.2` / TypeScript `~6.0.3` と**食い違っている**（テンプレート生成時の差）。型エラーやビルド差異が出たらまずここを疑う。
- Android は新アーキテクチャ有効（`newArchEnabled=true`）、Hermes 有効。

### Expo のドキュメント参照

`example/AGENTS.md` に「Expo は仕様が変わっている。コードを書く前に https://docs.expo.dev/versions/v57.0.0/ のバージョン固定ドキュメントを読むこと」と明記されている。Expo Modules API を触る際はこれに従う。

## コードスタイル

- ESLint は `eslint-config-universe` の flat config（native + web）。`build` は無視対象。
- Prettier: printWidth 100 / singleQuote / bracketSameLine / trailingComma es5。
- tsconfig は `strict` に加え `noUnusedLocals`・`noImplicitReturns`・`noFallthroughCasesInSwitch` が有効。
