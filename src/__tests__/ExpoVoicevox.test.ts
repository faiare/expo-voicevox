import ExpoVoicevoxModule from '../ExpoVoicevoxModule';
import {
  addPrepareProgressListener,
  audioQueryFromAccentPhrases,
  createAccentPhrases,
  createAccentPhrasesFromKana,
  createAudioQuery,
  createAudioQueryFromKana,
  finalize,
  getCharacters,
  getVersion,
  initialize,
  isInitialized,
  loadUserDictFile,
  prepareAssets,
  replaceMoraData,
  replaceMoraPitch,
  replacePhonemeLength,
  saveUserDictFile,
  setUserDictWords,
  synthesis,
  tts,
  ttsFromKana,
} from '../index';

jest.mock('../ExpoVoicevoxModule', () => ({
  __esModule: true,
  default: {
    getVersion: jest.fn(),
    isInitialized: jest.fn(),
    prepareAssets: jest.fn(),
    initialize: jest.fn(),
    getMetasJson: jest.fn(),
    tts: jest.fn(),
    ttsFromKana: jest.fn(),
    createAudioQueryJson: jest.fn(),
    createAudioQueryFromKanaJson: jest.fn(),
    synthesis: jest.fn(),
    createAccentPhrasesJson: jest.fn(),
    createAccentPhrasesFromKanaJson: jest.fn(),
    replaceMoraDataJson: jest.fn(),
    replacePhonemeLengthJson: jest.fn(),
    replaceMoraPitchJson: jest.fn(),
    audioQueryFromAccentPhrasesJson: jest.fn(),
    setUserDictWords: jest.fn(),
    loadUserDictFile: jest.fn(),
    saveUserDictFile: jest.fn(),
    finalize: jest.fn(),
    addListener: jest.fn(),
  },
}));

const nativeModule = ExpoVoicevoxModule as jest.Mocked<typeof ExpoVoicevoxModule>;

const validOptions = {
  openJtalkDictDir: '/tmp/voicevox/open_jtalk_dic_utf_8-1.11',
  voiceModelPaths: ['/tmp/voicevox/0.vvm'],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getVersion', () => {
  it('ネイティブの返り値をそのまま返す', () => {
    nativeModule.getVersion.mockReturnValue('0.17.0');
    expect(getVersion()).toBe('0.17.0');
  });
});

describe('isInitialized', () => {
  it('ネイティブの返り値をそのまま返す', () => {
    nativeModule.isInitialized.mockReturnValue(true);
    expect(isInitialized()).toBe(true);
  });
});

describe('prepareAssets', () => {
  it('ネイティブへそのまま委譲する', async () => {
    const paths = { openJtalkDictDir: '/data/dict', voiceModelPaths: ['/data/0.vvm'] };
    nativeModule.prepareAssets.mockResolvedValue(paths);

    await expect(prepareAssets()).resolves.toEqual(paths);
  });
});

describe('addPrepareProgressListener', () => {
  it('onPrepareProgress を購読する', () => {
    const listener = jest.fn();

    addPrepareProgressListener(listener);

    expect(nativeModule.addListener).toHaveBeenCalledWith('onPrepareProgress', listener);
  });
});

describe('initialize', () => {
  it('引数なしなら両方 null で渡し、ネイティブに自動解決させる', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize();

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: null,
      voiceModelPaths: null,
      cpuNumThreads: 0,
    });
  });

  it('cpuNumThreads だけ指定してもパスは null のまま', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize({ cpuNumThreads: 2 });

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: null,
      voiceModelPaths: null,
      cpuNumThreads: 2,
    });
  });

  it('辞書だけ指定したらモデルは null のまま', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize({ openJtalkDictDir: '/tmp/dict' });

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: '/tmp/dict',
      voiceModelPaths: null,
      cpuNumThreads: 0,
    });
  });

  it('cpuNumThreads を 0 で埋めてネイティブへ渡す', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize(validOptions);

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: validOptions.openJtalkDictDir,
      voiceModelPaths: validOptions.voiceModelPaths,
      cpuNumThreads: 0,
    });
  });

  it('指定された cpuNumThreads をそのまま渡す', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize({ ...validOptions, cpuNumThreads: 4 });

    expect(nativeModule.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ cpuNumThreads: 4 })
    );
  });

  it('呼び出し側の配列をそのまま参照せずコピーして渡す', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);
    const voiceModelPaths = ['/tmp/voicevox/0.vvm'];

    await initialize({ ...validOptions, voiceModelPaths });

    const passed = nativeModule.initialize.mock.calls[0][0].voiceModelPaths;
    expect(passed).toEqual(voiceModelPaths);
    expect(passed).not.toBe(voiceModelPaths);
  });

  it('openJtalkDictDir が空ならネイティブを呼ばずに throw する', async () => {
    await expect(initialize({ ...validOptions, openJtalkDictDir: '' })).rejects.toThrow(
      'openJtalkDictDir'
    );
    expect(nativeModule.initialize).not.toHaveBeenCalled();
  });

  it('voiceModelPaths が空配列ならネイティブを呼ばずに throw する', async () => {
    await expect(initialize({ ...validOptions, voiceModelPaths: [] })).rejects.toThrow(
      'voiceModelPaths'
    );
    expect(nativeModule.initialize).not.toHaveBeenCalled();
  });

  it('voiceModelPaths に空文字が混ざっていたら throw する', async () => {
    await expect(initialize({ ...validOptions, voiceModelPaths: ['/a.vvm', ''] })).rejects.toThrow(
      'voiceModelPaths[1]'
    );
    expect(nativeModule.initialize).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5, 65536])('cpuNumThreads が %p なら throw する', async (cpuNumThreads) => {
    await expect(initialize({ ...validOptions, cpuNumThreads })).rejects.toThrow('cpuNumThreads');
    expect(nativeModule.initialize).not.toHaveBeenCalled();
  });
});

