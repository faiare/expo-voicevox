---
'@faiare/expo-voicevox': minor
---

アセットの準備を、始める前に確かめられるようにし、始めたあとで中断できるようにした。

- `getAssetStatus()` を追加した。取得も展開も始めずに `configured` / `ready` / `assetSource` /
  `downloadBytes` を返す。初回起動で何 MB 落とすことになるのかを `prepareAssets()` の前に
  知り、確認の画面を出すかどうかを決められる。準備の実行中に呼んでも待たされない
- `cancelPrepareAssets()` を追加した。進行中の `prepareAssets()`（`initialize()` が内部で
  呼んだものも含む）を中断する。中途半端に展開されたものは残らないので、そのまま呼び直せる
- `isPrepareAssetsCancelled(error)` を追加した。中断による reject かどうかを見分ける
