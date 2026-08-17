import { VVM_CATALOG_VERSION, VVM_CATALOG_VOICES } from '../vvm/catalog.generated';
import { compareVvmName, isSongOnlyFile, normalizeSlug, resolveVoices } from '../vvm/resolveVoices';

const VERSION = VVM_CATALOG_VERSION;

/** 解決結果をファイル名だけに落として比較しやすくする。 */
function files(voices: Parameters<typeof resolveVoices>[0]) {
  return resolveVoices(voices, VERSION).map((model) => model.fileName);
}

describe('resolveVoices', () => {
  it('短縮形をファイルへ解決する', () => {
    expect(files(['zundamon/normal'])).toEqual(['0.vvm']);
  });

  it('同じキャラクターでもスタイルによって別のファイルになる', () => {
    // ずんだもんのトークは 0.vvm / 5.vvm / 15.vvm に分かれている。
    expect(files(['zundamon/normal', 'zundamon/sasayaki', 'zundamon/herohero'])).toEqual([
      '0.vvm',
      '5.vvm',
      '15.vvm',
    ]);
  });

  it('展開形も受け付ける', () => {
    expect(files([{ character: 'shikoku_metan', styles: ['normal', 'sasayaki'] }])).toEqual([
      '0.vvm',
      '5.vvm',
    ]);
  });

  it('kebab-case と大文字と余分な空白を吸収する', () => {
    expect(files([' Shikoku-Metan / Normal '])).toEqual(['0.vvm']);
  });

  it('同じファイルを引く指定をまとめ、要求元を記録する', () => {
    const resolved = resolveVoices(
      ['zundamon/normal', 'shikoku_metan/normal', 'zundamon/normal'],
      VERSION
    );
    expect(resolved).toEqual([
      { fileName: '0.vvm', requestedBy: ['shikoku_metan/normal', 'zundamon/normal'] },
    ]);
  });

  it('ファイル直接指定を受け付け、要求元は空になる', () => {
    expect(resolveVoices([{ file: 'n0.vvm' }], VERSION)).toEqual([
      { fileName: 'n0.vvm', requestedBy: [] },
    ]);
  });

  it('Nemo の声をキャラクター名で引ける', () => {
    expect(files(['nemo_female_1/normal'])).toEqual(['n0.vvm']);
  });

  it('空の指定は空の結果になる', () => {
    expect(resolveVoices([], VERSION)).toEqual([]);
  });

  describe('歌唱（ソング）の扱い', () => {
    it('歌唱にしか存在しないキャラクター／スタイルの組は無い', () => {
      // これが崩れると「名前で引くとトークが返る」という前提が成り立たなくなり、
      // 歌唱を名前で選べないことがユーザーから見て不可解になる。
      const talkLike = new Set(
        VVM_CATALOG_VOICES.filter((v) => v.kind !== 'song').map((v) => `${v.character}/${v.style}`)
      );
      const songOnly = VVM_CATALOG_VOICES.filter(
        (v) => v.kind === 'song' && !talkLike.has(`${v.character}/${v.style}`)
      );
      expect(songOnly).toEqual([]);
    });

    it('名前で引くと必ずトークのモデルになる', () => {
      // ずんだもんの「ノーマル」は 0.vvm(styleId 3) と s0.vvm(3003) の両方にある。
      expect(files(['zundamon/normal'])).toEqual(['0.vvm']);
    });

    it('歌唱専用ファイルを判別できる', () => {
      expect(isSongOnlyFile('s0.vvm')).toBe(true);
      expect(isSongOnlyFile('0.vvm')).toBe(false);
      expect(isSongOnlyFile('n0.vvm')).toBe(false);
    });
  });

  describe('エラー', () => {
    it('キャラクター名だけの指定は、使えるスタイルを列挙して失敗する', () => {
      expect(() => files(['zundamon'])).toThrow(/needs a style/);
      expect(() => files(['zundamon'])).toThrow(/zundamon\/sasayaki/);
      // どのファイルが増えるのかが分かること。
      expect(() => files(['zundamon'])).toThrow(/15\.vvm/);
    });

    it('styles が空の展開形も同様に失敗する', () => {
      expect(() => files([{ character: 'zundamon', styles: [] }])).toThrow(/needs a style/);
    });

    it('未知のキャラクターは候補を出す', () => {
      expect(() => files(['zundamoon/normal'])).toThrow(/Did you mean: zundamon/);
    });

    it('未知のスタイルはそのキャラクターのスタイルを列挙する', () => {
      expect(() => files(['zundamon/whisper'])).toThrow(/has no style "whisper"/);
      expect(() => files(['zundamon/whisper'])).toThrow(/zundamon\/hisohiso/);
    });

    it('区切りが 2 つ以上ある指定は形式エラーになる', () => {
      expect(() => files(['zundamon/normal/extra'])).toThrow(/must be written as/);
    });

    it('.vvm でないファイル名を弾く', () => {
      expect(() => files([{ file: '0' }])).toThrow(/must name a \.vvm file/);
    });

    it('リリースに無いファイル名を弾く', () => {
      expect(() => files([{ file: '999.vvm' }])).toThrow(/is not part of the VVM/);
    });

    it('解釈できない要素を弾く', () => {
      expect(() => files([42 as never])).toThrow(/could not interpret a voices entry/);
    });

    it('カタログと違うバージョンではキャラクター名を使えない', () => {
      expect(() => resolveVoices(['zundamon/normal'], '9.9.9')).toThrow(
        /cannot be selected by character name/
      );
      // ファイル直接指定は通る（サイズと sha256 は不明のまま）。
      expect(resolveVoices([{ file: '0.vvm' }], '9.9.9')).toEqual([
        { fileName: '0.vvm', requestedBy: [] },
      ]);
    });
  });
});

describe('normalizeSlug', () => {
  it('前後の空白を落とし、小文字化して - を _ にする', () => {
    expect(normalizeSlug(' Shikoku-Metan ')).toBe('shikoku_metan');
  });
});

describe('compareVvmName', () => {
  it('数値順に並べ、接頭辞つきを後ろにする', () => {
    const names = ['10.vvm', 's0.vvm', '2.vvm', 'n0.vvm', '0.vvm'];
    expect([...names].sort(compareVvmName)).toEqual([
      '0.vvm',
      '2.vvm',
      '10.vvm',
      'n0.vvm',
      's0.vvm',
    ]);
  });
});
