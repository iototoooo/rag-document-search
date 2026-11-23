import type { ChunkSearcher, SearchOptions } from "@/lib/contracts/ports";
import type { DocumentRecord, RetrievedChunk } from "@/lib/contracts/types";
import { cosineSimilarity } from "@/lib/embeddings/mock";
import type { InMemoryDocumentRepository } from "@/lib/ingest/memory";

/**
 * インメモリ検索（評価・統合テスト用）。
 * DB の RLS と同じく visibility = 'internal' の文書だけを検索対象にする。
 * pgvector の `1 - (a <=> b)`（コサイン類似度）と同じ指標で並べる。
 */
export class InMemoryRlsSearcher implements ChunkSearcher {
  constructor(private readonly repo: InMemoryDocumentRepository) {}

  async search(embedding: number[], options: SearchOptions): Promise<RetrievedChunk[]> {
    const visibleDocs = new Map<string, DocumentRecord>();
    for (const d of this.repo.documents.values()) {
      if (d.visibility === "internal") visibleDocs.set(d.id, d);
    }
    const rows: RetrievedChunk[] = [];
    for (const c of this.repo.chunks.values()) {
      const d = visibleDocs.get(c.documentId);
      if (!d) continue; // RLS: 閲覧不可の文書のチャンクは存在しないのと同じ
      rows.push({
        chunkId: c.chunkKey,
        documentId: d.id,
        chunkKey: c.chunkKey,
        fileName: d.fileName,
        title: d.title,
        pageNumber: c.pageNumber,
        section: c.section,
        content: c.content,
        similarity: cosineSimilarity(embedding, c.embedding),
      });
    }
    return rows
      .filter((r) => r.similarity >= options.threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, Math.max(1, Math.min(20, options.count)));
  }
}
