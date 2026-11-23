import {
  apiErrorSchema,
  chatResponseSchema,
  type ApiErrorCode,
  type ChatResponse,
} from "@/lib/contracts/api";

export type ChatApiResult =
  | { kind: "ok"; data: ChatResponse }
  | { kind: "error"; code: ApiErrorCode; message: string; requiresLogin: boolean };

/** UI に表示するエラーメッセージ（サーバーのメッセージ本文に依存しない）。 */
const UI_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: "ログインの有効期限が切れました。再度ログインしてください。",
  FORBIDDEN: "この機能を利用する権限がありません。管理者に連絡してください。",
  NOT_FOUND: "対象が見つかりませんでした。",
  INVALID_REQUEST: "質問の内容を確認してください。",
  PAYLOAD_TOO_LARGE: "質問が長すぎます。短くして再度お試しください。",
  RATE_LIMITED: "リクエストが集中しています。しばらく待ってから再度お試しください。",
  INTERNAL: "エラーが発生しました。時間をおいて再度お試しください。",
  UPSTREAM_UNAVAILABLE: "外部サービスに接続できませんでした。時間をおいて再度お試しください。",
};

export function errorMessageFor(code: ApiErrorCode): string {
  return UI_ERROR_MESSAGES[code];
}

function statusToCode(status: number): ApiErrorCode {
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "FORBIDDEN";
  if (status === 404) return "NOT_FOUND";
  if (status === 400) return "INVALID_REQUEST";
  if (status === 413) return "PAYLOAD_TOO_LARGE";
  if (status === 429) return "RATE_LIMITED";
  if (status === 503) return "UPSTREAM_UNAVAILABLE";
  return "INTERNAL";
}

function makeError(code: ApiErrorCode, serverMessage?: string): ChatApiResult {
  // INVALID_REQUEST のみサーバーの検証メッセージ（例: 文字数上限）を表示する
  const message =
    code === "INVALID_REQUEST" && serverMessage ? serverMessage : errorMessageFor(code);
  return { kind: "error", code, message, requiresLogin: code === "UNAUTHENTICATED" };
}

/**
 * /api/chat の応答を検証する。契約（zod スキーマ）に合わない応答はエラー扱い。
 */
export function parseChatApiResponse(status: number, bodyText: string): ChatApiResult {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return makeError(status >= 200 && status < 300 ? "INTERNAL" : statusToCode(status));
  }

  if (status >= 200 && status < 300) {
    const parsed = chatResponseSchema.safeParse(json);
    if (!parsed.success) return makeError("INTERNAL");
    const data = parsed.data;
    // 根拠なしの回答に出典が付いている場合は出典を表示しない（契約違反の防御）
    if (!data.found && data.citations.length > 0) {
      return { kind: "ok", data: { ...data, citations: [] } };
    }
    return { kind: "ok", data };
  }

  const err = apiErrorSchema.safeParse(json);
  if (err.success) return makeError(err.data.error.code, err.data.error.message);
  return makeError(statusToCode(status));
}

export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "citation"; id: number };

/**
 * 回答本文の [n] を出典参照に分割する。
 * 出典一覧に存在しない番号はテキストのまま残す（存在しない出典へのリンクを作らない）。
 */
export function splitAnswerWithCitations(answer: string, validIds: number[]): AnswerSegment[] {
  const valid = new Set(validIds);
  const segments: AnswerSegment[] = [];
  const re = /\[(\d{1,3})\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(answer)) !== null) {
    const id = Number(m[1]);
    if (!valid.has(id)) continue;
    if (m.index > last) segments.push({ type: "text", text: answer.slice(last, m.index) });
    segments.push({ type: "citation", id });
    last = m.index + m[0].length;
  }
  if (last < answer.length) segments.push({ type: "text", text: answer.slice(last) });
  return segments;
}

/**
 * 送信前の文字数チェック。サーバー側の zod（trim 後の string.length）と同じ数え方にする。
 */
export function questionLength(text: string): number {
  return text.trim().length;
}

export function canSubmitQuestion(text: string, maxLength: number): boolean {
  const len = questionLength(text);
  return len > 0 && len <= maxLength;
}