describe('getCharacters', () => {
  it('voicevox-core のメタ情報 JSON を構造化して返す', async () => {
    nativeModule.getMetasJson.mockResolvedValue(
      JSON.stringify([
        {
          name: 'ずんだもん',
          speaker_uuid: '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',
          version: '0.17.0',
          order: 1,
          styles: [
            { name: 'ノーマル', id: 3, type: 'talk', order: 0 },
            { name: 'あまあま', id: 1, type: 'talk', order: 1 },
          ],
        },
      ])
    );

    await expect(getCharacters()).resolves.toEqual([
      {
        name: 'ずんだもん',
        speakerUuid: '388f246b-8c41-4ac1-8e2d-5d79f3ff56d9',
        styles: [
          { id: 3, name: 'ノーマル', type: 'talk' },
          { id: 1, name: 'あまあま', type: 'talk' },
        ],
      },
    ]);
  });

  it('JSON が配列でなければ throw する', async () => {
    nativeModule.getMetasJson.mockResolvedValue('{}');

    await expect(getCharacters()).rejects.toThrow('is not an array');
  });
});

describe('tts', () => {
  it('ネイティブが返した WAV のパスをそのまま返す', async () => {
    nativeModule.tts.mockResolvedValue('/tmp/cache/voicevox-1.wav');

    await expect(tts('こんにちは', 3)).resolves.toBe('/tmp/cache/voicevox-1.wav');
    expect(nativeModule.tts).toHaveBeenCalledWith('こんにちは', 3, true);
  });

  it('疑問文の語尾上げを明示的に無効にできる', async () => {
    nativeModule.tts.mockResolvedValue('/tmp/cache/voicevox-1.wav');

    await tts('元気ですか', 3, { enableInterrogativeUpspeak: false });

    expect(nativeModule.tts).toHaveBeenCalledWith('元気ですか', 3, false);
  });

  it('text が空ならネイティブを呼ばずに throw する', () => {
    expect(() => tts('', 3)).toThrow('text');
    expect(nativeModule.tts).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5])('styleId が %p なら throw する', (styleId) => {
    expect(() => tts('こんにちは', styleId)).toThrow('styleId');
    expect(nativeModule.tts).not.toHaveBeenCalled();
  });
});

describe('ttsFromKana', () => {
  it('カナと語尾上げの指定をネイティブへ渡す', async () => {
    nativeModule.ttsFromKana.mockResolvedValue('/tmp/cache/voicevox-2.wav');

    await expect(ttsFromKana("コンニチワ'", 3)).resolves.toBe('/tmp/cache/voicevox-2.wav');
    expect(nativeModule.ttsFromKana).toHaveBeenCalledWith("コンニチワ'", 3, true);
  });

  it('kana が空ならネイティブを呼ばずに throw する', () => {
    expect(() => ttsFromKana('', 3)).toThrow('kana');
    expect(nativeModule.ttsFromKana).not.toHaveBeenCalled();
  });
});

