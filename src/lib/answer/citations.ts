import type { SourceForPrompt } from "@/lib/contracts/ports";
import type { Citation, RetrievedChunk } from "@/lib/contracts/types";

export const SNIPPET_MAX_LENGTH = 200;

/** 検索結果に 1 始まりの出典番号を振る（サーバー側で管理する正の一覧）。 */
export function numberSources(chunks: RetrievedChunk[]): Array<{ id: number; chunk: RetrievedChunk }> {
  return chunks.map((chunk, i) => ({ id: i + 1, chunk }));
}

export function toPromptSources(numbered: Array<{ id: number; chunk: RetrievedChunk }>): SourceForPrompt[] {
  return numbered.map(({ id, chunk }) => ({
    id,
    fileName: chunk.fileName,
    title: chunk.title,
    pageNumber: chunk.pageNumber,
    section: chunk.section,
    content: chunk.content,
  }));
}

export function makeSnippet(content: string, max = SNIPPET_MAX_LENGTH): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  const chars = Array.from(oneLine);
  return chars.length <= max ? oneLine : `${chars.slice(0, max - 1).join("")}…`;
}

/**
 * LLM が返した出典番号のうち、サーバー側一覧に存在するものだけを採用する。
 * 本文中の [n] / [n, m] マーカーも検証し、存在しない番号は除去する。
 * 有効な出典が 0 件なら null（＝根拠なし扱い）。
 */
export function buildCitations(
  numbered: Array<{ id: number; chunk: RetrievedChunk }>,
  answer: string,
  citedIds: number[],
): { answer: string; citations: Citation[] } | null {
  const byId = new Map(numbered.map((n) => [n.id, n.chunk]));
  const isValid = (id: number) => Number.isInteger(id) && byId.has(id);

  // 本文のマーカーを検証（[1] / [1,2] / [1、2] 形式）
  const markerIds = new Set<number>();
  const cleaned = answer
    .replace(/\[(\s*\d+\s*(?:[,、]\s*\d+\s*)*)\]/g, (_m, inner: string) => {
      const ids = inner
        .split(/[,、]/)
        .map((s) => Number(s.trim()))
        .filter(isValid);
      ids.forEach((id) => markerIds.add(id));
      return ids.length ? `[${[...new Set(ids)].join(", ")}]` : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([。、．，])/g, "$1")
    .trim();

  const ordered: number[] = [];
  for (const id of [...citedIds, ...markerIds]) {
    if (isValid(id) && !ordered.includes(id)) ordered.push(id);
  }
  if (ordered.length === 0 || cleaned === "") return null;

  const citations: Citation[] = ordered
    .sort((a, b) => a - b)
    .map((id) => {
      const c = byId.get(id)!;
      return {
        id,
        documentId: c.documentId,
        chunkId: c.chunkId,
        fileName: c.fileName,
        title: c.title,
        pageNumber: c.pageNumber,
        section: c.section,
        snippet: makeSnippet(c.content),
      };
    });

  return { answer: cleaned, citations };
}
