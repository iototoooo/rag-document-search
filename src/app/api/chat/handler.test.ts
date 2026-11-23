import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import type { AuthorizationResult } from "@/lib/auth/authorize";
import { chatResponseSchema } from "@/lib/contracts/api";
import type { AnswerGenerator, ChunkSearcher, EmbeddingProvider } from "@/lib/contracts/ports";
import { NOT_FOUND_MESSAGE } from "@/lib/contracts/types";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { InMemoryRateLimiter } from "@/lib/search/rate-limit";
import { RecordingGenerator, RlsFakeSearcher, type FakeDoc } from "@/lib/search/testing";
import { MAX_BODY_BYTES, createChatHandler } from "./handler";

const docs: FakeDoc[] = [
  {
    documentId: "doc-internal",
    fileName: "demo-doc2-meeting-room.pdf",
    title: "会議室利用ガイド",
    visibility: "internal",
    chunks: [{ chunkId: "c1", pageNumber: 1, section: "1. 予約方法", content: "会議室の予約は1回最大2時間まで。利用時間は8:30〜19:00。" }],
  },
  {
    documentId: "doc-dept",
    fileName: "dept-only.pdf",
    title: "部署限定",
    visibility: "department",
    chunks: [{ chunkId: "c2", pageNumber: 2, section: null, content: "会議室の予約は1回最大2時間まで。部署限定の機密。" }],
  },
];

const OK_AUTH: AuthorizationResult = { ok: true, user: { id: "u1", email: "u1@example.com" } };

function setup(opts: {
  auth?: AuthorizationResult;
  generator?: AnswerGenerator;
  embedder?: EmbeddingProvider;
  searcher?: ChunkSearcher;
  rateLimiter?: InMemoryRateLimiter;
} = {}) {
  const embedder = opts.embedder ?? new MockEmbeddingProvider(256);
  const searcher = opts.searcher ?? new RlsFakeSearcher(docs, (d) => d.visibility === "internal");
  const generator = opts.generator ?? new RecordingGenerator();
  const spies = {
    getSupabase: vi.fn(async () => ({ kind: "user-scoped-client" })),
    authorize: vi.fn(async () => opts.auth ?? OK_AUTH),
    embed: vi.spyOn(embedder, "embed"),
    search: vi.spyOn(searcher, "search"),
    generate: vi.spyOn(generator, "generate"),
    createSearcher: vi.fn(() => searcher),
  };
  const POST = createChatHandler({
    getSupabase: spies.getSupabase,
    authorize: spies.authorize,
    createEmbedder: () => embedder,
    createSearcher: spies.createSearcher,
    createGenerator: () => generator,
    getRagConfig: () => ({ threshold: 0.3, count: 6 }),
    rateLimiter: opts.rateLimiter,
  });
  return { POST, spies };
}

function req(body: unknown, init: { contentType?: string; raw?: string } = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": init.contentType ?? "application/json" },
    body: init.raw ?? JSON.stringify(body),
  });
}

async function errorCode(res: Response) {
  return ((await res.json()) as { error: { code: string } }).error.code;
}

