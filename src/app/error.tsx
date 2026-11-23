"use client";

/** 想定外のエラー時の画面（内部情報は表示しない）。 */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-xl font-bold">エラーが発生しました</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        時間をおいて再度お試しください。解決しない場合は管理者に連絡してください。
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        再読み込み
      </button>
    </main>
  );
}
