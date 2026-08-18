import type { VoicevoxSpeechStateChange } from '../ExpoVoicevox.types';
import ExpoVoicevoxModule from '../ExpoVoicevoxModule';
import {
  addPrepareProgressListener,
  addSpeechStateChangeListener,
  audioQueryFromAccentPhrases,
  cancelPrepareAssets,
  clearSynthesisCache,
  createAccentPhrases,
  createAccentPhrasesFromKana,
  createAudioQuery,
  createAudioQueryFromKana,
  finalize,
  getAssetStatus,
  getCharacters,
  getSynthesisCacheStats,
  getVersion,
  initialize,
  isInitialized,
  isPrepareAssetsCancelled,
  isSpeaking,
  loadUserDictFile,
  precacheSpeech,
  precacheSpeechFromAudioQuery,
  precacheSpeechFromKana,
  prepareAssets,
  replaceMoraData,
  replaceMoraPitch,
  replacePhonemeLength,
  saveUserDictFile,
  setUserDictWords,
  speak,
  speakFromAudioQuery,
  speakFromKana,
  stopSpeaking,
  synthesis,
  tts,
  ttsFromKana,
  waitForSpeech,
} from '../index';

jest.mock('../ExpoVoicevoxModule', () => ({
  __esModule: true,
  default: {
    getVersion: jest.fn(),
    isInitialized: jest.fn(),
    prepareAssets: jest.fn(),
    getAssetStatus: jest.fn(),
    cancelPrepareAssets: jest.fn(),
    initialize: jest.fn(),
    getMetasJson: jest.fn(),
    tts: jest.fn(),
    ttsFromKana: jest.fn(),
    createAudioQueryJson: jest.fn(),
    createAudioQueryFromKanaJson: jest.fn(),
    synthesis: jest.fn(),
    speak: jest.fn(),
    speakFromKana: jest.fn(),
    speakFromAudioQuery: jest.fn(),
    stopSpeaking: jest.fn(),
    isSpeaking: jest.fn(),
    createAccentPhrasesJson: jest.fn(),
    createAccentPhrasesFromKanaJson: jest.fn(),
    replaceMoraDataJson: jest.fn(),
    replacePhonemeLengthJson: jest.fn(),
    replaceMoraPitchJson: jest.fn(),
    audioQueryFromAccentPhrasesJson: jest.fn(),
    setUserDictWords: jest.fn(),
    loadUserDictFile: jest.fn(),
    saveUserDictFile: jest.fn(),
    precacheSpeech: jest.fn(),
    precacheSpeechFromKana: jest.fn(),
    precacheSpeechFromAudioQuery: jest.fn(),
    clearSynthesisCache: jest.fn(),
    getSynthesisCacheStats: jest.fn(),
    finalize: jest.fn(),
    addListener: jest.fn(),
  },
}));

const nativeModule = ExpoVoicevoxModule as jest.Mocked<typeof ExpoVoicevoxModule>;

const speechListeners: ((change: VoicevoxSpeechStateChange) => void)[] = [];

// 再生状態を購読するのは index.ts の内部（最初の speak() で 1 本だけ張る）と
// addSpeechStateChangeListener() の両方なので、登録されたものを全部覚えておいて全部呼ぶ。
// どちらが先に登録されるかに依存させないための作り。
// jest.clearAllMocks() は実装を消さないので、ここで仕掛けておけば全テストで効く。
nativeModule.addListener.mockImplementation(((event: string, listener: unknown) => {
  if (event === 'onSpeechStateChange') {
    speechListeners.push(listener as (change: VoicevoxSpeechStateChange) => void);
  }
  return { remove: jest.fn() };
}) as never);

