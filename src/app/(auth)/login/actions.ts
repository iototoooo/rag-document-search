"use server";

import { redirect } from "next/navigation";
import { logError } from "@/lib/observability/log";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { authorizeWithSupabase } from "@/lib/auth/server";
import { LOGIN_UNAVAILABLE_MESSAGE, performLogin, type LoginState } from "@/lib/ui/login";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  let supabase: Awaited<ReturnType<typeof createUserSupabaseClient>>;
  try {
    supabase = await createUserSupabaseClient();
  } catch (error) {
    logError("auth.login.client", error);
    return { error: LOGIN_UNAVAILABLE_MESSAGE };
  }

  const outcome = await performLogin(
    {
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        return { error };
      },
      authorize: () => authorizeWithSupabase(supabase),
      async signOut() {
        await supabase.auth.signOut();
      },
    },
    {
      email: formData.get("email"),
      password: formData.get("password"),
      next: formData.get("next"),
    },
  );

  if (!outcome.ok) return outcome.state;
  // redirect は try ブロックの外で呼ぶ（NEXT_REDIRECT を投げるため）
  redirect(outcome.redirectTo);
}
