# E2E（Maestro）

example アプリを実際に動かして、合成と再生がネイティブまで通っていることを確かめる。
ユニットテストでは触れない層（voicevox-core のリンク、モデルの読み込み、音の再生）が対象。

## 実行

```bash
npm run e2e:lint        # 端末なしで YAML の構文だけ見る
npm run e2e:ios         # iOS シミュレータ
npm run e2e:android     # Android エミュレータ
npm run e2e:smoke       # smoke タグだけ（起動 → アセット → 初期化 → 合成/再生）
npm run e2e -- .maestro/02-synthesis.yaml   # 1 本だけ
```

前提はビルド済みのアプリが端末に入っていること。

```bash
npm run e2e:build:ios       # Release（Metro が要らない）
npm run e2e:build:android
npm run e2e:dev:ios         # Debug（別途 Metro が要る）
npm run e2e:dev:android
```

`maestro` が見つからないときは `PATH="$HOME/.maestro/bin:$PATH"` を前に付ける。

## フロー

| ファイル | 何を確かめるか | タグ |
|---|---|---|
| `00-assets.yaml` | `getAssetStatus()` / `prepareAssets()`。Android の初回展開もここで払う | smoke, assets, slow |
| `01-initialize.yaml` | `initialize()` と `getCharacters()`、`finalize()` の有効・無効 | smoke, core |
| `02-synthesis.yaml` | `synthesis()` / `speak()` / `stopSpeaking()` / 書き出し先の切り替え | smoke, core |
| `03-params.yaml` | `speedScale` などの増減と下限、疑問文の語尾上げ | feature |
| `04-accent.yaml` | アクセント句の取得・編集・再合成、`replaceMoraData()` | feature |
| `05-user-dict.yaml` | `setUserDictWords()` の全置換、初期化前の登録 | feature |
| `06-kana.yaml` | `createAudioQueryFromKana()` | feature |
| `07-cache.yaml` | 合成キャッシュ。2 回目が速いことを数値で確かめる | feature, slow |
| `08-finalize.yaml` | `finalize()` と、そのあとの再初期化 | core |
| `90-prepare-cancel.yaml` | `cancelPrepareAssets()`。**既定では回らない**（下記） | manual |

`subflows/` は部品なので単体では回らない（`config.yaml` の `flows` で
トップレベルの `*.yaml` だけに絞ってある）。

- `launch.yaml` … 起動と、操作できる状態になるまでの待ち
- `initialize.yaml` … 起動 + `initialize()`
- `wait-idle.yaml` / `wait-idle-long.yaml` … 処理の完了待ち（60 秒 / 300 秒）

## 設計

### 音が鳴ったかどうかは 3 つの手掛かりで確かめる

Maestro は音を聞けない。代わりに次の 3 つを見る。上ほど強い証拠になる。

1. **`speech-state`** — ネイティブの再生器が出すイベント（`started` / `finished` /
   `stopped` / `failed`）。JS が書いた文字列ではなく、再生器そのものの状態遷移。
2. **`status-text` の合成結果** — 書き出したパスや再生時間（`durationMillis`）。
   時間が返っていれば PCM は生成されている。
3. **`status-error` が出ていないこと**。

`stopSpeaking()` の結果だけは `status-text` では見ない。停止処理が書く文字列と
`waitForSpeech()` が書く文字列が競合して、どちらが最後に残るか決まらないため。
`speech-state` はイベントリスナしか書かないので決定的に見られる。

### セレクタは testID で指す

画面の文言は日本語で、`−` `＋` `ON` `OFF` `削除` のように同じ文字列が何度も出る。
テキストで指すと壊れるので、`id:` で指す。React Native の `testID` は iOS では
アクセシビリティ識別子、Android では `resource-id` になるので、同じ書き方が
両方で通る。

### 遠くまでスクロールするなら `timeout` を伸ばす

`scrollUntilVisible` の既定のタイムアウトは **20 秒**。`speed: 30` のスワイプは CI の
エミュレータで 1 回 2.6 秒ほどかかり、8 セクションあるこの画面の最下部までは 8 回前後
必要になる。つまり既定では**到達した直後にタイムアウトする**。

