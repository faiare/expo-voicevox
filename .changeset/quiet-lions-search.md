---
'@faiare/expo-voicevox': minor
---

`speak()` / `tts()` 系が合成パラメータを直接受け取るようにし、鳴らさず温めるだけの
`precacheSpeech()` 系を追加した。

- `speak` / `speakFromKana` / `tts` / `ttsFromKana` のオプションに `speedScale` / `pitchScale` /
  `intonationScale` / `volumeScale` / `prePhonemeLength` / `postPhonemeLength` を追加した。
  話速や頭出しを変えるために `createAudioQuery()` → 書き換え → `synthesis()` の 3 ステップを
  踏む必要が無くなり、合成キャッシュにもそのまま乗る（キーに含まれる）
- `precacheSpeech()` / `precacheSpeechFromKana()` / `precacheSpeechFromAudioQuery()` を追加した。
  再生もファイル書き出しもせず、合成結果をキャッシュへ入れるだけ

`speakFromAudioQuery()` と `synthesis()` は AudioQuery 自身がパラメータを持っているので、
合成パラメータのオプションは受け取らない。
