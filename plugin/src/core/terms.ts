/**
 * 利用規約の案内。
 *
 * VOICEVOX の音声モデルと ONNX Runtime は「VOICEVOX を利用したことがわかるクレジット表記」を
 * 求めており、OpenJTalk 辞書は BSD-3-Clause で著作権表示の再掲を求めている。
 * アプリに組み込む側が気づかないまま公開してしまわないよう、prebuild で一度だけ出す。
 */
export const TERMS_NOTICE = [
  '─'.repeat(72),
  'License and credit requirements',
  '─'.repeat(72),
  '  voicevox_core            : MIT License',
  '  VOICEVOX voice models    : custom terms (see the bundled TERMS.txt)',
  '  VOICEVOX ONNX Runtime    : custom terms',
  '  OpenJTalk dictionary     : BSD-3-Clause (copyright notice must be reproduced)',
  '',
  '  The voice model and ONNX Runtime terms require your app to display a credit',
  '  that makes it clear VOICEVOX was used, e.g. "VOICEVOX:<character name>".',
  '  Per-character conditions are listed in the bundled TERMS.txt.',
  '─'.repeat(72),
].join('\n');

export function printTerms(log: (message: string) => void): void {
  for (const line of TERMS_NOTICE.split('\n')) {
    log(line);
  }
}
