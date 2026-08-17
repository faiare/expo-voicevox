# @faiare/expo-voicevox

[VOICEVOX CORE](https://github.com/VOICEVOX/voicevox_core) を組み込んで、Expo アプリから日本語音声合成を行うネイティブモジュール。

対象は **iOS / Android のみ**（web は非対応）。

| | |
|---|---|
| voicevox_core | 0.17.0 |
| VOICEVOX ONNX Runtime | iOS 1.17.3 / Android 1.23.2 |
| 音声モデル (VVM) | 0.17.0 |
| OpenJTalk 辞書 | `open_jtalk_dic_utf_8-1.11` (r9y9/open_jtalk v1.11.1) |

## セットアップ

```bash
npx expo install @faiare/expo-voicevox
```

`app.json` に config plugin を追加して、使いたい声を書く。

```jsonc
{
  "expo": {
    "plugins": [
      ["@faiare/expo-voicevox", { "voices": ["zundamon/normal"] }]
    ]
  }
}
```

```bash
npx expo prebuild
npx expo run:ios     # または npx expo run:android
```

`npx expo prebuild` が以下をすべて行う。手作業でファイルを置く必要はない。

- voicevox_core と ONNX Runtime のネイティブバイナリを取得してパッケージへ配置
- 指定した声を含む `.vvm` と OpenJTalk 辞書を取得して、iOS はアプリバンドル、Android は `assets/` へ配置
- Android の `minSdkVersion` と対応 ABI、iOS の deployment target を設定

**`ios/` と `android/` はコミットしないこと。** アセットを含めると 170MB 超がリポジトリに入る。`.gitignore` に入れて `npx expo prebuild` で毎回生成する運用にする。

## 使いたい声の指定

指定は **`<キャラクター>/<スタイル>`** の形で、どちらも半角英数の slug を使う。

```jsonc
["@faiare/expo-voicevox", {
  "voices": [
    "zundamon/normal",
    "zundamon/sasayaki",
    { "character": "shikoku_metan", "styles": ["normal", "sexy"] }
  ]
}]
```

- **キャラクターの slug は [VOICEVOX 公式サイト](https://voicevox.hiroshiba.jp/) の product URL と同じ**。`https://voicevox.hiroshiba.jp/product/shikoku_metan/` なら `shikoku_metan`。ハイフン区切り（`shikoku-metan`）でも受け付ける。
- **スタイルの指定は必須**。キャラクター名だけでは通らない。1 キャラクターの声は複数の `.vvm` に分かれており（ずんだもんのトークは `0.vvm` / `5.vvm` / `15.vvm` の 3 ファイル ≈ 176MB）、キャラクター名だけでは何 MB 取り込まれるかが `app.json` から読み取れないため。
- スタイルの slug が分からないときは、キャラクター名だけを書いて `npx expo prebuild` を実行すると、そのキャラクターの全スタイルがファイル名とサイズ付きで一覧表示される。

```
expo-voicevox: "zundamon" needs a style.
  Available styles for zundamon:
    zundamon/normal — ずんだもん "ノーマル" (0.vvm, 56.6MB)
    zundamon/amaama — ずんだもん "あまあま" (0.vvm, 56.6MB)
    ...
    zundamon/sasayaki — ずんだもん "ささやき" (5.vvm, 54.9MB)
```

prebuild では実際に取り込むファイルとサイズが必ず出力される。

```
expo-voicevox: voice models: 2 file(s), 111.5MB
expo-voicevox:   0.vvm  56.6MB  shikoku_metan/normal, zundamon/normal
expo-voicevox:   5.vvm  54.9MB  zundamon/sasayaki
expo-voicevox: OpenJTalk dictionary: open_jtalk_dic_utf_8-1.11
expo-voicevox: asset source: bundle (embedded in the app)
```

VVM のファイル名で直接指定することもできる（`{ "file": "n0.vvm" }`）。歌唱モデル `s0.vvm` も指定できるが、歌唱合成 API は未対応なので警告が出る。

## plugin のオプション

| キー | 既定 | 説明 |
|---|---|---|
| `voices` | `["zundamon/normal"]` | 同梱する声。上記参照 |
| `assetSource` | `"bundle"` | `"bundle"` はアプリに埋め込む。`"download"` は初回起動時に取得する |
| `openJtalkDictionary` | `true` | 辞書を同梱するか。自前で用意する場合のみ `false` |
| `coreVersion` | `"0.17.0"` | voicevox_core のバージョン |
| `voiceModelVersion` | `"0.17.0"` | VVM リリースのタグ。変更するとキャラクター名では指定できなくなる（同梱カタログが使えないため）。`{ "file": "0.vvm" }` 形式のみになる |
| `onnxruntimeVersion` | `{ "ios": "1.17.3", "android": "1.23.2" }` | 変更は非推奨（後述の「プラットフォームごとの事情」参照） |
| `android.abis` | `["arm64-v8a", "x86_64"]` | ここに無い ABI は jniLibs から取り除かれる |
| `android.minSdkVersion` | `26` | voicevoxcore-android の要求。これ未満は指定できない |
| `ios.deploymentTarget` | `"16.4"` | voicevox_core.xcframework の要求 |
| `cacheDirectory` | `$XDG_CACHE_HOME/expo-voicevox` | ダウンロードキャッシュの場所。プロジェクトルートからの相対パスも可 |
| `skipIntegrityCheck` | `false` | sha256 検証をスキップする（社内ミラー用） |

型定義は `import type { ExpoVoicevoxPluginProps } from '@faiare/expo-voicevox/plugin/build/types'` で参照できる。

### bundle と download の使い分け

| | `bundle` | `download` |
|---|---|---|
| AAB / IPA のサイズ | モデル 57MB + 辞書 約 22MB（圧縮後）+ ネイティブライブラリ 約 46MB | ネイティブライブラリのみ 約 46MB |
| 初回起動 | Android のみ端末へ展開（オフライン可） | 約 173MB のダウンロードと展開が必要 |
| 端末の消費容量 | アプリ本体 + 展開後 173MB | 173MB |
| Google Play の 200MB 上限 | モデル 1 個なら収まる。**2 個以上で超える可能性** | 余裕がある |

モデルが 100MB を超える設定にすると prebuild で警告が出る。本番配信で複数キャラクターを載せる場合は `assetSource: "download"` を検討する。

### ダウンロードキャッシュと EAS Build

取得したアーカイブは `$XDG_CACHE_HOME/expo-voicevox`（未設定なら `~/.cache/expo-voicevox`）に保存され、2 回目以降の prebuild は再取得しない。環境変数 `EXPO_VOICEVOX_CACHE_DIR` が最優先。

EAS Build のコンテナはビルドごとにまっさらなので、そのままだと毎回 200MB 前後を取得する。緩和するには次のどちらか。

- `cacheDirectory` を `node_modules/.cache/expo-voicevox` にして、`eas.json` の `build.<profile>.cache.paths` に同じパスを入れる
- `assetSource: "download"` にして、ビルド時の取得をネイティブバイナリだけにする

サイズと sha256 はパッケージ内に固定表として持っているので、prebuild が GitHub API を叩くことはない（レート制限に当たらない）。

## 使い方

```ts
import * as Voicevox from '@faiare/expo-voicevox';

// ネイティブライブラリのロード確認を兼ねる
Voicevox.getVersion(); // "0.17.0"

// config plugin が配置したアセットを自動で解決する
await Voicevox.initialize();

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
| `prepareAssets()` | 非同期 | アセットを使える状態にして絶対パスを返す。冪等 |
| `addPrepareProgressListener(cb)` | 同期 | アセット準備の進捗を購読する |
| `initialize(options?)` | 非同期 | ONNX Runtime / OpenJTalk / Synthesizer を用意し、音声モデルを読み込む |
| `getCharacters()` | 非同期 | 読み込み済みモデルのキャラクターとスタイル |
| `tts(text, styleId, options?)` | 非同期 | 合成した WAV のファイルパスを返す |
| `ttsFromKana(kana, styleId, options?)` | 非同期 | AquesTalk 風記法のカナから合成する |
| `createAudioQuery(text, styleId)` | 非同期 | 合成パラメータ（AudioQuery）を生成する |
| `createAudioQueryFromKana(kana, styleId)` | 非同期 | カナから AudioQuery を生成する |
| `synthesis(audioQuery, styleId, options?)` | 非同期 | AudioQuery を合成する |
| `createAccentPhrases(text, styleId)` | 非同期 | アクセント句の配列を生成する |
| `createAccentPhrasesFromKana(kana, styleId)` | 非同期 | カナからアクセント句を生成する |
| `replaceMoraData(phrases, styleId)` | 非同期 | 音素長と音高を生成し直す |
| `replacePhonemeLength(phrases, styleId)` | 非同期 | 音素長だけを生成し直す |
| `replaceMoraPitch(phrases, styleId)` | 非同期 | 音高だけを生成し直す |
| `audioQueryFromAccentPhrases(phrases)` | 非同期 | アクセント句から AudioQuery を組み立てる |
| `setUserDictWords(words)` | 非同期 | ユーザー辞書を差し替える |
| `loadUserDictFile(path)` / `saveUserDictFile(path)` | 非同期 | 辞書ファイルの読み書き |
| `finalize()` | 非同期 | Synthesizer を破棄する |

WAV はキャッシュディレクトリに書き出される。ブリッジ越しに Base64 を運ばないための設計で、不要になったら呼び出し側で削除してよい。

`finalize()` は iOS では即座に解放されるが、Android は Java API に明示的な close が無いため参照を手放して GC に委ねる（解放のタイミングは保証されない）。

### 話速・音高を変える

`tts()` は既定のパラメータで合成する。調整したいときは AudioQuery を経由する。

```ts
const query = await Voicevox.createAudioQuery('こんにちは', 3);
query.speedScale = 1.3;      // 話速
query.pitchScale = 0.05;     // 音高
query.intonationScale = 1.2; // 抑揚
query.volumeScale = 1.0;     // 音量
query.prePhonemeLength = 0.1;  // 開始の無音（秒）
query.postPhonemeLength = 0.1; // 終了の無音（秒）
const wavPath = await Voicevox.synthesis(query, 3);
```

`outputSamplingRate` と `outputStereo` もここで指定できるので、24kHz モノラル以外も出力できる。

疑問文の語尾上げは既定で有効。切るには `{ enableInterrogativeUpspeak: false }` を渡す。

### 読みとアクセントを直す

アクセント句を取り出して編集し、AudioQuery に組み立て直す。

```ts
const phrases = await Voicevox.createAccentPhrases('端に寄る', 3);
phrases[0].accent = 1; // アクセント核の位置（1 始まり、0 は平板）
const adjusted = await Voicevox.replaceMoraData(phrases, 3);
const query = await Voicevox.audioQueryFromAccentPhrases(adjusted);
const wavPath = await Voicevox.synthesis(query, 3);
```

モーラの `pitch` や `vowelLength` を直接書き換えることもできる。その場合は `replaceMoraData()` を呼ばずにそのまま組み立てる（呼ぶと上書きされる）。

### ユーザー辞書

固有名詞など、既定の辞書では読みを誤る語を登録する。

```ts
await Voicevox.setUserDictWords([
  { surface: '四国めたん', pronunciation: 'シコクメタン', accentType: 4, wordType: 'PROPER_NOUN' },
]);
```

`setUserDictWords()` は**全置換**で、呼ぶたびに辞書を作り直して OpenJTalk へ適用し直す。voicevox-core は「辞書を変更したら再適用が必要」という仕様なので、追加・削除を個別に扱う API にすると再適用の呼び忘れが無言で効かないバグになる。呼び出し側は自分の単語リストを唯一の状態として持ち、変更のたびにこれを呼べばよい。

`initialize()` の前でも呼べる。設定した辞書は `finalize()` をまたいで残る。

**既定の辞書に既にある語を上書きするには `priority` を上げる必要がある。** 未知語（固有名詞など）なら既定の `priority: 5` で効くが、`こんにちは` のような一般語は形態素解析のコスト勝負になるため、既定の優先度では既存の読みが勝つ。

登録済みの単語を読み出す API は用意していない。voicevox-core が返す形が iOS（MeCab 形式で品詞から `wordType` を逆引きする）と Android（5 フィールドのみ）で食い違っており、両プラットフォームで同じ値を返せないため。

### 準備の進捗を出す

Android は初回起動時に APK 内のアセットを端末へ展開する（`assetSource: "download"` ならダウンロードも行う）。時間がかかるので進捗を出すとよい。iOS の bundle モードはバンドルをそのまま読むためイベントは発生しない。

```ts
useEffect(() => {
  const subscription = Voicevox.addPrepareProgressListener((progress) => {
    setStatus(`${progress.stage} ${progress.current} ${progress.completedFiles}/${progress.totalFiles}`);
  });
  return () => subscription.remove();
}, []);
```

### 自分でアセットを管理する

`initialize()` に絶対パスを渡すと、config plugin が配置したものを一切見ない（ダウンロードも展開も走らない）。

```ts
await Voicevox.initialize({
  openJtalkDictDir: '/path/to/open_jtalk_dic_utf_8-1.11',
  voiceModelPaths: ['/path/to/0.vvm'],
  cpuNumThreads: 0, // 0 = 環境に合わせて自動
});
```

この使い方だけをするなら plugin config に `"voices": []` を指定して、辞書だけを同梱することもできる。

## example を動かす

```bash
npm install
npm run setup:voicevox   # 開発者用: ネイティブバイナリを取得する
npm run build

cd example
npx expo prebuild --clean
npm run ios              # または npm run android
```

「initialize()」→「合成して再生」の 2 タップで音が鳴る。

example の `app.json` は plugin を `"../app.plugin.js"` という相対パスで参照している。`nativeModulesDir: ".."` は autolinking 専用の設定で Node のモジュール解決には効かず、example から `@faiare/expo-voicevox` を resolve できないため。利用者のアプリでは `"@faiare/expo-voicevox"` と書く。

## 開発

```bash
CI=1 npm run build          # TTY では --watch が自動で付くため CI=1 が必要
CI=1 npm run build plugin
CI=1 npm test
CI=1 npm test plugin
npm run lint
```

メンテナンス用のスクリプト（ネットワークアクセスを伴う）:

```bash
npm run gen:vvm-catalog          # VVM のキャラクター対応表を上流 README から再生成
npm run refresh:artifact-digests # 配布物の size / sha256 の固定表を作り直す
```

`npm run setup:voicevox` が置くのはネイティブバイナリだけで、モデルと辞書はキャッシュにのみ入る（アプリへの配置は config plugin が行う）。

### リリース前チェック

example は plugin を相対パスで参照しているため、利用者と同じ経路を検証できない。publish 前に一度は tarball から確認する。

```bash
npm pack --dry-run --json --ignore-scripts   # ネイティブバイナリが混ざっていないこと
npm pack
# 別ディレクトリで新規 Expo アプリを作り、上の .tgz を入れて
# app.json に "@faiare/expo-voicevox" 形式で plugin を追加し、npx expo prebuild が通ること
```

## プラットフォームごとの事情

**iOS**

- 配布される xcframework は dynamic framework。`vendored_frameworks` で持ち込み、CocoaPods が Embed & Sign する。
- iOS 版のみ ONNX Runtime を**ロード時動的リンク**する（`voicevox_onnxruntime_init_once`）ため、`voicevox_onnxruntime.xcframework` も必ずセットで必要。
- ONNX Runtime は **1.17.3 でなければならない**。core 0.17.0 の iOS バイナリは compatibility version 1.17.3 を要求するが、1.23.2 の framework は 0.0.0 を名乗るため dyld に弾かれる。
- 配布される `voicevox_onnxruntime.framework` の `CFBundleIdentifier` にはアンダースコアが含まれており Xcode の署名で弾かれるため、plugin がハイフンへ置換している。
- アセットは `ios/voicevox/` を**フォルダ参照（Xcode の青フォルダ）**として Copy Bundle Resources に登録している。通常のリソース追加だと `.app` 直下へ平坦に展開されてしまい、辞書のディレクトリ構造が保てないため。iOS はバンドル内をそのまま読むので、実行時の展開・コピーは一切発生しない。
- 最低 iOS バージョンは 16.4（framework 自体は 16.2 から）。

**Android**

- 公式の Java API（`jp.hiroshiba.voicevoxcore`）を使うので JNI ラッパーの自作は不要。
- ただし Maven Central へ公開されていない（[voicevox_core#651](https://github.com/VOICEVOX/voicevox_core/issues/651)）ため、AAR を展開して jar と `.so` を直接取り込んでいる。ローカル Maven リポジトリとして参照すると、アプリ側の依存解決からは見えず失敗する。
- **minSdk は 26**、**対応 ABI は `arm64-v8a` と `x86_64` のみ**。どちらも plugin が `gradle.properties` に設定するので `expo-build-properties` は不要。
- ONNX Runtime は **1.23.2**（iOS の 1.17.3 とは別）。Android は `dlopen` でファイル名解決するのでバージョンを揃える必要がなく、1.17.3 は LOAD セグメントが 4KB アラインのため Android 15 以降の 16KB ページサイズ端末で互換モードに落ちる。1.23.2 は 16KB アライン済み。
- voicevox-core は実ファイルパスしか受け付けず（Java API も `OpenJtalk(String)` / `VoiceModelFile(String)` のみ）、APK 内 assets には実パスが無い。そのため **初回起動時に端末のストレージへ展開する**。展開先は `filesDir` ではなく **`noBackupFilesDir`**。`filesDir` だと 170MB 超が Android Auto Backup（上限 25MB）や端末間データ転送の対象になって壊れるため。
- assets の `noCompress` は**あえて設定していない**。どのみち展開が必要で非圧縮にする利点が無く、`sys.dic` は deflate で 21%（103MB → 21.7MB）まで縮むので、圧縮したままの方が配信サイズが 80MB 以上小さくなる。

## ライセンス・クレジット

- `@faiare/expo-voicevox` 本体: MIT
- voicevox_core: MIT
- VOICEVOX 音声モデル (VVM) / VOICEVOX ONNX Runtime: 独自の利用規約。**VOICEVOX を利用したことがわかるクレジット表記が必要**
- OpenJTalk 辞書: BSD-3-Clause。著作権表示の再掲が必要

音声モデルの規約本文（`TERMS.txt` / `README.txt`）は `assetSource` に関係なくアプリへ同梱される。辞書の `COPYING` は辞書本体に含まれるので、`assetSource: "download"` では初回起動時の取得と同時に端末へ置かれる。

キャラクターごとに条件が異なり、企業利用に事前確認が必要なものもあるので `TERMS.txt` を確認すること。`npx expo prebuild` を実行すると、この要件がログにも出る。

## 現時点で扱っていないもの

歌唱合成（`s0.vvm` は同梱できるが合成 API を公開していない）。
音声モデルの実行時アンロード（`initialize()` のやり直しで代替）。
Android の Play Asset Delivery（`assetSource: "download"` で代替）。

**ストリーミング合成は voicevox_core 0.17.0 自体に存在しない**（C ヘッダにも Java の `Synthesizer` にも該当 API が無い）。`streaming_talk` はスタイルの種別名で、逐次出力の合成を指すものではない。