/** ネイティブから再生状態のイベントが届いたことにする。 */
function emitSpeechState(change: VoicevoxSpeechStateChange): void {
  if (speechListeners.length === 0) {
    throw new Error('onSpeechStateChange がまだ購読されていない');
  }
  speechListeners.forEach((listener) => listener(change));
}

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
      synthesisCacheBytes: 32 * 1024 * 1024,
    });
  });

  it('cpuNumThreads だけ指定してもパスは null のまま', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize({ cpuNumThreads: 2 });

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: null,
      voiceModelPaths: null,
      cpuNumThreads: 2,
      synthesisCacheBytes: 32 * 1024 * 1024,
    });
  });

  it('辞書だけ指定したらモデルは null のまま', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize({ openJtalkDictDir: '/tmp/dict' });

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: '/tmp/dict',
      voiceModelPaths: null,
      cpuNumThreads: 0,
      synthesisCacheBytes: 32 * 1024 * 1024,
    });
  });

  it('cpuNumThreads を 0 で埋めてネイティブへ渡す', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize(validOptions);

    expect(nativeModule.initialize).toHaveBeenCalledWith({
      openJtalkDictDir: validOptions.openJtalkDictDir,
      voiceModelPaths: validOptions.voiceModelPaths,
      cpuNumThreads: 0,
      synthesisCacheBytes: 32 * 1024 * 1024,
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

  it('指定された synthesisCacheBytes をそのまま渡す', async () => {
    nativeModule.initialize.mockResolvedValue(undefined);

    await initialize({ ...validOptions, synthesisCacheBytes: 0 });

    expect(nativeModule.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ synthesisCacheBytes: 0 })
    );
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'synthesisCacheBytes が %p なら throw する',
    async (synthesisCacheBytes) => {
      await expect(initialize({ ...validOptions, synthesisCacheBytes })).rejects.toThrow(
        'synthesisCacheBytes'
      );
      expect(nativeModule.initialize).not.toHaveBeenCalled();
    }
  );
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
    expect(nativeModule.tts).toHaveBeenCalledWith('こんにちは', 3, true, 'cache', true, '');
  });

  it('疑問文の語尾上げを明示的に無効にできる', async () => {
    nativeModule.tts.mockResolvedValue('/tmp/cache/voicevox-1.wav');

    await tts('元気ですか', 3, { enableInterrogativeUpspeak: false });

    expect(nativeModule.tts).toHaveBeenCalledWith('元気ですか', 3, false, 'cache', true, '');
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
    expect(nativeModule.ttsFromKana).toHaveBeenCalledWith(
      "コンニチワ'",
      3,
      true,
      'cache',
      true,
      ''
    );
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

    const [json, styleId, upspeak, directory] = nativeModule.synthesis.mock.calls[0];
    expect(JSON.parse(json).speedScale).toBe(1.5);
    expect(JSON.parse(json).accent_phrases).toHaveLength(1);
    expect(styleId).toBe(3);
    expect(upspeak).toBe(true);
    expect(directory).toBe('cache');
  });

  it('壊れた AudioQuery はネイティブへ流さずに throw する', () => {
    expect(() => synthesis({ speedScale: 1 } as never, 3)).toThrow('audioQuery');
    expect(nativeModule.synthesis).not.toHaveBeenCalled();
  });
});

describe('書き出し先の指定', () => {
  it('tts は既定で cache を渡す', async () => {
    nativeModule.tts.mockResolvedValue('/tmp/cache/voicevox-1.wav');

    await tts('こんにちは', 3);

    expect(nativeModule.tts).toHaveBeenCalledWith('こんにちは', 3, true, 'cache', true, '');
  });

  it('tts に document を指定できる', async () => {
    nativeModule.tts.mockResolvedValue('/tmp/documents/voicevox-1.wav');

    await tts('こんにちは', 3, { directory: 'document' });

    expect(nativeModule.tts).toHaveBeenCalledWith('こんにちは', 3, true, 'document', true, '');
  });

  it('ttsFromKana に document を指定できる', async () => {
    nativeModule.ttsFromKana.mockResolvedValue('/tmp/documents/voicevox-2.wav');

    await ttsFromKana("コンニチワ'", 3, { directory: 'document' });

    expect(nativeModule.ttsFromKana).toHaveBeenCalledWith(
      "コンニチワ'",
      3,
      true,
      'document',
      true,
      ''
    );
  });

  it('synthesis に document を指定できる', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.synthesis.mockResolvedValue('/tmp/documents/voicevox-3.wav');
    const query = await createAudioQuery('あ', 3);

    await synthesis(query, 3, { directory: 'document' });

    expect(nativeModule.synthesis.mock.calls[0][3]).toBe('document');
  });

  it('未知の directory はネイティブを呼ばずに throw する', () => {
    expect(() => tts('こんにちは', 3, { directory: 'tmp' as never })).toThrow('directory');
    expect(nativeModule.tts).not.toHaveBeenCalled();
  });
});

