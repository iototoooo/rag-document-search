import { foldCjkRadicals, normalizeText } from "@/lib/documents/normalize";

// 部首補助の置換は共通の normalizeText に統合済み。既存の呼び出し元のため再エクスポートする。
export { foldCjkRadicals };

/** 取り込み用の正規化（共通の normalizeText と同じ。NFKC + 部首補助の置換 + 空白整理）。 */
export function normalizeForIngest(text: string): string {
  return normalizeText(text);
}

/** 全角相当の文字は表示幅 2、それ以外は 1 として行の表示幅を概算する。 */
export function displayWidth(line: string): number {
  let w = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0) ?? 0;
    w += cp >= 0x2e80 && !(cp >= 0xff61 && cp <= 0xff9f) ? 2 : 1;
  }
  return w;
}