const CORE_AUDIO_QUERY_JSON = JSON.stringify({
  accent_phrases: [
    {
      moras: [
        {
          text: 'ア',
          consonant: null,
          consonant_length: null,
          vowel: 'a',
          vowel_length: 0.1,
          pitch: 5.5,
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
  kana: 'ア',
});

describe('createAudioQuery', () => {
  it('ネイティブの JSON を構造化して返す', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);

    const query = await createAudioQuery('あ', 3);

    expect(nativeModule.createAudioQueryJson).toHaveBeenCalledWith('あ', 3);
    expect(query.speedScale).toBe(1);
    expect(query.accentPhrases[0].moras[0]).toEqual({
      text: 'ア',
      consonant: null,
      consonantLength: null,
      vowel: 'a',
      vowelLength: 0.1,
      pitch: 5.5,
    });
  });

  it('text が空ならネイティブを呼ばずに throw する', async () => {
    await expect(createAudioQuery('', 3)).rejects.toThrow('text');
    expect(nativeModule.createAudioQueryJson).not.toHaveBeenCalled();
  });
});

describe('createAudioQueryFromKana', () => {
  it('カナをそのままネイティブへ渡す', async () => {
    nativeModule.createAudioQueryFromKanaJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);

    await createAudioQueryFromKana("ア'", 3);

    expect(nativeModule.createAudioQueryFromKanaJson).toHaveBeenCalledWith("ア'", 3);
  });
});

describe('synthesis', () => {
  it('AudioQuery を JSON にしてネイティブへ渡す', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.synthesis.mockResolvedValue('/tmp/cache/voicevox-3.wav');
    const query = await createAudioQuery('あ', 3);

    query.speedScale = 1.5;
    await expect(synthesis(query, 3)).resolves.toBe('/tmp/cache/voicevox-3.wav');

    const [json, styleId, upspeak] = nativeModule.synthesis.mock.calls[0];
    expect(JSON.parse(json).speedScale).toBe(1.5);
    expect(JSON.parse(json).accent_phrases).toHaveLength(1);
    expect(styleId).toBe(3);
    expect(upspeak).toBe(true);
  });

  it('壊れた AudioQuery はネイティブへ流さずに throw する', () => {
    expect(() => synthesis({ speedScale: 1 } as never, 3)).toThrow('audioQuery');
    expect(nativeModule.synthesis).not.toHaveBeenCalled();
  });
});

const CORE_ACCENT_PHRASES_JSON = JSON.stringify(JSON.parse(CORE_AUDIO_QUERY_JSON).accent_phrases);

describe('アクセント句の編集', () => {
  it('createAccentPhrases はネイティブの JSON を構造化する', async () => {
    nativeModule.createAccentPhrasesJson.mockResolvedValue(CORE_ACCENT_PHRASES_JSON);

    const phrases = await createAccentPhrases('あ', 3);

    expect(nativeModule.createAccentPhrasesJson).toHaveBeenCalledWith('あ', 3);
    expect(phrases).toHaveLength(1);
    expect(phrases[0].isInterrogative).toBe(false);
  });

  it('createAccentPhrasesFromKana はカナをそのまま渡す', async () => {
    nativeModule.createAccentPhrasesFromKanaJson.mockResolvedValue(CORE_ACCENT_PHRASES_JSON);

    await createAccentPhrasesFromKana("ア'", 3);

    expect(nativeModule.createAccentPhrasesFromKanaJson).toHaveBeenCalledWith("ア'", 3);
  });

  it.each([
    ['replaceMoraData', replaceMoraData, 'replaceMoraDataJson'],
    ['replacePhonemeLength', replacePhonemeLength, 'replacePhonemeLengthJson'],
    ['replaceMoraPitch', replaceMoraPitch, 'replaceMoraPitchJson'],
  ] as const)('%s は編集後のアクセント句を JSON にして渡す', async (_name, fn, nativeName) => {
    nativeModule.createAccentPhrasesJson.mockResolvedValue(CORE_ACCENT_PHRASES_JSON);
    nativeModule[nativeName].mockResolvedValue(CORE_ACCENT_PHRASES_JSON);
    const phrases = await createAccentPhrases('あ', 3);

    phrases[0].accent = 2;
    phrases[0].isInterrogative = true;
    await fn(phrases, 3);

    const [json, styleId] = nativeModule[nativeName].mock.calls[0];
    expect(JSON.parse(json)[0]).toMatchObject({ accent: 2, is_interrogative: true });
    expect(styleId).toBe(3);
  });

  it('audioQueryFromAccentPhrases はアクセント句から AudioQuery を組み立てる', async () => {
    nativeModule.audioQueryFromAccentPhrasesJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.createAccentPhrasesJson.mockResolvedValue(CORE_ACCENT_PHRASES_JSON);
    const phrases = await createAccentPhrases('あ', 3);

    const query = await audioQueryFromAccentPhrases(phrases);

    expect(JSON.parse(nativeModule.audioQueryFromAccentPhrasesJson.mock.calls[0][0])).toHaveLength(
      1
    );
    expect(query.speedScale).toBe(1);
  });

  it('壊れたアクセント句はネイティブへ流さずに throw する', async () => {
    await expect(replaceMoraData([{ accent: 1 } as never], 3)).rejects.toThrow('accentPhrases[0]');
    expect(nativeModule.replaceMoraDataJson).not.toHaveBeenCalled();
  });
});