const UTTERANCE = { id: 1, durationMillis: 1200, started: true };

describe('speak', () => {
  it('テキスト・語尾上げ・オーディオセッションをネイティブへ渡す', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    await expect(speak('こんにちは', 3)).resolves.toEqual(UTTERANCE);
    expect(nativeModule.speak).toHaveBeenCalledWith('こんにちは', 3, true, 'none', true, '');
  });

  it('オーディオセッションを指定できる', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    await speak('こんにちは', 3, { audioSession: 'duck' });

    expect(nativeModule.speak).toHaveBeenCalledWith('こんにちは', 3, true, 'duck', true, '');
  });

  it('疑問文の語尾上げを明示的に無効にできる', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    await speak('元気ですか', 3, { enableInterrogativeUpspeak: false });

    expect(nativeModule.speak).toHaveBeenCalledWith('元気ですか', 3, false, 'none', true, '');
  });

  it('text が空ならネイティブを呼ばずに throw する', () => {
    expect(() => speak('', 3)).toThrow('text');
    expect(nativeModule.speak).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5])('styleId が %p なら throw する', (styleId) => {
    expect(() => speak('こんにちは', styleId)).toThrow('styleId');
    expect(nativeModule.speak).not.toHaveBeenCalled();
  });

  it('未知の audioSession はネイティブを呼ばずに throw する', () => {
    expect(() => speak('こんにちは', 3, { audioSession: 'loud' as never })).toThrow('audioSession');
    expect(nativeModule.speak).not.toHaveBeenCalled();
  });
});

describe('speakFromKana', () => {
  it('カナと語尾上げの指定をネイティブへ渡す', async () => {
    nativeModule.speakFromKana.mockResolvedValue(UTTERANCE);

    await expect(speakFromKana("コンニチワ'", 3)).resolves.toEqual(UTTERANCE);
    expect(nativeModule.speakFromKana).toHaveBeenCalledWith(
      "コンニチワ'",
      3,
      true,
      'none',
      true,
      ''
    );
  });

  it('kana が空ならネイティブを呼ばずに throw する', () => {
    expect(() => speakFromKana('', 3)).toThrow('kana');
    expect(nativeModule.speakFromKana).not.toHaveBeenCalled();
  });
});

describe('speakFromAudioQuery', () => {
  it('AudioQuery を JSON にしてネイティブへ渡す', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.speakFromAudioQuery.mockResolvedValue(UTTERANCE);
    const query = await createAudioQuery('あ', 3);

    query.speedScale = 1.5;
    await expect(speakFromAudioQuery(query, 3)).resolves.toEqual(UTTERANCE);

    const [json, styleId, upspeak, audioSession] = nativeModule.speakFromAudioQuery.mock.calls[0];
    expect(JSON.parse(json).speedScale).toBe(1.5);
    expect(JSON.parse(json).accent_phrases).toHaveLength(1);
    expect(styleId).toBe(3);
    expect(upspeak).toBe(true);
    expect(audioSession).toBe('none');
  });

  it('壊れた AudioQuery はネイティブへ流さずに throw する', () => {
    expect(() => speakFromAudioQuery({ speedScale: 1 } as never, 3)).toThrow('audioQuery');
    expect(nativeModule.speakFromAudioQuery).not.toHaveBeenCalled();
  });
});

