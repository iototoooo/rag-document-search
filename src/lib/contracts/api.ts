import { z } from "zod";

/**
 * HTTP API の入出力契約。サーバー（Route Handler）とクライアント（UI）の両方が参照する。
 */

export const QUESTION_MAX_LENGTH = 1000;

/** POST /api/chat リクエスト */
export const chatRequestSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "質問を入力してください")
    .max(QUESTION_MAX_LENGTH, `質問は${QUESTION_MAX_LENGTH}文字以内で入力してください`),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const citationSchema = z.object({
  id: z.number().int().positive(),
  documentId: z.string(),
  chunkId: z.string(),
  fileName: z.string(),
  title: z.string(),
  pageNumber: z.number().int().positive(),
  section: z.string().nullable(),
  snippet: z.string(),
});

/** POST /api/chat 成功レスポンス（200） */
export const chatResponseSchema = z.object({
  /** 回答本文。found=false の場合は NOT_FOUND_MESSAGE */
  answer: z.string(),
  found: z.boolean(),
  /** found=false の場合は必ず空配列 */
  citations: z.array(citationSchema),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const API_ERROR_CODES = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 503,
} as const;
export type ApiErrorCode = keyof typeof API_ERROR_CODES;

/** エラーレスポンス共通形式。message は利用者向けの日本語で、内部情報を含めない。 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(
      Object.keys(API_ERROR_CODES) as [ApiErrorCode, ...ApiErrorCode[]],
    ),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

const DEFAULT_ERROR_MESSAGES: Record<ApiErrorCode, string> = {
  UNAUTHENTICATED: "ログインが必要です",
  FORBIDDEN: "この機能を利用する権限がありません",
  NOT_FOUND: "見つかりません",
  INVALID_REQUEST: "リクエストの内容が正しくありません",
  PAYLOAD_TOO_LARGE: "リクエストが大きすぎます",
  RATE_LIMITED: "しばらく時間をおいて再度お試しください",
  INTERNAL: "エラーが発生しました。時間をおいて再度お試しください",
  UPSTREAM_UNAVAILABLE: "外部サービスに接続できません。時間をおいて再度お試しください",
};

/** 共通形式のエラー Response を生成する。キャッシュ不可。 */
export function apiErrorResponse(code: ApiErrorCode, message?: string): Response {
  const body: ApiError = {
    error: { code, message: message ?? DEFAULT_ERROR_MESSAGES[code] },
  };
  return Response.json(body, {
    status: API_ERROR_CODES[code],
    headers: { "Cache-Control": "no-store" },
  });
}

/**
 * 出典 PDF を開く URL。Route Handler が認証・閲覧権限を確認してから PDF を返す。
 * 権限がない文書・存在しない文書はどちらも 404 を返し、存在有無を区別させない。
 */
export function documentFileUrl(documentId: string, pageNumber?: number): string {
  const base = `/api/documents/${encodeURIComponent(documentId)}/file`;
  return pageNumber ? `${base}#page=${pageNumber}` : base;
}
