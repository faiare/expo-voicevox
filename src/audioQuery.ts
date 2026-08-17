/**
 * AudioQuery / AccentPhrase のブリッジ変換。
 *
 * ネイティブとは voicevox-core が定める JSON 文字列でやり取りする。iOS の C API は
 * JSON しか受け付けず、Android の Java API もオブジェクトの内部表現は Gson の JSON なので、
 * 文字列で運ぶのが両プラットフォームで一致させる最短経路になる。
 * `getCharacters()` が採っている「ネイティブは JSON、構造化は JS で 1 回だけ」と同じ方針。
 *
 * **JSON のキーは snake_case と camelCase が混在している**。voicevox-core の定義がそうなっており
 * （jar の `@SerializedName` で確認）、camelCase でない 5 個だけがここでの変換対象になる。
 *
 * - `AudioQuery.accentPhrases` → `accent_phrases`
 * - `AccentPhrase.pauseMora` → `pause_mora` / `isInterrogative` → `is_interrogative`
 * - `Mora.consonantLength` → `consonant_length` / `vowelLength` → `vowel_length`
 *
 * `speedScale` などの AudioQuery 直下のフィールドは JSON 側も camelCase なのでそのまま通る。
 */
import type { VoicevoxAccentPhrase, VoicevoxAudioQuery, VoicevoxMora } from './ExpoVoicevox.types';

function fail(message: string): never {
  throw new Error(`expo-voicevox: ${message}`);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${path} must be an array`);
  }
  return value;
}

function asFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${path} must be a finite number`);
  }
  return value;
}

function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(`${path} must be a string`);
  }
  return value;
}

function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(`${path} must be a boolean`);
  }
  return value;
}

/** null と undefined はどちらも null にし、値があるときだけ検証する。 */
function asNullable<T>(
  value: unknown,
  path: string,
  convert: (value: unknown, path: string) => T
): T | null {
  return value == null ? null : convert(value, path);
}

// MARK: - ネイティブ -> 公開型

function toMora(value: unknown, path: string): VoicevoxMora {
  const mora = asRecord(value, path);
  return {
    text: asString(mora.text, `${path}.text`),
    consonant: asNullable(mora.consonant, `${path}.consonant`, asString),
    consonantLength: asNullable(mora.consonant_length, `${path}.consonant_length`, asFiniteNumber),
    vowel: asString(mora.vowel, `${path}.vowel`),
    vowelLength: asFiniteNumber(mora.vowel_length, `${path}.vowel_length`),
    pitch: asFiniteNumber(mora.pitch, `${path}.pitch`),
  };
}

function toAccentPhrase(value: unknown, path: string): VoicevoxAccentPhrase {
  const phrase = asRecord(value, path);
  return {
    moras: asArray(phrase.moras, `${path}.moras`).map((mora, index) =>
      toMora(mora, `${path}.moras[${index}]`)
    ),
    accent: asFiniteNumber(phrase.accent, `${path}.accent`),
    pauseMora: asNullable(phrase.pause_mora, `${path}.pause_mora`, toMora),
    isInterrogative: asBoolean(phrase.is_interrogative, `${path}.is_interrogative`),
  };
}

/** ネイティブが返した AccentPhrase 配列の JSON を構造化する。 */
export function parseAccentPhrases(json: string): VoicevoxAccentPhrase[] {
  return asArray(JSON.parse(json), 'accentPhrases').map((phrase, index) =>
    toAccentPhrase(phrase, `accentPhrases[${index}]`)
  );
}

