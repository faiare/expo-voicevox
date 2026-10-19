---
"@faiare/expo-voicevox": minor
---

Expo SDK 58（React Native 0.88）に追随した。

- SDK 58 からアプリの release ビルドで R8 が既定で有効になり、voicevoxcore-android の
  クラス名が潰されて Android の `initialize()` が例外も出さずに戻らなくなっていた。
  モジュールに consumer ProGuard rules（`android/consumer-rules.pro`）を同梱したので、
  利用側で keep ルールを書き足す必要はない。SDK 57 以前でも `android.enableMinifyInReleaseBuilds`
  を有効にしていたアプリは同じ理由で壊れていたので、このリリースで直る
- 開発と検証の対象を SDK 58 に移した。iOS のデプロイメントターゲット（16.4）と
  Android の minSdk（26）は変わらない
