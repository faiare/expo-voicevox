# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクトの目的

`create-expo-module` で生成した直後の状態から、**voicevox-core を組み込んで Expo アプリに音声合成機能を提供する** ネイティブモジュール（npm パッケージ `@faiare/expo-voicevox`）を作る。

- 対象プラットフォームは **iOS / Android のみ**。`expo-module.config.json` の `platforms` も `["apple", "android"]` のみ。
- `src/ExpoVoicevoxModule.web.ts` はテンプレート由来の web スタブ。web はサポート対象外なので、API 追加時に web 実装を作り込む必要はない（バンドラの解決を壊さないためにファイル自体は残す）。
- 音声合成 API は実装済み。基本（`getVersion` / `isInitialized` / `prepareAssets` / `initialize` / `getCharacters` / `tts` / `finalize`）に加え、AudioQuery 一式（`createAudioQuery` / `createAudioQueryFromKana` / `synthesis` / `ttsFromKana`）、アクセント句編集（`createAccentPhrases` 系 / `replaceMoraData` / `replacePhonemeLength` / `replaceMoraPitch` / `audioQueryFromAccentPhrases`）、ユーザー辞書（`setUserDictWords` / `loadUserDictFile` / `saveUserDictFile`）が揃っている。アセットの取得と配置は `plugin/` の config plugin が担う。
- メモリ上の WAV をそのまま鳴らす `speak` 系（`speak` / `speakFromKana` / `speakFromAudioQuery` / `stopSpeaking` / `isSpeaking` / `waitForSpeech`）もある。再生制御は停止までで、pause / resume / volume と文分割の逐次再生は入れていない（1 発話 = 1 合成 = 1 再生）。
- アセットは `getAssetStatus()` で「使える状態か / 何 MB 取りに行くか」を副作用なしに問い合わせられ、`cancelPrepareAssets()` で進行中の準備を中断できる（中断かどうかは `isPrepareAssetsCancelled()` で見分ける）。
- 合成結果はネイティブ側の LRU キャッシュに載るので、同じ入力の 2 回目は推論をやり直さない（`clearSynthesisCache` / `getSynthesisCacheStats`、`initialize` の `synthesisCacheBytes`、各呼び出しの `cache: false`）。鳴らさず温めるだけの `precacheSpeech` 系もある。
- `speak` / `tts` 系は `speedScale` / `prePhonemeLength` などの合成パラメータを直接受ける（AudioQuery を組み立てずに話速と頭出しを変えられる）。
- **未対応**は歌唱合成（SING）とモデルの実行時アンロードのみ。ストリーミング合成は voicevox_core 0.17.0 自体に API が無い（C ヘッダに `stream` の出現が 0 件）ので「未対応」ではなく「上流に無い」。

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
npm run changeset      # リリースノート用の .changeset/*.md を対話で作る
npm run release:version # changeset version + package-lock.json の同期（CI が呼ぶ。手で叩かない）
npm run setup:voicevox # voicevox-core のバイナリを取得（開発者用）
npm run gen:vvm-catalog # VVM のキャラクター対応表を再生成（メンテ用・要ネットワーク）
npm run refresh:artifact-digests # 配布物の size / sha256 の固定表を作り直す（メンテ用・要ネットワーク）
npm run check:expo-major # npm の expo@latest がこのリポジトリより新しいメジャーか調べる
npm run e2e            # Maestro の E2E（要ビルド済みアプリ。下の「E2E」を読むこと）
npm run e2e:ios        # iOS シミュレータだけで回す
npm run e2e:android    # Android エミュレータだけで回す
npm run e2e:smoke      # smoke タグだけ（起動 → アセット → 初期化 → 合成/再生）
npm run e2e:lint       # 端末なしでフローの構文だけ見る
npm run e2e:build:ios  # Release で example をビルド（Metro が要らない）
npm run e2e:dev:ios    # Debug で example をビルド（別途 Metro が要る）
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

### シミュレータ / エミュレータでの動作確認

再生のようにネイティブでしか確かめられないものは、実際に example を動かして確認する。

```bash
# iOS: 起動済みシミュレータへ install して起動（Debug なので Metro が要る）
xcrun simctl boot <UDID>; xcrun simctl install <UDID> example/ios/build/Build/Products/Debug-iphonesimulator/expovoicevoxexample.app
xcrun simctl launch <UDID> expo.modules.voicevox.example

# Android: ビルドから install / 起動まで
cd example && npx expo run:android
```

UI 操作は **Maestro に任せる**（下の「E2E（Maestro）」）。座標を自分で計算する必要は無く、
`scrollUntilVisible` が目的の要素を画面の中央まで運んでくれるので、ビューポートの外を押していた・
スワイプの慣性で行き過ぎた・Android の下部トーストにタップを吸われた、といった事故が起きない。

