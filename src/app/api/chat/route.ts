import { ClaudeAnswerGenerator } from "@/lib/answer/claude-generator";
import { authorizeUser, type AuthCapableClient } from "@/lib/auth/authorize";
import { getAnthropicEnv, getAuthConfig, getEmbeddingEnv, getRagConfig } from "@/lib/config/env";
import { OpenAIEmbeddingProvider } from "@/lib/embeddings/openai";
import { SupabaseChunkSearcher, type RpcCapableClient } from "@/lib/search/supabase-searcher";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { createChatHandler } from "./handler";

/**
 * POST /api/chat
 * 環境変数はリクエスト時に読み取る（ビルド時に .env.local がなくても成功させるため）。
 * service_role クライアントはここでは使用しない。
 */
// SupabaseClient の完全な型を最小インターフェースへ構造的に照合すると
// 型展開が深くなりすぎる（TS2589）ため、ここで明示的に最小型として扱う。
type UserClient = AuthCapableClient & RpcCapableClient;

/**
 * 1 リクエストの最大実行時間（秒）。Embedding + 検索 + Claude（タイムアウト 30 秒・再試行 1 回）が
 * 収まる長さにし、応答が返らない場合に関数が長時間動き続けて課金されるのを防ぐ。
 */
export const maxDuration = 60;

/**
 * API クライアントはプロセス内で再利用する（リクエストごとに作ると HTTP 接続・TLS ハンドシェイクを
 * 毎回やり直すため遅くなる）。どちらも利用者に依存する状態を持たないので共有してよい。
 * 環境変数は初回リクエスト時に読み取る。変更した場合はサーバーの再起動が必要。
 */
let embedder: OpenAIEmbeddingProvider | null = null;
let generator: ClaudeAnswerGenerator | null = null;

export const POST = createChatHandler<UserClient>({
  getSupabase: async () => (await createUserSupabaseClient()) as unknown as UserClient,
  authorize: (client) => authorizeUser(client, getAuthConfig()),
  createEmbedder: () => {
    if (embedder) return embedder;
    const env = getEmbeddingEnv();
    return (embedder = new OpenAIEmbeddingProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.EMBEDDING_MODEL,
      dimensions: env.EMBEDDING_DIMENSIONS,
      maxRetries: env.OPENAI_MAX_RETRIES,
    }));
  },
  createSearcher: (client) => new SupabaseChunkSearcher(client),
  createGenerator: () => {
    if (generator) return generator;
    const env = getAnthropicEnv();
    return (generator = new ClaudeAnswerGenerator({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      effort: env.ANTHROPIC_EFFORT,
      maxTokens: env.ANTHROPIC_MAX_TOKENS,
      maxRetries: env.ANTHROPIC_MAX_RETRIES,
      timeoutMs: env.ANTHROPIC_TIMEOUT_MS,
      serverFallback: env.ANTHROPIC_SERVER_FALLBACK,
    }));
  },
  getRagConfig: () => getRagConfig(),
});
