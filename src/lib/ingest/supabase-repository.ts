/**
 * DocumentRepository / DocumentFileStorage の Supabase 実装。
 *
 * ⚠ service_role クライアント専用（取り込み CLI からのみ使用）。
 *   RLS を迂回するため、Route Handler・Server Component など
 *   リクエスト処理から import しないこと。
 *   （CLI から使うため "server-only" は import していない）
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DocumentFileStorage, DocumentRepository } from "@/lib/contracts/ports";
import type {
  ChunkDraft,
  DocumentMimeType,
  DocumentRecord,
  DocumentVisibility,
} from "@/lib/contracts/types";

export const DOCUMENTS_BUCKET = "documents";

type DocumentRow = {
  id: string;
  source_key: string;
  file_name: string;
  title: string;
  mime_type: DocumentMimeType;
  content_hash: string;
  page_count: number | null;
  storage_path: string | null;
  visibility: DocumentVisibility;
  department: string | null;
  embedding_model: string;
};

const DOCUMENT_COLUMNS =
  "id, source_key, file_name, title, mime_type, content_hash, page_count, storage_path, visibility, department, embedding_model";

export function rowToDocument(row: DocumentRow): DocumentRecord {
  return {
    id: row.id,
    sourceKey: row.source_key,
    fileName: row.file_name,
    title: row.title,
    mimeType: row.mime_type,
    contentHash: row.content_hash,
    pageCount: row.page_count,
    storagePath: row.storage_path,
    visibility: row.visibility,
    department: row.department,
    embeddingModel: row.embedding_model,
  };
}

/** RPC replace_document_with_chunks の引数を組み立てる（テスト可能な純粋関数） */
export function toReplaceRpcArgs(input: {
  document: Omit<DocumentRecord, "id">;
  chunks: Array<ChunkDraft & { embedding: number[] }>;
}) {
  const d = input.document;
  return {
    p_document: {
      source_key: d.sourceKey,
      file_name: d.fileName,
      title: d.title,
      mime_type: d.mimeType,
      content_hash: d.contentHash,
      page_count: d.pageCount,
      storage_path: d.storagePath,
      visibility: d.visibility,
      department: d.department,
      embedding_model: d.embeddingModel,
    },
    p_chunks: input.chunks.map((c) => ({
      chunk_key: c.chunkKey,
      chunk_index: c.chunkIndex,
      page_number: c.pageNumber,
      page_end: c.pageEnd,
      section: c.section,
      content: c.content,
      token_count: c.tokenCount,
      content_hash: c.contentHash,
      embedding: c.embedding,
    })),
  };
}

export class SupabaseDocumentRepository implements DocumentRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findBySourceKey(sourceKey: string): Promise<DocumentRecord | null> {
    const { data, error } = await this.client
      .from("documents")
      .select(DOCUMENT_COLUMNS)
      .eq("source_key", sourceKey)
      .maybeSingle<DocumentRow>();
    if (error) throw new Error("documents の取得に失敗しました");
    return data ? rowToDocument(data) : null;
  }

  async replaceDocument(input: {
    document: Omit<DocumentRecord, "id">;
    chunks: Array<ChunkDraft & { embedding: number[] }>;
  }): Promise<{ documentId: string }> {
    const { data, error } = await this.client.rpc(
      "replace_document_with_chunks",
      toReplaceRpcArgs(input),
    );
    if (error || typeof data !== "string") {
      throw new Error("文書の保存に失敗しました");
    }
    return { documentId: data };
  }
}

export class SupabaseDocumentStorage implements DocumentFileStorage {
  constructor(private readonly client: SupabaseClient) {}

  async upload(path: string, data: Uint8Array, contentType: string): Promise<void> {
    const { error } = await this.client.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, data, { contentType, upsert: true, cacheControl: "0" });
    if (error) throw new Error("原本ファイルのアップロードに失敗しました");
  }
}
