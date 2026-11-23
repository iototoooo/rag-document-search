import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getServiceRoleEnv } from "@/lib/config/env";

/**
 * service_role クライアント。RLS を迂回するため、取り込み CLI 等の
 * 管理処理からのみ使用する。リクエスト処理（検索・チャット・PDF 配信）では使用禁止。
 */
export function createAdminSupabaseClient() {
  const env = getServiceRoleEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