厄介なのは、そのときのエラーが `No visible element found` で、失敗時のスクリーンショットには
目的の要素がしっかり映っていること（最後のスワイプで到達し、次の確認の前に時間切れになる）。
「映っているのに見つからない」ときは、まずタイムアウトを疑う。

最下部を指すときは `centerElement` も外す。これ以上スクロールできないので中央へ寄せられず、
寄せようとして残り時間を食い潰す。

既定のフローは **すべての `scrollUntilVisible` に `timeout: 120000` を明示**してある。伸ばしても
要素が早く見つかればその時点で進むので、待ち時間が増えるわけではない。

### `assertVisible` の前にその要素まで戻す

`assertVisible` は画面に映っていることを要求する。`03-params` は `btn-params-reset` まで
スクロールしてからタップし、そのまま話速の値を assert していたので、話速の行が画面の上に
隠れて落ちた。**離れた位置の値を見るときは `scrollUntilVisible` で戻してから見ること。**

上部のステータスバーは**本文の行数で高さが変わる**（WAV のパスは 3 行、「再生中 #1（7232ms）」は
1 行）ので、下端ぎりぎりの要素は入ったり入らなかったりする。`02-synthesis` の `speech-state` が
これで落ちた。**一連の assert が終わるまで見続ける要素は、先に画面の中央へ寄せておく**
（`btn-stop-speaking` を中央にすると `btn-speak` が上、`speech-state` が直下に収まる）。

### テキストの一致は正規表現で、部分一致には `.*` を付ける

Maestro のテキスト照合は完全一致の正規表現。`合成しました` のように前後に
別の文字が付く文字列を見るときは `.*合成しました.*` と書く。複数行にまたがる
ステータス（`prepareAssets()` の結果）は `(?s)` を先頭に置いて `.` を改行にも
当てる。

### assert したいテキストは Pressable の外に置く

iOS では `Pressable` の子の `Text` が親へマージされ、アクセシビリティツリーから
消える。`Toggle` はこれを避けるためにラベルとバッジを親子から兄弟へ組み替えて
ある（`example/App.tsx` の `Toggle`）。値を読みたい要素を新しく足すときも、
タップ領域の中に入れないこと。

### キーボードは入力の直後に畳む

入力欄に触れるとキーボードが画面の下半分を覆い、その下にあるボタンやステッパーは
タップを吸われて反応しない。リストの先頭までスクロールしても、覆われた位置より上へ
出てこない要素は押せないままになる（`05-user-dict` の `initialize()` がこれで落ちて
いた）。

- 値の変更（品詞・優先度）は**入力より先に**済ませる。
- 入力の直後に `pressKey: Enter` を送る。辞書の入力欄は単一行なので blur して
  キーボードが畳まれる。
- `hideKeyboard` は iOS だと閉じ方を見つけられずに落ちることがあるので使わない。

### dev ビルドの警告を 0 件に保つ

RN の LogBox は警告が 1 件でもあると画面下部に通知を出し、**見えている黒帯より
広い範囲のタップを吸う**。黒帯に重なっていないボタンでも押せなくなり、Maestro は
「タップした」と報告したまま何も起きない（`02-synthesis` の `speak()` がこれで
落ちていた）。Release では出ないが、フローを書いている間は Debug なので、警告は
残さず潰すこと。

`react-native` の `SafeAreaView` は 0.86 で非推奨になっていて、これが唯一の警告
だった。推奨どおり `react-native-safe-area-context` へ移してある。ついでに、
`react-native` の `SafeAreaView` は **iOS でしか効かない**（Android では素の View）
ので、上部の固定バーがシステムのステータスバーの裏に潜り、Android の
アクセシビリティツリーから `status-busy` ごと消えていた問題も同時に直っている。

### Android のドライバが起動しないとき

`Maestro Android driver did not start up in time` で始まる前に落ちることがある。
端末側に残ったドライバを消してから回し直す。

```bash
adb uninstall dev.mobile.maestro
adb uninstall dev.mobile.maestro.test
```

