"use client";
import { createBrowserClient } from "@supabase/ssr";

/** ブラウザ用クライアント（anon キーのみ。service_role は絶対に渡さない）。 */
export function createBrowserSupabaseClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
