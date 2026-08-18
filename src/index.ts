// Reexport the native module. On web, it will be resolved to ExpoVoicevoxModule.web.ts
// and on native platforms to ExpoVoicevoxModule.ts
import type { EventSubscription } from 'expo-modules-core';

import type {
  NormalizedVoicevoxUserDictWord,
  VoicevoxAccentPhrase,
  VoicevoxAssetPaths,
  VoicevoxAudioQuery,
  VoicevoxAudioSessionMode,
  VoicevoxCharacter,
  VoicevoxInitializeOptions,
  VoicevoxOutputDirectory,
  VoicevoxPrepareProgress,
  VoicevoxSpeakOptions,
  VoicevoxSpeechState,
  VoicevoxSpeechStateChange,
  VoicevoxSynthesisCacheStats,
  VoicevoxSynthesisOptions,
  VoicevoxUserDictWord,
  VoicevoxUserDictWordType,
  VoicevoxUtterance,
} from './ExpoVoicevox.types';
import ExpoVoicevoxModule from './ExpoVoicevoxModule';
import {
  parseAccentPhrases,
  parseAudioQuery,
  stringifyAccentPhrases,
  stringifyAudioQuery,
} from './audioQuery';

export * from './ExpoVoicevox.types';

const MAX_CPU_NUM_THREADS = 65535;

/** 合成結果のキャッシュの既定の上限。24kHz モノラル 16bit ≒ 48KB/秒 なので約 11 分ぶん。 */
const DEFAULT_SYNTHESIS_CACHE_BYTES = 32 * 1024 * 1024;

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`expo-voicevox: ${name} must be a non-empty string`);
  }
}

function assertStyleId(styleId: unknown): asserts styleId is number {
  if (!Number.isInteger(styleId) || (styleId as number) < 0) {
    throw new Error('expo-voicevox: styleId must be a non-negative integer');
  }
}

/**
 * 疑問文の語尾上げの指定を解決する。
 *
 * voicevox-core の既定値に任せず常に明示するのは、iOS と Android で挙動を揃えるため。
 */
function resolveInterrogativeUpspeak(
  options: VoicevoxSynthesisOptions | VoicevoxSpeakOptions | undefined
): boolean {
  return options?.enableInterrogativeUpspeak ?? true;
}

const OUTPUT_DIRECTORIES: VoicevoxOutputDirectory[] = ['cache', 'document'];

const AUDIO_SESSION_MODES: VoicevoxAudioSessionMode[] = ['none', 'exclusive', 'duck', 'mix'];

/**
 * WAV の書き出し先を解決する。
 *
 * `enableInterrogativeUpspeak` と同じく、ネイティブの既定値には任せず JS 側が常に明示する。
 */
function resolveOutputDirectory(
  options: VoicevoxSynthesisOptions | undefined
): VoicevoxOutputDirectory {
  const directory = options?.directory ?? 'cache';
  if (!OUTPUT_DIRECTORIES.includes(directory)) {
    throw new Error(`expo-voicevox: directory must be one of ${OUTPUT_DIRECTORIES.join(' / ')}`);
  }
  return directory;
}

/**
 * 合成結果のキャッシュを使うかを解決する。既定は true。
 *
 * `enableInterrogativeUpspeak` と同じく、ネイティブの既定値には任せず JS 側が常に明示する。
 */
function resolveUseCache(
  options: VoicevoxSynthesisOptions | VoicevoxSpeakOptions | undefined
): boolean {
  return options?.cache ?? true;
}

/** 再生中のオーディオセッションの扱いを解決する。既定は何も触らない `'none'`。 */
function resolveAudioSession(options: VoicevoxSpeakOptions | undefined): VoicevoxAudioSessionMode {
  const audioSession = options?.audioSession ?? 'none';
  if (!AUDIO_SESSION_MODES.includes(audioSession)) {
    throw new Error(
      `expo-voicevox: audioSession must be one of ${AUDIO_SESSION_MODES.join(' / ')}`
    );
  }
  return audioSession;
}

/**
 * voicevox-core のバージョンを返す。
 *
 * ネイティブライブラリがリンク・ロードできているかの確認にも使える。
 */