Maestro のセレクタで拾えないものを調べるときだけ、iOS は `axe describe-ui --udid <UDID>`、
Android は `adb shell uiautomator dump` を探索用に使う（`maestro hierarchy` で足りることが多い）。
エージェントで回すときの注意:

- **`until` の無限ループを書かない**。反応しない要素を永久に待ち続ける。必ず回数上限を付ける。
- **エミュレータや Metro はツールのバックグラウンド実行で起動する**。`nohup ... &` だと
  ツール呼び出しの終了時にプロセスごと回収されて落ちる（macOS に `setsid` は無い）。

**`Metro が変更を配らないことがある`**。ファイルを直しても、アプリを再起動しても古い JS のまま
動き続けることがある（`curl localhost:8081/index.bundle?platform=ios&dev=true` で配信中の中身を
grep すると、Metro 自体が古いコードを持っていると分かる）。**`npx expo start --clear` で
Metro を起動し直してからアプリを再起動する**のが確実。app の再インストールだけでは直らない。

`src/` を変更したら **`npm run build` を先に実行**すること。`package.json` の `main` は `build/index.js` で、example は build 出力を解決する。

### E2E（Maestro）

`.maestro/` にフローがある。**手順と設計は `.maestro/README.md` に書いてあるので、
フローを触る前にそちらを読むこと。** ここには要点だけ残す。

- 前提は Maestro 2.8.0 / Java 17 と、**ビルド済みの example が端末に入っていること**。
  appId は iOS / Android とも `expo.modules.voicevox.example`。
- **フローを書いている間は Debug + Metro**（testID を足すたびにリビルドしていられない）、
  **一通り書けたら Release で通す**（dev トーストも LogBox も出ず、Metro が古い JS を配る事故も
  起きない）。
- **音が鳴ったかは Maestro からは分からない**。ネイティブの再生器が出すイベント（`speech-state`）と、
  合成結果に載る再生時間で確かめている。キャッシュは 2 回目が速いことをスクリプトで数値として比べる。
- **テキストの一致は完全一致の正規表現**。部分一致には `.*` を付ける。複数行にまたがるステータスは
  `(?s)` を頭に置く。
- **iOS では `Pressable` の子の `Text` が親へマージされて消える**。読みたい値はタップ領域の外に置く
  （`Toggle` はそのために親子から兄弟へ組み替えてある）。
- **Maestro は画面に映っている要素しか見ない**。位置に依存する値は `scrollUntilVisible` で運んでから
  見る。「消えたこと」を見るときは、消える前に見えていたことを先に確かめないと空振りになる。
- **入力欄に触れるとキーボードが画面の下半分を覆う**。その下にある要素はタップが吸われるので、
  値の変更は入力より先に済ませ、入力の直後に `pressKey: Enter` で畳む（単一行の入力欄なら
  blur する）。`hideKeyboard` は iOS だと落ちることがあるので使っていない。
- **dev ビルドの警告は 0 件に保つ**。LogBox の通知は見えている黒帯より広くタップを吸うので、
  重なっていないボタンまで押せなくなる（Maestro は「タップした」と報告したまま何も起きない）。
- **`react-native` の `SafeAreaView` は iOS でしか効かない**（0.86 で非推奨）。Android では
  素の View なので上部の固定バーがシステムのステータスバーの裏に潜り、アクセシビリティツリー
  ごと消える。example は `react-native-safe-area-context` を使っている。
- Android の `initialize()` は暗黙に `prepareAssets()` を呼ぶ。初回は 130MB の展開を含むので、
  初期化と合成の待ちは 300 秒にしてある。`00-assets` を先頭に固定してこのコストを 1 本目で払う。
- **`clearState` は既定のフローでは使わない**。Android では展開済みのモデルと辞書ごと消える。
  中断の検証（`90-prepare-cancel`）だけは避けられないので `manual` タグで既定から外してある。
- `.mcp.json` に Maestro の MCP サーバを登録してあるので、フローを書いて即実行し、
  失敗した画面をその場で見て直せる。

### CI

`.github/workflows/ci.yml` が push（main）と PR で 2 ジョブ回す。どちらも ubuntu-latest で、iOS は macOS runner の実行時間が見合わないので入れていない（`xcodebuild` は手元で通す）。

- **js**: `npm ci` → `npm run lint` → `npm test` → `npm test plugin` → example で `npm ci` と `tsc --noEmit`。
- **android**: 上に加えて `npx expo prebuild --platform android --no-install` → `./gradlew :faiare-expo-voicevox:testDebugUnitTest`。

**Maestro の E2E は `ci.yml` には入っていない**。別ワークフロー（`e2e.yml`）で、既定では PR で回らない。下の「Maestro の E2E」節を読むこと。

CI 特有の前提が 3 つある。

