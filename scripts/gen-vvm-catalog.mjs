#!/usr/bin/env node
/**
 * VVM リリースの README にある公式の対応表から `plugin/src/vvm/catalog.generated.ts` を作る。
 *
 * 上流（VOICEVOX/voicevox_vvm）は `scripts/make_docs.py` で
 * 「VVMファイル名 | 話者名 | スタイル名 | スタイルID」の表を README に生成している。
 * キャラクター名から `.vvm` を引くにはこの表が要るが、手で写すと必ずずれるので機械的に取り込む。
 *
 * slug は `plugin/src/vvm/slugs.ts` の手書き表を使う。**表に載っていない名前が 1 つでもあれば
 * 失敗する**ので、VVM のバージョンを上げたときの取りこぼしが黙って通ることはない。
 *
 * 使い方:
 *   npm run gen:vvm-catalog             # 既定バージョン
 *   npm run gen:vvm-catalog -- 0.18.0   # バージョン指定
 */

import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SLUGS_PATH = path.join(ROOT, 'plugin', 'build', 'vvm', 'slugs.js');
if (!fs.existsSync(SLUGS_PATH)) {
  throw new Error(
    `plugin/build is missing. Run \`npx tsc --build plugin\` first (${path.relative(ROOT, SLUGS_PATH)} not found).`
  );
}
const { CHARACTER_SLUGS, STYLE_SLUGS } = require(SLUGS_PATH);

const { DEFAULT_VVM_VERSION, voiceModelReadmeUrl } = require(
  path.join(ROOT, 'plugin', 'build', 'core', 'versions.js')
);

const VERSION = process.argv[2] ?? DEFAULT_VVM_VERSION;
const OUTPUT = path.join(ROOT, 'plugin', 'src', 'vvm', 'catalog.generated.ts');

/** README のセクション見出し -> 声の種別。 */
const SECTION_KINDS = {
  トーク: 'talk',
  ソング: 'song',
  'Nemo トーク': 'nemo',
};

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`fetch failed (${response.status} ${response.statusText}): ${url}`);
  }
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      accept: 'application/vnd.github+json',
      ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`fetch failed (${response.status} ${response.statusText}): ${url}`);
  }
  return response.json();
}

/** README の `<!-- vvm-table start -->` 以降を種別つきの行に展開する。 */
function parseReadme(markdown) {
  const marker = '<!-- vvm-table start -->';
  const index = markdown.indexOf(marker);
  if (index < 0) {
    throw new Error(`${marker} not found in the README; the upstream format may have changed`);
  }

  const rows = [];
  let kind = null;
  for (const line of markdown.slice(index + marker.length).split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      kind = SECTION_KINDS[heading[1]] ?? null;
      continue;
    }
    if (kind === null) {
      continue;
    }
    // | 0.vvm | 四国めたん | ノーマル | 2 |
    const cells = /^\|\s*([\w.]+\.vvm)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/.exec(line);
    if (cells) {
      rows.push({
        file: cells[1],
        characterName: cells[2],
        styleName: cells[3],
        styleId: Number(cells[4]),
        kind,
      });
    }
  }

  if (rows.length === 0) {
    throw new Error('no rows could be parsed from the table; the upstream format may have changed');
  }
  return rows;
}

/** GitHub リリースから `.vvm` の size と sha256 を集める。 */
async function fetchReleaseFiles(version) {
  const release = await fetchJson(
    `https://api.github.com/repos/VOICEVOX/voicevox_vvm/releases/tags/${version}`
  );
  const files = {};
  for (const asset of release.assets ?? []) {
    if (!asset.name.endsWith('.vvm')) {
      continue;
    }
    const digest = typeof asset.digest === 'string' ? asset.digest : null;
    files[asset.name] = {
      size: asset.size,
      sha256: digest?.startsWith('sha256:') ? digest.slice('sha256:'.length) : null,
    };
  }
  if (Object.keys(files).length === 0) {
    throw new Error(`release ${version} has no .vvm assets`);
  }
  return files;
}

function toSlugs(rows) {
  const missingCharacters = new Set();
  const missingStyles = new Set();

  const voices = rows.map((row) => {
    const character = CHARACTER_SLUGS[row.characterName];
    const style = STYLE_SLUGS[row.styleName];
    if (!character) missingCharacters.add(row.characterName);
    if (!style) missingStyles.add(row.styleName);
    return { ...row, character, style };
  });

  if (missingCharacters.size > 0 || missingStyles.size > 0) {
    const lines = ['some names have no slug in plugin/src/vvm/slugs.ts.'];
    if (missingCharacters.size > 0) {
      lines.push(
        `  missing from CHARACTER_SLUGS: ${[...missingCharacters].map((n) => JSON.stringify(n)).join(', ')}`
      );
      lines.push(
        '    Character slugs must match the product URLs on https://voicevox.hiroshiba.jp/.'
      );
    }
    if (missingStyles.size > 0) {
      lines.push(
        `  missing from STYLE_SLUGS: ${[...missingStyles].map((n) => JSON.stringify(n)).join(', ')}`
      );
    }
    throw new Error(lines.join('\n'));
  }

  return voices;
}