export function getVersion(): string {
  return ExpoVoicevoxModule.getVersion();
}

/** `initialize()` が完了しているかどうか。 */
export function isInitialized(): boolean {
  return ExpoVoicevoxModule.isInitialized();
}

/**
 * config plugin が配置した音声モデルと辞書を使える状態にして、絶対パスを返す。
 *
 * `initialize()` が内部で呼ぶので通常は不要。進捗を見せながら先に済ませておきたいときに使う。
 * 冪等で、2 回目以降は即座に返る。
 */
export function prepareAssets(): Promise<VoicevoxAssetPaths> {
  return ExpoVoicevoxModule.prepareAssets();
}

/**
 * アセットの準備の進捗を購読する。
 *
 * Android は初回起動時に APK 内のアセットを端末へ展開するため進捗が流れる。
 * iOS の `assetSource: "bundle"` ではバンドルをそのまま読むのでイベントは発生しない。
 */
export function addPrepareProgressListener(
  listener: (progress: VoicevoxPrepareProgress) => void
): EventSubscription {
  return ExpoVoicevoxModule.addListener('onPrepareProgress', listener);
}

/**
 * 音声合成の準備をする。
 *
 * 引数なしで呼ぶと、`app.json` の config plugin が配置した辞書と音声モデルを自動で解決する。
 * 自前でアセットを管理する場合は `openJtalkDictDir` と `voiceModelPaths` を絶対パスで渡す。
 *
 * 処理は重いので、アプリ起動直後ではなく必要になった時点で呼ぶのが望ましい。
 */
export async function initialize(options: VoicevoxInitializeOptions = {}): Promise<void> {
  const openJtalkDictDir = options.openJtalkDictDir;
  if (openJtalkDictDir !== undefined) {
    assertNonEmptyString(openJtalkDictDir, 'openJtalkDictDir');
  }

  const voiceModelPaths = options.voiceModelPaths;
  if (voiceModelPaths !== undefined) {
    if (!Array.isArray(voiceModelPaths) || voiceModelPaths.length === 0) {
      throw new Error('expo-voicevox: voiceModelPaths must list at least one .vvm path');
    }
    voiceModelPaths.forEach((modelPath, index) => {
      assertNonEmptyString(modelPath, `voiceModelPaths[${index}]`);
    });
  }

  const cpuNumThreads = options.cpuNumThreads ?? 0;
  if (
    !Number.isInteger(cpuNumThreads) ||
    cpuNumThreads < 0 ||
    cpuNumThreads > MAX_CPU_NUM_THREADS
  ) {
    throw new Error(
      `expo-voicevox: cpuNumThreads must be an integer between 0 and ${MAX_CPU_NUM_THREADS}`
    );
  }

  const synthesisCacheBytes = options.synthesisCacheBytes ?? DEFAULT_SYNTHESIS_CACHE_BYTES;
  if (
    !Number.isInteger(synthesisCacheBytes) ||
    synthesisCacheBytes < 0 ||
    synthesisCacheBytes > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      'expo-voicevox: synthesisCacheBytes must be an integer between 0 and Number.MAX_SAFE_INTEGER'
    );
  }

  // 省略されたものは null で渡し、ネイティブ側に自動解決させる。
  await ExpoVoicevoxModule.initialize({
    openJtalkDictDir: openJtalkDictDir ?? null,
    voiceModelPaths: voiceModelPaths ? [...voiceModelPaths] : null,
    cpuNumThreads,
    synthesisCacheBytes,
  });
}

/**
 * 読み込み済みの音声モデルに含まれるキャラクターとスタイルの一覧を返す。
 *
 * ネイティブからは voicevox-core が生成した JSON がそのまま渡ってくるので、
 * 構造化はここで一度だけ行う（iOS と Android で解釈がぶれないようにするため）。
 */