### 端末の状態を壊さない

`clearState` は既定のフローでは使わない。Android では展開済みのモデルと辞書
（130MB）ごと消えて、次の初期化がやり直しになるため。中断の検証だけはこれが
避けられないので、`manual` タグを付けて既定の suite から外してある。

```bash
maestro test --include-tags manual .maestro/90-prepare-cancel.yaml
```

### 待ち時間

Android の `initialize()` は暗黙に `prepareAssets()` を呼ぶので、初回は 130MB の
展開を含む。初期化と合成の待ちは 300 秒にしてある（早く終わればそのぶん待たない）。

## CI で回す

`.github/workflows/e2e.yml` が **Android（ubuntu-latest のエミュレータ）と iOS（macos-15 の
シミュレータ）**を並列で回す。どちらのランナーも public リポジトリなら無料・無制限で使える。
範囲の決定は `scope` ジョブ 1 つに集約してあり、`e2e` ラベルによる出し分けもここが持つ
（skip されれば端末ジョブも一緒に skip される）。

| トリガ | 範囲 |
|---|---|
| PR に `e2e` ラベルを付けたとき | `--include-tags smoke`（00/01/02） |
| main への push | `manual` 以外の全フロー |
| `workflow_dispatch` | 入力 `scope` で smoke / full を選ぶ |

ラベルの無い PR では回らない。ネイティブを触ったときは手元から投げるのが早い。

```bash
gh pr edit --add-label e2e                                  # PR のチェックとして緑を見たいとき
gh workflow run e2e.yml --ref feat/xxx -f scope=smoke       # 手元で確かめたいだけのとき
gh run watch
```

`maestro check-syntax` だけの `lint` ジョブは端末が要らないので、ラベルに関係なく全 PR で回る。

失敗すると `.maestro/output`（スクリーンショットとログ）と `maestro-report.xml` が artifact に
上がる。`gh run download <run-id>` で落として、落ちたステップの直前のスクリーンショットを見る。

CI 側の作りで踏みやすいのは 2 点。

- **エミュレータの `emulator-options` から `-noaudio` を外してある**。`reactivecircus/android-emulator-runner`
  の既定値には入っているが、音が鳴ったかの判断は `speech-state`（`AudioTrack` が出す実際の状態遷移）に
  頼っているので、音声デバイスを殺すと `02-synthesis` の検証が空になる。
- **APK は `-PreactNativeArchitectures=x86_64` の Release**。Debug は LogBox がタップを吸う。
  **Android のエミュレータを arm64 にはできない**。Linux arm64 ランナーには `/dev/kvm` が無く、
  macOS ランナーは VM の中なのでネスト仮想化が効かず HVF が `HV_UNSUPPORTED` で落ちる。
  arm64 の検証は iOS（macos-15 = Apple Silicon）が担う。
- **iOS も Release**（`xcodebuild -configuration Release -sdk iphonesimulator`）。Release の
  ビルドフェーズが JS バンドルを `.app` に埋めるので Metro が要らない。端末は
  `xcrun simctl list devices available --json` から**新しいランタイムの iPhone を 1 台選ぶ**
  （端末名を固定するとランナーイメージの Xcode が上がった時点で落ちる）。
- **iOS の再生はホスト macOS の CoreAudio に出る**。ランナーイメージの Null Audio Device は
  起動時の初期化に 3 割ほど失敗する（actions/runner-images#13668）ので、出力デバイスが
  無ければ `coreaudiod` を再起動して拾い直している。無いままだと `AVAudioPlayer.play()` が
  false を返し、`02-synthesis` が「could not start the audio player」で落ちる。
  **BlackHole の追加インストールでは直らない**（反映に再起動が要る。runner-images#11746）。
