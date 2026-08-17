/**
 * `app.json` の `voices` を、実際にダウンロードする `.vvm` の一覧へ解決する。
 *
 * 1 キャラクターの声は複数の `.vvm` に分かれているため、指定は必ず
 * `<キャラクター>/<スタイル>` の形にしてある。キャラクター名だけを許すと、
 * 何 MB 取り込まれるかが `app.json` から読み取れなくなるため。
 */
import { VVM_CATALOG_FILES, VVM_CATALOG_VERSION, VVM_CATALOG_VOICES } from './catalog.generated';
import type { VvmCatalogVoice } from './catalogTypes';
import { suggest, VoicevoxPluginError } from '../errors';
import type { VoicevoxVoiceSpec } from '../types';

export type SelectedVoiceModel = {
  /** 例 "0.vvm"。 */
  fileName: string;
  /** この `.vvm` を要求した声のラベル（"zundamon/normal"）。ファイル直接指定なら空。 */
  requestedBy: string[];
};

/**
 * 歌唱（`s0.vvm`）は voicevox-core の歌唱合成 API を叩いていないので名前では選べない。
 *
 * 歌唱の声はキャラクターとスタイルの組が必ずトーク側にも存在する（ずんだもんの「ノーマル」は
 * 0.vvm の styleId 3 と s0.vvm の 3003 の両方にある）ため、除外してもキャラクター名で
 * 引けなくなる声は 1 つも無い。`zundamon/normal` は常にトークの 0.vvm を指す。
 */
const SELECTABLE_KINDS = new Set(['talk', 'nemo']);

const SELECTABLE_VOICES = VVM_CATALOG_VOICES.filter((voice) => SELECTABLE_KINDS.has(voice.kind));

const VOICES_BY_KEY = new Map(SELECTABLE_VOICES.map((voice) => [key(voice), voice]));
const VOICES_BY_CHARACTER = groupByCharacter(SELECTABLE_VOICES);

function key(voice: Pick<VvmCatalogVoice, 'character' | 'style'>): string {
  return `${voice.character}/${voice.style}`;
}

function groupByCharacter(voices: VvmCatalogVoice[]): Map<string, VvmCatalogVoice[]> {
  const grouped = new Map<string, VvmCatalogVoice[]>();
  for (const voice of voices) {
    const list = grouped.get(voice.character);
    if (list) {
      list.push(voice);
    } else {
      grouped.set(voice.character, [voice]);
    }
  }
  return grouped;
}

/**
 * 入力の表記ゆれを吸収する。
 * 公式の product slug はアンダースコア区切りだが、kebab-case で書かれても受け付ける。
 */
export function normalizeSlug(value: string): string {
  return value.trim().toLowerCase().replace(/-/g, '_');
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) {
    return 'unknown size';
  }
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** "0.vvm" < "5.vvm" < "10.vvm" < "n0.vvm" < "s0.vvm" の順。 */
export function compareVvmName(a: string, b: string): number {
  const parse = (name: string) => {
    const matched = /^([a-z]*)(\d+)\.vvm$/.exec(name);
    return matched ? { prefix: matched[1], index: Number(matched[2]) } : { prefix: name, index: 0 };
  };
  const left = parse(a);
  const right = parse(b);
  return left.prefix.localeCompare(right.prefix) || left.index - right.index;
}

/**
 * その `.vvm` が歌唱の声しか持っていないか。
 *
 * `{ file: "s0.vvm" }` のようにファイル直接指定で歌唱モデルを入れられてしまうが、
 * expo-voicevox は歌唱合成 API を公開していないので使えない。124MB を無駄に同梱しないよう
 * prebuild で警告するために使う。
 */
export function isSongOnlyFile(fileName: string): boolean {
  const voices = VVM_CATALOG_VOICES.filter((voice) => voice.file === fileName);
  return voices.length > 0 && voices.every((voice) => voice.kind === 'song');
}

function describeStyles(character: string): string {
  const voices = VOICES_BY_CHARACTER.get(character) ?? [];
  return [...voices]
    .sort((a, b) => compareVvmName(a.file, b.file) || a.style.localeCompare(b.style))
    .map(
      (voice) =>
        `    ${character}/${voice.style}` +
        ` — ${voice.characterName} "${voice.styleName}"` +
        ` (${voice.file}, ${formatBytes(VVM_CATALOG_FILES[voice.file]?.size)})`
    )
    .join('\n');
}

function unknownCharacter(character: string): never {
  const candidates = suggest(character, VOICES_BY_CHARACTER.keys());
  throw new VoicevoxPluginError(
    `unknown character "${character}".` +
      (candidates.length > 0 ? `\n  Did you mean: ${candidates.join(', ')}` : '') +
      '\n  Character slugs match the product URLs on https://voicevox.hiroshiba.jp/.'
  );
}

