import { createHash } from "node:crypto";
import type { ChunkDraft } from "@/lib/contracts/types";
import { detectHeading } from "./sections";
import { displayWidth } from "./text";
import { estimateTokens } from "./tokens";

/**
 * ページ単位テキスト → チャンク。
 * - 出典ページの精度を優先し、チャンクはページをまたがない（pageEnd = pageNumber）
 * - セクション（見出し）・行（段落）境界を優先して区切る
 * - 小さいセクションは同一ページ内で minTokens に達するまで結合し、maxTokens を超えない
 * - maxTokens を超える長いセクションだけ、行単位で分割し overlapTokens 分を重複させる
 */

export type PageText = {
  /** 1 始まりのページ番号 */
  pageNumber: number;
  /** normalizeForIngest 済みのテキスト */
  text: string;
};

export type ChunkOptions = {
  maxTokens: number;
  minTokens: number;
  overlapTokens: number;
};

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = {
  maxTokens: 800,
  minTokens: 300,
  overlapTokens: 100,
};

/** 文末とみなす文字（これで終わる行は折り返しではない） */
const LINE_END_RE = /[。！？!?」』）)】:：]$/;
/** 最長行の何割以上の幅があれば「折り返された行」とみなすか */
const WRAP_RATIO = 0.8;

