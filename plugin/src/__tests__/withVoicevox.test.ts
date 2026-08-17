import type { ExpoVoicevoxPluginProps } from '../types';

/**
 * mod の登録しか行わないので、ここでの適用ではダウンロードも配置も起きない。
 * 実際の取得は `withDangerousMod` に渡した関数が prebuild 中に呼ばれたときに走る。
 *
 * 利用規約の告知はプロセス内で 1 回に絞られているため、ケースごとに
 * `jest.resetModules()` でモジュールを読み直してフラグを戻す。
 */
function apply(props: ExpoVoicevoxPluginProps) {
  jest.resetModules();
  const withVoicevox = require('../withVoicevox').default as (
    config: unknown,
    props: ExpoVoicevoxPluginProps
  ) => unknown;
  return withVoicevox({ name: 'test', slug: 'test' }, props);
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

  it('prebuild が設定を何度解決しても告知は 1 回だけ出す', () => {
    jest.resetModules();
    const withVoicevox = require('../withVoicevox').default;

    // createRunOncePlugin は同じ config オブジェクトでの重複だけを弾く。
    // prebuild は platform ごと・--clean の前後で config を作り直すので、
    // ここでも毎回新しい config を渡して同じ状況を作る。
    for (let i = 0; i < 3; i += 1) {
      withVoicevox({ name: 'test', slug: 'test' }, { voices: ['zundamon/normal'] });
    }

    const occurrences = log.mock.calls.filter((call) =>
      String(call[0]).includes('License and credit requirements')
    );
    expect(occurrences).toHaveLength(1);
    // 取り込む声のログは毎回出る（告知だけを絞っている）。
    expect(
      log.mock.calls.filter((call) => String(call[0]).includes('voice models: 1 file(s)'))
    ).toHaveLength(3);
  });
});
