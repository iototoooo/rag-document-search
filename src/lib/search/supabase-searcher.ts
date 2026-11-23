import { z } from "zod";
import type { ChunkSearcher, SearchOptions } from "@/lib/contracts/ports";
import type { RetrievedChunk } from "@/lib/contracts/types";

/**
 * pgvector（match_document_chunks RPC）によるチャンク検索。
 *
 * 重要: ここに渡すクライアントは必ず「リクエストユーザーの権限で動く Supabase クライアント」
 * （anon キー + ユーザー JWT, createUserSupabaseClient()）とする。
 * service_role クライアントを渡すと RLS が迂回され、閲覧権限のない文書が漏れる。
 * RPC は security invoker なので、RLS で見えない文書は結果・件数に一切現れない。
 */

/** rpc だけを持つ最小インターフェース（テストでモックしやすくするため）。 */
export type RpcCapableClient = {
  rpc(
    fn: "match_document_chunks",
    args: { query_embedding: string; match_threshold: number; match_count: number },
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

const rowSchema = z.object({
  chunk_id: z.string().min(1),
  document_id: z.string().min(1),
  chunk_key: z.string().min(1),
  file_name: z.string().min(1),
  title: z.string(),
  page_number: z.number().int().positive(),
  section: z.string().nullable(),
  content: z.string(),
  similarity: z.number(),
});
const rowsSchema = z.array(rowSchema);

export class SearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchError";
  }
}

/** pgvector の入力形式 "[0.1,0.2,...]" に変換する。 */
export function toPgVector(embedding: number[]): string {
  for (const x of embedding) {
    if (!Number.isFinite(x)) throw new SearchError("Embedding に不正な値が含まれています");
  }
  return `[${embedding.join(",")}]`;
}

export class SupabaseChunkSearcher implements ChunkSearcher {
  constructor(private readonly supabase: RpcCapableClient) {}

  async search(embedding: number[], options: SearchOptions): Promise<RetrievedChunk[]> {
    const count = Math.min(Math.max(Math.trunc(options.count), 1), 20);
    const threshold = Math.min(Math.max(options.threshold, 0), 1);

    const { data, error } = await this.supabase.rpc("match_document_chunks", {
      query_embedding: toPgVector(embedding),
      match_threshold: threshold,
      match_count: count,
    });
    // エラー内容（SQL 等）は外に出さない
    if (error) throw new SearchError("ベクトル検索に失敗しました");

    const parsed = rowsSchema.safeParse(data ?? []);
    if (!parsed.success) throw new SearchError("検索結果の形式が不正です");

    return parsed.data
      .filter((r) => r.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, count)
      .map((r) => ({
        chunkId: r.chunk_id,
        documentId: r.document_id,
        chunkKey: r.chunk_key,
        fileName: r.file_name,
        title: r.title,
        pageNumber: r.page_number,
        section: r.section,
        content: r.content,
        similarity: r.similarity,
      }));
  }
}
