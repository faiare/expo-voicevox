---
'@faiare/expo-voicevox': patch
---

prebuild で「取り込む声」のログが何度も流れるのをやめた。

Expo CLI は 1 コマンドの中で `getConfig()` を何度も呼ぶ（`expo prebuild --platform ios`
だけでも冒頭の読み込み・bundle identifier の確認・その後の読み直し・`getPrebuildConfig` の
4 回）。`getConfig()` はそのたびに config を作り直すため `createRunOncePlugin` では弾けず、
`voice models: ...` から `asset source: ...` までの数行がコマンドや `--platform` の指定に
応じて 2〜5 回流れていた。利用規約の告知と同じく、直前に出したものと内容が変わったときだけ
出すようにした。