- **`npm ci` はルートの `package-lock.json` が `package.json` と同期していないと即失敗する**。ローカルの `npm install` は黙って動き続けるので気付けない。依存を触ったら lock も一緒にコミットすること。
- **`npm ci` は `prepare`（`internal/module_scripts/prepare.js`）を走らせる**ので、build/ と plugin/build/ の tsc はこの時点で通っている必要がある。逆に言えば prebuild が `app.plugin.js` から require する `plugin/build/withVoicevox` もこれで用意される。
- **`example/android` は生成物なのでリポジトリに無い**。Gradle を回すには prebuild が要り、そこで config plugin が 130MB 超を取得する。`~/.cache/expo-voicevox` を `actions/cache` で使い回しており、キーは `plugin/src/core/versions.ts` / `plugin/src/core/artifacts.generated.ts` / `example/app.json` のハッシュ。バージョンや `voices` を変えると当然取り直しになる。

#### Maestro の E2E（`e2e.yml`）

`.github/workflows/e2e.yml` が Maestro のフローを回す。**`ci.yml` とは別ファイル**（トリガもランナー要件も違い、`concurrency` を共有すると E2E のキャンセルが lint まで巻き込む）。**現状は Android（ubuntu-latest）のみで、iOS は入っていない**。

| トリガ | 範囲 |
|---|---|
| PR（`e2e` ラベルが付いているときだけ） | `--include-tags smoke`（00/01/02 の 3 本） |
| main への push | manual 以外の全フロー |
| `workflow_dispatch` | 入力 `scope` で smoke / full を選ぶ |

`check-syntax` だけの `lint` ジョブは端末が要らないので、ラベルに関係なく全 PR で回る。

ネイティブを触ったときは手元から任意のブランチに投げるのが主経路。

```bash
gh workflow run e2e.yml --ref feat/xxx -f scope=smoke && gh run watch
```

- **`e2e.yml` が main に載るまで `workflow_dispatch` は使えない**（イベントの登録が default ブランチの定義に依存する）。載る前の検証は PR に `e2e` ラベルを付ける形でしかできない（`pull_request` は head ブランチのワークフローファイルを使う）。
- **ラベルの無い PR ではジョブが skip されるので、required status check にしてはいけない**。永久に pending になる。
- **cron は入れていない**。依存は lock と `plugin/src/core/versions.ts` でピン留め済みで、コミット無しに壊れる要素はランナーイメージの更新くらいしかない。しかも `~/.cache/expo-voicevox` が効いている限り取得経路は再検証されないので、定期実行しても「上流から消えた」は検知できない。Maestro CLI も `MAESTRO_VERSION: 2.8.0` で固定してある。
- **エミュレータの `emulator-options` から `-noaudio` を外してある**。`reactivecircus/android-emulator-runner` の既定値には入っているが、`speak` 系の検証は `AudioTrack` が実際に出す `speech-state` を見ているので、音声デバイスを殺すと `02-synthesis` が意味を失う。スナップショット作成用の空回しのほうには付けてよい。
- **`android-emulator-runner` の `script` で行末のバックスラッシュ継続を使ってはいけない**。このアクションは script を `@actions/exec` の引数分割に通すので、`\` がそのまま引数として渡って `Flow path does not exist: .../\` で落ちる。1 コマンド 1 行で書くこと。
- **エミュレータを起動する前に `pulseaudio` のダミーシンク（`module-null-sink`）を立てる**。無いと `02-synthesis` が `Assertion is false: .*#\d+ started.*, id: speech-state` で落ちる（JS 側は「再生中」まで進むのに、ネイティブの再生器が `started` を観測させないまま終わる）。**紛らわしいが、シンクを立ててもエミュレータの「Could not init `pa` audio driver」は消えない**。このメッセージは無視してよく、判断材料は `02-synthesis` が通るかどうかだけ（入れると通り、外すと落ちるのを CI で確認済み）。
- **APK は `-PreactNativeArchitectures=x86_64` で 1 ABI に絞る**（既定は `arm64-v8a,x86_64`）。エミュレータは x86_64 なので、NDK のビルド時間と APK サイズがおおよそ半分になる。`assembleRelease` は JS を焼き込むので Metro は要らず、release も `signingConfigs.debug` を使うので keystore も要らない。
- **Debug ではなく Release で回す**。Debug は LogBox がタップを吸う（`.maestro/README.md`）。
- アセットのキャッシュは `ci.yml` の `android` ジョブと**同一のキー**。`runner.os` が同じ `Linux` なので、先に走ったほうが温めたものをそのまま拾う。AVD のスナップショットは別途 `~/.android/avd` をキャッシュしている。
- 失敗すると `.maestro/output` と `maestro-report.xml` が artifact に上がる。既定の `~/.maestro/tests/{timestamp}/` はランナーから拾いにくいので `--debug-output` で明示し、**`--flatten-debug-output` も付けている**（付けないと `.maestro/output` にファイルが残らず、artifact が `maestro-report.xml` 1 本だけになる）。
- 所要時間の実測（smoke）は Android ジョブが 12 分、うち `:app:assembleRelease` が 5 分、AVD スナップショットの作成が 1 分 40 秒（2 回目以降はキャッシュで飛ぶ）、Maestro の 3 本が 2 分 27 秒。**RN 0.86 はプリビルド済みの Android アーティファクトを配るので NDK のフルコンパイルは走らない**。

