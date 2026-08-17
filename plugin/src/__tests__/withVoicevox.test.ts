import withVoicevox from '../withVoicevox';

/**
 * mod の登録しか行わないので、ここでの適用ではダウンロードも配置も起きない。
 * 実際の取得は `withDangerousMod` に渡した関数が prebuild 中に呼ばれたときに走る。
 */
function apply(props: Parameters<typeof withVoicevox>[1]) {
  return withVoicevox({ name: 'test', slug: 'test' } as never, props);
}

describe('withVoicevox', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockRestore();
    warn.mockRestore();
  });

  function loggedLines(): string {
    return log.mock.calls.map((call) => String(call[0])).join('\n');
  }

  it('取り込む声とサイズを prebuild のログに出す', () => {
    apply({ voices: ['zundamon/normal'] });

    expect(loggedLines()).toContain('voice models: 1 file(s)');
    expect(loggedLines()).toContain('0.vvm');
  });

  it('クレジット表記が必要なことを prebuild で告知する', () => {
    apply({ voices: ['zundamon/normal'] });

    const lines = loggedLines();
    expect(lines).toContain('License and credit requirements');
    expect(lines).toContain('VOICEVOX voice models');
    expect(lines).toContain('OpenJTalk dictionary');
  });

  it('download モードでも告知する（同梱の有無に関係なく規約は適用される）', () => {
    apply({ assetSource: 'download', voices: ['zundamon/normal'] });

    expect(loggedLines()).toContain('License and credit requirements');
  });

  it('音声モデルを同梱しない設定では告知しない', () => {
    apply({ voices: [] });

    expect(loggedLines()).not.toContain('License and credit requirements');
  });
});
