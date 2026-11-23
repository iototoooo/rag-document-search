import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

/** 外部 AI サービスが一時的に利用できない（接続失敗・レート制限・5xx）。利用者には 503 を返す。 */
export class UpstreamUnavailableError extends Error {
  constructor(readonly service: "anthropic" | "openai") {
    super(`${service} unavailable`);
    this.name = "UpstreamUnavailableError";
  }
}

/** 応答の形式が想定外（parsed_output が null 等）。利用者には 500 を返す。 */
export class AnswerFormatError extends Error {
  constructor(message = "回答の形式が不正です") {
    super(message);
    this.name = "AnswerFormatError";
  }
}

function isTransient(
  error: unknown,
  sdk: {
    APIConnectionError: abstract new (...args: never[]) => unknown;
    RateLimitError: abstract new (...args: never[]) => unknown;
    InternalServerError: abstract new (...args: never[]) => unknown;
  },
): boolean {
  return (
    error instanceof sdk.APIConnectionError ||
    error instanceof sdk.RateLimitError ||
    error instanceof sdk.InternalServerError
  );
}

/** Anthropic / OpenAI の一時的エラーかどうか（型付き例外クラスで判定）。 */
export function isUpstreamUnavailable(error: unknown): boolean {
  return (
    error instanceof UpstreamUnavailableError ||
    isTransient(error, Anthropic) ||
    isTransient(error, OpenAI)
  );
}
