import { describe, expect, it, vi } from "vitest";
import type { EmbeddingProvider } from "@/lib/contracts/ports";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { InMemoryDocumentRepository, InMemoryFileStorage } from "./memory";
import {
  detectMimeType,
  embeddingInput,
  inferTitle,
  ingestDocument,
  sha256Hex,
  toSourceKey,
} from "./pipeline";

const enc = (s: string) => new TextEncoder().encode(s);

const MD_V1 = ["# 旅費規程", "", "## 1. 日当", "", "出張の日当は1日2500円とする。", "", "## 2. 宿泊費", "", "宿泊費は1泊12000円まで。"].join("\n");
const MD_V2 = MD_V1.replace("2500円", "3000円");

function setup(embedder: EmbeddingProvider = new MockEmbeddingProvider(64)) {
  const repo = new InMemoryDocumentRepository();
  const storage = new InMemoryFileStorage();
  const logger = vi.fn();
  return { repo, storage, logger, deps: { embedder, repo, storage, logger, chunkOptions: { minTokens: 0 } } };
}

describe("ユーティリティ", () => {
  it("sourceKey はファイル名から拡張子を除き、危険な文字を拒否する", () => {
    expect(toSourceKey("demo-doc1-travel-rules.pdf")).toBe("demo-doc1-travel-rules");
    expect(toSourceKey("dir/sub/a_b.md")).toBe("a_b");
    expect(() => toSourceKey("出張旅費規程.pdf")).toThrow();
    expect(() => toSourceKey("a b.pdf")).toThrow();
    expect(() => toSourceKey(".pdf")).toThrow();
  });
  it("MIME 判定", () => {
    expect(detectMimeType("a.PDF")).toBe("application/pdf");
    expect(detectMimeType("a.md")).toBe("text/markdown");
    expect(() => detectMimeType("a.docx")).toThrow();
  });
  it("タイトル推定と Embedding 入力", () => {
    expect(inferTitle([{ pageNumber: 1, text: "# **規程**\n本文" }], "fb")).toBe("規程");
    expect(inferTitle([{ pageNumber: 1, text: "あ".repeat(61) }], "fb")).toBe("fb");
    expect(embeddingInput("T", { content: "C" })).toBe("T\nC");
  });
});

describe("ingestDocument（インメモリ repo・モック Embedding）", () => {
  it("取り込み: チャンク・メタデータ・原本を保存する", async () => {
    const { repo, storage, deps, logger } = setup();
    const r = await ingestDocument(
      { fileName: "leave.md", data: enc(MD_V1), visibility: "internal" },
      deps,
    );
    expect(r.status).toBe("ingested");
    expect(r.chunkCount).toBeGreaterThan(0);
    const doc = (await repo.findBySourceKey("leave"))!;
    expect(doc).toMatchObject({
      sourceKey: "leave",
      fileName: "leave.md",
      title: "旅費規程",
      mimeType: "text/markdown",
      visibility: "internal",
      embeddingModel: "mock-embedding",
      pageCount: null,
      contentHash: sha256Hex(enc(MD_V1)),
    });
    expect(doc.storagePath).toBe(`leave/${doc.contentHash}.md`);
    expect(storage.files.get(doc.storagePath!)).toEqual({
      size: enc(MD_V1).byteLength,
      contentType: "text/markdown",
    });
    const chunks = repo.chunksOf("leave");
    expect(chunks).toHaveLength(r.chunkCount);
    expect(chunks.every((c) => c.embedding.length === 64)).toBe(true);
    expect(chunks.some((c) => c.section === "1. 日当" && c.content.includes("2500円"))).toBe(true);
    // ログに本文を出さない
    expect(JSON.stringify(logger.mock.calls)).not.toContain("2500円");
  });

  it("同じ内容の再取り込みはスキップし、重複登録しない", async () => {
    const { repo, deps } = setup();
    const input = { fileName: "leave.md", data: enc(MD_V1), visibility: "internal" as const };
    await ingestDocument(input, deps);
    const before = repo.chunks.size;
    const embedSpy = vi.spyOn(deps.embedder, "embed");
    const r2 = await ingestDocument(input, deps);
    expect(r2.status).toBe("skipped");
    expect(embedSpy).not.toHaveBeenCalled();
    expect(repo.replaceCalls).toBe(1);
    expect(repo.chunks.size).toBe(before);
    expect(repo.documents.size).toBe(1);
  });

  it("内容が変わった場合は同じ文書 ID のままチャンクを置き換える", async () => {
    const { repo, deps } = setup();
    await ingestDocument({ fileName: "leave.md", data: enc(MD_V1), visibility: "internal" }, deps);
    const id1 = (await repo.findBySourceKey("leave"))!.id;
    const r2 = await ingestDocument(
      { fileName: "leave.md", data: enc(MD_V2), visibility: "internal" },
      deps,
    );
    expect(r2.status).toBe("ingested");
    const doc = (await repo.findBySourceKey("leave"))!;
    expect(doc.id).toBe(id1);
    expect(doc.contentHash).toBe(sha256Hex(enc(MD_V2)));
    const all = repo.chunksOf("leave");
    expect(all).toHaveLength(r2.chunkCount);
    expect(all.some((c) => c.content.includes("3000円"))).toBe(true);
    expect([...repo.chunks.values()].some((c) => c.content.includes("2500円"))).toBe(false);
  });

  it("公開範囲や Embedding モデルが変わった場合も再取り込みする", async () => {
    const { repo, deps } = setup();
    await ingestDocument({ fileName: "leave.md", data: enc(MD_V1), visibility: "restricted" }, deps);
    const r = await ingestDocument({ fileName: "leave.md", data: enc(MD_V1), visibility: "internal" }, deps);
    expect(r.status).toBe("ingested");
    expect((await repo.findBySourceKey("leave"))!.visibility).toBe("internal");

    const other = new MockEmbeddingProvider(64);
    Object.defineProperty(other, "model", { value: "mock-embedding-v2" });
    const r3 = await ingestDocument(
      { fileName: "leave.md", data: enc(MD_V1), visibility: "internal" },
      { ...deps, embedder: other },
    );
    expect(r3.status).toBe("ingested");
  });

  it("Embedding の件数・次元が不正なら保存しない", async () => {
    const bad: EmbeddingProvider = {
      model: "bad",
      dimensions: 64,
      embed: async (texts) => texts.map(() => new Array(32).fill(0)),
    };
    const { repo, storage, deps } = setup(bad);
    await expect(
      ingestDocument({ fileName: "leave.md", data: enc(MD_V1), visibility: "internal" }, deps),
    ).rejects.toThrow(/次元数/);
    expect(repo.replaceCalls).toBe(0);
    expect(storage.files.size).toBe(0);

    const short: EmbeddingProvider = { model: "s", dimensions: 64, embed: async () => [] };
    await expect(
      ingestDocument(
        { fileName: "leave.md", data: enc(MD_V1), visibility: "internal" },
        { ...deps, embedder: short },
      ),
    ).rejects.toThrow(/件数/);
  });

  it("空ファイル・テキストなし・非対応形式はエラー", async () => {
    const { deps } = setup();
    await expect(
      ingestDocument({ fileName: "a.md", data: new Uint8Array(), visibility: "internal" }, deps),
    ).rejects.toThrow();
    await expect(
      ingestDocument({ fileName: "a.md", data: enc("   \n\n"), visibility: "internal" }, deps),
    ).rejects.toThrow(/抽出/);
    await expect(
      ingestDocument({ fileName: "a.docx", data: enc("x"), visibility: "internal" }, deps),
    ).rejects.toThrow();
  });
});
