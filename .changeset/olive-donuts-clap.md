---
'@faiare/expo-voicevox': minor
---

同じ入力の再合成を避ける LRU キャッシュを追加した。`speak` 系も `tts` 系も、テキスト / カナ /
AudioQuery・`styleId`・`enableInterrogativeUpspeak` の組み合わせが同じなら 2 回目からは
voicevox-core の推論を行わず、保持しておいた WAV をそのまま使う。

- 上限は合計バイト数で、`initialize()` の `synthesisCacheBytes` で指定する（既定 32MB、`0` で無効）
- `clearSynthesisCache()` と `getSynthesisCacheStats()` を追加
- 各呼び出しの `cache: false` で読み書きともに素通しできる
- `initialize()` / `finalize()` / `setUserDictWords()` / `loadUserDictFile()` では自動で空になる
  （辞書を変えると読みが変わるため）
