import { resolveProps } from '../resolveProps';
import { buildRuntimeManifest, serializeManifest } from '../runtimeManifest';

describe('buildRuntimeManifest', () => {
  it('bundle モードでは downloads が空になる', () => {
    const manifest = buildRuntimeManifest(resolveProps({ voices: ['zundamon/normal'] }));

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.assetSource).toBe('bundle');
    expect(manifest.voiceModelNames).toEqual(['0.vvm']);
    expect(manifest.openJtalkDictDirName).toBe('open_jtalk_dic_utf_8-1.11');
    expect(manifest.downloads).toEqual([]);
  });

  it('download モードではモデルと辞書の取得先を並べる', () => {
    const manifest = buildRuntimeManifest(
      resolveProps({ assetSource: 'download', voices: ['zundamon/normal'] })
    );

    expect(manifest.downloads).toHaveLength(2);

    const [model, dictionary] = manifest.downloads;
    expect(model).toMatchObject({ kind: 'file', name: '0.vvm' });
    expect(model.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(model.size).toBeGreaterThan(0);

    // 配布物の tar は open_jtalk_dic_utf_8-1.11/ を先頭に持つので、
    // ルートへ展開するだけでこの名前のディレクトリができる。
    expect(dictionary).toMatchObject({ kind: 'targz', name: 'open_jtalk_dic_utf_8-1.11' });
    expect(dictionary.url).toContain('open_jtalk_dic_utf_8-1.11.tar.gz');
    expect(dictionary.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('辞書を入れない設定では openJtalkDictDirName が null になる', () => {
    const manifest = buildRuntimeManifest(
      resolveProps({ voices: ['zundamon/normal'], openJtalkDictionary: false })
    );

    expect(manifest.openJtalkDictDirName).toBeNull();
  });

  describe('revision', () => {
    it('同じ設定なら同じ値になる', () => {
      const first = buildRuntimeManifest(resolveProps({ voices: ['zundamon/normal'] }));
      const second = buildRuntimeManifest(resolveProps({ voices: ['zundamon/normal'] }));

      expect(second.revision).toBe(first.revision);
    });

    it('モデルが変われば変わる', () => {
      const first = buildRuntimeManifest(resolveProps({ voices: ['zundamon/normal'] }));
      const second = buildRuntimeManifest(
        resolveProps({ voices: ['zundamon/normal', 'zundamon/sasayaki'] })
      );

      expect(second.revision).not.toBe(first.revision);
    });

    it('assetSource が変われば変わる', () => {
      const bundle = buildRuntimeManifest(resolveProps({ voices: ['zundamon/normal'] }));
      const download = buildRuntimeManifest(
        resolveProps({ assetSource: 'download', voices: ['zundamon/normal'] })
      );

      expect(download.revision).not.toBe(bundle.revision);
    });

    it('入れ子の値の違いも拾う', () => {
      // canonicalize が入れ子のキーを落としていると downloads の中身の差を見逃す。
      const base = resolveProps({ assetSource: 'download', voices: ['zundamon/normal'] });
      const manifest = buildRuntimeManifest(base);

      const tampered = buildRuntimeManifest({
        ...base,
        voiceModels: [{ ...base.voiceModels[0], url: 'https://example.com/0.vvm' }],
      });

      expect(tampered.revision).not.toBe(manifest.revision);
    });
  });
});

describe('serializeManifest', () => {
  it('末尾に改行を付けた JSON を返す', () => {
    const text = serializeManifest(buildRuntimeManifest(resolveProps()));

    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text).manifestVersion).toBe(1);
  });
});