#### Expo のメジャー追随（`expo-major-watch.yml`）

`.github/workflows/expo-major-watch.yml` が週次（月曜 03:17 UTC）で npm の `expo@latest` を見て、メジャーがこのリポジトリより新しければ「Expo SDK NN に追随する」という issue を 1 本立てる。判定は `scripts/check-expo-major.mjs`、本文のひな形は `.github/expo-major-issue.md`。Dependabot は入れていない（メジャー追随はネイティブを含む手作業のチェックリストなので、PR より作業チケットが合う）。

- **「現在のバージョン」の出どころは `package.json` の `devDependencies.expo` だけ**。上げれば自動で鳴り止む。控えを別の場所に置かないこと。
- 重複判定は issue のタイトル完全一致（`state: 'all'`）。**一度閉じた issue は再作成されない**。
- 手元で試すなら `EXPO_LATEST_OVERRIDE=58.0.0 npm run check:expo-major`。ワークフローの `workflow_dispatch` にも同じ入力（`simulate_version`）がある。
- **public リポジトリのスケジュールワークフローは 60 日間リポジトリ活動が無いと GitHub に自動で無効化され、`workflow_dispatch` ごと止まる**。対策として同じファイルに `keepalive` ジョブがあり、最新コミットが 45 日より古いときだけ main に空コミットを push する。**GITHUB_TOKEN で push したコミットはワークフローを起こさない**ので、これで `ci.yml` や `publish.yml` が回ることはない（履歴の `chore: keep the scheduled workflow alive` はこれ）。
- それでも無効化されてしまったら `gh workflow enable expo-major-watch.yml` で戻す。

### リリース（changesets + npm Trusted Publishing）

main へのマージだけでリリースが進む。手で `npm version` や `npm publish` を叩くことはない。

1. 変更を入れる PR に `npm run changeset` で `.changeset/*.md` を足す（patch / minor / major と要約）。リリース不要な変更なら足さなくてよい。
2. main にマージされると `.github/workflows/publish.yml` が動く。`.changeset/*.md` が残っていれば **version PR**（`changeset-release/main` ブランチ）を作る・更新する。中身は `package.json` の version、`CHANGELOG.md`、`package-lock.json` の 3 つ。
3. その version PR をマージすると、同じワークフローが今度は publish 側に入り、tarball を作って npm に publish し、`v0.1.1` 形式の git tag と GitHub Release を作る。

**ワークフローのファイル名 `publish.yml` は変えてはいけない**。npm の Trusted Publisher は「リポジトリ + ワークフローファイル名」で照合するので、改名すると OIDC 認証が通らなくなる。npm トークンは使っていない（`id-token: write` を持つ publish ジョブだけが短命トークンを受け取る）。

ジョブは公式ガイド通り `select-mode` → `version` / `pack` → `publish` に割ってある。OIDC のトークンを受け取るジョブを最小にするための分割なので、まとめてはいけない。`workflow_dispatch` は任意のブランチから流せるので、publish ジョブだけ `if: github.ref == 'refs/heads/main'` で縛ってある（これが無いと、未公開バージョンを持つ作業ブランチから手動実行したときにそのブランチのコードが npm に出る）。

npm の Trusted Publisher には任意項目の Environment name があるが、**設定していない**。publish 直前に人の承認を挟むのが主目的の機能で、単独メンテナのこのリポジトリでは version PR のマージがすでにその役割を果たしているため。付けるなら GitHub の environment 作成・publish ジョブの `environment:` 追加・npm 側の入力を**同時に**やること（片方だけ設定したときの照合挙動は npm のドキュメントに明記が無い）。

エージェント向けの注意点が 3 つある。

- **`changeset version` は `package-lock.json` を更新しない**。放置すると次の `npm ci` が lock 不一致で落ちるので、version ジョブは `changeset version` そのままではなく `npm run release:version`（`changeset version && npm install --package-lock-only --ignore-scripts`）を呼んでいる。
- **version PR では `ci.yml` が回らない**。`GITHUB_TOKEN` で作られた PR はワークフローを起こさないという GitHub の仕様。npm の公開は取り消せないので、代わりに publish 前の `pack` ジョブで `npm ci`（= lock 検証 + prepare の tsc）と `npm test` / `npm test plugin` を通している。version PR でも CI を回したいなら GitHub App トークンを `changesets/action/version` に渡す形にする必要がある。
- **`CHANGELOG.md` は npm の強制同梱対象ではない**。`files` が許可リストなので、明示的に列挙していないと tarball から落ちる（`README` / `LICENSE` と違って npm-packlist の常時同梱リストに入っていない）。

