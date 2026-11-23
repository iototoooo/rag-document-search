import "server-only";
import { authorizeUser, type AuthCapableClient, type AuthorizationResult } from "@/lib/auth/authorize";
import { getAuthConfig } from "@/lib/config/env";
import type { createUserSupabaseClient } from "@/lib/supabase/server";

type UserSupabaseClient = Awaited<ReturnType<typeof createUserSupabaseClient>>;

/**
 * SupabaseClient を authorizeUser に渡すためのアダプタ。
 * SupabaseClient の複雑なジェネリクスを AuthCapableClient と構造比較させると
 * TS2589（型展開が深すぎる）になるため、ここで一度だけ unknown 経由で変換する。
 * 実行時に使うのは auth.getUser() と from("app_users").select().eq().maybeSingle() のみ。
 */
export function authorizeWithSupabase(supabase: UserSupabaseClient): Promise<AuthorizationResult> {
  return authorizeUser(supabase as unknown as AuthCapableClient, getAuthConfig());
}
