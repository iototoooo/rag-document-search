import { describe, expect, it } from "vitest";
import { toTokenUsage } from "@/lib/answer/claude-generator";
import { estimateClaudeCostUsd } from "@/lib/config/env";
import type { AnswerGenerator, ChunkSearcher, EmbeddingProvider } from "@/lib/contracts/ports";
import type { RetrievedChunk } from "@/lib/contracts/types";
import { sanitizeMetric } from "@/lib/observability/log";
import { answerQuestion, type AnswerMetrics } from "./answer-service";

const embedder: EmbeddingProvider = {
  model: "m",
  dimensions: 3,
  embed: async () => [[1, 0, 0]],
};
const chunk: RetrievedChunk = {
  chunkId: "c1",
  documentId: "d1",
  chunkKey: "k1",
  fileName: "a.pdf",
  title: "A",
  pageNumber: 1,
  section: null,
  content: "本文",
  similarity: 0.9,
};
const searcher = (rows: RetrievedChunk[]): ChunkSearcher => ({ search: async () => rows });
/** 呼ばれるたびに 10ms 進む時計 */
const clock = () => {
  let t = 0;
  return () => (t += 10);
};

describe("answerQuestion の計測", () => {
  it("各段階の時間とトークン数を記録する", async () => {
    const generator: AnswerGenerator = {
      generate: async () => ({
        status: "answered",
        answer: "答え [1]",
        citedSourceIds: [1],
        usage: { inputTokens: 1200, outputTokens: 300 },
      }),
    };
    let m: AnswerMetrics | null = null;
    const res = await answerQuestion("質問", {
      embedder,
      searcher: searcher([chunk]),
      generator,
      rag: { threshold: 0.3, count: 6 },
      onMetrics: (x) => (m = x),
      now: clock(),
    });
    expect(res.found).toBe(true);
    expect(m).toEqual({
      embedMs: 10,
      searchMs: 10,
      generateMs: 10,
      chunkCount: 1,
      usage: { inputTokens: 1200, outputTokens: 300 },
      outcome: "answered",
    });
  });

  it("検索 0 件なら LLM を呼ばず generateMs は null", async () => {
    let called = false;
    let m: AnswerMetrics | null = null;
    await answerQuestion("質問", {
      embedder,
      searcher: searcher([]),
      generator: { generate: async () => ((called = true), { status: "not_found" }) },
      rag: { threshold: 0.3, count: 6 },
      onMetrics: (x) => (m = x),
    });
    expect(called).toBe(false);
    expect(m!.generateMs).toBeNull();
    expect(m!.outcome).toBe("no_sources");
  });

  it("例外時も計測済みの範囲で通知する（outcome=error）", async () => {
    let m: AnswerMetrics | null = null;
    await expect(
      answerQuestion("質問", {
        embedder,
        searcher: searcher([chunk]),
        generator: { generate: async () => Promise.reject(new Error("x")) },
        rag: { threshold: 0.3, count: 6 },
        onMetrics: (x) => (m = x),
      }),
    ).rejects.toThrow();
    expect(m!.outcome).toBe("error");
    expect(m!.searchMs).not.toBeNull();
  });
});

describe("toTokenUsage", () => {
  it("入力にキャッシュ分を合算し、出力はそのまま", () => {
    expect(
      toTokenUsage({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: null }),
    ).toEqual({ inputTokens: 120, outputTokens: 50 });
  });
  it("usage がない・形式不正なら undefined", () => {
    expect(toTokenUsage(undefined)).toBeUndefined();
    expect(toTokenUsage({ input_tokens: "1" })).toBeUndefined();
  });
});

describe("estimateClaudeCostUsd", () => {
  it("許可モデルの料金で計算し、未知のモデルは null", () => {
    expect(estimateClaudeCostUsd("claude-opus-5-5", { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(6);
    expect(estimateClaudeCostUsd("claude-haiku-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.6);
    expect(estimateClaudeCostUsd("unknown", { inputTokens: 1, outputTokens: 1 })).toBeNull();
  });
});

describe("sanitizeMetric（ログに本文を出さない）", () => {
  it("数値・真偽値・短い識別子だけを残し、文章や配列は捨てる", () => {
    const out = sanitizeMetric({
      embedMs: 12,
      outcome: "answered",
      question: "出張の日当はいくらですか？",
      answer: "6ヶ月後に10日です",
      key: "dummy-not-a-real-key-value",
      list: [1, 2],
      usage: { inputTokens: 10, outputTokens: 2, note: "本文" },
      ok: true,
      none: null,
    });
    expect(out).toEqual({
      embedMs: 12,
      outcome: "answered",
      usage: { inputTokens: 10, outputTokens: 2 },
      ok: true,
      none: null,
    });
  });
});
