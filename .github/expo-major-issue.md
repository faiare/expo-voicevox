npm の `expo` が **SDK {{LATEST_MAJOR}}**（`{{LATEST_VERSION}}`）になりました。このリポジトリが追随しているのは SDK {{CURRENT_MAJOR}} です。

このチェックリストを消化して `package.json` の `expo` を上げると、次回からこの issue は立たなくなります。

## 依存の更新

- [ ] `package.json`: `expo` / `expo-modules-core` / `babel-preset-expo` / `jest-expo` / `react-native` / `@types/react`
- [ ] `example/package.json`: `expo` / `expo-asset` / `expo-audio` / `react` / `react-native`
- [ ] `package-lock.json` と `example/package-lock.json` を再生成する（**CI の `npm ci` は lock が `package.json` と同期していないと即失敗する**）
- [ ] `npx expo install --check` を example で流して、SDK が要求するバージョンとの食い違いを潰す

## ドキュメントの版を合わせる

- [ ] `README.md` の Expo SDK バッジと、そのリンク先 `https://docs.expo.dev/versions/v{{LATEST_MAJOR}}.0.0/`
- [ ] `example/AGENTS.md` が指す固定ドキュメント URL
- [ ] `CLAUDE.md` の「バージョン注意」節（モジュール本体と example の TypeScript / react-native の対応表）

## ネイティブ側の確認

- [ ] Expo Modules API の破壊的変更（`AsyncFunction` / `OnDestroy` / `Name()` の登録、`expo-module.config.json` の書式）
- [ ] iOS のデプロイメントターゲット（現在 16.4）が SDK の要求を下回っていないか。`ios/ExpoVoicevox.podspec`
- [ ] Android の compileSdk / minSdk と `newArchEnabled` の前提。`android/build.gradle`
- [ ] react-native のメジャーが動いた場合、`android/src/main/jniLibs` と `ios/Frameworks` の持ち込み方が変わっていないか

## 検証

- [ ] `CI=1 npm run lint` / `CI=1 npm test` / `CI=1 npm test plugin`
- [ ] `cd example && npx expo prebuild --clean` が config plugin ごと通る
- [ ] `cd example/android && ./gradlew :faiare-expo-voicevox:testDebugUnitTest --console=plain`
- [ ] `cd example/ios && xcodebuild -workspace expovoicevoxexample.xcworkspace -scheme expovoicevoxexample -sdk iphonesimulator -configuration Debug -derivedDataPath build CODE_SIGNING_ALLOWED=NO build`（**iOS は CI に無いので手元で通すこと**）
- [ ] シミュレータ / エミュレータで `speak` まで実際に鳴らす

## リリース

- [ ] `npm run changeset` でリリースノートを足す

---

<sub>この issue は [`.github/workflows/expo-major-watch.yml`](../blob/main/.github/workflows/expo-major-watch.yml) が自動で作成しました。本文のひな形は `.github/expo-major-issue.md` です。</sub>
