// Reexport the native module. On web, it will be resolved to ExpoVoicevoxModule.web.ts
// and on native platforms to ExpoVoicevoxModule.ts
import type { EventSubscription } from 'expo-modules-core';

import type {
  VoicevoxAssetPaths,
  VoicevoxAudioQuery,
  VoicevoxCharacter,
  VoicevoxInitializeOptions,
  VoicevoxPrepareProgress,
  VoicevoxSynthesisOptions,
} from './ExpoVoicevox.types';
import ExpoVoicevoxModule from './ExpoVoicevoxModule';
import { parseAudioQuery, stringifyAudioQuery } from './audioQuery';

export * from './ExpoVoicevox.types';

const MAX_CPU_NUM_THREADS = 65535;

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
function resolveInterrogativeUpspeak(options: VoicevoxSynthesisOptions | undefined): boolean {
  return options?.enableInterrogativeUpspeak ?? true;
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

  // 省略されたものは null で渡し、ネイティブ側に自動解決させる。
  await ExpoVoicevoxModule.initialize({
    openJtalkDictDir: openJtalkDictDir ?? null,
    voiceModelPaths: voiceModelPaths ? [...voiceModelPaths] : null,
    cpuNumThreads,
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
 * WAV はキャッシュディレクトリに書き出される。ブリッジ越しに Base64 を運ばないためのもので、
 * 呼び出し側で不要になったら削除してよい。
 *
 * 話速や音高を変えたい場合は `createAudioQuery()` と `synthesis()` を使う。
 */
export function tts(
  text: string,
  styleId: number,
  options?: VoicevoxSynthesisOptions
): Promise<string> {
  assertNonEmptyString(text, 'text');
  assertStyleId(styleId);
  return ExpoVoicevoxModule.tts(text, styleId, resolveInterrogativeUpspeak(options));
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
  return ExpoVoicevoxModule.ttsFromKana(kana, styleId, resolveInterrogativeUpspeak(options));
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
    resolveInterrogativeUpspeak(options)
  );
}

/** Synthesizer を破棄してメモリを解放する。再度使うには `initialize()` が必要。 */
export function finalize(): Promise<void> {
  return ExpoVoicevoxModule.finalize();
}

export default ExpoVoicevoxModule;