describe('stopSpeaking / isSpeaking', () => {
  it('stopSpeaking はネイティブへそのまま委譲する', async () => {
    nativeModule.stopSpeaking.mockResolvedValue(undefined);

    await stopSpeaking();

    expect(nativeModule.stopSpeaking).toHaveBeenCalledTimes(1);
  });

  it('isSpeaking はネイティブの返り値をそのまま返す', () => {
    nativeModule.isSpeaking.mockReturnValue(true);
    expect(isSpeaking()).toBe(true);
  });
});

describe('addSpeechStateChangeListener', () => {
  it('onSpeechStateChange を購読する', () => {
    const listener = jest.fn();

    addSpeechStateChangeListener(listener);

    expect(nativeModule.addListener).toHaveBeenCalledWith('onSpeechStateChange', listener);
  });
});

describe('waitForSpeech', () => {
  it('終端イベントが届くまで待ち、終わり方を返す', async () => {
    nativeModule.speak.mockResolvedValue({ id: 10, durationMillis: 500, started: true });

    const { id } = await speak('こんにちは', 3);
    const finished = waitForSpeech(id);
    emitSpeechState({ id, state: 'finished', reason: '' });

    await expect(finished).resolves.toBe('finished');
  });

  it("停止されたら 'stopped' を返す", async () => {
    nativeModule.speak.mockResolvedValue({ id: 11, durationMillis: 500, started: true });

    const { id } = await speak('こんにちは', 3);
    const done = waitForSpeech(id);
    emitSpeechState({ id, state: 'stopped', reason: '' });

    await expect(done).resolves.toBe('stopped');
  });

  it("再生に失敗したら 'failed' を返す（reject はしない）", async () => {
    nativeModule.speak.mockResolvedValue({ id: 12, durationMillis: 500, started: true });

    const { id } = await speak('こんにちは', 3);
    const done = waitForSpeech(id);
    emitSpeechState({ id, state: 'failed', reason: 'could not start the audio player' });

    await expect(done).resolves.toBe('failed');
  });

  it("追い越された発話は即座に 'stopped' で解決する", async () => {
    nativeModule.speak.mockResolvedValue({ id: 13, durationMillis: 0, started: false });

    const { id } = await speak('こんにちは', 3);

    await expect(waitForSpeech(id)).resolves.toBe('stopped');
  });

  it('speak が解決するより先に終端イベントが届いても取りこぼさない', async () => {
    nativeModule.speak.mockImplementation(async () => {
      // ごく短い発話だと、ネイティブの解決より先にイベントが届くことがある。
      emitSpeechState({ id: 14, state: 'finished', reason: '' });
      return { id: 14, durationMillis: 5, started: true };
    });

    const { id } = await speak('あ', 3);

    await expect(waitForSpeech(id)).resolves.toBe('finished');
  });

  it("追跡していない id は 'finished' で解決する", async () => {
    await expect(waitForSpeech(999_999)).resolves.toBe('finished');
  });

  it("'started' では解決しない", async () => {
    nativeModule.speak.mockResolvedValue({ id: 15, durationMillis: 500, started: true });

    const { id } = await speak('こんにちは', 3);
    emitSpeechState({ id, state: 'started', reason: '' });

    const pending = Symbol('pending');
    const race = await Promise.race([waitForSpeech(id), Promise.resolve(pending)]);
    expect(race).toBe(pending);
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
    nativeModule.stopSpeaking.mockResolvedValue(undefined);
    nativeModule.finalize.mockResolvedValue(undefined);

    await finalize();

    expect(nativeModule.finalize).toHaveBeenCalledTimes(1);
  });

  it('先に stopSpeaking を呼んでから finalize する', async () => {
    const order: string[] = [];
    nativeModule.stopSpeaking.mockImplementation(async () => {
      order.push('stopSpeaking');
    });
    nativeModule.finalize.mockImplementation(async () => {
      order.push('finalize');
    });

    await finalize();

    expect(order).toEqual(['stopSpeaking', 'finalize']);
  });
});

