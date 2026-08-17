// Reexport the native module. On web, it will be resolved to ExpoVoicevoxModule.web.ts
// and on native platforms to ExpoVoicevoxModule.ts
import type { VoicevoxCharacter, VoicevoxInitializeOptions } from './ExpoVoicevox.types';
import ExpoVoicevoxModule from './ExpoVoicevoxModule';

export * from './ExpoVoicevox.types';

const MAX_CPU_NUM_THREADS = 65535;

function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`expo-voicevox: ${name} には空でない文字列を指定してください`);
  }
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
 * 音声合成の準備をする。
 *
 * 辞書・音声モデルは端末のファイルシステム上に展開された状態で、絶対パスを渡すこと。
 * 処理は重いので、アプリ起動直後ではなく必要になった時点で呼ぶのが望ましい。
 */
export async function initialize(options: VoicevoxInitializeOptions): Promise<void> {
  assertNonEmptyString(options?.openJtalkDictDir, 'openJtalkDictDir');

  const voiceModelPaths = options.voiceModelPaths;
  if (!Array.isArray(voiceModelPaths) || voiceModelPaths.length === 0) {
    throw new Error('expo-voicevox: voiceModelPaths には最低 1 件の .vvm パスを指定してください');
  }
  voiceModelPaths.forEach((modelPath, index) => {
    assertNonEmptyString(modelPath, `voiceModelPaths[${index}]`);
  });

  const cpuNumThreads = options.cpuNumThreads ?? 0;
  if (
    !Number.isInteger(cpuNumThreads) ||
    cpuNumThreads < 0 ||
    cpuNumThreads > MAX_CPU_NUM_THREADS
  ) {
    throw new Error(
      `expo-voicevox: cpuNumThreads には 0 以上 ${MAX_CPU_NUM_THREADS} 以下の整数を指定してください`
    );
  }

  await ExpoVoicevoxModule.initialize({
    openJtalkDictDir: options.openJtalkDictDir,
    voiceModelPaths: [...voiceModelPaths],
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
    throw new Error('expo-voicevox: メタ情報の JSON が配列ではありません');
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
 */
export function tts(text: string, styleId: number): Promise<string> {
  assertNonEmptyString(text, 'text');
  if (!Number.isInteger(styleId) || styleId < 0) {
    throw new Error('expo-voicevox: styleId には 0 以上の整数を指定してください');
  }
  return ExpoVoicevoxModule.tts(text, styleId);
}

/** Synthesizer を破棄してメモリを解放する。再度使うには `initialize()` が必要。 */
export function finalize(): Promise<void> {
  return ExpoVoicevoxModule.finalize();
}

export default ExpoVoicevoxModule;