`.changeset/config.json` は `access: "public"`、changelog は `@changesets/changelog-github`（CHANGELOG に PR とコミットのリンクが入る。version ジョブが `GITHUB_TOKEN` を env で渡している。これは changesets/action 自体の認証とは別物）。パッケージが 1 つだけのリポジトリなので、タグは `<name>@<version>` ではなく `v<version>` になる。

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
- **同期/非同期**: 合成処理は重い。`Function` ではなく `AsyncFunction`（iOS/Android 共通）で公開し、JS スレッドをブロックしないこと。同期で公開しているのは `getVersion` と `isInitialized` だけで、`isInitialized` は直列キュー / ロックの外から読まれるため iOS は `NSLock` で守った Bool、Android は `@Volatile` にしてある。**`engineQueue.sync` で借りてはいけない**（数秒かかる合成の完了まで JS スレッドが止まる）。

### 再生（speak 系）の勘所

- **再生の完了を `engineQueue` / `engineLock` の中で待ってはいけない**。待つと鳴っているあいだ
  まるごと次の合成がブロックされる。合成だけを直列化し、再生は別（iOS はメインキュー、Android は
  発話ごとの専用スレッド）で始めて即座に戻す。`stopSpeaking` / `isSpeaking` にも直列化を掛けない
  （掛けると合成の実行中に止められない）。
- **iOS: `AVAudioPlayer` を専用の `DispatchQueue` で生成してはいけない**。delegate は「生成した
  スレッドの run loop」に配送されるので、run loop の無い GCD キューで作ると
  `audioPlayerDidFinishPlaying` が永久に呼ばれず再生完了を検知できない。生成・`play()`・`stop()` は
  すべて `DispatchQueue.main` の上で行う。
- **iOS: 割り込み（着信など）では delegate が呼ばれない**。`AVAudioSession.interruptionNotification`
  を購読して自分で状態を畳む。`stop()` でも delegate は来ないので同様。
- **Android: WAV ヘッダを 44 バイト決め打ちにしない**。`synthesis()` は `outputSamplingRate` /
  `outputStereo` を反映するのでサンプルレートもチャンネル数も変わるうえ、RIFF は `fmt ` と `data` の
  あいだに他のチャンクを挟める。`VoicevoxWav` は `java.io` だけで書いてあるので JVM ユニットテストで
  検証する（`VoicevoxArchive` と同じポリシー）。
- **Android: MODE_STREAM の `stop()` は drain**（書き込み済みを鳴らし切る）。完了は
  `playbackHeadPosition >= frameCount` のポーリングで判定する。`setNotificationMarkerPosition` は
  Looper 付き Handler が要り `flush()` でリセットされるので使わない。停止は `pause()` + `flush()`。
- **Android: `AudioTrack` は書き込んでいる専用スレッドが解放する**。書き込み中の track を別スレッドから
  `release()` すると落ちるので、停止側はロックの中で参照を切って `pause()` + `flush()` までにとどめる。
- **`isSpeaking` は `isInitialized` と同じ扱い**。JS スレッドから同期で呼ばれるので、iOS は `NSLock` で
  守った Bool、Android は `@Volatile`。`DispatchQueue.main.sync` やロックの `sync` で借りない。
- **状態変化の通知はロックの外で行う**。JS のリスナーが同期的に `speak()` を呼び返すとデッドロックする。
  ロックの中では「何を通知するか」だけ決め、呼ぶのは出てから。
- `audioSession` はプロセス共有の設定を触る。既定 `'none'` では触らず、触ったら**戻さない**
  （戻すと再生中に他ライブラリが変えた設定を踏み潰す）。
- 発話の追い越しは**発話 ID の世代管理**で判定する。`speak` の入口で採番して予約し、再生の直前に
  予約がまだ最新かを見る。前の発話を止めるのは「新しい音が鳴り出す瞬間」であって `speak` が
  呼ばれた瞬間ではない（合成に失敗したときに前の音を止め損にしないため）。

### 合成キャッシュの勘所

合成結果の WAV は `VoicevoxWavCache`（`ios/VoicevoxWavCache.swift` / `android/.../VoicevoxWavCache.kt`）
に LRU で持つ。`speak` 系も `tts` 系も同じキャッシュを通る。

- **ユーザー辞書を変えたら必ず捨てる**。`setUserDictWords` / `loadUserDictFile` は読みを変えるので、
  残すと古い発音のまま鳴る。`initialize` / `finalize` / `OnDestroy` でも捨てる。`saveUserDictFile`
  は読みを変えないので捨てない。
