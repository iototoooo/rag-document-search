/**
 * ログイン後のリダイレクト先を検証する（オープンリダイレクト対策）。
 * 許可するのは "/" で始まるサイト内の相対パスのみ。
 * "//evil.example"（プロトコル相対 URL）や "/\evil"（ブラウザが // と解釈しうる）、
 * 制御文字を含むもの、/login 自身は既定値 "/" に置き換える。
 */
export function sanitizeRedirectPath(input: unknown, fallback = "/"): string {
  if (typeof input !== "string") return fallback;
  const value = input.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // 制御文字・バックスラッシュを含むパスは拒否
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  try {
    // 同一オリジンとして解決できることを確認
    const base = "http://localhost";
    const url = new URL(value, base);
    if (url.origin !== base) return fallback;
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
