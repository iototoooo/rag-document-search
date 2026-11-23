import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** Vercel の設定ファイルとルート設定の静的検査（外部通信なし）。 */
const root = path.resolve(__dirname, "..", "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("vercel.json", () => {
  const config = JSON.parse(read("vercel.json")) as Record<string, unknown>;

  it("サーバー処理を東京リージョン（hnd1）だけで実行する（Supabase 東京との往復を短くする）", () => {
    expect(config.regions).toEqual(["hnd1"]);
  });

  it("環境変数や秘密の値を含めない（環境変数は Vercel の管理画面でのみ設定する）", () => {
    expect(config).not.toHaveProperty("env");
    expect(config).not.toHaveProperty("build");
    expect(read("vercel.json")).not.toMatch(/KEY|SECRET|PASSWORD|TOKEN|sb_|sk-|eyJ/i);
  });
});

describe("/api/chat のルート設定", () => {
  it("maxDuration を 60 秒に制限している（応答が返らない場合の課金を抑える）", () => {
    expect(read("src/app/api/chat/route.ts")).toMatch(/^export const maxDuration = 60;$/m);
  });

  it("非推奨の preferredRegion / edge runtime を使わない（リージョンは vercel.json で指定）", () => {
    for (const p of ["src/app/api/chat/route.ts", "src/app/api/documents/[documentId]/file/route.ts", "src/app/layout.tsx"]) {
      const s = read(p);
      expect(s).not.toMatch(/export const preferredRegion/);
      expect(s).not.toMatch(/export const runtime\s*=\s*["']edge["']/);
    }
  });
});
