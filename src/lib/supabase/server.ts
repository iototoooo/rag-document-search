import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getPublicSupabaseEnv } from "@/lib/config/env";

/**
 * リクエストユーザーの権限で動く Supabase クライアント（anon キー + ユーザー JWT）。
 * RLS が適用されるため、検索・文書取得は必ずこのクライアントで行う。
 */
export async function createUserSupabaseClient() {
  const env = getPublicSupabaseEnv();
  const cookieStore = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component からの呼び出しでは Cookie を書き込めない。
          // セッション更新は proxy.ts が担う。
        }
      },
    },
  });
}
