import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/LoginForm";
import { sanitizeRedirectPath } from "@/lib/ui/redirect";

export const metadata: Metadata = { title: "ログイン | 社内文書検索AI" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-10">
      <h1 className="mb-2 text-2xl font-bold">ログイン</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        社内アカウントでログインしてください。アカウントの発行は管理者に依頼してください。
      </p>
      <Suspense fallback={<LoginForm next="/" />}>
        <LoginFormWithNext searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function LoginFormWithNext({
  searchParams,
}: {
  searchParams: PageProps<"/login">["searchParams"];
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.next) ? params.next[0] : params.next;
  return <LoginForm next={sanitizeRedirectPath(raw)} />;
}
