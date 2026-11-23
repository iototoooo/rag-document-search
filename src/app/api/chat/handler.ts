import {
  apiErrorResponse,
  chatRequestSchema,
  chatResponseSchema,
  type ChatResponse,
} from "@/lib/contracts/api";
import type { AnswerGenerator, ChunkSearcher, EmbeddingProvider } from "@/lib/contracts/ports";
import type { AuthorizationResult } from "@/lib/auth/authorize";
import { isUpstreamUnavailable } from "@/lib/answer/errors";
import { logError, logMetric } from "@/lib/observability/log";
import { answerQuestion } from "@/lib/search/answer-service";
import { InMemoryRateLimiter } from "@/lib/search/rate-limit";

export const MAX_BODY_BYTES = 16 * 1024;

/**
 * POST /api/chat の依存。すべて注入可能にし、テストではモックを渡す。
 * Supabase クライアントはリクエストユーザー権限のもの（RLS 適用）を 1 リクエストにつき 1 つ作る。
 */
export type ChatHandlerDeps<TClient> = {
  getSupabase(): Promise<TClient>;
  authorize(client: TClient): Promise<AuthorizationResult>;
  createEmbedder(): EmbeddingProvider;
  createSearcher(client: TClient): ChunkSearcher;
  createGenerator(): AnswerGenerator;
  getRagConfig(): { threshold: number; count: number };
  rateLimiter?: InMemoryRateLimiter;
};

function json(body: ChatResponse): Response {
  return Response.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

async function readBodyWithLimit(request: Request, limit: number): Promise<string | "too_large"> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return "too_large";
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export function createChatHandler<TClient>(deps: ChatHandlerDeps<TClient>) {
  const limiter = deps.rateLimiter ?? new InMemoryRateLimiter(20, 60_000);

  return async function POST(request: Request): Promise<Response> {
    try {
      // 1. 認証・認可を最初に行う。失敗時は Embedding・検索・LLM を一切呼ばない
      const supabase = await deps.getSupabase();
      const auth = await deps.authorize(supabase);
      if (!auth.ok) return apiErrorResponse(auth.code);

      if (!limiter.take(auth.user.id)) return apiErrorResponse("RATE_LIMITED");

      // 2. 入力検証
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return apiErrorResponse("INVALID_REQUEST");
      }
      const raw = await readBodyWithLimit(request, MAX_BODY_BYTES);
      if (raw === "too_large") return apiErrorResponse("PAYLOAD_TOO_LARGE");

      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        return apiErrorResponse("INVALID_REQUEST");
      }
      const parsed = chatRequestSchema.safeParse(body);
      if (!parsed.success) {
        const message = parsed.error.issues[0]?.message;
        return apiErrorResponse("INVALID_REQUEST", message);
      }

      // 3. 検索・回答生成（検索はユーザー権限のクライアントで RLS を適用）
      const result = await answerQuestion(parsed.data.question, {
        embedder: deps.createEmbedder(),
        searcher: deps.createSearcher(supabase),
        generator: deps.createGenerator(),
        rag: deps.getRagConfig(),
        // 応答時間の内訳とトークン数だけを記録（質問・資料・回答は出さない）
        onMetrics: (m) => logMetric("api_chat", m),
      });

      const checked = chatResponseSchema.safeParse(result);
      if (!checked.success) {
        logError("api/chat", new Error("ResponseSchemaMismatch"));
        return apiErrorResponse("INTERNAL");
      }
      return json(checked.data);
    } catch (error) {
      // 質問文・資料・回答はログに出さない（エラー種別のみ）
      logError("api/chat", error);
      if (isUpstreamUnavailable(error)) return apiErrorResponse("UPSTREAM_UNAVAILABLE");
      return apiErrorResponse("INTERNAL");
    }
  };
}