- **キャッシュは直列化の内側にだけ置く**。合成の入口は iOS が `engineQueue`、Android が
  `engineLock` で直列化済みなので、キャッシュ自身はロックを持たない。`clearSynthesisCache` /
  `getSynthesisCacheStats` も同じキュー・ロックに載せる（**同期関数にしない**。JS スレッドが
  合成の完了まで止まる）。
- **キーは `(種別, styleId, 語尾上げ, 合成パラメータ JSON, ペイロード)`**。ペイロードは自由形式なので
  必ず最後に置く。合成パラメータの JSON は JS が固定順（`SYNTHESIS_PARAM_KEYS`）で組み立てるので、
  オブジェクトの書き順が変わってもキーは変わらない。
  `directory` は含めない（合成結果は書き出し先に依存しない）。`tts` 系はキャッシュに当たっても
  ファイルは毎回書くので、返るパスは常に別物。
- **`precacheSpeech` 系は「鳴らさず・書かず・キャッシュにだけ入れる」**。`cache: false` は付けられない
  （付けたら何も残らず呼ぶ意味が無い）。
- **上限は件数ではなくバイト数**（既定 32MB）。1 件の WAV は数十 KB〜数 MB と幅があり、件数では
  メモリ使用量の上限が読めない。単体で上限を超える WAV は格納しない。
- `android.util.LruCache` と `NSCache` は使わない。前者は Android API なので JVM ユニットテストで
  検証できず、後者は追い出しが OS 任せでバイト単位の LRU にならない。**両 OS の挙動を 1:1 に
  揃えるため自前で書いてある**ので、追い出しの規則を変えるときは両方を直すこと。
- **`ios/` に Swift ファイルを足したら `pod install` が要る**。podspec の glob は pod install 時に
  展開されるので、回さないと `cannot find 'VoicevoxWavCache' in scope` でビルドが落ちる。

### アセットの状態取得と中断

`getAssetStatus()` は取得も展開も始めずに読める範囲だけを返し、`cancelPrepareAssets()` は
進行中の `prepareAssets()` を中断する。

- **どちらも直列化の外に置く**。iOS は `.runOnQueue(engineQueue)` を付けず、Android は
  `synchronized(engineLock)` を取らない。取ると準備の完了まで戻らず、中断そのものができない。
  同じ理由で `VoicevoxAssets` 側も `lock`（準備用）と `stateLock` / `AtomicBoolean`（中断フラグと
  `cached` の読み）を分けてある。
- **中断フラグは `prepare()` の入口で下ろす**。下ろさないと、一度中断したあと二度と準備できなくなる。
- **チェックはバッファ / チャンク単位で入れる**。ファイル単位だと 0.vvm 1 つで数秒待たされる
  （`copyCancellable` / `VoicevoxDownloader` の読み取りループ / `inflate` のチャンクループ）。
- **中断は「失敗」と区別できる必要がある**。`VoicevoxCancelledException` の文言
  `the asset preparation was cancelled` を iOS・Android・JS の `isPrepareAssetsCancelled()` の
  3 箇所が共有している。変えるときは 3 つとも直すこと。iOS の `prepareAssets()` ラッパは
  この例外だけ包み直さずに投げ直す（包むと文言が変わる）。
- **中断したら staging を消す**。iOS の `downloadAssets` は元々後始末していなかったので
  `downloadEntries` に切り出して do/catch で消すようにした（Android の `materialize` は元からこの形）。
- エミュレータでは bundle モードの展開が 250ms 程度で終わるので、**UI 操作で中断の瞬間を捉えるのは
  現実的でない**。中断そのものは `VoicevoxArchiveTest` の JVM テストで検証する。

### 合成パラメータの直接指定（speedScale など）

`speak` / `tts` 系は `speedScale` / `prePhonemeLength` などを直接受ける。指定があるとネイティブは
`tts` ではなく **createAudioQuery → JSON を書き換え → synthesis** の経路を通る（`tts` はこの 2 つを
繋いでいるだけなので、上書きが無ければ出力は一致する）。

- 書き換えは `VoicevoxAudioQueryPatch`（`ios/` と `android/` に 1:1 で置いてある）。**トップレベルの
  フィールドしか触らない**。`accent_phrases` の中に入る編集は `createAudioQuery` / `synthesis` の担当。
- **AudioQuery に無いキーは例外にする**。黙って無視すると、綴りを間違えたまま「効かない」だけの
  バグになって気付けない。
- JS からは**固定順の JSON 文字列 1 本**で渡す（`resolveSynthesisParams`）。Record を増やすより
  キャッシュキーに載せやすく、「空文字なら上書き無し」でネイティブ側の分岐も 1 つで済む。
- `speakFromAudioQuery` / `synthesis` はこれを**受け取らない**。AudioQuery 自身がパラメータを
  持っているので、重ねられるとどちらが効くのか読めなくなる。

### AudioQuery のブリッジ（重要）

