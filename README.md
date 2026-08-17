# expo-voicevox

[VOICEVOX CORE](https://github.com/VOICEVOX/voicevox_core) を組み込んで、Expo アプリから日本語音声合成を行うネイティブモジュール。

対象は **iOS / Android のみ**（web は非対応）。

| | |
|---|---|
| voicevox_core | 0.17.0 |
| VOICEVOX ONNX Runtime | iOS 1.17.3 / Android 1.23.2 |
| 音声モデル (VVM) | 0.17.0 の `0.vvm` |
| OpenJTalk 辞書 | `open_jtalk_dic_utf_8-1.11` (r9y9/open_jtalk v1.11.1) |

## セットアップ

ネイティブバイナリ・音声モデル・辞書はリポジトリに含めていない。初回に一度取得する（約 200MB）。

```bash
npm install
npm run setup:voicevox     # --force を付けると配置済みでも再取得する
```

配置先:

```
ios/Frameworks/voicevox_core.xcframework
ios/Frameworks/voicevox_onnxruntime.xcframework
android/libs/voicevoxcore-android-0.17.0.jar
android/src/main/jniLibs/{arm64-v8a,x86_64}/libvoicevox_core_java_api.so
android/src/main/jniLibs/{arm64-v8a,x86_64}/libvoicevox_onnxruntime.so
example/assets/voicevox/0.vvm
example/assets/voicevox/open_jtalk_dic_utf_8-1.11/
```

macOS / Linux 前提（`unzip` と `tar` を使う）。

## 使い方

```ts
import * as Voicevox from 'expo-voicevox';

// ネイティブライブラリのロード確認を兼ねる
Voicevox.getVersion(); // "0.17.0"

// 辞書とモデルは端末のファイルシステム上の絶対パスで渡す
await Voicevox.initialize({
  openJtalkDictDir: '/path/to/open_jtalk_dic_utf_8-1.11',
  voiceModelPaths: ['/path/to/0.vvm'],
  cpuNumThreads: 0, // 0 = 環境に合わせて自動
});

// 使えるスタイルの一覧
const characters = await Voicevox.getCharacters();
// [{ name: 'ずんだもん', speakerUuid: '...', styles: [{ id: 3, name: 'ノーマル', type: 'talk' }, ...] }, ...]

// 合成。返り値は書き出した WAV の絶対パス（24kHz / モノラル / 16bit）
const wavPath = await Voicevox.tts('こんにちは', 3);

await Voicevox.finalize();
```

| API | 種別 | 説明 |
|---|---|---|
| `getVersion()` | 同期 | voicevox_core のバージョン |
| `isInitialized()` | 同期 | `initialize()` が完了しているか |
| `initialize(options)` | 非同期 | ONNX Runtime / OpenJTalk / Synthesizer を用意し、音声モデルを読み込む |
| `getCharacters()` | 非同期 | 読み込み済みモデルのキャラクターとスタイル |
| `tts(text, styleId)` | 非同期 | 合成した WAV のファイルパスを返す |
| `finalize()` | 非同期 | Synthesizer を破棄する |

WAV はキャッシュディレクトリに書き出される。ブリッジ越しに Base64 を運ばないための設計で、不要になったら呼び出し側で削除してよい。

## example を動かす

```bash
npm run build          # src/ の変更後は必須（example は build/ を解決する）
cd example
npx expo prebuild --clean
npm run ios            # または npm run android
```

「アセットを展開」→「initialize()」→「合成して再生」の順にタップすると音が鳴る。
アセットの展開は初回のみで、約 160MB をドキュメントディレクトリへコピーする。

## 開発

```bash
CI=1 npm run build          # TTY では --watch が自動で付くため CI=1 が必要
CI=1 npm test
npm run lint
```

## プラットフォームごとの事情

**iOS**
- 配布される xcframework は dynamic framework。`vendored_frameworks` で持ち込み、CocoaPods が Embed & Sign する。
- iOS 版のみ ONNX Runtime を**ロード時動的リンク**する（`voicevox_onnxruntime_init_once`）ため、`voicevox_onnxruntime.xcframework` も必ずセットで必要。
- ONNX Runtime は **1.17.3 でなければならない**。core 0.17.0 の iOS バイナリは compatibility version 1.17.3 を要求するが、1.23.2 の framework は 0.0.0 を名乗るため dyld に弾かれる。
- 配布される `voicevox_onnxruntime.framework` の `CFBundleIdentifier` にはアンダースコアが含まれており Xcode の署名で弾かれるため、セットアップスクリプトがハイフンへ置換している。
- 最低 iOS バージョンは 16.4（framework 自体は 16.2 から）。

**Android**
- 公式の Java API（`jp.hiroshiba.voicevoxcore`）を使うので JNI ラッパーの自作は不要。
- ただし Maven Central へ公開されていない（[voicevox_core#651](https://github.com/VOICEVOX/voicevox_core/issues/651)）ため、AAR を展開して jar と `.so` を直接取り込んでいる。ローカル Maven リポジトリとして参照すると、アプリ側の依存解決からは見えず失敗する。
- **minSdk は 26**。example では `expo-build-properties` で指定している。
- **対応 ABI は `arm64-v8a` と `x86_64` のみ**。`armeabi-v7a` / `x86` のバイナリは配布されていない。example では `expo-build-properties` の `buildArchs` で絞っている。
- ONNX Runtime は **1.23.2**（iOS の 1.17.3 とは別）。Android は `dlopen` でファイル名解決するのでバージョンを揃える必要がなく、1.17.3 は LOAD セグメントが 4KB アラインのため Android 15 以降の 16KB ページサイズ端末で互換モードに落ちる。1.23.2 は 16KB アライン済み。

## ライセンス・クレジット

- `expo-voicevox` 本体: MIT
- voicevox_core: MIT
- VOICEVOX 音声モデル (VVM) / VOICEVOX ONNX Runtime: 独自の利用規約。**VOICEVOX を利用したことがわかるクレジット表記が必要**（`example/assets/voicevox/vvm-TERMS.txt`）
- OpenJTalk 辞書: BSD-3-Clause。著作権表示の再掲が必要

`0.vvm` に含まれるのは 四国めたん / ずんだもん / 春日部つむぎ / 雨晴はう で、いずれも `VOICEVOX:<キャラ名>` のクレジット表記で商用・非商用ともに利用できる。他の VVM はキャラクターごとに条件が異なり、企業利用に事前確認が必要なものもあるので `TERMS.txt` を確認すること。

## 現時点で扱っていないもの

AudioQuery の編集・アクセント調整・カナ入力合成・歌唱合成・ユーザー辞書・ストリーミング、モデルと辞書の実行時ダウンロード。
