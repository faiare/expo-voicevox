/**
 * config plugin とネイティブ実装の両方が知っている名前。
 *
 * ここを変えるときは以下も揃える必要がある。
 * - iOS   `ios/VoicevoxAssets.swift`
 * - Android `android/src/main/java/expo/modules/voicevox/VoicevoxAssets.kt`
 */

/**
 * アセットを置くディレクトリ名。
 *
 * iOS は `ios/<ProjectName>/voicevox/` を青フォルダ（folder reference）として
 * バンドルに載せるので `<App>.app/voicevox/` になる。
 * Android は `android/app/src/main/assets/voicevox/` に置く。
 */
export const VOICEVOX_RESOURCE_DIR = 'voicevox';

/** そのディレクトリ直下に置く、ネイティブが読む唯一の設定ファイル。 */
export const VOICEVOX_MANIFEST_FILE = 'voicevox-manifest.json';