AudioQuery と AccentPhrase は **voicevox-core の JSON 文字列**でブリッジを通す。iOS の C API は JSON しか受け付けず、Android の Java API もオブジェクトの内部表現が Gson の JSON なので、これが両プラットフォームを一致させる最短経路になる。構造化と命名変換は `src/audioQuery.ts` の 1 箇所だけ（`getCharacters` と同じ方針）。

- **JSON のキーは snake_case と camelCase の混在**。snake_case なのは `accent_phrases` / `pause_mora` / `is_interrogative` / `consonant_length` / `vowel_length` の 5 個だけで、`speedScale` などの AudioQuery 直下のフィールドは camelCase のまま。jar の `@SerializedName` で確認できる。
- したがって **Android の Gson は `FieldNamingPolicy` を触ってはいけない**。既定（フィールド名そのまま）が正しい。`LOWER_CASE_WITH_UNDERSCORES` にすると `speedScale` まで変換されて iOS と食い違う。null を省略しないよう `serializeNulls()` だけ設定してある。
- 疑問文の語尾上げ（`enableInterrogativeUpspeak`）は **JS 側が常に明示して渡す**。iOS の `voicevox_make_default_tts_options()` は true を返すが、Android の `Synthesizer$TtsConfigurator` はフィールドを初期化せず Java 既定の false になるため、ネイティブの既定値に任せると挙動が割れる。

### ユーザー辞書

`voicevox_open_jtalk_rc_use_user_dict` のヘッダに「**この関数を呼び出した後にユーザー辞書を変更した場合、再度この関数を呼び出す必要がある**」と明記されている。そのため:

- 両 OS で **OpenJTalk のハンドルを `VoicevoxEngine` が保持**している（Synthesizer を作った直後に捨ててはいけない）。`release()` は Synthesizer と OpenJTalk を解放し、ユーザー辞書は次の `initialize()` のために残す。
- JS の API は**全置換（`setUserDictWords`）**にしてある。追加・削除を個別に扱う形にすると再適用の呼び忘れが無言で効かないバグになる。単語の UUID は辞書を作り直すたびに振り直されるので JS へは渡さない。
- **読み出す API は作らない**。`voicevox_user_dict_to_json` が返すのは MeCab 形式（`word_type` を持たず品詞から逆引きする）で、Android の `UserDict.toHashMap()` が返す 5 フィールドの `UserDictWord` と形が違い、両 OS で同じ値を返せない。
- iOS で辞書を差し替えるときは **`use_user_dict` を成功させてから旧辞書を `voicevox_user_dict_delete`** する。破棄済みの辞書に触るとプロセスごと落ちる。

#### C 構造体が保持する文字列の寿命（Swift）

`VoicevoxUserDictWord` は `surface` / `pronunciation` を **`const char *` で保持する**（コピーしない）。
ヘッダの safety に「`voicevox_user_dict_add_word` の時点で有効でなければならない」と書かれているので、
Swift の `String` を `voicevox_user_dict_word_make` にそのまま渡してはいけない。Swift が用意する
一時的な C 文字列はその呼び出しが終わると解放され、`add_word` が解放済みメモリを読んで
`VOICEVOX_RESULT_INVALID_USER_DICT_WORD_ERROR`（24）になる。**`withCString` のスコープ内で
`add_word` まで済ませること**（`ios/VoicevoxEngine.swift` の `addWord`）。

`tts` / `synthesis` / `open_jtalk_rc_new` などは文字列を呼び出し中しか読まないので、`String` を
直接渡してよい。構造体に残るのはこの 1 箇所だけ。

### C API を Swift から呼ぶときの型の曖昧さ

`VoicevoxResultCode` / `VoicevoxAccelerationMode` / `VoicevoxUserDictWordType` は「enum タグ」と「int32_t の typedef」が両方ヘッダにあり、Swift では型名として曖昧になる。**値は `Int32` として扱い、`Int32(VOICEVOX_XXX.rawValue)` で取り出す**こと。

また C の enum 定数は `voicevox_core` を import しているファイルからしか見えない。`ios/ExpoVoicevoxModule.swift` は import していないので、定数の引き当ては `ios/VoicevoxEngine.swift` 側に置く。

### config plugin（`plugin/`）

`app.json` の plugin config に使いたい声を書くだけで、`npx expo prebuild` がモデル・辞書・ネイティブバイナリの取得と配置まで済ませる。エントリは `app.plugin.js` →  `plugin/build/withVoicevox.js`。

**声の指定はキャラクター名 + スタイルの slug**（`"zundamon/normal"`）で、キャラクター名だけの指定は**エラーにする**。1 キャラクターの声が複数の `.vvm` に分かれている（ずんだもんのトークは `0.vvm` / `5.vvm` / `15.vvm` の 3 ファイル ≈ 176MB）ため、キャラクター名だけでは何 MB 取り込まれるか `app.json` から読み取れないから。