export async function getCharacters(): Promise<VoicevoxCharacter[]> {
  const json = await ExpoVoicevoxModule.getMetasJson();
  const metas: unknown = JSON.parse(json);
  if (!Array.isArray(metas)) {
    throw new Error('expo-voicevox: the voice metadata JSON is not an array');
  }
  return metas.map((meta: any) => ({
    name: String(meta?.name ?? ''),
    speakerUuid: String(meta?.speaker_uuid ?? ''),
    styles: Array.isArray(meta?.styles)
      ? meta.styles.map((style: any) => ({
          id: Number(style?.id),
          name: String(style?.name ?? ''),
          type: String(style?.type ?? 'talk'),
        }))
      : [],
  }));
}

/**
 * テキストを音声合成し、書き出した WAV ファイルの絶対パスを返す。
 *
 * WAV は既定でキャッシュディレクトリに書き出される。ブリッジ越しに Base64 を運ばないための
 * もので、呼び出し側で不要になったら削除してよい。書き出し先は `directory` で変えられる。
 *
 * 鳴らすだけならファイルを作らない `speak()` を使う。
 * 話速や音高を変えたい場合は `createAudioQuery()` と `synthesis()` を使う。
 */
export function tts(
  text: string,
  styleId: number,
  options?: VoicevoxSynthesisOptions
): Promise<string> {
  assertNonEmptyString(text, 'text');
  assertStyleId(styleId);
  return ExpoVoicevoxModule.tts(
    text,
    styleId,
    resolveInterrogativeUpspeak(options),
    resolveOutputDirectory(options),
    resolveUseCache(options)
  );
}

/**
 * AquesTalk 風記法のカナを音声合成し、書き出した WAV ファイルの絶対パスを返す。
 *
 * 例: `"コンニチワ'"`（`'` がアクセント核、`_` が無声化、`/` が句切り、`？` が疑問形）。
 */
export function ttsFromKana(
  kana: string,
  styleId: number,
  options?: VoicevoxSynthesisOptions
): Promise<string> {
  assertNonEmptyString(kana, 'kana');
  assertStyleId(styleId);
  return ExpoVoicevoxModule.ttsFromKana(
    kana,
    styleId,
    resolveInterrogativeUpspeak(options),
    resolveOutputDirectory(options),
    resolveUseCache(options)
  );
}

/**
 * テキストから AudioQuery を生成する。
 *
 * 返ってきた AudioQuery の `speedScale` などを書き換えて `synthesis()` に渡すと、
 * 話速・音高・抑揚・音量・前後の無音を調整した音声が得られる。
 */
export async function createAudioQuery(text: string, styleId: number): Promise<VoicevoxAudioQuery> {
  assertNonEmptyString(text, 'text');
  assertStyleId(styleId);
  return parseAudioQuery(await ExpoVoicevoxModule.createAudioQueryJson(text, styleId));
}

/** AquesTalk 風記法のカナから AudioQuery を生成する。 */
export async function createAudioQueryFromKana(
  kana: string,
  styleId: number
): Promise<VoicevoxAudioQuery> {
  assertNonEmptyString(kana, 'kana');
  assertStyleId(styleId);
  return parseAudioQuery(await ExpoVoicevoxModule.createAudioQueryFromKanaJson(kana, styleId));
}

/**
 * テキストからアクセント句の配列を生成する。
 *
 * 読みやアクセントを直したいときに使う。編集後は `audioQueryFromAccentPhrases()` で
 * AudioQuery に組み立てて `synthesis()` へ渡す。
 */
export async function createAccentPhrases(
  text: string,
  styleId: number
): Promise<VoicevoxAccentPhrase[]> {
  assertNonEmptyString(text, 'text');
  assertStyleId(styleId);
  return parseAccentPhrases(await ExpoVoicevoxModule.createAccentPhrasesJson(text, styleId));
}

/** AquesTalk 風記法のカナからアクセント句の配列を生成する。 */
export async function createAccentPhrasesFromKana(
  kana: string,
  styleId: number
): Promise<VoicevoxAccentPhrase[]> {
  assertNonEmptyString(kana, 'kana');
  assertStyleId(styleId);
  return parseAccentPhrases(
    await ExpoVoicevoxModule.createAccentPhrasesFromKanaJson(kana, styleId)
  );
}

