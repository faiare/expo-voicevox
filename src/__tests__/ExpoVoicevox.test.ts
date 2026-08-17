import ExpoVoicevoxModule from '../ExpoVoicevoxModule';
import {
  addPrepareProgressListener,
  finalize,
  getCharacters,
  getVersion,
  initialize,
  isInitialized,
  prepareAssets,
  tts,
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
    expect(nativeModule.tts).toHaveBeenCalledWith('こんにちは', 3);
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

describe('finalize', () => {
  it('ネイティブへそのまま委譲する', async () => {
    nativeModule.finalize.mockResolvedValue(undefined);

    await finalize();

    expect(nativeModule.finalize).toHaveBeenCalledTimes(1);
  });
});
