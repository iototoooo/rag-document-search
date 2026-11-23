/**
 * .env.local の Supabase 接続設定を点検する（外部通信なし・値は表示しない）。
 *
 *   npm run env:check
 *
 * 終了コード: NG があれば 1、なければ 0。
 */
import { checkSupabaseEnv, formatCheckReport } from "@/lib/config/env-check";

try {
  process.loadEnvFile(".env.local");
} catch {
  console.error(".env.local が見つかりません。Copy-Item .env.example .env.local で作成してください。");
  process.exit(1);
}

const items = checkSupabaseEnv(process.env);
console.log(formatCheckReport(items));
process.exit(items.some((i) => i.level === "error") ? 1 : 0);
