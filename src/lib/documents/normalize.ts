/**
 * CJK 部首補助（U+2E80–U+2EFF）の一部は NFKC で通常の漢字に変換されない。
 * PDF から「上⻑」「国⺠」のように抽出されると「上長」で検索できないため、
 * 通常の漢字へ置き換える（よく使う字形のみ。見た目が同じものに限定）。
 */
const CJK_RADICAL_SUPPLEMENT_MAP: Record<string, string> = {
  "⺠": "民",
  "⻑": "長",
  "⻄": "西",
  "⻘": "青",
  "⻝": "食",
  "⻤": "鬼",
  "⻩": "黄",
  "⻭": "歯",
  "⻲": "亀",
  "⻆": "角",
  "⻫": "斉",
  "⻯": "竜",
  "⺩": "王",
  "⻊": "足",
  "⺮": "竹",
};

const RADICAL_SUPPLEMENT_RE = /[⺀-⻿]/g;

export function foldCjkRadicals(text: string): string {
  return text.replace(RADICAL_SUPPLEMENT_RE, (c) => CJK_RADICAL_SUPPLEMENT_MAP[c] ?? c);
}

/**
 * 抽出テキストの正規化。
 * PDFからは「⽇(U+2F47)」のような康熙部首が混入することがあるため、
 * NFKC で通常の漢字（日 U+65E5）に揃え、NFKC で変換されない部首補助も置き換え、
 * 改行・空白を整える。
 */
export function normalizeText(input: string): string {
  return foldCjkRadicals(input.normalize("NFKC"))
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t　]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
