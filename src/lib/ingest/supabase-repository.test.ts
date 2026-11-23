import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  SupabaseDocumentRepository,
  SupabaseDocumentStorage,
  toReplaceRpcArgs,
} from "./supabase-repository";

const doc = {
  sourceKey: "doc-a",
  fileName: "doc-a.pdf",
  title: "規程",
  mimeType: "application/pdf" as const,
  contentHash: "a".repeat(64),
  pageCount: 2,
  storagePath: `doc-a/${"a".repeat(64)}.pdf`,
  visibility: "internal" as const,
  department: null,
  embeddingModel: "text-embedding-3-small",
};
const chunk = {
  chunkKey: "doc-a:p1:c0",
  chunkIndex: 0,
  pageNumber: 1,
  pageEnd: 1,
  section: "1. 総則",
  content: "本文",
  tokenCount: 2,
  contentHash: "b".repeat(64),
  embedding: [0.1, 0.2],
};

describe("toReplaceRpcArgs", () => {
  it("snake_case の RPC 引数に変換する", () => {
    expect(toReplaceRpcArgs({ document: doc, chunks: [chunk] })).toEqual({
      p_document: {
        source_key: "doc-a",
        file_name: "doc-a.pdf",
        title: "規程",
        mime_type: "application/pdf",
        content_hash: "a".repeat(64),
        page_count: 2,
        storage_path: `doc-a/${"a".repeat(64)}.pdf`,
        visibility: "internal",
        department: null,
        embedding_model: "text-embedding-3-small",
      },
      p_chunks: [
        {
          chunk_key: "doc-a:p1:c0",
          chunk_index: 0,
          page_number: 1,
          page_end: 1,
          section: "1. 総則",
          content: "本文",
          token_count: 2,
          content_hash: "b".repeat(64),
          embedding: [0.1, 0.2],
        },
      ],
    });
  });
});

describe("SupabaseDocumentRepository（クライアントはモック）", () => {
  it("replaceDocument は RPC を 1 回だけ呼ぶ（トランザクション）", async () => {
    const rpc = vi.fn(async () => ({ data: "uuid-1", error: null }));
    const repo = new SupabaseDocumentRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.replaceDocument({ document: doc, chunks: [chunk] })).resolves.toEqual({
      documentId: "uuid-1",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("replace_document_with_chunks", expect.any(Object));
  });

  it("RPC エラー時は詳細を含めずに失敗する", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "secret detail" } }));
    const repo = new SupabaseDocumentRepository({ rpc } as unknown as SupabaseClient);
    await expect(repo.replaceDocument({ document: doc, chunks: [chunk] })).rejects.toThrow(
      "文書の保存に失敗しました",
    );
  });

  it("findBySourceKey は行をドメイン型に変換する", async () => {
    const row = {
      id: "uuid-1",
      source_key: "doc-a",
      file_name: "doc-a.pdf",
      title: "規程",
      mime_type: "application/pdf",
      content_hash: "a".repeat(64),
      page_count: 2,
      storage_path: "p",
      visibility: "internal",
      department: null,
      embedding_model: "m",
    };
    const eq = vi.fn(() => ({ maybeSingle: async () => ({ data: row, error: null }) }));
    const from = vi.fn(() => ({ select: () => ({ eq }) }));
    const repo = new SupabaseDocumentRepository({ from } as unknown as SupabaseClient);
    const found = await repo.findBySourceKey("doc-a");
    expect(from).toHaveBeenCalledWith("documents");
    expect(eq).toHaveBeenCalledWith("source_key", "doc-a");
    expect(found).toMatchObject({ id: "uuid-1", sourceKey: "doc-a", embeddingModel: "m" });
  });
});

describe("SupabaseDocumentStorage（クライアントはモック）", () => {
  it("非公開バケット documents へ upsert でアップロードする", async () => {
    const upload = vi.fn(async () => ({ data: {}, error: null }));
    const fromBucket = vi.fn(() => ({ upload }));
    const storage = new SupabaseDocumentStorage({
      storage: { from: fromBucket },
    } as unknown as SupabaseClient);
    const data = new Uint8Array([1, 2]);
    await storage.upload("doc-a/x.pdf", data, "application/pdf");
    expect(fromBucket).toHaveBeenCalledWith("documents");
    expect(upload).toHaveBeenCalledWith("doc-a/x.pdf", data, {
      contentType: "application/pdf",
      upsert: true,
      cacheControl: "0",
    });
  });
});
