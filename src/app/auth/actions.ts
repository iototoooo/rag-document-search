"use server";

import { redirect } from "next/navigation";
import { logError } from "@/lib/observability/log";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/** ログアウト（POST の Server Action のみ。GET では実行しない）。 */
export async function logoutAction(): Promise<void> {
  try {
    const supabase = await createUserSupabaseClient();
    await supabase.auth.signOut();
  } catch (error) {
    logError("auth.logout", error);
  }
  redirect("/login");
}
