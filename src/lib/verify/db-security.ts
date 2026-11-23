/**
 * 実 DB のセキュリティ検証（読み取り専用）の判定ヘルパー。
 * 値（キー・本文・ID）は出力せず、件数と判定だけを返す。
 */

export type VerifyStatus = "ok" | "ng" | "skip";
export type VerifyResult = { group: string; name: string; status: VerifyStatus; detail: string };

/** PostgREST / Postgres の「権限なし」エラーか（42501 = insufficient_privilege）。 */
export function isPermissionDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  if (e.code === "42501") return true;
  return typeof e.message === "string" && /permission denied/i.test(e.message);
}

/** エラーを「コード: 短い説明」だけにする（本文・値を含めない）。 */
export function describeError(error: unknown): string {
  if (!error || typeof error !== "object") return "エラーなし";
  const e = error as { code?: unknown; status?: unknown; statusCode?: unknown; name?: unknown };
  const parts = [e.code, e.status ?? e.statusCode, e.name].filter(
    (x) => typeof x === "string" || typeof x === "number",
  );
  return parts.length ? parts.join(" / ") : "エラー";
}

/** 1536 次元のゼロベクトル（pgvector のテキスト表現）。権限確認用の無意味な検索に使う。 */
export function zeroVectorLiteral(dimensions = 1536): string {
  return `[${new Array(dimensions).fill(0).join(",")}]`;
}

export function formatVerifyReport(results: VerifyResult[]): string {
  const mark = { ok: "OK  ", ng: "NG  ", skip: "SKIP" } as const;
  const lines: string[] = [];
  let group = "";
  for (const r of results) {
    if (r.group !== group) {
      group = r.group;
      lines.push("", `## ${group}`);
    }
    lines.push(`[${mark[r.status]}] ${r.name}: ${r.detail}`);
  }
  const ng = results.filter((r) => r.status === "ng").length;
  const ok = results.filter((r) => r.status === "ok").length;
  const skip = results.filter((r) => r.status === "skip").length;
  lines.push("", `結果: OK ${ok} / NG ${ng} / SKIP ${skip}`);
  return lines.join("\n");
}
