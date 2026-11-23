import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { MockEmbeddingProvider, cosineSimilarity } from "./mock";
import { OpenAIEmbeddingProvider } from "./openai";

describe("MockEmbeddingProvider", () => {
  it("決定的で、類似文ほど類似度が高い", async () => {
    const p = new MockEmbeddingProvider(256);
    const [a, a2, b, c] = await p.embed([
      "出張の日当の金額",
      "出張の日当の金額",
      "出張の日当はいくらですか",
      "会議室の予約方法",
    ]);
    expect(a).toEqual(a2);
    expect(a).toHaveLength(256);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(cosineSimilarity(a, c));
  });
});

describe("OpenAIEmbeddingProvider（API はモック）", () => {
  function fakeClient(dim: number) {
    const create = vi.fn(async ({ input }: { input: string[] }) => ({
      data: input.map((_, index) => ({ index, embedding: new Array(dim).fill(index) })).reverse(),
    }));
    return { client: { embeddings: { create } } as unknown as OpenAI, create };
  }

  it("バッチ分割し、index 順に並べ替える", async () => {
    const { client, create } = fakeClient(4);
    const p = new OpenAIEmbeddingProvider(
      { apiKey: "dummy", model: "text-embedding-3-small", dimensions: 4 },
      client,
    );
    const texts = Array.from({ length: 100 }, (_, i) => `t${i}`);
    const out = await p.embed(texts);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "text-embedding-3-small",
      dimensions: 4,
    });
    expect(out).toHaveLength(100);
    expect(out[0][0]).toBe(0);
    expect(out[95][0]).toBe(95);
    expect(out[96][0]).toBe(0); // 2 バッチ目の先頭
  });

  it("次元数不一致はエラー", async () => {
    const { client } = fakeClient(3);
    const p = new OpenAIEmbeddingProvider({ apiKey: "dummy", model: "m", dimensions: 4 }, client);
    await expect(p.embed(["x"])).rejects.toThrow(/次元数/);
  });
});