/**
 * アクセント句の音素長と音高を、指定したスタイルで生成し直す。
 *
 * `accent` や `isInterrogative` を書き換えたあとに呼ぶと、その読み方に合った音になる。
 */
export async function replaceMoraData(
  accentPhrases: VoicevoxAccentPhrase[],
  styleId: number
): Promise<VoicevoxAccentPhrase[]> {
  assertStyleId(styleId);
  return parseAccentPhrases(
    await ExpoVoicevoxModule.replaceMoraDataJson(stringifyAccentPhrases(accentPhrases), styleId)
  );
}

/** アクセント句の音素長（発音の長さ）だけを生成し直す。音高は保つ。 */
export async function replacePhonemeLength(
  accentPhrases: VoicevoxAccentPhrase[],
  styleId: number
): Promise<VoicevoxAccentPhrase[]> {
  assertStyleId(styleId);
  return parseAccentPhrases(
    await ExpoVoicevoxModule.replacePhonemeLengthJson(
      stringifyAccentPhrases(accentPhrases),
      styleId
    )
  );
}

/** アクセント句の音高だけを生成し直す。音素長は保つ。 */
export async function replaceMoraPitch(
  accentPhrases: VoicevoxAccentPhrase[],
  styleId: number
): Promise<VoicevoxAccentPhrase[]> {
  assertStyleId(styleId);
  return parseAccentPhrases(
    await ExpoVoicevoxModule.replaceMoraPitchJson(stringifyAccentPhrases(accentPhrases), styleId)
  );
}

/**
 * アクセント句の配列から AudioQuery を組み立てる。
 *
 * 合成パラメータ（`speedScale` など）は既定値で埋められ、`kana` は null になる。
 * この API はモデルの推論を行わないので、`initialize()` の前でも呼べる。
 */
export async function audioQueryFromAccentPhrases(
  accentPhrases: VoicevoxAccentPhrase[]
): Promise<VoicevoxAudioQuery> {
  return parseAudioQuery(
    await ExpoVoicevoxModule.audioQueryFromAccentPhrasesJson(stringifyAccentPhrases(accentPhrases))
  );
}

/**
 * AudioQuery を音声合成し、書き出した WAV ファイルの絶対パスを返す。
 *
 * `outputSamplingRate` と `outputStereo` もここで効くので、24kHz モノラル以外も出力できる。
 */
export function synthesis(
  audioQuery: VoicevoxAudioQuery,
  styleId: number,
  options?: VoicevoxSynthesisOptions
): Promise<string> {
  assertStyleId(styleId);
  return ExpoVoicevoxModule.synthesis(
    stringifyAudioQuery(audioQuery),
    styleId,
    resolveInterrogativeUpspeak(options),
    resolveOutputDirectory(options),
    resolveUseCache(options)
  );
}

/**
 * 発話ごとの「終わり待ち」。`waitForSpeech()` が参照する。
 *
 * 挿入順を保つので、古いものから掃除できる。
 */
const speechWaiters = new Map<
  number,
  {
    promise: Promise<VoicevoxSpeechState>;
    resolve: (state: VoicevoxSpeechState) => void;
    settled: boolean;
  }
>();

/** 追跡し続ける発話の数。`waitForSpeech()` を呼ばない使い方でも溜まり続けないようにする。 */
const MAX_TRACKED_UTTERANCES = 16;

let speechSubscription: EventSubscription | null = null;

/**
 * 終端イベントの購読を確保する。
 *
 * `speak()` がネイティブを呼ぶ**前**に張る。ごく短い発話だと `speak()` の解決より先に
 * 終端イベントが届くので、後から購読したのでは取りこぼす。
 */
function ensureSpeechTracking(): void {
  if (speechSubscription) {
    return;
  }
  speechSubscription = ExpoVoicevoxModule.addListener('onSpeechStateChange', (change) => {
    if (change.state === 'started') {
      return;
    }
    settleSpeechWaiter(change.id, change.state);
  });
}

