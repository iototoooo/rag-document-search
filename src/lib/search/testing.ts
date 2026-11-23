import type { AnswerGenerator, ChunkSearcher, SearchOptions } from "@/lib/contracts/ports";
import type { DocumentVisibility, RetrievedChunk } from "@/lib/contracts/types";
import { MockEmbeddingProvider, cosineSimilarity } from "@/lib/embeddings/mock";

/**
 * テスト専用: RLS を模したインメモリ検索。
 * Supabase の RLS と同じく、ユーザーが閲覧できない文書のチャンクは検索対象にすら入らない。
 */
export type FakeDoc = {
  documentId: string;
  fileName: string;
  title: string;
  visibility: DocumentVisibility;
  chunks: Array<{ chunkId: string; pageNumber: number; section: string | null; content: string }>;
};

export class RlsFakeSearcher implements ChunkSearcher {
  readonly calls: Array<{ options: SearchOptions }> = [];

  constructor(
    private readonly docs: FakeDoc[],
    private readonly canRead: (doc: FakeDoc) => boolean,
    private readonly embedder = new MockEmbeddingProvider(256),
  ) {}

  async search(embedding: number[], options: SearchOptions): Promise<RetrievedChunk[]> {
    this.calls.push({ options });
    const visible = this.docs.filter(this.canRead);
    const all: RetrievedChunk[] = [];
    for (const d of visible) {
      const vecs = await this.embedder.embed(d.chunks.map((c) => c.content));
      d.chunks.forEach((c, i) => {
        all.push({
          chunkId: c.chunkId,
          documentId: d.documentId,
          chunkKey: `${d.documentId}:p${c.pageNumber}:c${i}`,
          fileName: d.fileName,
          title: d.title,
          pageNumber: c.pageNumber,
          section: c.section,
          content: c.content,
          similarity: cosineSimilarity(embedding, vecs[i]),
        });
      });
    }
    return all
      .filter((c) => c.similarity >= options.threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, options.count);
  }
}

/** テスト専用: 入力を記録し、渡された資料の 1 番目を引用して答えるジェネレーター。 */
export class RecordingGenerator implements AnswerGenerator {
  readonly inputs: Array<Parameters<AnswerGenerator["generate"]>[0]> = [];
  constructor(private readonly behavior: "cite-first" | "not-found" | "refuse" | "cite-99" = "cite-first") {}

  async generate(input: Parameters<AnswerGenerator["generate"]>[0]) {
    this.inputs.push(input);
    switch (this.behavior) {
      case "not-found":
        return { status: "not_found" as const };
      case "refuse":
        return { status: "refused" as const };
      case "cite-99":
        return { status: "answered" as const, answer: "存在しない出典[99]", citedSourceIds: [99] };
      default:
        return {
          status: "answered" as const,
          answer: `回答です[${input.sources[0].id}]`,
          citedSourceIds: [input.sources[0].id],
        };
    }
  }
}
