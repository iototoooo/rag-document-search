import type { AuthorizedUser } from "@/lib/contracts/types";

/**
 * サーバー側の認証・認可。
 * 1. supabase.auth.getUser() で JWT を Supabase Auth に問い合わせて検証する（getSession は使わない）
 * 2. メール確認済みであること
 * 3. ALLOWED_EMAIL_DOMAINS が設定されていればドメインも一致すること（補助的な絞り込み）
 * 4. app_users テーブルに is_active=true の行があること（これが本来の利用許可）
 * ドメイン一致だけでは認可しない。
 */

/** テストでモックできるよう、必要最小限の Supabase クライアント形状だけを要求する。 */
export type AuthCapableClient = {
  auth: {
    getUser(): Promise<{
      data: {
        user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null;
      };
      error: unknown;
    }>;
  };
  from(table: "app_users"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{ data: { is_active: boolean } | null; error: unknown }>;
      };
    };
  };
};

export type AuthorizationResult =
  | { ok: true; user: AuthorizedUser }
  | { ok: false; code: "UNAUTHENTICATED" | "FORBIDDEN" };

export function isEmailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  // 完全一致のみ（"evil-example.com" や "example.com.evil" を許可しない）
  return allowedDomains.includes(domain);
}

export async function authorizeUser(
  supabase: AuthCapableClient,
  options: { allowedEmailDomains: string[] },
): Promise<AuthorizationResult> {
  let user;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { ok: false, code: "UNAUTHENTICATED" };
    user = data.user;
  } catch {
    return { ok: false, code: "UNAUTHENTICATED" };
  }

  if (!user.email || !user.email_confirmed_at) return { ok: false, code: "FORBIDDEN" };
  if (!isEmailDomainAllowed(user.email, options.allowedEmailDomains)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  try {
    // RLS により自分自身の行しか読めない
    const { data, error } = await supabase
      .from("app_users")
      .select("is_active")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !data || data.is_active !== true) return { ok: false, code: "FORBIDDEN" };
  } catch {
    return { ok: false, code: "FORBIDDEN" };
  }

  return { ok: true, user: { id: user.id, email: user.email } };
}
