import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { decideProxyAction } from "@/lib/ui/proxy-rules";

/**
 * Supabase セッション Cookie の更新と、未ログイン時のページリダイレクト（楽観的チェック）。
 * 認可の最終判断はページ・Route Handler の authorizeUser() で行う。
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  let isAuthenticated = false;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          for (const [key, value] of Object.entries(headers ?? {})) {
            response.headers.set(key, value);
          }
        },
      },
    });
    try {
      // getUser() は Supabase Auth に JWT を問い合わせて検証し、必要ならトークンを更新する
      const { data } = await supabase.auth.getUser();
      isAuthenticated = Boolean(data.user);
    } catch {
      isAuthenticated = false;
    }
  }

  const decision = decideProxyAction({
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    isAuthenticated,
  });

  if (decision.action === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.location, request.url));
    // 更新済みの Cookie を引き継ぐ
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // 静的ファイル・画像最適化・favicon・拡張子付きファイルは除外
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
