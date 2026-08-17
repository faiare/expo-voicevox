/**
 * config plugin の設定ミスを表す例外。
 *
 * prebuild は例外のスタックをそのまま出すので、メッセージだけで直せるように
 * 「何が悪いか」と「どう書けばよいか」を必ず含める。
 */
export class VoicevoxPluginError extends Error {
  constructor(message: string) {
    super(`expo-voicevox: ${message}`);
    this.name = 'VoicevoxPluginError';
  }
}

/** レーベンシュタイン距離。slug の打ち間違いに候補を出すためだけに使う。 */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const columns = b.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);

  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let column = 1; column < columns; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[columns - 1];
}

/**
 * 打ち間違いの候補を近い順に最大 `limit` 件返す。
 * 元の語の半分を超えて違うものは候補にしない（無関係な語を並べても混乱するだけ）。
 */
export function suggest(input: string, candidates: Iterable<string>, limit = 3): string[] {
  const threshold = Math.max(2, Math.floor(input.length / 2));
  return [...candidates]
    .map((candidate) => ({ candidate, distance: editDistance(input, candidate) }))
    .filter((entry) => entry.distance <= threshold)
    .sort((a, b) => a.distance - b.distance || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate);
}
