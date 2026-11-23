/**
 * 安全なログ出力。質問文・文書本文・API キー・トークンを出力しないよう、
 * エラーは種類（name / status / code）のみ記録する。
 */
export function logError(context: string, error: unknown): void {
  console.error(`[${context}]`, summarizeError(error));
}

export function summarizeError(error: unknown): Record<string, string | number> {
  if (error && typeof error === "object") {
    const e = error as { name?: unknown; status?: unknown; code?: unknown };
    const out: Record<string, string | number> = {};
    if (typeof e.name === "string") out.name = e.name;
    if (typeof e.status === "number") out.status = e.status;
    if (typeof e.code === "string" || typeof e.code === "number") out.code = e.code;
    return Object.keys(out).length ? out : { name: "UnknownError" };
  }
  return { name: typeof error };
}

/**
 * 計測値（数値・列挙値のみ）を 1 行の JSON で出力する。
 * 文字列は短い識別子だけを許可し、質問文や本文が紛れ込まないよう長い文字列は捨てる。
 */
export function logMetric(context: string, values: Record<string, unknown>): void {
  console.info(`[metric:${context}]`, JSON.stringify(sanitizeMetric(values)));
}

export function sanitizeMetric(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string" && /^[a-z_]{1,32}$/.test(v)) out[k] = v;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = sanitizeMetric(v as Record<string, unknown>);
      if (Object.keys(nested).length) out[k] = nested;
    }
  }
  return out;
}