- **キャラクターの slug は VOICEVOX 公式サイトの product URL（`https://voicevox.hiroshiba.jp/product/<slug>/`）に合わせる**。独自にローマ字を当てると読みを誤る（雀松朱司は「すずめまつ」ではなく `wakamatsu`、黒沢冴白は「さはく」ではなく `kohaku`、†聖騎士 紅桜† は `horinaito_benizakura`）。
- 対応表は `npm run gen:vvm-catalog` が上流 README（`VOICEVOX/voicevox_vvm` の `scripts/make_docs.py` 生成物）から `plugin/src/vvm/catalog.generated.ts` を作る。手書きするのは `plugin/src/vvm/slugs.ts` だけ。**slug 未定義の名前が 1 つでもあると生成は失敗する**ので、VVM のバージョンを上げたときの取りこぼしは黙って通らない。
- 歌唱（`s0.vvm`）の声は、キャラクター名 + スタイルの組が必ずトーク側にも存在する。よって `kind: 'song'` を除外しても名前で引けなくなる声は無く、`zundamon/normal` は常にトークの `0.vvm` を指す。

#### エージェント向けの落とし穴

- **`package.json` の `files` を指定すると `.npmignore` は完全に無視される**（npm-packlist はこの許可リストだけを見る）。`ios` / `android` をディレクトリごと書くと、plugin が prebuild 時に取得する `ios/Frameworks` `android/libs` `android/src/main/jniLibs` や Gradle の `android/build` まで tarball に入り 100MB を超える。必要なパスだけを列挙すること。変更したら必ず `npm pack --dry-run --json --ignore-scripts` で中身を確認する（正常値: 100 ファイル前後 / tarball 150KB 前後・展開後 580KB 前後。最大のファイルは `plugin/build/vvm/catalog.generated.js` の約 36KB）。ネイティブバイナリが 1 つでも混ざれば MB 単位になるので、桁で判断できる。
- **`plugin/tsconfig.json` の `tsBuildInfoFile` は `./build/` の中を指すこと**。既定では `plugin/tsconfig.tsbuildinfo` に出るため、`internal/module_scripts/prepare.js` が `plugin/build` を消しても `tsc --build` が「最新」と判断して何も出力せず、**publish 時に `plugin/build` が空になる**。
- **`plugin/jest.config.js` は `transform` を上書きしている**。`jest-expo/node` プリセット（`getNodePreset()`）は babel-jest のオプションを `caller` だけで置き換えるため、素の jest-expo プリセットが入れている `babel-preset-expo` が落ちて TypeScript を解釈できなくなる。
- **config plugin から `resolveFrom(projectRoot, '@faiare/expo-voicevox')` は使えない**。`example/package.json` の `nativeModulesDir: ".."` は autolinking 専用でモジュール解決には効かず、example から `@faiare/expo-voicevox` は resolve できない。パッケージルートは `__dirname` 基準で求めること。同じ理由で `example/app.json` の plugin 指定は `"../app.plugin.js"` という相対パス形式になる（利用者向けの README には `"@faiare/expo-voicevox"` 形式を書く）。
- **パッケージ名がスコープ付きなので Gradle のプロジェクト名は `faiare-expo-voicevox`**（autolinking の `convertPackageToProjectName` が `@` を落として `/` をハイフンにする）。iOS の pod 名は podspec 由来なので `ExpoVoicevox` のまま。ログ接頭辞・キャッシュディレクトリ名（`~/.cache/expo-voicevox`）・Android の展開先（`noBackupFilesDir/expo-voicevox`）はパス/表示文字列なのでスコープを付けていない。

### バージョン注意

- モジュール本体の devDependencies は expo `^57.0.13` / TypeScript `^5.9.2`、example は TypeScript `~6.0.3` と**食い違っている**（テンプレート生成時の差）。型エラーやビルド差異が出たらまずここを疑う。react-native は両方 `0.86.2` で揃っている。
- Android は新アーキテクチャ有効（`newArchEnabled=true`）、Hermes 有効。

### Expo のドキュメント参照

`example/AGENTS.md` に「Expo は仕様が変わっている。コードを書く前に https://docs.expo.dev/versions/v57.0.0/ のバージョン固定ドキュメントを読むこと」と明記されている。Expo Modules API を触る際はこれに従う。

## コードスタイル

- ESLint は `eslint-config-universe` の flat config。`src/` は native + web、`plugin/src/` と `scripts/` は node 設定。`build` / `plugin/build` / `plugin/src/vvm/catalog.generated.ts`（生成物）は無視対象。
- Prettier: printWidth 100 / singleQuote / bracketSameLine / trailingComma es5。
- tsconfig は `strict` に加え `noUnusedLocals`・`noImplicitReturns`・`noFallthroughCasesInSwitch` が有効。
