import type { NextConfig } from "next";
import { assertSafeDeployEnv } from "./src/lib/config/deploy-guard";

// Vercel 上のビルドでは、service_role キー等の管理者用の値が設定されていたら中止する
assertSafeDeployEnv();

/** 全レスポンス共通のセキュリティヘッダー（ルート個別のヘッダーは各 Route Handler で追加） */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 出典 PDF ルートの frame-ancestors 'self' と矛盾しないよう SAMEORIGIN
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  // 社内向けのため、ページ以外（API・出典 PDF）も検索エンジンの索引対象から外す
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
