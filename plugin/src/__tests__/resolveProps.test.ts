import {
  isDeploymentTargetAtLeast,
  MINIMUM_ANDROID_SDK_VERSION,
  MINIMUM_IOS_DEPLOYMENT_TARGET,
  resolveProps,
} from '../resolveProps';
import { collectWarnings, describeSelection } from '../withVoicevox';

describe('resolveProps', () => {
  it('既定値を埋める', () => {
    const resolved = resolveProps();

    expect(resolved.assetSource).toBe('bundle');
    expect(resolved.openJtalkDictionary).toBe(true);
    expect(resolved.android).toEqual({
      abis: ['arm64-v8a', 'x86_64'],
      minSdkVersion: MINIMUM_ANDROID_SDK_VERSION,
    });
    expect(resolved.ios).toEqual({ deploymentTarget: MINIMUM_IOS_DEPLOYMENT_TARGET });
    expect(resolved.skipIntegrityCheck).toBe(false);
    expect(resolved.cacheDirectory).toBeNull();
    // 既定はずんだもんのノーマルだけ。
    expect(resolved.voiceModels.map((m) => m.fileName)).toEqual(['0.vvm']);
  });

  it('音声モデルに URL とサイズと sha256 を付ける', () => {
    const [model] = resolveProps({ voices: ['zundamon/normal'] }).voiceModels;

    expect(model.url).toBe(
      'https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.17.0/0.vvm'
    );
    expect(model.size).toBeGreaterThan(0);
    expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(model.requestedBy).toEqual(['zundamon/normal']);
  });

  it('カタログに無いバージョンではサイズと sha256 が不明になる', () => {
    const [model] = resolveProps({
      voiceModelVersion: '9.9.9',
      voices: [{ file: '0.vvm' }],
    }).voiceModels;

    expect(model.url).toBe(
      'https://github.com/VOICEVOX/voicevox_vvm/releases/download/9.9.9/0.vvm'
    );
    expect(model.size).toBeNull();
    expect(model.sha256).toBeNull();
  });

  it('ABI の重複を取り除く', () => {
    expect(resolveProps({ android: { abis: ['arm64-v8a', 'arm64-v8a'] } }).android.abis).toEqual([
      'arm64-v8a',
    ]);
  });

  it('辞書だけを配置する設定を許す', () => {
    const resolved = resolveProps({ voices: [], openJtalkDictionary: true });
    expect(resolved.voiceModels).toEqual([]);
    expect(resolved.openJtalkDictionary).toBe(true);
  });

  describe('エラー', () => {
    it('未知の assetSource を弾く', () => {
      expect(() => resolveProps({ assetSource: 'cdn' as never })).toThrow(/assetSource must be/);
    });

    it('配布されていない ABI を弾く', () => {
      expect(() => resolveProps({ android: { abis: ['armeabi-v7a' as never] } })).toThrow(
        /voicevox-core only ships/
      );
    });

    it('空の abis を弾く', () => {
      expect(() => resolveProps({ android: { abis: [] } })).toThrow(/must list at least one of/);
    });

    it('minSdkVersion が 26 未満なら弾く', () => {
      expect(() => resolveProps({ android: { minSdkVersion: 24 } })).toThrow(
        /minSdkVersion must be 26 or higher/
      );
    });

    it('deploymentTarget が 16.4 未満なら弾く', () => {
      expect(() => resolveProps({ ios: { deploymentTarget: '15.0' } })).toThrow(
        /deploymentTarget must be 16\.4 or higher/
      );
    });

    it('解釈できない deploymentTarget を弾く', () => {
      expect(() => resolveProps({ ios: { deploymentTarget: 'latest' } })).toThrow(
        /Use a form like "16\.4"/
      );
    });

    it('voices も辞書も無い設定を弾く', () => {
      expect(() => resolveProps({ voices: [], openJtalkDictionary: false })).toThrow(
        /nothing to place/
      );
    });

    it('voices が配列でなければ弾く', () => {
      expect(() => resolveProps({ voices: 'zundamon/normal' as never })).toThrow(
        /voices must be an array/
      );
    });
  });
});

describe('isDeploymentTargetAtLeast', () => {
  it('マイナーバージョンを数値として比べる', () => {
    expect(isDeploymentTargetAtLeast('16.4', '16.4')).toBe(true);
    expect(isDeploymentTargetAtLeast('16.10', '16.4')).toBe(true);
    expect(isDeploymentTargetAtLeast('16.2', '16.4')).toBe(false);
    expect(isDeploymentTargetAtLeast('17', '16.4')).toBe(true);
  });
});

describe('describeSelection', () => {
  it('ファイルとサイズと要求元を出す', () => {
    const text = describeSelection(
      resolveProps({ voices: ['zundamon/normal', 'zundamon/sasayaki'] })
    );

    expect(text).toContain('voice models: 2 file(s)');
    expect(text).toContain('0.vvm');
    expect(text).toContain('5.vvm');
    expect(text).toContain('zundamon/sasayaki');
    expect(text).toContain('open_jtalk_dic_utf_8-1.11');
  });

  it('モデルを入れない設定も説明する', () => {
    expect(describeSelection(resolveProps({ voices: [] }))).toContain('voice models: none');
  });
});

describe('collectWarnings', () => {
  it('既定の設定では警告しない', () => {
    expect(collectWarnings(resolveProps())).toEqual([]);
  });

  it('歌唱専用モデルの同梱を警告する', () => {
    const warnings = collectWarnings(resolveProps({ voices: [{ file: 's0.vvm' }] }));
    expect(warnings.some((w) => w.includes('singing'))).toBe(true);
  });

  it('bundle でモデルが大きいと配信サイズを警告する', () => {
    const warnings = collectWarnings(
      resolveProps({ voices: ['zundamon/normal', 'zundamon/sasayaki'] })
    );
    expect(warnings.some((w) => w.includes('Google Play'))).toBe(true);
  });

  it('download なら配信サイズは警告しない', () => {
    const warnings = collectWarnings(
      resolveProps({ assetSource: 'download', voices: ['zundamon/normal', 'zundamon/sasayaki'] })
    );
    expect(warnings.some((w) => w.includes('Google Play'))).toBe(false);
  });
});
