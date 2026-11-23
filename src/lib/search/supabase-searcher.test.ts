import { describe, expect, it, vi } from "vitest";
import { SearchError, SupabaseChunkSearcher, toPgVector, type RpcCapableClient } from "./supabase-searcher";

function row(id: string, similarity: number) {
  return {
    chunk_id: `c-${id}`,
    document_id: `d-${id}`,
    chunk_key: `doc:p1:c${id}`,
    file_name: "demo-doc1-travel-rules.pdf",
    title: "出張旅費規程",
    page_number: 1,
    section: "第2章 宿泊費・日当",
    content: `本文${id}`,
    similarity,
  };
}

function client(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as unknown as RpcCapableClient, rpc };
}

describe("toPgVector", () => {
  it("pgvector 文字列形式に変換する", () => {
    expect(toPgVector([0.1, -0.2, 3])).toBe("[0.1,-0.2,3]");
  });
  it("NaN / Infinity を拒否する", () => {
    expect(() => toPgVector([NaN])).toThrow(SearchError);
    expect(() => toPgVector([Infinity])).toThrow(SearchError);
  });
});

describe("SupabaseChunkSearcher", () => {
  it("RPC に正しい引数を渡し、行を RetrievedChunk に変換する", async () => {
    const { client: c, rpc } = client({ data: [row("1", 0.8)], error: null });
    const out = await new SupabaseChunkSearcher(c).search([0.5, 0.5], { threshold: 0.3, count: 6 });
    expect(rpc).toHaveBeenCalledWith("match_document_chunks", {
      query_embedding: "[0.5,0.5]",
      match_threshold: 0.3,
      match_count: 6,
    });
    expect(out).toEqual([
      {
        chunkId: "c-1",
        documentId: "d-1",
        chunkKey: "doc:p1:c1",
        fileName: "demo-doc1-travel-rules.pdf",
        title: "出張旅費規程",
        pageNumber: 1,
        section: "第2章 宿泊費・日当",
        content: "本文1",
        similarity: 0.8,
      },
    ]);
  });

  it("しきい値未満を再フィルタし、類似度順・件数で切り詰める", async () => {
    const { client: c } = client({
      data: [row("a", 0.4), row("b", 0.2), row("c", 0.9), row("d", 0.6)],
      error: null,
    });
    const out = await new SupabaseChunkSearcher(c).search([1], { threshold: 0.3, count: 2 });
    expect(out.map((r) => r.chunkId)).toEqual(["c-c", "c-d"]);
  });

  it("件数・しきい値を安全な範囲に丸める", async () => {
    const { client: c, rpc } = client({ data: [], error: null });
    await new SupabaseChunkSearcher(c).search([1], { threshold: -1, count: 999 });
    expect(rpc).toHaveBeenCalledWith("match_document_chunks", {
      query_embedding: "[1]",
      match_threshold: 0,
      match_count: 20,
    });
  });

  it("RPC エラーは内部情報を含まない SearchError", async () => {
    const { client: c } = client({ data: null, error: { message: "relation secret_table does not exist" } });
    const p = new SupabaseChunkSearcher(c).search([1], { threshold: 0.3, count: 6 });
    await expect(p).rejects.toThrow(SearchError);
    await expect(p).rejects.not.toThrow(/secret_table/);
  });

  it("形式不正の行はエラー", async () => {
    const { client: c } = client({ data: [{ ...row("1", 0.9), page_number: 0 }], error: null });
    await expect(
      new SupabaseChunkSearcher(c).search([1], { threshold: 0.3, count: 6 }),
    ).rejects.toThrow(/形式/);
  });

  it("data が null なら空配列", async () => {
    const { client: c } = client({ data: null, error: null });
    expect(await new SupabaseChunkSearcher(c).search([1], { threshold: 0.3, count: 6 })).toEqual([]);
  });
});
