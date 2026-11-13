---
'@faiare/expo-voicevox': patch
---

iOS: speak 系の再生 1 回につき 1 件残っていた「AVAudioSession Hang Risk」の警告を解消しました。`AVAudioPlayer.prepareToPlay()` が OS の内部でオーディオセッションを暗黙に有効化しており、これがメインスレッドで走っていたことが原因です。プレイヤーの生成・再生・停止とセッションの操作を、すべて run loop を持つ専用スレッドへ移しました。`audioSession: 'none'` の場合も同じ警告が出ていましたが、これも解消しています。
