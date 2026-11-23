import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  AnswerGenerator,
  GeneratedAnswer,
  SourceForPrompt,
  TokenUsage,
} from "@/lib/contracts/ports";
import { AnswerFormatError, UpstreamUnavailableError } from "./errors";
import { SYSTEM_PROMPT, answerOutputSchema, buildUserMessage } from "./prompt";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** parse() だけを持つ最小インターフェース（テストでモックを注入する）。 */
export type AnthropicLike = {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
};

/**
 * Claude による回答生成（構造化出力）。
 * - サーバー側フォールバック（拒否時に別モデルで再実行）は課金先モデルが変わるため既定で無効。
 *   ANTHROPIC_SERVER_FALLBACK=true のときだけ fallbacks: "default" を送る
 * - 出力上限（max_tokens）・再試行回数・タイムアウトは環境変数で上限付きで設定
 * - thinking はモデル既定（Opus 5.5 は常時 adaptive）。深さは effort で制御
 * - 質問・資料・回答をログに出さない
 */
export class ClaudeAnswerGenerator implements AnswerGenerator {
  private readonly client: AnthropicLike;

  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      effort: Effort;
      maxTokens?: number;
      maxRetries?: number;
      timeoutMs?: number;
      serverFallback?: boolean;
    },
    client?: AnthropicLike,
  ) {
    this.client =
      client ??
      new Anthropic({
        apiKey: options.apiKey,
        maxRetries: options.maxRetries ?? 1,
        timeout: options.timeoutMs ?? 30_000,
      });
  }

  async generate(input: { question: string; sources: SourceForPrompt[] }): Promise<GeneratedAnswer> {
    let response;
    try {
      response = await this.client.beta.messages.parse({
        model: this.options.model,
        max_tokens: this.options.maxTokens ?? 8000,
        ...(this.options.serverFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input.question, input.sources) }],
        output_config: {
          effort: this.options.effort,
          format: betaZodOutputFormat(answerOutputSchema),
        },
      });
    } catch (error) {
      if (
        error instanceof Anthropic.APIConnectionError ||
        error instanceof Anthropic.RateLimitError ||
        error instanceof Anthropic.InternalServerError
      ) {
        throw new UpstreamUnavailableError("anthropic");
      }
      throw error;
    }

    const usage = toTokenUsage(response.usage);

    // refusal は content を読む前に確認する
    if (response.stop_reason === "refusal") return { status: "refused", usage };
    if (response.stop_reason === "max_tokens") throw new AnswerFormatError("回答が途中で終了しました");

    const parsed = response.parsed_output;
    if (!parsed) throw new AnswerFormatError();

    const answer = parsed.answer.trim();
    if (!parsed.found || answer === "") return { status: "not_found", usage };

    return {
      status: "answered",
      answer,
      citedSourceIds: parsed.cited_source_ids,
      usage,
    };
  }
}

/**
 * API 応答の usage をトークン数だけに変換する（キャッシュ読み書き分は入力に合算）。
 * usage がない・数値でない場合は undefined（費用集計の対象外）。
 */
export function toTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
  if (typeof u.input_tokens !== "number" || typeof u.output_tokens !== "number") return undefined;
  return {
    inputTokens: n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens),
    outputTokens: n(u.output_tokens),
  };
}
