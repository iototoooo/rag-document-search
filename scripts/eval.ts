/**
 * 精度検証 CLI（テスト質問 CSV 12 問）
 *
 *   npm run eval                               # モック（既定）: 外部通信なし。検索ヒット率・配線のみ
 *   npm run eval -- --only 11,12               # 指定した質問だけ（例: 文書に記載のない 2 問）
 *   npm run eval -- --live --execute           # 実 API（OpenAI Embedding + Claude）: 課金あり
 *   npm run eval -- --live --execute --only 11,12
 *
 * 結果は reports/eval/ に Markdown と JSON で保存する（.gitignore 対象）。
 * 実 API モードは文書本文と質問を OpenAI / Anthropic に送信する。学習用ダミー文書でのみ使うこと。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AnswerGenerator, EmbeddingProvider, SearchOptions } from "@/lib/contracts/ports";
import { parseTestQuestions } from "@/lib/documents/csv";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { toMarkdown } from "@/lib/eval/report";
import { MockEvalGenerator, runEvaluation, type EvalMode } from "@/lib/eval/runner";

type Args = {
  live: boolean;
  execute: boolean;
  only: number[];
  pdfDir: string;
  csv: string;
  outDir: string;
  threshold?: number;
  count?: number;
};

function parseArgs(argv: string[]): Args {
  const a: Args = {
    live: false,
    execute: false,
    only: [],
    pdfDir: path.join("samples", "pdf"),
    csv: path.join("samples", "questions", "test-questions.csv"),
    outDir: path.join("reports", "eval"),
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${k} の値がありません`);
      return next;
    };
    if (k === "--live") a.live = true;
    else if (k === "--execute") a.execute = true;
    else if (k === "--only") a.only = v().split(",").map((s) => Number(s.trim())).filter(Number.isInteger);
    else if (k === "--pdf-dir") a.pdfDir = v();
    else if (k === "--csv") a.csv = v();
    else if (k === "--out") a.outDir = v();
    else if (k === "--threshold") a.threshold = Number(v());
    else if (k === "--count") a.count = Number(v());
    else throw new Error(`不明なオプション: ${k}`);
  }
  return a;
}

async function createLive(): Promise<{
  embedder: EmbeddingProvider;
  generator: AnswerGenerator;
  rag: SearchOptions;
  model: string;
}> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local がなければ環境変数のみ
  }
  const { getAnthropicEnv, getEmbeddingEnv, getRagConfig } = await import("@/lib/config/env");
  const { OpenAIEmbeddingProvider } = await import("@/lib/embeddings/openai");
  const { ClaudeAnswerGenerator } = await import("@/lib/answer/claude-generator");
  const emb = getEmbeddingEnv();
  const ant = getAnthropicEnv();
  return {
    embedder: new OpenAIEmbeddingProvider({
      apiKey: emb.OPENAI_API_KEY,
      model: emb.EMBEDDING_MODEL,
      dimensions: emb.EMBEDDING_DIMENSIONS,
      maxRetries: emb.OPENAI_MAX_RETRIES,
    }),
    generator: new ClaudeAnswerGenerator({
      apiKey: ant.ANTHROPIC_API_KEY,
      model: ant.ANTHROPIC_MODEL,
      effort: ant.ANTHROPIC_EFFORT,
      maxTokens: ant.ANTHROPIC_MAX_TOKENS,
      maxRetries: ant.ANTHROPIC_MAX_RETRIES,
      timeoutMs: ant.ANTHROPIC_TIMEOUT_MS,
      serverFallback: ant.ANTHROPIC_SERVER_FALLBACK,
    }),
    rag: getRagConfig(),
    model: `${ant.ANTHROPIC_MODEL}（effort=${ant.ANTHROPIC_EFFORT}, fallback=${ant.ANTHROPIC_SERVER_FALLBACK ? "on" : "off"}）`,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.live && !args.execute) {
    throw new Error("実 API で評価するには --live と --execute の両方を指定してください（課金が発生します）");
  }
  if (!existsSync(args.pdfDir) || !existsSync(args.csv)) {
    throw new Error("samples/ が見つかりません（PDF と CSV を README の構成で配置してください）");
  }

  const mode: EvalMode = args.live ? "live" : "mock";
  const pdfFiles = readdirSync(args.pdfDir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .sort()
    .map((f) => ({ fileName: f, data: new Uint8Array(readFileSync(path.join(args.pdfDir, f))) }));
  const questions = parseTestQuestions(readFileSync(args.csv, "utf8"));

  const deps =
    mode === "live"
      ? await createLive()
      : {
          embedder: new MockEmbeddingProvider(1536) as EmbeddingProvider,
          generator: new MockEvalGenerator() as AnswerGenerator,
          // モック Embedding は類似度の尺度が実モデルと異なるため、しきい値 0 で上位件数のみ評価する
          rag: { threshold: 0, count: 6 },
          model: "mock",
        };
  const rag = {
    threshold: args.threshold ?? deps.rag.threshold,
    count: args.count ?? deps.rag.count,
  };

  console.log(
    mode === "live"
      ? `[実API] ${deps.model} で ${args.only.length || questions.length} 問を評価します（課金あり）`
      : "[モック] 外部通信なしで評価します（正答率・応答時間は測定対象外）",
  );

  const report = await runEvaluation({
    mode,
    pdfFiles,
    questions,
    embedder: deps.embedder,
    generator: deps.generator,
    rag,
    model: deps.model,
    only: args.only,
    onProgress: (r) =>
      console.log(
        `  Q${r.id}: 検索=${r.retrievalHit === null ? "-" : r.retrievalHit ? "○" : "×"} 正答=${r.correct === null ? "-" : r.correct ? "○" : "×"}${r.latencyMs !== null ? ` ${r.latencyMs}ms` : ""}${r.stages ? `（E${r.stages.embedMs}/S${r.stages.searchMs ?? "-"}/G${r.stages.generateMs ?? "-"}）` : ""}${r.usage ? ` tok=${r.usage.inputTokens}/${r.usage.outputTokens}` : ""}${r.error ? ` エラー=${r.error}` : ""}`,
      ),
  });

  mkdirSync(args.outDir, { recursive: true });
  const stamp = report.summary.startedAt.replace(/[:.]/g, "-");
  const base = path.join(args.outDir, `${stamp}-${mode}`);
  writeFileSync(`${base}.md`, toMarkdown(report), "utf8");
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), "utf8");

  const s = report.summary;
  console.log("");
  console.log(`正答率: ${s.accuracy === null ? "測定対象外（モック）" : `${(s.accuracy * 100).toFixed(1)}%`}`);
  console.log(`検索ヒット率: ${s.retrievalHitRate === null ? "-" : `${(s.retrievalHitRate * 100).toFixed(1)}%`}`);
  if (s.latencyMs) console.log(`応答時間 p50/p95/max: ${s.latencyMs.p50}/${s.latencyMs.p95}/${s.latencyMs.max} ms`);
  if (s.stageAvgMs) {
    console.log(`内訳の平均 Embedding/検索/回答生成: ${s.stageAvgMs.embed}/${s.stageAvgMs.search}/${s.stageAvgMs.generate} ms`);
  }
  if (s.tokens) {
    const cost = s.tokens.estimatedCostUsd === null ? "料金表なし" : `約 $${s.tokens.estimatedCostUsd.toFixed(4)}`;
    console.log(`Claude トークン: ${s.tokens.calls} 回・入力 ${s.tokens.input}・出力 ${s.tokens.output}（推定 ${cost}）`);
  }
  console.log(`保存先: ${base}.md`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "評価に失敗しました");
  process.exitCode = 1;
});
