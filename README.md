# @faiare/expo-voicevox

[![npm version](https://img.shields.io/npm/v/@faiare/expo-voicevox?style=flat-square&logo=npm&logoColor=white&label=npm&color=cb3837)](https://www.npmjs.com/package/@faiare/expo-voicevox)
[![CI](https://img.shields.io/github/actions/workflow/status/faiare/expo-voicevox/ci.yml?branch=main&style=flat-square&logo=githubactions&logoColor=white&label=CI)](https://github.com/faiare/expo-voicevox/actions/workflows/ci.yml)
[![Expo SDK 57](https://img.shields.io/badge/Expo%20SDK-57-000020?style=flat-square&logo=expo&logoColor=white)](https://docs.expo.dev/versions/v57.0.0/)
[![platforms iOS and Android](https://img.shields.io/badge/platforms-iOS%20%7C%20Android-4c8eda?style=flat-square)](#requirements)
[![License MIT](https://img.shields.io/npm/l/@faiare/expo-voicevox?style=flat-square&color=blue)](./LICENSE)

Japanese text-to-speech for Expo apps, powered by [VOICEVOX CORE](https://github.com/VOICEVOX/voicevox_core).

iOS and Android only. Web is not supported.

| Component | Version |
|---|---|
| voicevox_core | 0.17.0 |
| VOICEVOX ONNX Runtime | 1.17.3 (iOS) / 1.23.2 (Android) |
| Voice models (VVM) | 0.17.0 |
| OpenJTalk dictionary | `open_jtalk_dic_utf_8-1.11` |

## Requirements

- An Expo project using prebuild (CNG). Expo Go is not supported — developed and tested against
  SDK 57
- iOS 16.4+
- Android 8.0 (API 26)+, `arm64-v8a` / `x86_64`

## Installation

```bash
npx expo install @faiare/expo-voicevox
```

Add the config plugin to `app.json` and list the voices you want to ship:

```jsonc
{
  "expo": {
    "plugins": [
      ["@faiare/expo-voicevox", { "voices": ["zundamon/normal"] }]
    ]
  }
}
```

```bash
npx expo prebuild
npx expo run:ios     # or npx expo run:android
```

`npx expo prebuild` downloads and installs everything needed:

- voicevox_core and ONNX Runtime native binaries
- The `.vvm` voice models for the voices you listed, plus the OpenJTalk dictionary
- Android `minSdkVersion` / ABI filters and the iOS deployment target

Do not commit `ios/` and `android/`. With assets embedded they exceed 170 MB. Add them to
`.gitignore` and regenerate them with `npx expo prebuild`.

## Choosing voices

Voices are written as `<character>/<style>`, both as ASCII slugs.

```jsonc
["@faiare/expo-voicevox", {
  "voices": [
    "zundamon/normal",
    "zundamon/sasayaki",
    { "character": "shikoku_metan", "styles": ["normal", "sexy"] }
  ]
}]
```

Character slugs match the product URLs on the [VOICEVOX website](https://voicevox.hiroshiba.jp/) —
`https://voicevox.hiroshiba.jp/product/shikoku_metan/` is `shikoku_metan`. Hyphens
(`shikoku-metan`) are accepted as well.

A style is required; a character name alone is an error, because one character's voices are split
across several `.vvm` files (Zundamon's talk styles span `0.vvm`, `5.vvm` and `15.vvm`, about
176 MB in total). If you do not know the style slug, write just the character name and run
`npx expo prebuild` — it lists every style with its file and size:

```
expo-voicevox: "zundamon" needs a style.
  Available styles for zundamon:
    zundamon/normal — ずんだもん "ノーマル" (0.vvm, 56.6MB)
    zundamon/amaama — ずんだもん "あまあま" (0.vvm, 56.6MB)
    ...
    zundamon/sasayaki — ずんだもん "ささやき" (5.vvm, 54.9MB)
```

Every prebuild reports what is actually bundled:

```
expo-voicevox: voice models: 2 file(s), 111.5MB
expo-voicevox:   0.vvm  56.6MB  shikoku_metan/normal, zundamon/normal
expo-voicevox:   5.vvm  54.9MB  zundamon/sasayaki
expo-voicevox: OpenJTalk dictionary: open_jtalk_dic_utf_8-1.11
expo-voicevox: asset source: bundle (embedded in the app)
```

You can also reference a VVM file directly with `{ "file": "n0.vvm" }`.

## Plugin options

| Option | Default | Description |
|---|---|---|
| `voices` | `["zundamon/normal"]` | Voices to bundle. See above |
| `assetSource` | `"bundle"` | `"bundle"` embeds assets in the app; `"download"` fetches them on first launch |
| `openJtalkDictionary` | `true` | Whether to bundle the dictionary. Set `false` only if you provide your own |
| `coreVersion` | `"0.17.0"` | voicevox_core version |
| `voiceModelVersion` | `"0.17.0"` | VVM release tag. Changing it disables name-based voice selection (the bundled catalog no longer applies), leaving only `{ "file": "0.vvm" }` |
| `onnxruntimeVersion` | `{ "ios": "1.17.3", "android": "1.23.2" }` | Changing this is not recommended |
| `android.abis` | `["arm64-v8a", "x86_64"]` | ABIs not listed here are stripped from `jniLibs` |
| `android.minSdkVersion` | `26` | Minimum required by voicevoxcore-android |
| `ios.deploymentTarget` | `"16.4"` | Minimum required by `voicevox_core.xcframework` |
| `cacheDirectory` | `$XDG_CACHE_HOME/expo-voicevox` | Download cache location. Relative paths resolve from the project root |
| `skipIntegrityCheck` | `false` | Skip sha256 verification (for internal mirrors) |

Types are available via
`import type { ExpoVoicevoxPluginProps } from '@faiare/expo-voicevox/plugin/build/types'`.

### bundle vs. download

| | `bundle` | `download` |
|---|---|---|
| AAB / IPA size | 57 MB per model + ~22 MB dictionary (compressed) + ~46 MB native libraries | ~46 MB native libraries only |
| First launch | Extracted on device (Android only), works offline | Downloads and extracts ~173 MB |
| Device storage | App + 173 MB extracted | 173 MB |
| Google Play 200 MB limit | Fits with one model; two or more may exceed it | Comfortable |

Prebuild warns when the bundled models exceed 100 MB. Consider `assetSource: "download"` when
shipping several characters.

### Download cache and EAS Build

Downloaded archives are cached in `$XDG_CACHE_HOME/expo-voicevox` (`~/.cache/expo-voicevox` when
unset), so subsequent prebuilds reuse them. The `EXPO_VOICEVOX_CACHE_DIR` environment variable takes
precedence over everything else.

EAS Build containers start empty, so each build downloads around 200 MB. To avoid that, either:

- Set `cacheDirectory` to `node_modules/.cache/expo-voicevox` and add the same path to
  `build.<profile>.cache.paths` in `eas.json`, or
- Use `assetSource: "download"` so builds only fetch the native binaries.

Sizes and checksums are pinned inside the package, so prebuild never calls the GitHub API and is not
subject to rate limits.

## Usage

```ts
import * as Voicevox from '@faiare/expo-voicevox';

Voicevox.getVersion(); // "0.17.0"

// Resolves the assets installed by the config plugin
await Voicevox.initialize();

const characters = await Voicevox.getCharacters();
// [{ name: 'ずんだもん', speakerUuid: '...', styles: [{ id: 3, name: 'ノーマル', type: 'talk' }, ...] }, ...]

// Returns the absolute path of the rendered WAV (24 kHz, mono, 16-bit)
const wavPath = await Voicevox.tts('こんにちは', 3);

await Voicevox.finalize();
```

WAV files are written to the cache directory instead of being passed over the bridge as Base64.
Delete them when you no longer need them — or use `speak()` below, which writes no file at all.

### Playing without writing a file

`speak()`, `speakFromKana()` and `speakFromAudioQuery()` synthesize and play the audio natively.
No file is created and no playback library is needed.

```ts
const subscription = Voicevox.addSpeechStateChangeListener(({ id, state }) => {
  console.log(id, state); // 'started' -> 'finished' | 'stopped' | 'failed'
});

const { id, durationMillis, started } = await Voicevox.speak('こんにちは', 3);

Voicevox.isSpeaking(); // true

// Wait for it to finish, if you want to
const ended = await Voicevox.waitForSpeech(id); // 'finished' | 'stopped' | 'failed'

await Voicevox.stopSpeaking();
subscription.remove();
```

**`speak()` resolves when playback *starts*, not when it ends.** It rejects only if synthesis
fails. Use `waitForSpeech(id)` to await the end — it never rejects, it returns how the utterance
ended.

**Calling `speak()` while something is playing replaces it.** The previous utterance is stopped at
the moment the new one *starts playing*, not when `speak()` is called — so a failed synthesis never
leaves you with silence, and there is no gap while the new audio is being synthesized. To go silent
immediately, `await Voicevox.stopSpeaking()` first. An utterance that gets overtaken while it is
still being synthesized resolves with `started: false` and never emits any event.

Every utterance that resolves with `started: true` emits exactly one `'started'` event followed by
exactly one `'finished'`, `'stopped'` or `'failed'`.

By default the library does not touch the audio session, so on iOS the silent switch mutes playback
unless your app already configured one (for example with expo-audio's
`setAudioModeAsync({ playsInSilentMode: true })`). Pass `audioSession` to let the library handle it:

| `audioSession` | iOS | Android |
|---|---|---|
| `'none'` (default) | Left untouched | No focus request |
| `'exclusive'` | `.playback`, other audio stops | `AUDIOFOCUS_GAIN_TRANSIENT` |
| `'duck'` | `.playback` + `.duckOthers` | `AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` |
| `'mix'` | `.playback` + `.mixWithOthers` | No focus request (same as `'none'`) |

```ts
await Voicevox.speak('こんにちは', 3, { audioSession: 'exclusive' });
```

Anything other than `'none'` sets the iOS category to `.playback`, which plays through the silent
switch. **The category is not restored afterwards** (only `setActive(false)` is called): it is
process-wide state, and restoring it would clobber whatever another library changed during
playback. Keep `'none'` if something else owns the audio session.

There is no pause, resume or volume control — only `stopSpeaking()`. One `speak()` is one synthesis
and one playback; long text is not split into sentences and streamed.

### Changing speed and timing without an AudioQuery

`speak()`, `speakFromKana()`, `tts()` and `ttsFromKana()` take the common AudioQuery fields
directly, so you don't have to go through `createAudioQuery()` for the usual adjustments:

```ts
await Voicevox.speak('こんにちは', 3, {
  speedScale: 1.1,        // faster
  prePhonemeLength: 0,    // start speaking immediately
});
```

`speedScale`, `pitchScale`, `intonationScale`, `volumeScale`, `prePhonemeLength` and
`postPhonemeLength` are accepted. Passing any of them makes the native side build an AudioQuery,
apply the overrides and synthesize from it — which is exactly what `tts()` does internally, so the
audio is identical. The extra step is Open JTalk's linguistic analysis only, no acoustic inference,
so it costs tens of milliseconds and it is skipped entirely on a cache hit.

`prePhonemeLength` and `postPhonemeLength` default to 0.1 s each. Dropping the leading one to `0`
is the cheapest way to make short prompts feel immediate.

`speakFromAudioQuery()` and `synthesis()` do not take these — the AudioQuery you pass already
carries them. For anything finer (per-accent-phrase or per-mora edits) use `createAudioQuery()`
and `synthesis()` / `speakFromAudioQuery()`.

### Reusing synthesized audio

Synthesis is the expensive part — hundreds of milliseconds to several seconds on a phone. The same
request is therefore synthesized only once: the WAV is kept in an in-memory LRU cache and replayed
straight from there. This applies to every synthesis entry point, `speak()` and `tts()` alike.

A request is "the same" when the kind (text / kana / AudioQuery), the payload, the `styleId`,
`enableInterrogativeUpspeak` and the synthesis parameters above all match. `directory` is not part
of the key — `tts()` still writes a fresh file and returns a new path on every call, it just skips
the inference.

The cache is bounded by total bytes, not by entry count. The default is 32 MB, which is roughly
11 minutes of audio at the 24 kHz mono 16-bit voicevox-core produces:

```ts
await Voicevox.initialize({ synthesisCacheBytes: 8 * 1024 * 1024 }); // 8 MB
await Voicevox.initialize({ synthesisCacheBytes: 0 });               // disabled
```

The limit is set by `initialize()` and the cache is emptied there, so pass the value every time.
A single WAV larger than the limit is never stored, so one long utterance can't evict everything
else.

The cache is also emptied by `finalize()`, `setUserDictWords()` and `loadUserDictFile()` — changing
the dictionary changes pronunciations, and stale audio would keep the old reading. Call
`clearSynthesisCache()` to empty it yourself, and `getSynthesisCacheStats()` to see how it is doing:

```ts
const { entryCount, bytes, limitBytes, hits, misses } = await Voicevox.getSynthesisCacheStats();
```

Both run on the synthesis queue, so they wait for an in-flight synthesis to finish.

To reclaim the memory under pressure, hook up React Native's `AppState`:

```ts
AppState.addEventListener('memoryWarning', () => {
  Voicevox.clearSynthesisCache();
});
```

For one-off text that would only push out audio you want to keep, opt out per call. `cache: false`
neither reads nor writes — it always synthesizes anew and stores nothing:

```ts
await Voicevox.speak(`${userName}さん、こんにちは`, 3, { cache: false });
```

### Warming the cache up front

When a tap has to be answered by speech immediately, synthesize ahead of time.
`precacheSpeech()` runs the synthesis and stores it in the cache without playing anything or
writing a file, so the later `speak()` starts at once:

```ts
useEffect(() => {
  Voicevox.precacheSpeech('保存しました', 3, { speedScale: 1.1 });
}, []);

// later, on tap
await Voicevox.speak('保存しました', 3, { speedScale: 1.1 }); // no inference
```

Pass the *same* options you will pass to `speak()` — the cache key includes them, so
precaching with `speedScale: 1.1` does nothing for a `speak()` without it. There are
`precacheSpeechFromKana()` and `precacheSpeechFromAudioQuery()` too. All three run on the
synthesis queue, so they queue up behind an in-flight synthesis instead of competing with it.

### Where WAV files are written

`tts()`, `ttsFromKana()` and `synthesis()` write a file and return its absolute path. Pick the
directory with `directory`:

```ts
const cached = await Voicevox.tts('こんにちは', 3); // default: 'cache'
const kept = await Voicevox.tts('こんにちは', 3, { directory: 'document' });
```

| `directory` | iOS | Android | Backed up | Reclaimed by the OS |
|---|---|---|---|---|
| `'cache'` (default) | `.cachesDirectory` | `cacheDir` | No | Yes, when storage runs low |
| `'document'` | `.documentDirectory` | `filesDir` | Yes | No |

- **Android**: `filesDir` is covered by Android Auto Backup, which has a **25 MB limit**. Piling up
  WAV files there will break the app's backup. Use `'cache'` for throwaway audio, or delete the
  files yourself — the library never removes them.
- **iOS**: `.documentDirectory` is included in iCloud backups, and if your `Info.plist` sets
  `UIFileSharingEnabled`, the files are visible to the user in the Files app.
- There is no `noBackupFilesDir` option. iOS has no one-to-one equivalent (it would be
  `.documentDirectory` plus an exclude-from-backup flag, i.e. two axes instead of one), and
  "must not be backed up but must not be deleted either" is not a real need for a few hundred
  kilobytes of audio — `'cache'` already covers it.
- If you only want to hear the audio, use `speak()` and no file is created.

### Adjusting speed and pitch

`tts()` synthesizes with default parameters. To change them, go through an AudioQuery:

```ts
const query = await Voicevox.createAudioQuery('こんにちは', 3);
query.speedScale = 1.3;
query.pitchScale = 0.05;
query.intonationScale = 1.2;
query.volumeScale = 1.0;
query.prePhonemeLength = 0.1;  // leading silence, seconds
query.postPhonemeLength = 0.1; // trailing silence, seconds
const wavPath = await Voicevox.synthesis(query, 3);
```

`outputSamplingRate` and `outputStereo` are also set here, so output other than 24 kHz mono is
possible.

Interrogative upspeak is enabled by default. Pass `{ enableInterrogativeUpspeak: false }` to disable
it.

### Editing pronunciation and accent

Extract accent phrases, edit them, and rebuild an AudioQuery:

```ts
const phrases = await Voicevox.createAccentPhrases('端に寄る', 3);
phrases[0].accent = 1; // accent nucleus position, 1-based (0 = flat)
const adjusted = await Voicevox.replaceMoraData(phrases, 3);
const query = await Voicevox.audioQueryFromAccentPhrases(adjusted);
const wavPath = await Voicevox.synthesis(query, 3);
```

You can also edit `pitch` and `vowelLength` on individual moras. In that case skip
`replaceMoraData()`, which would overwrite them.

### User dictionary

Register words the default dictionary reads incorrectly, such as proper nouns:

```ts
await Voicevox.setUserDictWords([
  { surface: '四国めたん', pronunciation: 'シコクメタン', accentType: 4, wordType: 'PROPER_NOUN' },
]);
```

`setUserDictWords()` replaces the entire dictionary and reapplies it to OpenJTalk. Keep your word
list as the single source of truth and call this whenever it changes. It can be called before
`initialize()`, and the dictionary survives `finalize()`.

Overriding a word that already exists in the default dictionary requires a higher `priority`.
Unknown words work at the default `priority: 5`, but common words such as `こんにちは` compete on
morphological analysis cost and keep their original reading at that priority.

There is no API for reading registered words back: voicevox_core returns incompatible shapes on iOS
and Android, so the same values cannot be produced on both platforms.

### Reporting preparation progress

On Android the assets are extracted to the device on first launch (and downloaded first when
`assetSource: "download"`), which takes a while. On iOS with `assetSource: "bundle"` the app bundle
is read in place and no events are emitted.

```ts
useEffect(() => {
  const subscription = Voicevox.addPrepareProgressListener((progress) => {
    setStatus(`${progress.stage} ${progress.current} ${progress.completedFiles}/${progress.totalFiles}`);
  });
  return () => subscription.remove();
}, []);
```

### Checking and cancelling asset preparation

`getAssetStatus()` answers "is this ready, and if not, how much will it fetch?" without starting
any download or extraction. It never blocks — call it while preparation is running and you get
`ready: false` right away.

```ts
const status = await Voicevox.getAssetStatus();
if (!status.configured) {
  // the config plugin is not set up, or you have to pass paths to initialize() yourself
} else if (!status.ready && status.assetSource === 'download') {
  // ask before spending status.downloadBytes on mobile data
}
```

`cancelPrepareAssets()` stops a preparation that is already running. The pending `prepareAssets()`
(or the `initialize()` that triggered it) rejects; use `isPrepareAssetsCancelled()` so a
deliberate cancellation isn't reported as a failure:

```ts
try {
  await Voicevox.prepareAssets();
} catch (error) {
  if (!Voicevox.isPrepareAssetsCancelled(error)) throw error;
}
```

Nothing half-extracted is left behind — the work happens in a staging directory that is removed on
cancellation — so calling `prepareAssets()` again simply starts over. Cancelling when nothing is
running is a no-op, and it does not affect the next `prepareAssets()`.

`assetSource: "bundle"` on iOS reads the app bundle in place, so preparation is instantaneous and
there is nothing to cancel.

### Managing assets yourself

Passing absolute paths to `initialize()` bypasses the config plugin entirely — nothing is downloaded
or extracted:

```ts
await Voicevox.initialize({
  openJtalkDictDir: '/path/to/open_jtalk_dic_utf_8-1.11',
  voiceModelPaths: ['/path/to/0.vvm'],
  cpuNumThreads: 0, // 0 = auto
});
```

If this is your only use case, set `"voices": []` in the plugin config to bundle just the
dictionary.

## API

| Function | Kind | Description |
|---|---|---|
| `getVersion()` | sync | voicevox_core version |
| `isInitialized()` | sync | Whether `initialize()` has completed |
| `prepareAssets()` | async | Makes assets available and returns their absolute paths. Idempotent |
| `getAssetStatus()` | async | Whether the assets are ready, and how much a download would fetch. Starts nothing |
| `cancelPrepareAssets()` | async | Stops a running `prepareAssets()`. No-op when nothing is running |
| `isPrepareAssetsCancelled(error)` | sync | Whether a rejection came from `cancelPrepareAssets()` |
| `addPrepareProgressListener(cb)` | sync | Subscribes to asset preparation progress |
| `initialize(options?)` | async | Sets up ONNX Runtime, OpenJTalk and the synthesizer, and loads the voice models |
| `getCharacters()` | async | Characters and styles in the loaded models |
| `tts(text, styleId, options?)` | async | Synthesizes text, returns the WAV path (`directory` picks cache or documents) |
| `ttsFromKana(kana, styleId, options?)` | async | Synthesizes AquesTalk-style kana, returns the WAV path |
| `createAudioQuery(text, styleId)` | async | Builds an AudioQuery from text |
| `createAudioQueryFromKana(kana, styleId)` | async | Builds an AudioQuery from kana |
| `synthesis(audioQuery, styleId, options?)` | async | Synthesizes an AudioQuery, returns the WAV path |
| `speak(text, styleId, options?)` | async | Synthesizes text and plays it back without writing a file |
| `speakFromKana(kana, styleId, options?)` | async | Same, from AquesTalk-style kana |
| `speakFromAudioQuery(audioQuery, styleId, options?)` | async | Same, from an AudioQuery |
| `precacheSpeech(text, styleId, options?)` | async | Synthesizes into the cache without playing or writing a file |
| `precacheSpeechFromKana(kana, styleId, options?)` | async | Same, from AquesTalk-style kana |
| `precacheSpeechFromAudioQuery(audioQuery, styleId, options?)` | async | Same, from an AudioQuery |
| `stopSpeaking()` | async | Stops playback, and cancels an utterance still being synthesized |
| `isSpeaking()` | sync | Whether audio is currently playing |
| `waitForSpeech(id)` | async | Waits for an utterance to end and returns how it ended |
| `addSpeechStateChangeListener(cb)` | sync | Subscribes to playback state changes |
| `createAccentPhrases(text, styleId)` | async | Builds accent phrases from text |
| `createAccentPhrasesFromKana(kana, styleId)` | async | Builds accent phrases from kana |
| `replaceMoraData(phrases, styleId)` | async | Regenerates phoneme lengths and pitches |
| `replacePhonemeLength(phrases, styleId)` | async | Regenerates phoneme lengths only |
| `replaceMoraPitch(phrases, styleId)` | async | Regenerates pitches only |
| `audioQueryFromAccentPhrases(phrases)` | async | Builds an AudioQuery from accent phrases |
| `setUserDictWords(words)` | async | Replaces the user dictionary |
| `loadUserDictFile(path)` | async | Loads a VOICEVOX-format dictionary file and merges it into the current one |
| `saveUserDictFile(path)` | async | Saves the current user dictionary to a file |
| `finalize()` | async | Stops playback, then destroys the synthesizer |
| `clearSynthesisCache()` | async | Empties the synthesis cache. The limit is kept |
| `getSynthesisCacheStats()` | async | Entry count, bytes, limit, hits and misses of the synthesis cache |

On iOS `finalize()` frees resources immediately. On Android the Java API has no explicit close, so
the reference is dropped and release timing is left to the GC.

## Not supported

- Singing synthesis (`s0.vvm` can be bundled, but no synthesis API is exposed)
- Unloading voice models at runtime (call `initialize()` again instead)
- Play Asset Delivery on Android (use `assetSource: "download"`)
- Pausing, resuming or changing the volume of playback (`stopSpeaking()` only)
- Sentence-by-sentence playback — one `speak()` is one synthesis and one playback

Streaming synthesis does not exist in voicevox_core 0.17.0 itself — neither the C header nor the
Java `Synthesizer` exposes such an API. `streaming_talk` is a style type, not incremental output.

## License and credits

- `@faiare/expo-voicevox`: MIT
- voicevox_core: MIT
- VOICEVOX voice models (VVM) and VOICEVOX ONNX Runtime: individual terms of use — **a credit
  indicating that VOICEVOX was used is required**
- OpenJTalk dictionary: BSD-3-Clause, copyright notice must be reproduced

The voice model terms (`TERMS.txt` / `README.txt`) are bundled with the app regardless of
`assetSource`. The dictionary's `COPYING` ships inside the dictionary itself, so with
`assetSource: "download"` it lands on the device together with the first-launch download.

Terms differ per character and some require prior approval for commercial use, so check `TERMS.txt`.
`npx expo prebuild` also prints these requirements.