describe('合成結果のキャッシュ', () => {
  it('cache 未指定なら true を渡す', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    await speak('こんにちは', 3);

    expect(nativeModule.speak).toHaveBeenCalledWith('こんにちは', 3, true, 'none', true, '');
  });

  it.each([
    ['tts', () => tts('こんにちは', 3, { cache: false }), () => nativeModule.tts, 4],
    [
      'ttsFromKana',
      () => ttsFromKana("コンニチワ'", 3, { cache: false }),
      () => nativeModule.ttsFromKana,
      4,
    ],
    ['speak', () => speak('こんにちは', 3, { cache: false }), () => nativeModule.speak, 4],
    [
      'speakFromKana',
      () => speakFromKana("コンニチワ'", 3, { cache: false }),
      () => nativeModule.speakFromKana,
      4,
    ],
  ])('%s は cache: false をネイティブへ渡す', async (_name, call, mock, index) => {
    mock().mockResolvedValue(UTTERANCE);

    await call();

    expect(mock().mock.calls[0][index as number]).toBe(false);
  });

  it('synthesis は cache: false をネイティブへ渡す', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.synthesis.mockResolvedValue('/tmp/cache/voicevox-3.wav');
    const query = await createAudioQuery('あ', 3);

    await synthesis(query, 3, { cache: false });

    expect(nativeModule.synthesis.mock.calls[0][4]).toBe(false);
  });

  it('speakFromAudioQuery は cache: false をネイティブへ渡す', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.speakFromAudioQuery.mockResolvedValue(UTTERANCE);
    const query = await createAudioQuery('あ', 3);

    await speakFromAudioQuery(query, 3, { cache: false });

    expect(nativeModule.speakFromAudioQuery.mock.calls[0][4]).toBe(false);
  });

  it('clearSynthesisCache はネイティブへそのまま委譲する', async () => {
    nativeModule.clearSynthesisCache.mockResolvedValue(undefined);

    await clearSynthesisCache();

    expect(nativeModule.clearSynthesisCache).toHaveBeenCalledTimes(1);
  });

  it('getSynthesisCacheStats はネイティブの返り値をそのまま返す', async () => {
    const stats = { entryCount: 2, bytes: 100, limitBytes: 1000, hits: 3, misses: 1 };
    nativeModule.getSynthesisCacheStats.mockResolvedValue(stats);

    await expect(getSynthesisCacheStats()).resolves.toBe(stats);
  });
});

describe('合成パラメータの直接指定', () => {
  it('指定が無ければ空文字を渡し、AudioQuery を挟ませない', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    await speak('こんにちは', 3, { audioSession: 'duck' });

    expect(nativeModule.speak.mock.calls[0][5]).toBe('');
  });

  it('指定した値だけを JSON にして渡す', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    await speak('こんにちは', 3, { speedScale: 1.1, prePhonemeLength: 0 });

    expect(nativeModule.speak.mock.calls[0][5]).toBe('{"speedScale":1.1,"prePhonemeLength":0}');
  });

  it('オブジェクトの並び順に関係なくキーの順序を固定する', async () => {
    nativeModule.speak.mockResolvedValue(UTTERANCE);

    // キャッシュキーの一部になるので、書いた順で JSON が変わってはいけない。
    await speak('こんにちは', 3, { prePhonemeLength: 0, speedScale: 1.1 });

    expect(nativeModule.speak.mock.calls[0][5]).toBe('{"speedScale":1.1,"prePhonemeLength":0}');
  });

  it('tts と ttsFromKana も同じ形で渡す', async () => {
    nativeModule.tts.mockResolvedValue('/tmp/cache/voicevox-1.wav');
    nativeModule.ttsFromKana.mockResolvedValue('/tmp/cache/voicevox-2.wav');

    await tts('こんにちは', 3, { volumeScale: 0.8 });
    await ttsFromKana("コンニチワ'", 3, { intonationScale: 1.2 });

    expect(nativeModule.tts.mock.calls[0][5]).toBe('{"volumeScale":0.8}');
    expect(nativeModule.ttsFromKana.mock.calls[0][5]).toBe('{"intonationScale":1.2}');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '1.1' as never])(
    'speedScale が %p ならネイティブを呼ばずに throw する',
    async (speedScale) => {
      await expect(speak('こんにちは', 3, { speedScale })).rejects.toThrow('speedScale');
      expect(nativeModule.speak).not.toHaveBeenCalled();
    }
  );
});