function validate(voices, files) {
  const problems = [];

  // キャラクター slug は全体で一意（1 slug に複数の日本語名が紐づいていないこと）。
  const nameByCharacterSlug = new Map();
  for (const voice of voices) {
    const known = nameByCharacterSlug.get(voice.character);
    if (known === undefined) {
      nameByCharacterSlug.set(voice.character, voice.characterName);
    } else if (known !== voice.characterName) {
      problems.push(
        `character slug "${voice.character}" is used by both ${known} and ${voice.characterName}`
      );
    }
  }

  // `<キャラクター>/<スタイル>` が 1 つの声を一意に指すこと。
  //
  // 検証するのはトークと Nemo だけで、歌唱（kind: 'song'）は対象外にしている。理由は 2 つ:
  //   - 歌唱はトークと同じキャラクター・同じスタイル名を重複して持つ
  //     （ずんだもんの「ノーマル」は 0.vvm の styleId 3 と s0.vvm の 3003 の両方にある）
  //   - 歌唱の中でも一意にならない（波音リツの「ノーマル」は s0.vvm に styleId 3009 と 6000 の
  //     2 件あり、README の表はソングとハミングを区別していない）
  // 歌唱は現在の API では選べないので、一意性を要求する意味がない。
  const seen = new Map();
  for (const voice of voices) {
    if (voice.kind === 'song') {
      continue;
    }
    const key = `${voice.character}/${voice.style}`;
    const known = seen.get(key);
    if (known === undefined) {
      seen.set(key, voice);
    } else {
      problems.push(
        `"${key}" collides: ${known.characterName} "${known.styleName}" (${known.file}) ` +
          `and "${voice.styleName}" (${voice.file})`
      );
    }
  }

  // 表にあるファイルがリリースに存在すること。
  for (const file of new Set(voices.map((v) => v.file))) {
    if (!files[file]) {
      problems.push(`${file} appears in the table but not in the release assets`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`catalog validation failed:\n  ${problems.join('\n  ')}`);
  }
}

function render(version, files, voices) {
  const fileEntries = Object.keys(files)
    .sort(compareVvmName)
    .map((name) => {
      const { size, sha256 } = files[name];
      return `  ${JSON.stringify(name)}: { size: ${size}, sha256: ${sha256 ? JSON.stringify(sha256) : 'null'} },`;
    })
    .join('\n');

  const voiceEntries = [...voices]
    .sort(
      (a, b) =>
        a.character.localeCompare(b.character) ||
        compareVvmName(a.file, b.file) ||
        a.styleId - b.styleId
    )
    .map(
      (v) =>
        `  { character: ${JSON.stringify(v.character)}, style: ${JSON.stringify(v.style)}, ` +
        `file: ${JSON.stringify(v.file)}, styleId: ${v.styleId}, kind: ${JSON.stringify(v.kind)}, ` +
        `characterName: ${JSON.stringify(v.characterName)}, styleName: ${JSON.stringify(v.styleName)} },`
    )
    .join('\n');

  return `// Generated by \`npm run gen:vvm-catalog\`. Do not edit by hand.
// Source: ${voiceModelReadmeUrl(version)}
import type { VvmCatalogFile, VvmCatalogVoice } from './catalogTypes';

export const VVM_CATALOG_VERSION = ${JSON.stringify(version)};

export const VVM_CATALOG_FILES: Record<string, VvmCatalogFile> = {
${fileEntries}
};

export const VVM_CATALOG_VOICES: VvmCatalogVoice[] = [
${voiceEntries}
];
`;
}

/** "0.vvm" < "5.vvm" < "10.vvm" < "n0.vvm" < "s0.vvm" の順に並べる。 */
function compareVvmName(a, b) {
  const parse = (name) => {
    const m = /^([a-z]*)(\d+)\.vvm$/.exec(name);
    return m ? { prefix: m[1], index: Number(m[2]) } : { prefix: name, index: 0 };
  };
  const pa = parse(a);
  const pb = parse(b);
  return pa.prefix.localeCompare(pb.prefix) || pa.index - pb.index;
}

async function main() {
  process.stdout.write(`Generating the catalog for VVM ${VERSION}\n`);

  const [markdown, files] = await Promise.all([
    fetchText(voiceModelReadmeUrl(VERSION)),
    fetchReleaseFiles(VERSION),
  ]);

  const rows = parseReadme(markdown);
  const voices = toSlugs(rows);
  validate(voices, files);

  fs.writeFileSync(OUTPUT, render(VERSION, files, voices), 'utf8');

  const byKind = voices.reduce((acc, v) => ({ ...acc, [v.kind]: (acc[v.kind] ?? 0) + 1 }), {});
  process.stdout.write(
    `  wrote ${path.relative(ROOT, OUTPUT)}\n` +
      `  ${Object.keys(files).length} files, ${voices.length} voices` +
      ` (talk ${byKind.talk ?? 0}, song ${byKind.song ?? 0}, nemo ${byKind.nemo ?? 0})\n`
  );
}

main().catch((error) => {
  process.stderr.write(`\nCatalog generation failed: ${error.message}\n`);
  process.exitCode = 1;
});
