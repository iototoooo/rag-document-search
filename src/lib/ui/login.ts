import { z } from "zod";
import type { AuthorizationResult } from "@/lib/auth/authorize";
import { sanitizeRedirectPath } from "./redirect";

export const loginInputSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(256),
  next: z.string().optional(),
});

/** 理由（アカウントの有無・パスワード誤り・未許可）を区別しない汎用メッセージ。 */
export const LOGIN_FAILED_MESSAGE =
  "ログインできませんでした。メールアドレスとパスワードを確認するか、管理者に連絡してください。";
export const LOGIN_INVALID_INPUT_MESSAGE = "メールアドレスとパスワードを正しく入力してください。";
export const LOGIN_UNAVAILABLE_MESSAGE =
  "現在ログインできません。時間をおいて再度お試しください。";

export type LoginState = { error: string | null };

export type LoginDeps = {
  signIn(email: string, password: string): Promise<{ error: unknown }>;
  authorize(): Promise<AuthorizationResult>;
  signOut(): Promise<void>;
};

export type LoginOutcome =
  | { ok: true; redirectTo: string }
  | { ok: false; state: LoginState };

/**
 * ログイン処理本体（Server Action から依存注入で呼ぶ）。
 * パスワード認証に成功しても、サーバー側の認可（app_users 等）に通らなければ
 * 直ちにサインアウトし、汎用エラーを返す。
 */
export async function performLogin(
  deps: LoginDeps,
  raw: { email: unknown; password: unknown; next: unknown },
): Promise<LoginOutcome> {
  const parsed = loginInputSchema.safeParse({
    email: typeof raw.email === "string" ? raw.email.trim() : raw.email,
    password: raw.password,
    next: typeof raw.next === "string" ? raw.next : undefined,
  });
  if (!parsed.success) return { ok: false, state: { error: LOGIN_INVALID_INPUT_MESSAGE } };

  try {
    const { error } = await deps.signIn(parsed.data.email, parsed.data.password);
    if (error) return { ok: false, state: { error: LOGIN_FAILED_MESSAGE } };
  } catch {
    return { ok: false, state: { error: LOGIN_UNAVAILABLE_MESSAGE } };
  }

  let result: AuthorizationResult;
  try {
    result = await deps.authorize();
  } catch {
    result = { ok: false, code: "FORBIDDEN" };
  }

  if (!result.ok) {
    try {
      await deps.signOut();
    } catch {
      // サインアウト失敗時もログイン成功扱いにはしない
    }
    return { ok: false, state: { error: LOGIN_FAILED_MESSAGE } };
  }

  return { ok: true, redirectTo: sanitizeRedirectPath(parsed.data.next) };
}
