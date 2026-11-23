import { z } from "zod";

/**
 * 環境変数の読み取り。用途ごとに分割し、必要な値だけを検証する。
 * エラーには欠落・不正なキー名のみを含め、値そのものは出力しない。
 */

type Source = Record<string, string | undefined>;

function parseWith<T extends z.ZodType>(schema: T, source: Source): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => i.path.join(".")))];
    throw new Error(`環境変数が不正または未設定です: ${keys.join(", ")}`);
  }
  return result.data;
}

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );

/** ブラウザにも公開してよい Supabase 接続情報（anon キーは RLS 前提で公開可）。 */
const publicSupabaseSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});
export function getPublicSupabaseEnv(source: Source = process.env) {
  // Next.js はクライアントバンドルで NEXT_PUBLIC_* を静的に埋め込むため、
  // process.env 全体ではなく個別に参照する。
  return parseWith(publicSupabaseSchema, {
    NEXT_PUBLIC_SUPABASE_URL:
      source === process.env ? process.env.NEXT_PUBLIC_SUPABASE_URL : source.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      source === process.env
        ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        : source.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/** サーバー専用: service_role キー。取り込み CLI 以外では使用しない。 */
const serviceRoleSchema = publicSupabaseSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});
export function getServiceRoleEnv(source: Source = process.env) {
  return parseWith(serviceRoleSchema, source);
}

const embeddingSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  // DB の vector(1536) 列と一致させるため、モデル・次元数は固定値のみ許可する
  EMBEDDING_MODEL: z.enum(["text-embedding-3-small"]).default("text-embedding-3-small"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().pipe(z.literal(1536)).default(1536),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
});
export function getEmbeddingEnv(source: Source = process.env) {
  return parseWith(embeddingSchema, source);
}

/**
 * 利用を許可する Claude モデル（意図しない高額モデルの指定を防ぐ許可リスト）。
 * 料金（入力/出力 per 1M tokens, 2026-11 時点の参考値）:
 *   claude-opus-5-5 $4/$20, claude-sonnet-5-5 $2/$10, claude-haiku-5-5 $0.10/$0.50
 * Fable / Mythos 等の上位モデルは許可しない（必要時はコード変更とレビューを経て追加する）。
 */
export const ALLOWED_ANTHROPIC_MODELS = [
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
] as const;

/**
 * 費用の推定用（USD per 1M tokens、2026-11 時点の参考値。プロンプト 100K トークン以下の料金）。
 * 実額は各社の Usage 画面で確認すること。
 */
export const ANTHROPIC_PRICING_USD_PER_MTOK: Record<
  (typeof ALLOWED_ANTHROPIC_MODELS)[number],
  { input: number; output: number }
> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function estimateClaudeCostUsd(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const p = (ANTHROPIC_PRICING_USD_PER_MTOK as Record<string, { input: number; output: number }>)[model];
  if (!p) return null;
  return (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000;
}

const bool = z
  .enum(["true", "false", "1", "0", "on", "off"])
  .optional()
  .transform((v) => v === "true" || v === "1" || v === "on");

const anthropicSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL: z.enum(ALLOWED_ANTHROPIC_MODELS).default("claude-opus-5-5"),
  // チャット用途は low で品質・速度・費用のバランスが良い。精度不足時のみ上げる
  ANTHROPIC_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  // 思考トークンも含む 1 回答あたりの出力上限（課金の上限にもなる）
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().min(1024).max(16000).default(8000),
  // 失敗時の自動再試行回数（0〜2）。再試行は課金増の要因になりうるため既定は 1
  ANTHROPIC_MAX_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  // 拒否（refusal）時に別モデルで自動再実行するサーバー側フォールバック。既定は無効
  ANTHROPIC_SERVER_FALLBACK: bool,
});
export type AnthropicEnv = z.infer<typeof anthropicSchema>;
export function getAnthropicEnv(source: Source = process.env): AnthropicEnv {
  return parseWith(anthropicSchema, source);
}

/** 検索パラメータ（すべて既定値あり）。 */
const ragSchema = z.object({
  RAG_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.3),
  RAG_MATCH_COUNT: z.coerce.number().int().min(1).max(20).default(6),
});
export function getRagConfig(source: Source = process.env) {
  const env = parseWith(ragSchema, source);
  return { threshold: env.RAG_MATCH_THRESHOLD, count: env.RAG_MATCH_COUNT };
}

/**
 * 認可の補助設定。ALLOWED_EMAIL_DOMAINS は「追加の絞り込み」であり、
 * これだけで認可完了とはしない（app_users テーブルでの許可が必須）。
 */
const authSchema = z.object({
  ALLOWED_EMAIL_DOMAINS: csv,
});
export function getAuthConfig(source: Source = process.env) {
  const env = parseWith(authSchema, source);
  return { allowedEmailDomains: env.ALLOWED_EMAIL_DOMAINS };
}
