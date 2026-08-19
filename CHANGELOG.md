# @faiare/expo-voicevox

## 0.3.1

### Patch Changes

- [#9](https://github.com/faiare/expo-voicevox/pull/9) [`3d9e728`](https://github.com/faiare/expo-voicevox/commit/3d9e728411ec6a562853d4be14f98b277a038a9f) Thanks [@faiare](https://github.com/faiare)! - prebuild で「取り込む声」のログが何度も流れるのをやめた。

  Expo CLI は 1 コマンドの中で `getConfig()` を何度も呼ぶ（`expo prebuild --platform ios`
  だけでも冒頭の読み込み・bundle identifier の確認・その後の読み直し・`getPrebuildConfig` の
  4 回）。`getConfig()` はそのたびに config を作り直すため `createRunOncePlugin` では弾けず、
  `voice models: ...` から `asset source: ...` までの数行がコマンドや `--platform` の指定に
  応じて 2〜5 回流れていた。利用規約の告知と同じく、直前に出したものと内容が変わったときだけ
  出すようにした。

## 0.3.0

### Minor Changes

- [#6](https://github.com/faiare/expo-voicevox/pull/6) [`b6202d2`](https://github.com/faiare/expo-voicevox/commit/b6202d2f91bb6d31e918c0f7ab4062907182188a) Thanks [@faiare](https://github.com/faiare)! - アセットの準備を、始める前に確かめられるようにし、始めたあとで中断できるようにした。

  - `getAssetStatus()` を追加した。取得も展開も始めずに `configured` / `ready` / `assetSource` /
    `downloadBytes` を返す。初回起動で何 MB 落とすことになるのかを `prepareAssets()` の前に
    知り、確認の画面を出すかどうかを決められる。準備の実行中に呼んでも待たされない
  - `cancelPrepareAssets()` を追加した。進行中の `prepareAssets()`（`initialize()` が内部で
    呼んだものも含む）を中断する。中途半端に展開されたものは残らないので、そのまま呼び直せる
  - `isPrepareAssetsCancelled(error)` を追加した。中断による reject かどうかを見分ける

- [#6](https://github.com/faiare/expo-voicevox/pull/6) [`ef16dc2`](https://github.com/faiare/expo-voicevox/commit/ef16dc2e96fe3e5163ed3a14d9987a77a59440d3) Thanks [@faiare](https://github.com/faiare)! - 同じ入力の再合成を避ける LRU キャッシュを追加した。`speak` 系も `tts` 系も、テキスト / カナ /
  AudioQuery・`styleId`・`enableInterrogativeUpspeak` の組み合わせが同じなら 2 回目からは
  voicevox-core の推論を行わず、保持しておいた WAV をそのまま使う。

  - 上限は合計バイト数で、`initialize()` の `synthesisCacheBytes` で指定する（既定 32MB、`0` で無効）
  - `clearSynthesisCache()` と `getSynthesisCacheStats()` を追加
  - 各呼び出しの `cache: false` で読み書きともに素通しできる
  - `initialize()` / `finalize()` / `setUserDictWords()` / `loadUserDictFile()` では自動で空になる
    （辞書を変えると読みが変わるため）

- [#6](https://github.com/faiare/expo-voicevox/pull/6) [`b724ec6`](https://github.com/faiare/expo-voicevox/commit/b724ec6ae1c2affbcad43eec9be3fc9aed1e2b0e) Thanks [@faiare](https://github.com/faiare)! - `speak()` / `tts()` 系が合成パラメータを直接受け取るようにし、鳴らさず温めるだけの
  `precacheSpeech()` 系を追加した。

  - `speak` / `speakFromKana` / `tts` / `ttsFromKana` のオプションに `speedScale` / `pitchScale` /
    `intonationScale` / `volumeScale` / `prePhonemeLength` / `postPhonemeLength` を追加した。
    話速や頭出しを変えるために `createAudioQuery()` → 書き換え → `synthesis()` の 3 ステップを
    踏む必要が無くなり、合成キャッシュにもそのまま乗る（キーに含まれる）
  - `precacheSpeech()` / `precacheSpeechFromKana()` / `precacheSpeechFromAudioQuery()` を追加した。
    再生もファイル書き出しもせず、合成結果をキャッシュへ入れるだけ

  `speakFromAudioQuery()` と `synthesis()` は AudioQuery 自身がパラメータを持っているので、
  合成パラメータのオプションは受け取らない。

## 0.2.0

### Minor Changes

- [#3](https://github.com/faiare/expo-voicevox/pull/3) [`6827f59`](https://github.com/faiare/expo-voicevox/commit/6827f59b1feb5c343b838583e68d46b9ba73f5ee) Thanks [@faiare](https://github.com/faiare)! - 合成した WAV をファイルに書き出さず、メモリのままネイティブで再生する API を追加した。
  `speak()` / `speakFromKana()` / `speakFromAudioQuery()` と、`stopSpeaking()` / `isSpeaking()` /
  `waitForSpeech()` / `addSpeechStateChangeListener()`。再生のあいだだけ iOS の AVAudioSession と
  Android の AudioFocus を扱う `audioSession` オプション付き（既定は何も触らない `'none'`）。

  あわせて `tts()` / `ttsFromKana()` / `synthesis()` に、WAV の書き出し先を選ぶ `directory`
  オプション（`'cache'` / `'document'`、既定は現行どおり `'cache'`）を追加した。
