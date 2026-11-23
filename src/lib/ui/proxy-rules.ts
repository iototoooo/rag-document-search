/**
 * proxy.ts の判定ロジック（楽観的チェックのみ）。
 * 最終的な認証・認可は各ページ / Route Handler の authorizeUser() で行う。
 */

export type ProxyDecision =
  | { action: "next" }
  | { action: "redirect"; location: string };

/** ログイン不要で表示できるページ。 */
const PUBLIC_PAGE_PREFIXES = ["/login"];

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isPublicPage(pathname: string): boolean {
  return PUBLIC_PAGE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function decideProxyAction(input: {
  pathname: string;
  search: string;
  isAuthenticated: boolean;
}): ProxyDecision {
  // API はリダイレクトしない（API 自身が 401 / 403 を JSON で返す）
  if (isApiPath(input.pathname)) return { action: "next" };
  if (isPublicPage(input.pathname)) return { action: "next" };
  if (input.isAuthenticated) return { action: "next" };

  const next = `${input.pathname}${input.search}`;
  const location =
    next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
  return { action: "redirect", location };
}
