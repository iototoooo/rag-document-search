import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/**
 * ヘッダーのユーザーメニュー。ログイン中のみログアウトボタンを表示する。
 * 表示用のみで、認可の判断には使わない。
 */
export async function UserMenu() {
  await connection();
  let loggedIn = false;
  try {
    const supabase = await createUserSupabaseClient();
    const { data } = await supabase.auth.getUser();
    loggedIn = Boolean(data.user);
  } catch (error) {
    unstable_rethrow(error);
    loggedIn = false;
  }
  if (!loggedIn) return null;
  return <LogoutButton />;
}
