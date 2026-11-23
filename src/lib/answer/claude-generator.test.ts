import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { ClaudeAnswerGenerator, type AnthropicLike } from "./claude-generator";
import { AnswerFormatError, UpstreamUnavailableError, isUpstreamUnavailable } from "./errors";

const sources = [
  { id: 1, fileName: "a.pdf", title: "出張旅費規程", pageNumber: 1, section: null, content: "2500円" },
];

function gen(parseImpl: (...args: unknown[]) => unknown, serverFallback = false) {
  const parse = vi.fn(parseImpl);
  const client = { beta: { messages: { parse } } } as unknown as AnthropicLike;
  const g = new ClaudeAnswerGenerator(
    { apiKey: "dummy", model: "claude-opus-5-5", effort: "medium", maxTokens: 4000, serverFallback },
    client,
  );
  return { g, parse };
}

describe("ClaudeAnswerGenerator（API はモック）", () => {
  it("構造化出力で parse を呼び、フォールバックは既定で送らず、thinking/temperature も送らない", async () => {
    const { g, parse } = gen(async () => ({
      stop_reason: "end_turn",
      parsed_output: { found: true, answer: "10日です[1]", cited_source_ids: [1] },
    }));
    const r = await g.generate({ question: "日当は？", sources });
    expect(r).toEqual({ status: "answered", answer: "10日です[1]", citedSourceIds: [1] });

    const params = parse.mock.calls[0][0] as Record<string, unknown>;
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.max_tokens).toBe(4000);
    expect(params).not.toHaveProperty("betas");
    expect(params).not.toHaveProperty("fallbacks");
    expect(params).not.toHaveProperty("thinking");
    expect(params).not.toHaveProperty("temperature");
    const oc = params.output_config as { effort: string; format: unknown };
    expect(oc.effort).toBe("medium");
    expect(oc.format).toBeTruthy();
    expect(typeof params.system).toBe("string");
  });

  it("応答の usage をトークン数として返す（費用集計用）", async () => {
    const { g } = gen(async () => ({
      stop_reason: "end_turn",
      usage: { input_tokens: 2100, output_tokens: 340, cache_read_input_tokens: 0 },
      parsed_output: { found: false, answer: "", cited_source_ids: [] },
    }));
    const r = await g.generate({ question: "社宅の家賃補助は？", sources });
    expect(r).toEqual({ status: "not_found", usage: { inputTokens: 2100, outputTokens: 340 } });
  });

  it("ANTHROPIC_SERVER_FALLBACK=true のときだけサーバー側フォールバックを送る", async () => {
    const { g, parse } = gen(
      async () => ({
        stop_reason: "end_turn",
        parsed_output: { found: true, answer: "10日です[1]", cited_source_ids: [1] },
      }),
      true,
    );
    await g.generate({ question: "日当は？", sources });
    const params = parse.mock.calls[0][0] as Record<string, unknown>;
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.fallbacks).toBe("default");
  });

  it("refusal は refused（content を読まない）", async () => {
    const { g } = gen(async () => ({ stop_reason: "refusal", parsed_output: null }));
    expect(await g.generate({ question: "q", sources })).toEqual({ status: "refused" });
  });

  it("found=false / 空回答は not_found", async () => {
    const { g } = gen(async () => ({
      stop_reason: "end_turn",
      parsed_output: { found: false, answer: "", cited_source_ids: [] },
    }));
    expect(await g.generate({ question: "q", sources })).toEqual({ status: "not_found" });
    const { g: g2 } = gen(async () => ({
      stop_reason: "end_turn",
      parsed_output: { found: true, answer: "  ", cited_source_ids: [1] },
    }));
    expect(await g2.generate({ question: "q", sources })).toEqual({ status: "not_found" });
  });

  it("parsed_output が null・max_tokens はエラー", async () => {
    const { g } = gen(async () => ({ stop_reason: "end_turn", parsed_output: null }));
    await expect(g.generate({ question: "q", sources })).rejects.toThrow(AnswerFormatError);
    const { g: g2 } = gen(async () => ({ stop_reason: "max_tokens", parsed_output: null }));
    await expect(g2.generate({ question: "q", sources })).rejects.toThrow(AnswerFormatError);
  });

  it("接続エラー・レート制限は UpstreamUnavailableError", async () => {
    const { g } = gen(async () => {
      throw new Anthropic.APIConnectionError({ message: "down" });
    });
    await expect(g.generate({ question: "q", sources })).rejects.toThrow(UpstreamUnavailableError);
  });

  it("その他の API エラーはそのまま投げる", async () => {
    const err = new Anthropic.BadRequestError(400, undefined, "bad", new Headers());
    const { g } = gen(async () => {
      throw err;
    });
    await expect(g.generate({ question: "q", sources })).rejects.toBe(err);
    expect(isUpstreamUnavailable(err)).toBe(false);
  });
});