/** ネイティブが返した AudioQuery の JSON を構造化する。 */
export function parseAudioQuery(json: string): VoicevoxAudioQuery {
  const query = asRecord(JSON.parse(json), 'audioQuery');
  return {
    accentPhrases: asArray(query.accent_phrases, 'audioQuery.accent_phrases').map((phrase, index) =>
      toAccentPhrase(phrase, `audioQuery.accent_phrases[${index}]`)
    ),
    speedScale: asFiniteNumber(query.speedScale, 'audioQuery.speedScale'),
    pitchScale: asFiniteNumber(query.pitchScale, 'audioQuery.pitchScale'),
    intonationScale: asFiniteNumber(query.intonationScale, 'audioQuery.intonationScale'),
    volumeScale: asFiniteNumber(query.volumeScale, 'audioQuery.volumeScale'),
    prePhonemeLength: asFiniteNumber(query.prePhonemeLength, 'audioQuery.prePhonemeLength'),
    postPhonemeLength: asFiniteNumber(query.postPhonemeLength, 'audioQuery.postPhonemeLength'),
    outputSamplingRate: asFiniteNumber(query.outputSamplingRate, 'audioQuery.outputSamplingRate'),
    outputStereo: asBoolean(query.outputStereo, 'audioQuery.outputStereo'),
    kana: asNullable(query.kana, 'audioQuery.kana', asString),
  };
}

// MARK: - 公開型 -> ネイティブ

/**
 * null のキーも省略せずに書き出す。
 *
 * voicevox-core は `consonant` と `consonant_length` の「有無が一致していること」を
 * 検証するので（ヘッダの `voicevox_mora_validate` 参照）、キーごと消すと解釈がぶれる。
 */
function fromMora(value: unknown, path: string): Record<string, unknown> {
  const mora = asRecord(value, path);
  return {
    text: asString(mora.text, `${path}.text`),
    consonant: asNullable(mora.consonant, `${path}.consonant`, asString),
    consonant_length: asNullable(mora.consonantLength, `${path}.consonantLength`, asFiniteNumber),
    vowel: asString(mora.vowel, `${path}.vowel`),
    vowel_length: asFiniteNumber(mora.vowelLength, `${path}.vowelLength`),
    pitch: asFiniteNumber(mora.pitch, `${path}.pitch`),
  };
}

function fromAccentPhrase(value: unknown, path: string): Record<string, unknown> {
  const phrase = asRecord(value, path);
  return {
    moras: asArray(phrase.moras, `${path}.moras`).map((mora, index) =>
      fromMora(mora, `${path}.moras[${index}]`)
    ),
    accent: asFiniteNumber(phrase.accent, `${path}.accent`),
    pause_mora: asNullable(phrase.pauseMora, `${path}.pauseMora`, fromMora),
    is_interrogative: asBoolean(phrase.isInterrogative, `${path}.isInterrogative`),
  };
}

/** AccentPhrase 配列をネイティブへ渡す JSON にする。 */
export function stringifyAccentPhrases(accentPhrases: VoicevoxAccentPhrase[]): string {
  return JSON.stringify(
    asArray(accentPhrases, 'accentPhrases').map((phrase, index) =>
      fromAccentPhrase(phrase, `accentPhrases[${index}]`)
    )
  );
}

/**
 * AudioQuery をネイティブへ渡す JSON にする。
 *
 * 壊れた値をそのまま流すと voicevox-core のパースエラーになって原因が分かりにくいので、
 * フィールドごとに検証してから渡す。
 */
export function stringifyAudioQuery(audioQuery: VoicevoxAudioQuery): string {
  const query = asRecord(audioQuery, 'audioQuery');
  return JSON.stringify({
    accent_phrases: asArray(query.accentPhrases, 'audioQuery.accentPhrases').map((phrase, index) =>
      fromAccentPhrase(phrase, `audioQuery.accentPhrases[${index}]`)
    ),
    speedScale: asFiniteNumber(query.speedScale, 'audioQuery.speedScale'),
    pitchScale: asFiniteNumber(query.pitchScale, 'audioQuery.pitchScale'),
    intonationScale: asFiniteNumber(query.intonationScale, 'audioQuery.intonationScale'),
    volumeScale: asFiniteNumber(query.volumeScale, 'audioQuery.volumeScale'),
    prePhonemeLength: asFiniteNumber(query.prePhonemeLength, 'audioQuery.prePhonemeLength'),
    postPhonemeLength: asFiniteNumber(query.postPhonemeLength, 'audioQuery.postPhonemeLength'),
    outputSamplingRate: asFiniteNumber(query.outputSamplingRate, 'audioQuery.outputSamplingRate'),
    outputStereo: asBoolean(query.outputStereo, 'audioQuery.outputStereo'),
    kana: asNullable(query.kana, 'audioQuery.kana', asString),
  });
}