/** 発話の待ち受けを用意する。すでにあれば何もしない。 */
function trackSpeech(id: number): void {
  if (speechWaiters.has(id)) {
    return;
  }
  let resolve!: (state: VoicevoxSpeechState) => void;
  const promise = new Promise<VoicevoxSpeechState>((settle) => {
    resolve = settle;
  });
  speechWaiters.set(id, { promise, resolve, settled: false });
}

/** 発話の待ち受けを解決する。2 回目以降は何もしない。 */
function settleSpeechWaiter(id: number, state: VoicevoxSpeechState): void {
  trackSpeech(id);
  const waiter = speechWaiters.get(id)!;
  if (waiter.settled) {
    return;
  }
  waiter.settled = true;
  waiter.resolve(state);
}

/**
 * 古い発話の記録を落とす。
 *
 * まだ終わっていないものは残す（消すと `waitForSpeech()` が永久に解決しなくなる）。
 * Map は挿入順を保つので、古いものから順に見ていける。
 */
function pruneSpeechWaiters(): void {
  for (const [id, waiter] of speechWaiters) {
    if (speechWaiters.size <= MAX_TRACKED_UTTERANCES) {
      break;
    }
    if (waiter.settled) {
      speechWaiters.delete(id);
    }
  }
}

/**
 * 再生系に共通する「先に購読を張り、返ってきた発話を追跡する」流れ。
 */
async function trackedSpeak(call: () => Promise<VoicevoxUtterance>): Promise<VoicevoxUtterance> {
  ensureSpeechTracking();
  const utterance = await call();
  trackSpeech(utterance.id);
  if (!utterance.started) {
    // 追い越された発話にはネイティブからイベントが届かないので、ここで畳む。
    settleSpeechWaiter(utterance.id, 'stopped');
  }
  pruneSpeechWaiters();
  return utterance;
}

/**
 * テキストを音声合成し、WAV をファイルにせずそのまま再生する。
 *
 * 合成が終わって**再生を始めた時点**で解決する。鳴り終わるまでは待たないので、
 * 終わりを待つなら `waitForSpeech()` を、状態を追うなら
 * `addSpeechStateChangeListener()` を使う。
 *
 * すでに何か鳴っている状態で呼ぶと、**新しい発話の再生が始まる瞬間に**前の発話が止まる
 * （その発話には `'stopped'` が届く）。呼んだ瞬間に黙らせたいなら、先に `stopSpeaking()` を
 * await すること。こうしているのは、合成に失敗したときに鳴っていた音を止め損にしないためと、
 * 合成にかかる数百ミリ秒〜数秒のあいだ無音になるのを避けるため。
 *
 * 合成に失敗したときだけ reject する。合成中に追い越された場合は reject せず、
 * `started: false` で解決する（投げっぱなしで呼んでも unhandled rejection にならないように）。
 */
export function speak(
  text: string,
  styleId: number,
  options?: VoicevoxSpeakOptions
): Promise<VoicevoxUtterance> {
  assertNonEmptyString(text, 'text');
  assertStyleId(styleId);
  const enableInterrogativeUpspeak = resolveInterrogativeUpspeak(options);
  const audioSession = resolveAudioSession(options);
  return trackedSpeak(() =>
    ExpoVoicevoxModule.speak(
      text,
      styleId,
      enableInterrogativeUpspeak,
      audioSession,
      resolveUseCache(options)
    )
  );
}

/** AquesTalk 風記法のカナを音声合成し、そのまま再生する。挙動は `speak()` と同じ。 */
export function speakFromKana(
  kana: string,
  styleId: number,
  options?: VoicevoxSpeakOptions
): Promise<VoicevoxUtterance> {
  assertNonEmptyString(kana, 'kana');
  assertStyleId(styleId);
  const enableInterrogativeUpspeak = resolveInterrogativeUpspeak(options);
  const audioSession = resolveAudioSession(options);
  return trackedSpeak(() =>
    ExpoVoicevoxModule.speakFromKana(
      kana,
      styleId,
      enableInterrogativeUpspeak,
      audioSession,
      resolveUseCache(options)
    )
  );
}