describe('setUserDictWords', () => {
  it('省略された項目を既定値で埋めてネイティブへ渡す', async () => {
    nativeModule.setUserDictWords.mockResolvedValue(undefined);

    await setUserDictWords([{ surface: '猫', pronunciation: 'ネコ' }]);

    expect(nativeModule.setUserDictWords).toHaveBeenCalledWith([
      {
        surface: '猫',
        pronunciation: 'ネコ',
        accentType: 0,
        wordType: 'COMMON_NOUN',
        priority: 5,
      },
    ]);
  });

  it('指定された値はそのまま渡す', async () => {
    nativeModule.setUserDictWords.mockResolvedValue(undefined);

    await setUserDictWords([
      {
        surface: '四国めたん',
        pronunciation: 'シコクメタン',
        accentType: 4,
        wordType: 'PROPER_NOUN',
        priority: 8,
      },
    ]);

    expect(nativeModule.setUserDictWords).toHaveBeenCalledWith([
      {
        surface: '四国めたん',
        pronunciation: 'シコクメタン',
        accentType: 4,
        wordType: 'PROPER_NOUN',
        priority: 8,
      },
    ]);
  });

  it('空配列で辞書を空にできる', async () => {
    nativeModule.setUserDictWords.mockResolvedValue(undefined);

    await setUserDictWords([]);

    expect(nativeModule.setUserDictWords).toHaveBeenCalledWith([]);
  });

  it('surface が空ならネイティブを呼ばずに throw する', () => {
    expect(() => setUserDictWords([{ surface: '', pronunciation: 'ネコ' }])).toThrow(
      'words[0].surface'
    );
    expect(nativeModule.setUserDictWords).not.toHaveBeenCalled();
  });

  it('未知の wordType は throw する', () => {
    expect(() =>
      setUserDictWords([{ surface: '猫', pronunciation: 'ネコ', wordType: 'NOUN' as never }])
    ).toThrow('words[0].wordType');
    expect(nativeModule.setUserDictWords).not.toHaveBeenCalled();
  });

  it.each([-1, 11, 1.5])('priority が %p なら throw する', (priority) => {
    expect(() => setUserDictWords([{ surface: '猫', pronunciation: 'ネコ', priority }])).toThrow(
      'words[0].priority'
    );
    expect(nativeModule.setUserDictWords).not.toHaveBeenCalled();
  });

  it('accentType が負なら throw する', () => {
    expect(() =>
      setUserDictWords([{ surface: '猫', pronunciation: 'ネコ', accentType: -1 }])
    ).toThrow('words[0].accentType');
  });

  it('2 件目の不正でもどの要素か分かる', () => {
    expect(() =>
      setUserDictWords([
        { surface: '猫', pronunciation: 'ネコ' },
        { surface: '犬', pronunciation: '' },
      ])
    ).toThrow('words[1].pronunciation');
  });
});

describe('ユーザー辞書のファイル入出力', () => {
  it('loadUserDictFile はパスをそのまま渡す', async () => {
    nativeModule.loadUserDictFile.mockResolvedValue(undefined);

    await loadUserDictFile('/tmp/dict.json');

    expect(nativeModule.loadUserDictFile).toHaveBeenCalledWith('/tmp/dict.json');
  });

  it('saveUserDictFile はパスをそのまま渡す', async () => {
    nativeModule.saveUserDictFile.mockResolvedValue(undefined);

    await saveUserDictFile('/tmp/dict.json');

    expect(nativeModule.saveUserDictFile).toHaveBeenCalledWith('/tmp/dict.json');
  });

  it('パスが空ならネイティブを呼ばずに throw する', () => {
    expect(() => loadUserDictFile('')).toThrow('path');
    expect(() => saveUserDictFile('')).toThrow('path');
    expect(nativeModule.loadUserDictFile).not.toHaveBeenCalled();
    expect(nativeModule.saveUserDictFile).not.toHaveBeenCalled();
  });
});

describe('finalize', () => {
  it('ネイティブへそのまま委譲する', async () => {
    nativeModule.finalize.mockResolvedValue(undefined);

    await finalize();

    expect(nativeModule.finalize).toHaveBeenCalledTimes(1);
  });
});
