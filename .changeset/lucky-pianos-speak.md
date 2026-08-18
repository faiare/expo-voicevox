---
'@faiare/expo-voicevox': minor
---

合成した WAV をファイルに書き出さず、メモリのままネイティブで再生する API を追加した。
`speak()` / `speakFromKana()` / `speakFromAudioQuery()` と、`stopSpeaking()` / `isSpeaking()` /
`waitForSpeech()` / `addSpeechStateChangeListener()`。再生のあいだだけ iOS の AVAudioSession と
Android の AudioFocus を扱う `audioSession` オプション付き（既定は何も触らない `'none'`）。

あわせて `tts()` / `ttsFromKana()` / `synthesis()` に、WAV の書き出し先を選ぶ `directory`
オプション（`'cache'` / `'document'`、既定は現行どおり `'cache'`）を追加した。