- **エミュレータの RAM は 6GB**。既定の 2GB では 130MB の展開とモデルの読み込みでシステムが
  圧迫され、「Pixel Launcher isn`t responding」が最前面に出る。アプリは正常でも全フローが
  launch の待ちで落ちるので、スクリーンショットを見ないと原因が分からない。
- **CI は `--config .maestro/config.ci.yaml` で fail-fast**。1 本目が落ちたら止める。ローカルは
  `config.yaml`（`continueOnFailure: true`）のままで、全部の結果が出る。
- **`adb install` の直後は待つ**。200MB の APK の dexopt でエミュレータが忙しく、adb が
  `device offline` で一瞬落ちて `launchApp` が `DeviceServerDiedException` になる。
- **エミュレータの前に `pulseaudio` のダミーシンクを立てている**。無いと `02-synthesis` が
  `speech-state` の `started` で落ちる。**シンクを立ててもエミュレータの
  「Could not init `pa` audio driver」は消えない**ので、あのメッセージでは判断しないこと。
- **`android-emulator-runner` の `script` は 1 コマンド 1 行で書く**。行末のバックスラッシュ継続は
  `@actions/exec` の引数分割を通るときに壊れ、`Flow path does not exist` で落ちる。

## つまずいたとき

```bash
maestro hierarchy --platform ios      # 実際の要素ツリーを見る
maestro studio                        # 画面を見ながらセレクタを試す
maestro test --debug-output .maestro/output .maestro/02-synthesis.yaml
```

スクリーンショットとログは既定で `~/.maestro/tests/{timestamp}/` に残る。

Debug ビルドで回していて「testID を足したのに見つからない」ときは、まず Metro を
疑う。古いバンドルを配り続けることがあるので `npx expo start --clear` で起動し直す。
アプリを入れ直しても直らない。

## testID の一覧

`example/App.tsx` を変えたらこの表も直すこと。

| testID | 要素 |
|---|---|
| `status-bar` / `status-busy` / `status-initialized` / `status-text` / `status-error` | 画面上部の固定バー。`status-busy` は `BUSY` / `IDLE` |
| `section-lib` … `section-cache` | 各セクション（スクロールの目印） |
| `lib-version` / `lib-initialized` | 1. ライブラリ の値 |
| `btn-asset-status` / `btn-prepare-assets` / `btn-cancel-prepare` / `btn-initialize` / `btn-finalize` | 2. 初期化 |
| `style-chip-{styleId}` | スタイルの選択（初期化後に並ぶ） |
| `input-text` | 合成するテキスト |
| `dir-chip-cache` / `dir-chip-document` | WAV の書き出し先 |
| `btn-synthesize-play` / `btn-speak` / `btn-speak-faster` / `btn-stop-speaking` | 3. 合成 |
| `speech-state` | 再生状態（鳴っていないあいだは要素ごと無い） |
| `param-{speed,pitch,intonation,volume,pre,post}-{minus,value,plus}` | 4. 合成パラメータ |
| `param-upspeak` / `param-upspeak-value` | 疑問文の語尾上げ。`-value` は `ON` / `OFF` |
| `btn-params-reset` | 既定値に戻す |
| `btn-accent-load` / `accent-phrase-{i}` / `mora-chip-{i}-{j}` | 5. アクセントと音高 |
| `accent-core-{i}-{minus,value,plus}` / `accent-interrogative-{i}` | 句ごとの編集 |
| `selected-mora-label` / `selected-mora-{pitch,length}-{minus,value,plus}` | 選択したモーラ |
| `btn-accent-replace-mora-data` / `btn-accent-speak` | 句の再合成 |
| `input-dict-surface` / `input-dict-pronunciation` / `wordtype-chip-{TYPE}` | 6. ユーザー辞書 |
| `dict-{accent,priority}-{minus,value,plus}` | 辞書のパラメータ |
| `btn-dict-fill-sample` / `btn-dict-add` / `dict-word-{i}` / `btn-dict-remove-{i}` | 語の登録と削除 |
| `input-kana` / `btn-kana-speak` | 7. カナから合成 |
| `btn-cache-{measure,precache,stats,clear}` | 8. 合成キャッシュ |

`btn-dict-fill-sample`（「例を入れる」）は iOS 向けの回避策でもある。シミュレータには
日本語を打ち込めないので、日本語の語はこのボタンから入れる。