function joinParts(a: string, b: string): string {
  return /[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b;
}

/**
 * PDF の自動折り返しで分断された行を連結する。
 * 文末記号で終わらず、ページ内の最長行に近い幅の行だけを次の行と連結する（表・箇条書きは連結しない）。
 */
export function unwrapLines(lines: string[]): string[] {
  const cleaned = lines.map((l) => l.trim()).filter(Boolean);
  if (cleaned.length < 2) return cleaned;
  const maxWidth = Math.max(...cleaned.map(displayWidth));
  const out: string[] = [];
  let current = cleaned[0];
  let currentFirstWidth = displayWidth(cleaned[0]);
  for (let i = 1; i < cleaned.length; i++) {
    const next = cleaned[i];
    const wrapped =
      !LINE_END_RE.test(current) &&
      currentFirstWidth >= maxWidth * WRAP_RATIO &&
      detectHeading(current) === null &&
      detectHeading(next) === null;
    if (wrapped) {
      current = joinParts(current, next);
      // 連結後も続けて折り返される可能性があるため、直近に連結した行の幅で判定する
      currentFirstWidth = displayWidth(next);
    } else {
      out.push(current);
      current = next;
      currentFirstWidth = displayWidth(next);
    }
  }
  out.push(current);
  return out;
}

type Segment = { section: string | null; lines: string[] };
type Unit = { section: string | null; text: string; tokens: number };

/** 1 行が maxTokens を超える場合に文・文字数で分割する */
function splitLongLine(line: string, maxTokens: number): string[] {
  if (estimateTokens(line) <= maxTokens) return [line];
  const sentences = line.split(/(?<=[。！？!?])/u).filter(Boolean);
  const parts: string[] = [];
  let buf = "";
  for (const s of sentences) {
    if (estimateTokens(s) > maxTokens) {
      if (buf) parts.push(buf);
      buf = "";
      // 文単体でも長すぎる場合は文字数で強制分割
      let rest = s;
      while (rest.length > 0) {
        let n = Math.min(rest.length, maxTokens);
        while (n > 1 && estimateTokens(rest.slice(0, n)) > maxTokens) n = Math.floor(n * 0.9);
        parts.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      continue;
    }
    if (buf && estimateTokens(buf + s) > maxTokens) {
      parts.push(buf);
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf) parts.push(buf);
  return parts;
}

/** セグメントを maxTokens 以下のユニットに分割（長い場合のみ overlap 付き） */
function segmentToUnits(seg: Segment, opts: ChunkOptions): Unit[] {
  const text = seg.lines.join("\n");
  const tokens = estimateTokens(text);
  if (tokens <= opts.maxTokens) return [{ section: seg.section, text, tokens }];

  const pieces = seg.lines.flatMap((l) => splitLongLine(l, opts.maxTokens));
  const units: Unit[] = [];
  let window: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const candidate = [...window, pieces[i]];
    if (window.length > 0 && estimateTokens(candidate.join("\n")) > opts.maxTokens) {
      units.push({
        section: seg.section,
        text: window.join("\n"),
        tokens: estimateTokens(window.join("\n")),
      });
      // 末尾から overlapTokens 以内の行を次のウィンドウへ持ち越す
      const overlap: string[] = [];
      for (let j = window.length - 1; j >= 0; j--) {
        const t = estimateTokens([window[j], ...overlap].join("\n"));
        if (t > opts.overlapTokens) break;
        overlap.unshift(window[j]);
      }
      // 持ち越し + 新しい行が maxTokens を超える場合は重複を諦める
      window = estimateTokens([...overlap, pieces[i]].join("\n")) <= opts.maxTokens
        ? [...overlap, pieces[i]]
        : [pieces[i]];
    } else {
      window = candidate;
    }
  }
  if (window.length > 0) {
    units.push({
      section: seg.section,
      text: window.join("\n"),
      tokens: estimateTokens(window.join("\n")),
    });
  }
  return units;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function chunkPages(
  sourceKey: string,
  pages: PageText[],
  options: Partial<ChunkOptions> = {},
): ChunkDraft[] {
  const opts: ChunkOptions = { ...DEFAULT_CHUNK_OPTIONS, ...options };
  if (opts.maxTokens < 1 || opts.minTokens < 0 || opts.overlapTokens < 0) {
    throw new Error("チャンク設定が不正です");
  }
  if (opts.overlapTokens >= opts.maxTokens) {
    throw new Error("overlapTokens は maxTokens 未満にしてください");
  }

  const chunks: ChunkDraft[] = [];
  let carriedSection: string | null = null;

  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const page of sorted) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1) {
      throw new Error("ページ番号は 1 以上の整数である必要があります");
    }
    const lines = unwrapLines(page.text.split("\n"));

    // ページ内をセクション単位に分割
    const segments: Segment[] = [];
    for (const line of lines) {
      const heading = detectHeading(line);
      if (heading) {
        carriedSection = heading.text;
        segments.push({ section: heading.text, lines: [line] });
        continue;
      }
      if (segments.length === 0) {
        // 前ページから続くセクション: 見出し文字列を先頭に付けて文脈を保つ（文書内の実テキスト）
        segments.push({
          section: carriedSection,
          lines: carriedSection ? [carriedSection, line] : [line],
        });
      } else {
        segments[segments.length - 1].lines.push(line);
      }
    }

    // ユニット化して、同一ページ内で結合
    const units = segments.flatMap((s) => segmentToUnits(s, opts));
    let buf: Unit[] = [];
    const flush = () => {
      if (buf.length === 0) return;
      const content = buf.map((u) => u.text).join("\n");
      const sections = [...new Set(buf.map((u) => u.section).filter((s): s is string => !!s))];
      const chunkIndex = chunks.length;
      chunks.push({
        chunkKey: `${sourceKey}:p${page.pageNumber}:c${chunkIndex}`,
        chunkIndex,
        pageNumber: page.pageNumber,
        pageEnd: page.pageNumber,
        section: sections.length ? sections.join(" / ") : null,
        content,
        tokenCount: Math.max(1, estimateTokens(content)),
        contentHash: sha256(content),
      });
      buf = [];
    };
    for (const unit of units) {
      const bufTokens = buf.length ? estimateTokens(buf.map((u) => u.text).join("\n")) : 0;
      if (buf.length > 0 && (bufTokens >= opts.minTokens || bufTokens + unit.tokens > opts.maxTokens)) {
        flush();
      }
      buf.push(unit);
    }
    flush();
  }

  return chunks;
}