/**
 * AudioQuery を音声合成し、そのまま再生する。挙動は `speak()` と同じ。
 *
 * `outputSamplingRate` と `outputStereo` を変えても鳴る（ネイティブ側は WAV のヘッダを
 * 読んでから再生するので、24kHz モノラルを決め打ちしていない）。
 */
export function speakFromAudioQuery(
  audioQuery: VoicevoxAudioQuery,
  styleId: number,
  options?: VoicevoxSpeakOptions
): Promise<VoicevoxUtterance> {
  assertStyleId(styleId);
  const audioQueryJson = stringifyAudioQuery(audioQuery);
  const enableInterrogativeUpspeak = resolveInterrogativeUpspeak(options);
  const audioSession = resolveAudioSession(options);
  return trackedSpeak(() =>
    ExpoVoicevoxModule.speakFromAudioQuery(
      audioQueryJson,
      styleId,
      enableInterrogativeUpspeak,
      audioSession,
      resolveUseCache(options)
    )
  );
}

/**
 * 再生中の発話を止める。
 *
 * 合成の途中の発話も対象で、その `speak()` は `started: false` で解決する。
 * 鳴っていた発話には `'stopped'` が届く。何も鳴っていなければ何もしない。
 */
export function stopSpeaking(): Promise<void> {
  return ExpoVoicevoxModule.stopSpeaking();
}

/**
 * いま音が鳴っているか。
 *
 * 合成中はまだ false（音は出ていないため）。`speak()` が `started: true` で解決してから
 * `'finished'` / `'stopped'` / `'failed'` が届くまでのあいだ true になる。
 */
export function isSpeaking(): boolean {
  return ExpoVoicevoxModule.isSpeaking();
}

/**
 * 発話が終わるまで待ち、終わり方を返す。
 *
 * reject はしない。停止も失敗も戻り値の状態で表す。
 * 追跡していない `id`（古くて掃除されたもの、`speak()` が返していないもの）を渡すと、
 * すでに終わったものとみなして即座に `'finished'` で解決する。
 */
export function waitForSpeech(id: number): Promise<VoicevoxSpeechState> {
  return speechWaiters.get(id)?.promise ?? Promise.resolve('finished');
}

/**
 * `speak()` 系の再生状態を購読する。
 *
 * `speak()` が `started: true` を返した発話ごとに、`'started'` が 1 回と
 * `'finished'` / `'stopped'` / `'failed'` のいずれかが 1 回届く。`id` は `speak()` の
 * 返り値と対応する。
 */
export function addSpeechStateChangeListener(
  listener: (change: VoicevoxSpeechStateChange) => void
): EventSubscription {
  return ExpoVoicevoxModule.addListener('onSpeechStateChange', listener);
}

const USER_DICT_WORD_TYPES: VoicevoxUserDictWordType[] = [
  'PROPER_NOUN',
  'COMMON_NOUN',
  'VERB',
  'ADJECTIVE',
  'SUFFIX',
];

const MAX_USER_DICT_PRIORITY = 10;

function normalizeUserDictWord(
  word: VoicevoxUserDictWord,
  index: number
): NormalizedVoicevoxUserDictWord {
  const at = `words[${index}]`;
  assertNonEmptyString(word?.surface, `${at}.surface`);
  assertNonEmptyString(word?.pronunciation, `${at}.pronunciation`);

  const accentType = word.accentType ?? 0;
  if (!Number.isInteger(accentType) || accentType < 0) {
    throw new Error(`expo-voicevox: ${at}.accentType must be a non-negative integer`);
  }

  const wordType = word.wordType ?? 'COMMON_NOUN';
  if (!USER_DICT_WORD_TYPES.includes(wordType)) {
    throw new Error(
      `expo-voicevox: ${at}.wordType must be one of ${USER_DICT_WORD_TYPES.join(' / ')}`
    );
  }

  const priority = word.priority ?? 5;
  if (!Number.isInteger(priority) || priority < 0 || priority > MAX_USER_DICT_PRIORITY) {
    throw new Error(
      `expo-voicevox: ${at}.priority must be an integer between 0 and ${MAX_USER_DICT_PRIORITY}`
    );
  }

  return {
    surface: word.surface,
    pronunciation: word.pronunciation,
    accentType,
    wordType,
    priority,
  };
}

