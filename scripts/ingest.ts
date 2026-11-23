/**
 * 文書取り込み CLI
 *
 *   npm run ingest                      # ドライラン（既定）: 外部通信なし、統計のみ表示
 *   npm run ingest -- --dir samples/pdf # 対象ディレクトリ指定
 *   npm run ingest -- --execute         # 実行: OpenAI Embeddings API（有料）+ Supabase へ保存
 *
 * --execute は文書本文を OpenAI に送信し、Supabase（service_role）へ書き込む。
 * 実行前に .env.local の接続先とコストを必ず確認すること。
 */
import {
  createDryRunDeps,
  formatSummary,
  listPdfFiles,
  parseCliArgs,
  runIngest,
} from "@/lib/ingest/cli";
import type { IngestDeps } from "@/lib/ingest/pipeline";
import { DB_EMBEDDING_DIMENSIONS } from "@/lib/ingest/pipeline";

function loadEnvLocal() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local がなければ環境変数のみを使う
  }
}

async function createLiveDeps(): Promise<IngestDeps> {
  // "server-only" を含むモジュールは --conditions=react-server 指定時のみ読み込める（npm script で指定済み）
  const { getEmbeddingEnv, getServiceRoleEnv } = await import("@/lib/config/env");
  const { createAdminSupabaseClient } = await import("@/lib/supabase/admin");
  const { OpenAIEmbeddingProvider } = await import("@/lib/embeddings/openai");
  const { SupabaseDocumentRepository, SupabaseDocumentStorage } = await import(
    "@/lib/ingest/supabase-repository"
  );

  const supa = getServiceRoleEnv();
  const emb = getEmbeddingEnv();
  if (emb.EMBEDDING_DIMENSIONS !== DB_EMBEDDING_DIMENSIONS) {
    throw new Error(`EMBEDDING_DIMENSIONS は DB と同じ ${DB_EMBEDDING_DIMENSIONS} にしてください`);
  }
  console.log(`接続先 Supabase: ${new URL(supa.NEXT_PUBLIC_SUPABASE_URL).host}`);
  console.log(`Embedding モデル: ${emb.EMBEDDING_MODEL}（有料 API を呼び出します）`);

  const admin = createAdminSupabaseClient();
  return {
    embedder: new OpenAIEmbeddingProvider({
      apiKey: emb.OPENAI_API_KEY,
      model: emb.EMBEDDING_MODEL,
      dimensions: emb.EMBEDDING_DIMENSIONS,
      maxRetries: emb.OPENAI_MAX_RETRIES,
    }),
    repo: new SupabaseDocumentRepository(admin),
    storage: new SupabaseDocumentStorage(admin),
    logger: (msg, meta) => console.log(`  ${msg}`, meta ?? ""),
  };
}

async function main() {
  const opts = parseCliArgs(process.argv.slice(2));
  const files = listPdfFiles(opts.dir);
  if (files.length === 0) {
    console.log("PDF が見つかりません");
    return;
  }

  let deps: IngestDeps;
  if (opts.execute) {
    loadEnvLocal();
    deps = await createLiveDeps();
  } else {
    console.log("[ドライラン] モック Embedding・インメモリ保存で実行します（外部通信なし）");
    deps = createDryRunDeps();
  }

  const rows = await runIngest(files, deps);
  console.log(formatSummary(rows));
  if (rows.some((r) => r.status === "error")) process.exitCode = 1;
}

main().catch((e: unknown) => {
  // 設定エラー等。メッセージはキー名のみを含む設計（値は含まない）
  console.error(e instanceof Error ? e.message : "取り込みに失敗しました");
  process.exitCode = 1;
});
