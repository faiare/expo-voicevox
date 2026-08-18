# @faiare/expo-voicevox

## 0.2.0

### Minor Changes

- [#3](https://github.com/faiare/expo-voicevox/pull/3) [`6827f59`](https://github.com/faiare/expo-voicevox/commit/6827f59b1feb5c343b838583e68d46b9ba73f5ee) Thanks [@faiare](https://github.com/faiare)! - 合成した WAV をファイルに書き出さず、メモリのままネイティブで再生する API を追加した。
  `speak()` / `speakFromKana()` / `speakFromAudioQuery()` と、`stopSpeaking()` / `isSpeaking()` /
  `waitForSpeech()` / `addSpeechStateChangeListener()`。再生のあいだだけ iOS の AVAudioSession と
  Android の AudioFocus を扱う `audioSession` オプション付き（既定は何も触らない `'none'`）。

  あわせて `tts()` / `ttsFromKana()` / `synthesis()` に、WAV の書き出し先を選ぶ `directory`
  オプション（`'cache'` / `'document'`、既定は現行どおり `'cache'`）を追加した。