/**
 * ユーザー辞書の単語を差し替える。空配列を渡すと辞書を空にする。
 *
 * 固有名詞など、既定の辞書では読みを誤る語をここで登録する。
 *
 * 呼ぶたびに辞書を作り直して OpenJTalk へ適用し直す。voicevox-core は
 * 「辞書を変更したら再適用が必要」という仕様なので、追加・削除を個別に扱う API ではなく
 * 全置換にして、再適用の呼び忘れが起きない形にしている。
 * 呼び出し側は自分の単語リストを唯一の状態として持ち、変更のたびにこれを呼べばよい。
 *
 * `initialize()` の前でも呼べる。設定した辞書は `finalize()` をまたいで残るので、
 * 再初期化しても登録し直す必要はない。
 *
 * 登録済みの単語を読み出す API は用意していない。voicevox-core が返す形が
 * iOS（MeCab 形式で品詞から `wordType` を逆引きする）と Android（5 フィールドのみ）で
 * 食い違っており、揃えた値を返せないため。
 */
export function setUserDictWords(words: VoicevoxUserDictWord[]): Promise<void> {
  if (!Array.isArray(words)) {
    throw new Error('expo-voicevox: words must be an array');
  }
  return ExpoVoicevoxModule.setUserDictWords(words.map(normalizeUserDictWord));
}

/**
 * VOICEVOX 形式の辞書ファイルを読み込み、現在の辞書へ**追加**して適用し直す。
 *
 * 置き換えではないので、まっさらな状態から読みたいときは先に `setUserDictWords([])` を呼ぶ。
 */
export function loadUserDictFile(path: string): Promise<void> {
  assertNonEmptyString(path, 'path');
  return ExpoVoicevoxModule.loadUserDictFile(path);
}

/** 現在のユーザー辞書を VOICEVOX 形式でファイルへ保存する。 */
export function saveUserDictFile(path: string): Promise<void> {
  assertNonEmptyString(path, 'path');
  return ExpoVoicevoxModule.saveUserDictFile(path);
}

/**
 * Synthesizer を破棄する。再度使うには `initialize()` が必要。
 *
 * 鳴っている音があれば先に止める。ネイティブの `finalize` は合成用の直列キューの上で動くので、
 * 合成の実行中に呼ぶとその完了まで待たされる。停止だけはキューの外で先に効かせたいので、
 * ここで `stopSpeaking()` を挟んでいる。
 *
 * iOS は `voicevox_synthesizer_delete` を呼ぶので即座に解放される。
 * Android は Java API に明示的な close が無く、参照を手放して GC に委ねるため
 * 実際に解放されるタイミングは保証されない。
 *
 * ユーザー辞書はここでは破棄されず、次の `initialize()` にも引き継がれる。
 */
export async function finalize(): Promise<void> {
  await ExpoVoicevoxModule.stopSpeaking();
  await ExpoVoicevoxModule.finalize();
}

/**
 * 合成結果のキャッシュを空にする。上限（`initialize()` の `synthesisCacheBytes`）は保たれる。
 *
 * `initialize()` / `finalize()` / `setUserDictWords()` / `loadUserDictFile()` では自動で空になるので、
 * 通常は呼ぶ必要が無い。メモリを取り戻したいときに使う（React Native の `AppState` が出す
 * `'memoryWarning'` に繋ぐのが分かりやすい）。
 *
 * 合成用の直列キューの上で動くので、合成の実行中に呼ぶとその完了まで待たされる。
 */
export function clearSynthesisCache(): Promise<void> {
  return ExpoVoicevoxModule.clearSynthesisCache();
}

/**
 * 合成結果のキャッシュの状態を返す。上限の調整や、当たっているかの確認に使う。
 *
 * `clearSynthesisCache()` と同じく合成用の直列キューの上で動く。
 */
export function getSynthesisCacheStats(): Promise<VoicevoxSynthesisCacheStats> {
  return ExpoVoicevoxModule.getSynthesisCacheStats();
}

export default ExpoVoicevoxModule;
