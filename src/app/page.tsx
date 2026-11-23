import { redirect, unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { logError } from "@/lib/observability/log";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { authorizeWithSupabase } from "@/lib/auth/server";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <Suspense fallback={<PageLoading />}>
        <ChatGate />
      </Suspense>
    </main>
  );
}

type GateResult = "ok" | "unauthenticated" | "forbidden" | "error";

async function checkAccess(): Promise<GateResult> {
  // 認可結果をビルド時に静的生成させない（必ずリクエスト時に判定する）
  await connection();
  try {
    const supabase = await createUserSupabaseClient();
    const result = await authorizeWithSupabase(supabase);
    if (result.ok) return "ok";
    return result.code === "UNAUTHENTICATED" ? "unauthenticated" : "forbidden";
  } catch (error) {
    // Next.js 内部の制御用エラー（動的レンダリングへの切り替え等）は握りつぶさない
    unstable_rethrow(error);
    logError("page.chat.authorize", error);
    return "error";
  }
}

/** サーバー側で認証・認可を確認してからチャット画面を表示する。 */
async function ChatGate() {
  const access = await checkAccess();
  // redirect は try の外で呼ぶ
  if (access === "unauthenticated") redirect("/login");
  if (access === "forbidden") return <Forbidden />;
  if (access === "error") return <ServiceError />;
  return <ChatPanel />;
}

function PageLoading() {
  return (
    <p className="py-10 text-center text-sm text-zinc-500" role="status">
      読み込み中…
    </p>
  );
}

function Forbidden() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-bold">利用権限がありません</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        このアカウントでは社内文書検索AIを利用できません。管理者に連絡してください。
      </p>
      <LogoutButton />
    </section>
  );
}

function ServiceError() {
  return (
    <section className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-bold">現在ご利用いただけません</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        時間をおいて再度アクセスしてください。解決しない場合は管理者に連絡してください。
      </p>
    </section>
  );
}
