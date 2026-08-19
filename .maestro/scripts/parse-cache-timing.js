// 「1 回目 Xms / 2 回目 Yms」を読み取り、2 回目が速いかどうかを返す。
//
// Maestro のスクリプトは GraalJS で動く。async/await と fetch は使えないので、
// var と同期的な処理だけで書いてある。

var text = maestro.copiedText;
var matched = text.match(/1 回目 (\d+)ms \/ 2 回目 (\d+)ms/);

if (!matched) {
  throw new Error('合成時間が読み取れませんでした: ' + text);
}

var cold = parseInt(matched[1], 10);
var warm = parseInt(matched[2], 10);

output.cold = cold;
output.warm = warm;
// 同じ入力の 2 回目は推論をやり直さないので、必ず速くなる。
output.cacheFaster = warm < cold;
