import type { VoicevoxAudioQuery } from '../ExpoVoicevox.types';
import {
  parseAccentPhrases,
  parseAudioQuery,
  stringifyAccentPhrases,
  stringifyAudioQuery,
} from '../audioQuery';

/**
 * voicevox-core が実際に返す形。
 *
 * キーは snake_case と camelCase の混在で、snake_case なのは `accent_phrases` /
 * `pause_mora` / `is_interrogative` / `consonant_length` / `vowel_length` の 5 個だけ。
 */
const CORE_JSON = JSON.stringify({
  accent_phrases: [
    {
      moras: [
        {
          text: 'コ',
          consonant: 'k',
          consonant_length: 0.05,
          vowel: 'o',
          vowel_length: 0.1,
          pitch: 5.5,
        },
        {
          text: 'ン',
          consonant: null,
          consonant_length: null,
          vowel: 'N',
          vowel_length: 0.08,
          pitch: 5.6,
        },
      ],
      accent: 1,
      pause_mora: null,
      is_interrogative: false,
    },
  ],
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  outputSamplingRate: 24000,
  outputStereo: false,
  kana: "コ'ン",
});

const PARSED: VoicevoxAudioQuery = {
  accentPhrases: [
    {
      moras: [
        {
          text: 'コ',
          consonant: 'k',
          consonantLength: 0.05,
          vowel: 'o',
          vowelLength: 0.1,
          pitch: 5.5,
        },
        {
          text: 'ン',
          consonant: null,
          consonantLength: null,
          vowel: 'N',
          vowelLength: 0.08,
          pitch: 5.6,
        },
      ],
      accent: 1,
      pauseMora: null,
      isInterrogative: false,
    },
  ],
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  outputSamplingRate: 24000,
  outputStereo: false,
  kana: "コ'ン",
};

describe('parseAudioQuery', () => {
  it('voicevox-core の JSON を公開型へ変換する', () => {
    expect(parseAudioQuery(CORE_JSON)).toEqual(PARSED);
  });

  it('配列を渡されたら throw する', () => {
    expect(() => parseAudioQuery('[]')).toThrow('audioQuery must be an object');
  });

  it('数値フィールドが欠けていたらどのフィールドか分かる形で throw する', () => {
    const broken = { ...JSON.parse(CORE_JSON), speedScale: undefined };
    expect(() => parseAudioQuery(JSON.stringify(broken))).toThrow('audioQuery.speedScale');
  });

  it('モーラの欠損はパスつきで報告する', () => {
    const query = JSON.parse(CORE_JSON);
    delete query.accent_phrases[0].moras[1].vowel;
    expect(() => parseAudioQuery(JSON.stringify(query))).toThrow(
      'audioQuery.accent_phrases[0].moras[1].vowel'
    );
  });
});

describe('stringifyAudioQuery', () => {
  it('voicevox-core が読める JSON へ戻す', () => {
    expect(JSON.parse(stringifyAudioQuery(PARSED))).toEqual(JSON.parse(CORE_JSON));
  });

  it('往復しても内容が変わらない', () => {
    expect(parseAudioQuery(stringifyAudioQuery(PARSED))).toEqual(PARSED);
  });

  it('null のモーラフィールドをキーごと消さない', () => {
    const written = JSON.parse(stringifyAudioQuery(PARSED));
    const mora = written.accent_phrases[0].moras[1];
    expect(mora).toHaveProperty('consonant', null);
    expect(mora).toHaveProperty('consonant_length', null);
  });

  it('NaN を渡したらネイティブへ流さずに throw する', () => {
    expect(() => stringifyAudioQuery({ ...PARSED, speedScale: NaN })).toThrow(
      'audioQuery.speedScale'
    );
  });

  it('accentPhrases が配列でなければ throw する', () => {
    expect(() => stringifyAudioQuery({ ...PARSED, accentPhrases: null as never })).toThrow(
      'audioQuery.accentPhrases must be an array'
    );
  });
});

describe('AccentPhrase の変換', () => {
  it('pauseMora を持つアクセント句を往復できる', () => {
    const pauseMora = {
      text: '、',
      consonant: null,
      consonantLength: null,
      vowel: 'pau',
      vowelLength: 0.3,
      pitch: 0,
    };
    const phrases = [{ ...PARSED.accentPhrases[0], pauseMora, isInterrogative: true }];

    const json = stringifyAccentPhrases(phrases);
    expect(JSON.parse(json)[0]).toMatchObject({
      is_interrogative: true,
      pause_mora: { text: '、', vowel_length: 0.3 },
    });
    expect(parseAccentPhrases(json)).toEqual(phrases);
  });

  it('配列でない JSON なら throw する', () => {
    expect(() => parseAccentPhrases('{}')).toThrow('accentPhrases must be an array');
  });
});
