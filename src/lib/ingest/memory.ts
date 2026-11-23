import type { DocumentFileStorage, DocumentRepository } from "@/lib/contracts/ports";
import type { ChunkDraft, DocumentRecord } from "@/lib/contracts/types";

/**
 * ドライラン・テスト用のインメモリ実装（外部通信なし）。
 * DB の一意制約（source_key / chunk_key / (document_id, chunk_index)）を模倣する。
 */

type StoredChunk = ChunkDraft & { embedding: number[]; documentId: string };

export class InMemoryDocumentRepository implements DocumentRepository {
  readonly documents = new Map<string, DocumentRecord>();
  readonly chunks = new Map<string, StoredChunk>();
  replaceCalls = 0;
  private seq = 0;

  async findBySourceKey(sourceKey: string): Promise<DocumentRecord | null> {
    const d = this.documents.get(sourceKey);
    return d ? { ...d } : null;
  }

  async replaceDocument(input: {
    document: Omit<DocumentRecord, "id">;
    chunks: Array<ChunkDraft & { embedding: number[] }>;
  }): Promise<{ documentId: string }> {
    this.replaceCalls++;
    const existing = this.documents.get(input.document.sourceKey);
    const id = existing?.id ?? `mem-doc-${++this.seq}`;

    // 同一文書の既存チャンクを削除してから挿入（トランザクション相当）
    const next = new Map(this.chunks);
    for (const [key, c] of next) if (c.documentId === id) next.delete(key);
    const indexes = new Set<number>();
    for (const c of input.chunks) {
      if (next.has(c.chunkKey)) throw new Error(`duplicate chunk_key: ${c.chunkKey}`);
      if (indexes.has(c.chunkIndex)) throw new Error(`duplicate chunk_index: ${c.chunkIndex}`);
      indexes.add(c.chunkIndex);
      next.set(c.chunkKey, { ...c, documentId: id });
    }
    this.chunks.clear();
    for (const [k, v] of next) this.chunks.set(k, v);
    this.documents.set(input.document.sourceKey, { ...input.document, id });
    return { documentId: id };
  }

  chunksOf(sourceKey: string): StoredChunk[] {
    const id = this.documents.get(sourceKey)?.id;
    return [...this.chunks.values()]
      .filter((c) => c.documentId === id)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
  }
}

export class InMemoryFileStorage implements DocumentFileStorage {
  readonly files = new Map<string, { size: number; contentType: string }>();

  async upload(path: string, data: Uint8Array, contentType: string): Promise<void> {
    this.files.set(path, { size: data.byteLength, contentType });
  }
}
