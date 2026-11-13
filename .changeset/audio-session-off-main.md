---
'@faiare/expo-voicevox': patch
---

iOS で `audioSession` を指定した `speak` 系が、メインスレッドで `AVAudioSession` の `setCategory` / `setActive` を呼んでいたのをバックグラウンドの直列キューへ移した。Xcode の「AVAudioSession Hang Risk」警告が出なくなる。あわせて、セッションの有効化後に再生の開始に失敗したとき、セッションが有効のまま残っていたのを直した。