describe('precacheSpeech', () => {
  it('語尾上げと合成パラメータをネイティブへ渡す', async () => {
    nativeModule.precacheSpeech.mockResolvedValue(undefined);

    await precacheSpeech('こんにちは', 3, { speedScale: 1.1 });

    expect(nativeModule.precacheSpeech).toHaveBeenCalledWith(
      'こんにちは',
      3,
      true,
      '{"speedScale":1.1}'
    );
  });

  it('カナ版もネイティブへ委譲する', async () => {
    nativeModule.precacheSpeechFromKana.mockResolvedValue(undefined);

    await precacheSpeechFromKana("コンニチワ'", 3);

    expect(nativeModule.precacheSpeechFromKana).toHaveBeenCalledWith("コンニチワ'", 3, true, '');
  });

  it('AudioQuery 版は JSON にして渡す', async () => {
    nativeModule.createAudioQueryJson.mockResolvedValue(CORE_AUDIO_QUERY_JSON);
    nativeModule.precacheSpeechFromAudioQuery.mockResolvedValue(undefined);
    const query = await createAudioQuery('あ', 3);

    await precacheSpeechFromAudioQuery(query, 3);

    const [json, styleId, upspeak] = nativeModule.precacheSpeechFromAudioQuery.mock.calls[0];
    expect(JSON.parse(json).accent_phrases).toHaveLength(1);
    expect(styleId).toBe(3);
    expect(upspeak).toBe(true);
  });

  it('text が空ならネイティブを呼ばずに throw する', () => {
    expect(() => precacheSpeech('', 3)).toThrow('text');
    expect(nativeModule.precacheSpeech).not.toHaveBeenCalled();
  });
});

describe('アセットの状態と中断', () => {
  it('getAssetStatus はネイティブの返り値をそのまま返す', async () => {
    const status = {
      configured: true,
      ready: false,
      assetSource: 'download' as const,
      downloadBytes: 181_000_000,
    };
    nativeModule.getAssetStatus.mockResolvedValue(status);

    await expect(getAssetStatus()).resolves.toBe(status);
  });

  it('cancelPrepareAssets はネイティブへそのまま委譲する', async () => {
    nativeModule.cancelPrepareAssets.mockResolvedValue(undefined);

    await cancelPrepareAssets();

    expect(nativeModule.cancelPrepareAssets).toHaveBeenCalledTimes(1);
  });

  it('中断のエラーだけを isPrepareAssetsCancelled が拾う', () => {
    // ネイティブ 2 実装が投げる文言。ここが食い違うと中断を通信エラーと区別できなくなる。
    expect(isPrepareAssetsCancelled(new Error('the asset preparation was cancelled'))).toBe(true);
    expect(
      isPrepareAssetsCancelled(
        new Error('failed to prepare the voicevox assets: the asset preparation was cancelled')
      )
    ).toBe(true);
    expect(isPrepareAssetsCancelled(new Error('failed to download: HTTP 503'))).toBe(false);
    expect(isPrepareAssetsCancelled('the asset preparation was cancelled')).toBe(false);
    expect(isPrepareAssetsCancelled(undefined)).toBe(false);
  });
});
