/**
 * 見出しの検出（正規化済みテキストの 1 行を対象）。
 * 対応: 「第N章 …」「N. 見出し」「N.N 見出し」、Markdown の「# 見出し」。
 * 誤検出を避けるため、長すぎる行・句点などで終わる行（本文や番号付き手順）は見出しとしない。
 */

export type Heading = {
  /** 表示用の見出し文字列（Markdown の # や ** は除去） */
  text: string;
  /** 1 = 章・大見出し、2 以上 = 小見出し */
  level: number;
};

export const MAX_HEADING_LENGTH = 40;

const SENTENCE_END_RE = /[。．.!！?？、,，:：;；]$/;
const MARKDOWN_RE = /^(#{1,6})\s+(.+)$/;
const CHAPTER_RE = /^第[0-9一二三四五六七八九十百]+[章節](?:\s+|[:：.．]\s*)?\S/;
const NUMBERED_RE = /^(\d{1,2})((?:\.\d{1,2})*)\.?\s+(\S.*)$/;

export function detectHeading(rawLine: string): Heading | null {
  const line = rawLine.trim();
  if (!line) return null;

  const md = MARKDOWN_RE.exec(line);
  if (md) {
    const text = md[2].replace(/\*\*/g, "").trim();
    if (!text || text.length > MAX_HEADING_LENGTH) return null;
    return { text, level: md[1].length };
  }

  if (line.length > MAX_HEADING_LENGTH) return null;
  if (SENTENCE_END_RE.test(line)) return null;

  if (CHAPTER_RE.test(line)) return { text: line, level: 1 };

  const num = NUMBERED_RE.exec(line);
  if (num) {
    // "1 回" のような区切り記号なしの行は見出しにしない（"1." か "1.2" の形式のみ）
    const hasSeparator = num[2].length > 0 || /^\d{1,2}\./.test(line);
    const body = num[3];
    if (!hasSeparator) return null;
    // 本文が数字・記号ばかりの行（表や日付）は除外
    if (!/[\p{L}]/u.test(body)) return null;
    const depth = num[2] ? num[2].split(".").length : 1;
    return { text: line, level: depth };
  }

  return null;
}