function unknownStyle(character: string, style: string): never {
  const candidates = suggest(
    style,
    (VOICES_BY_CHARACTER.get(character) ?? []).map((voice) => voice.style)
  );
  throw new VoicevoxPluginError(
    `"${character}" has no style "${style}".` +
      (candidates.length > 0 ? `\n  Did you mean: ${candidates.join(', ')}` : '') +
      `\n  Available styles for ${character}:\n${describeStyles(character)}`
  );
}

function missingStyle(character: string): never {
  throw new VoicevoxPluginError(
    `"${character}" needs a style.\n` +
      "  A character's voices are spread across several .vvm files, so the character name\n" +
      '  alone does not determine which files (and how many MB) get bundled.\n' +
      `  Available styles for ${character}:\n${describeStyles(character)}`
  );
}

function lookup(character: string, style: string): VvmCatalogVoice {
  if (!VOICES_BY_CHARACTER.has(character)) {
    unknownCharacter(character);
  }
  const voice = VOICES_BY_KEY.get(`${character}/${style}`);
  if (!voice) {
    unknownStyle(character, style);
  }
  return voice;
}

function normalizeFileName(file: string): string {
  const trimmed = file.trim();
  if (!trimmed.endsWith('.vvm')) {
    throw new VoicevoxPluginError(
      `{ "file": "${file}" } must name a .vvm file (for example "0.vvm").`
    );
  }
  return trimmed;
}

/**
 * `voices` を `.vvm` の一覧へ解決する。
 *
 * @param voiceModelVersion 同梱カタログと違うバージョンが指定されている場合、
 *   キャラクター名では引けなくなるので `{ file }` 形式のみ受け付ける。
 */
export function resolveVoices(
  voices: VoicevoxVoiceSpec[],
  voiceModelVersion: string
): SelectedVoiceModel[] {
  const catalogUsable = voiceModelVersion === VVM_CATALOG_VERSION;
  const requestedBy = new Map<string, string[]>();

  const add = (fileName: string, label: string | null) => {
    const labels = requestedBy.get(fileName);
    if (labels) {
      if (label && !labels.includes(label)) {
        labels.push(label);
      }
    } else {
      requestedBy.set(fileName, label ? [label] : []);
    }
  };

  const requireCatalog = (spec: unknown) => {
    if (!catalogUsable) {
      throw new VoicevoxPluginError(
        `voiceModelVersion is set to "${voiceModelVersion}", so voices cannot be selected by ` +
          `character name (the bundled catalog is for ${VVM_CATALOG_VERSION}).\n` +
          `  Replace ${JSON.stringify(spec)} with a file name, e.g. { "file": "0.vvm" }.`
      );
    }
  };

  for (const spec of voices) {
    if (typeof spec === 'string') {
      requireCatalog(spec);
      const parts = spec.split('/').map((part) => normalizeSlug(part));
      if (parts.length === 1) {
        const character = parts[0];
        if (!VOICES_BY_CHARACTER.has(character)) {
          unknownCharacter(character);
        }
        missingStyle(character);
      }
      if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
        throw new VoicevoxPluginError(
          `"${spec}" must be written as "<character>/<style>" (for example "zundamon/normal").`
        );
      }
      const voice = lookup(parts[0], parts[1]);
      add(voice.file, key(voice));
      continue;
    }

    if (spec && typeof spec === 'object' && 'file' in spec) {
      const fileName = normalizeFileName(spec.file);
      if (catalogUsable && !VVM_CATALOG_FILES[fileName]) {
        throw new VoicevoxPluginError(
          `"${fileName}" is not part of the VVM ${VVM_CATALOG_VERSION} release.` +
            `\n  Available files: ${Object.keys(VVM_CATALOG_FILES).sort(compareVvmName).join(', ')}`
        );
      }
      add(fileName, null);
      continue;
    }

    if (spec && typeof spec === 'object' && 'character' in spec) {
      requireCatalog(spec);
      const character = normalizeSlug(spec.character);
      if (!Array.isArray(spec.styles) || spec.styles.length === 0) {
        if (!VOICES_BY_CHARACTER.has(character)) {
          unknownCharacter(character);
        }
        missingStyle(character);
      }
      for (const rawStyle of spec.styles) {
        if (typeof rawStyle !== 'string' || rawStyle.trim().length === 0) {
          throw new VoicevoxPluginError(
            `styles for "${character}" must be non-empty strings, e.g. ["normal", "sexy"].`
          );
        }
        const voice = lookup(character, normalizeSlug(rawStyle));
        add(voice.file, key(voice));
      }
      continue;
    }

    throw new VoicevoxPluginError(
      `could not interpret a voices entry: ${JSON.stringify(spec)}\n` +
        '  Use "zundamon/normal", { "character": "zundamon", "styles": ["normal"] } or { "file": "0.vvm" }.'
    );
  }

  return [...requestedBy.entries()]
    .sort(([a], [b]) => compareVvmName(a, b))
    .map(([fileName, labels]) => ({ fileName, requestedBy: labels.sort() }));
}
