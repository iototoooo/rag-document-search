/**
 * トークン数の概算（外部トークナイザを使わない保守的な見積もり）。
 * - CJK（ひらがな・カタカナ・漢字・全角記号）: 1 文字 ≒ 1 トークン
 * - ASCII 英数字の連続: 4 文字ごとに 1 語相当とし、1 語 ≒ 1.3 トークン
 * - その他の記号: 1 文字 ≒ 1 トークン
 * - 空白は数えない
 */
const TOKEN_RE = /[A-Za-z0-9]+|[^\sA-Za-z0-9]/gu;

export function estimateTokens(text: string): number {
  let total = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const s = m[0];
    if (/^[A-Za-z0-9]+$/.test(s)) {
      total += Math.max(1, Math.ceil(s.length / 4)) * 1.3;
    } else {
      total += 1;
    }
  }
  return Math.ceil(total);
}
