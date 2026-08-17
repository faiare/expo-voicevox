// このファイルは `npm run refresh:artifact-digests` が生成する。手で編集しないこと。
//
// voicevox_core / ONNX Runtime / OpenJTalk 辞書の配布物を URL でピン留めしている。
// prebuild はこの表を見るだけなので GitHub API を叩かない。
export const ARTIFACT_DIGESTS: Record<string, { size: number; sha256: string }> = {
  'https://github.com/r9y9/open_jtalk/releases/download/v1.11.1/open_jtalk_dic_utf_8-1.11.tar.gz': {
    size: 23646843,
    sha256: 'fe6ba0e43542cef98339abdffd903e062008ea170b04e7e2a35da805902f382a',
  },
  'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.17.3/voicevox_onnxruntime-ios-xcframework-1.17.3.zip':
    { size: 14028727, sha256: '5b0138f25e68c3fb99771d37978837d5038a67b0720f96d912c900887164494b' },
  'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.23.2/voicevox_onnxruntime-android-arm64-1.23.2.tgz':
    { size: 6459115, sha256: '43e6fc2a89ea6412d4cc20215042a3b34da22fdf05c1bb76256a686f82378d46' },
  'https://github.com/VOICEVOX/onnxruntime-builder/releases/download/voicevox_onnxruntime-1.23.2/voicevox_onnxruntime-android-x64-1.23.2.tgz':
    { size: 7115144, sha256: '807e2ea50dfb2a309416adb1cee6edc53d3d8eae1d702ad4e6f199a0f91f2d24' },
  'https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.0/java_packages.zip': {
    size: 23836097,
    sha256: 'e22f120adfb1a680bafd01287bc7aa3f104aa7e437d5d710107a16036c38b017',
  },
  'https://github.com/VOICEVOX/voicevox_core/releases/download/0.17.0/voicevox_core-xcframework-0.17.0.zip':
    { size: 5834062, sha256: 'e634b0fd7e09924a4c9c4f6e8b5c0da0790a7649d89f289cbcad1b97976212be' },
  'https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.17.0/README.txt': {
    size: 27238,
    sha256: '12a64121db0815fc5e6ea8cdf13cd3ed052b7c7d7a170a70a2c0eced2fc63573',
  },
  'https://github.com/VOICEVOX/voicevox_vvm/releases/download/0.17.0/TERMS.txt': {
    size: 15667,
    sha256: '57fc18afeebc8a08c303b2b4e3f05bf6453a37c482d17c04ec3fbc674e5fc5f4',
  },
};