describe("POST /api/chat", () => {
  it("未認証は 401 で、Embedding・検索・LLM を呼ばない", async () => {
    const { POST, spies } = setup({ auth: { ok: false, code: "UNAUTHENTICATED" } });
    const res = await POST(req({ question: "会議室は何時間まで？" }));
    expect(res.status).toBe(401);
    expect(await errorCode(res)).toBe("UNAUTHENTICATED");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(spies.embed).not.toHaveBeenCalled();
    expect(spies.search).not.toHaveBeenCalled();
    expect(spies.generate).not.toHaveBeenCalled();
  });

  it("未許可ユーザーは 403 で、Embedding・検索・LLM を呼ばない", async () => {
    const { POST, spies } = setup({ auth: { ok: false, code: "FORBIDDEN" } });
    const res = await POST(req({ question: "会議室は何時間まで？" }));
    expect(res.status).toBe(403);
    expect(spies.embed).not.toHaveBeenCalled();
    expect(spies.search).not.toHaveBeenCalled();
    expect(spies.generate).not.toHaveBeenCalled();
  });

  it("認可は入力検証より先に行う（不正入力でも未認証なら 401）", async () => {
    const { POST } = setup({ auth: { ok: false, code: "UNAUTHENTICATED" } });
    const res = await POST(req(null, { raw: "{broken" }));
    expect(res.status).toBe(401);
  });

  it("不正 JSON・空質問・長すぎる質問・JSON 以外は 400", async () => {
    const { POST, spies } = setup();
    expect((await POST(req(null, { raw: "{broken" }))).status).toBe(400);
    expect((await POST(req({ question: "   " }))).status).toBe(400);
    expect((await POST(req({ question: "あ".repeat(1001) }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ question: "x" }, { contentType: "text/plain" }))).status).toBe(400);
    expect(spies.embed).not.toHaveBeenCalled();
  });

  it("巨大ボディは 413", async () => {
    const { POST, spies } = setup();
    const res = await POST(req(null, { raw: JSON.stringify({ question: "a".repeat(MAX_BODY_BYTES + 10) }) }));
    expect(res.status).toBe(413);
    expect(spies.embed).not.toHaveBeenCalled();
  });

  it("正常時は契約どおりのレスポンスを返し、検索にはユーザー権限クライアントを使う", async () => {
    const { POST, spies } = setup();
    const res = await POST(req({ question: "会議室の予約は1回何時間までですか？" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = chatResponseSchema.parse(await res.json());
    expect(body.found).toBe(true);
    expect(body.citations[0]).toMatchObject({ fileName: "demo-doc2-meeting-room.pdf", pageNumber: 1 });
    expect(spies.createSearcher).toHaveBeenCalledWith({ kind: "user-scoped-client" });
    const text = JSON.stringify(body);
    expect(text).not.toContain("dept-only");
    expect(text).not.toContain("部署限定");
  });

  it("該当文書がない質問は NOT_FOUND を返す", async () => {
    const { POST, spies } = setup({ searcher: { search: async () => [] } });
    const res = await POST(req({ question: "社宅の家賃補助はありますか？" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
    expect(spies.generate).not.toHaveBeenCalled();
  });

  it("LLM が存在しない出典を返すと NOT_FOUND", async () => {
    const { POST } = setup({ generator: new RecordingGenerator("cite-99") });
    const res = await POST(req({ question: "会議室は何時間まで？" }));
    expect(await res.json()).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
  });

  it("外部 API の一時障害は 503、その他の例外は 500。ログに質問文を出さない", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const question = "極秘の質問文ABC123";

    const upstream = setup({
      generator: {
        generate: async () => {
          throw new Anthropic.RateLimitError(429, undefined, `rate limited: ${question}`, new Headers());
        },
      },
      searcher: { search: async () => [
        { chunkId: "c", documentId: "d", chunkKey: "k", fileName: "f.pdf", title: "t", pageNumber: 1, section: null, content: "x", similarity: 0.9 },
      ] },
    });
    const r1 = await upstream.POST(req({ question }));
    expect(r1.status).toBe(503);

    const broken = setup({
      embedder: {
        model: "m",
        dimensions: 1,
        embed: async () => {
          throw new Error(`boom ${question}`);
        },
      },
    });
    const r2 = await broken.POST(req({ question }));
    expect(r2.status).toBe(500);
    const body = JSON.stringify(await r2.json());
    expect(body).not.toContain(question);
    expect(body).not.toContain("boom");

    const logged = JSON.stringify(errSpy.mock.calls);
    expect(logged).not.toContain(question);
    expect(errSpy).toHaveBeenCalled();
  });

  it("ユーザー単位のレート制限で 429", async () => {
    const { POST } = setup({ rateLimiter: new InMemoryRateLimiter(1, 60_000) });
    expect((await POST(req({ question: "会議室は？" }))).status).toBe(200);
    const res = await POST(req({ question: "会議室は？" }));
    expect(res.status).toBe(429);
    expect(await errorCode(res)).toBe("RATE_LIMITED");
  });
});
