import type { ChatResponse } from "@/lib/contracts/api";
import type {
  AnswerGenerator,
  ChunkSearcher,
  EmbeddingProvider,
  SearchOptions,
  TokenUsage,
} from "@/lib/contracts/ports";
import { estimateClaudeCostUsd } from "@/lib/config/env";
import type { RetrievedChunk } from "@/lib/contracts/types";
import type { TestQuestion } from "@/lib/documents/csv";
import { normalizeText } from "@/lib/documents/normalize";
import { InMemoryDocumentRepository, InMemoryFileStorage } from "@/lib/ingest/memory";
import { ingestDocument, toSourceKey } from "@/lib/ingest/pipeline";
import { answerQuestion, type AnswerMetrics } from "@/lib/search/answer-service";
import { extractKeyFacts, missingFacts } from "./facts";
import { InMemoryRlsSearcher } from "./memory-searcher";

/**
 * 精度検証ランナー。
 * - mode "mock": モック Embedding・モック回答生成（外部通信なし）。検索ヒット率と配線のみ測定し、
 *   正答率・応答時間は「測定対象外」とする（実 API の結果と混同しないため null を記録）。
 * - mode "live": 実 Embedding・実 Claude を使用（課金あり。CLI で --live --execute 指定時のみ）。
 * どちらも DB は使わずインメモリ索引で評価する（RLS・ネットワーク遅延は含まない）。
 */

export type EvalMode = "mock" | "live";

export type QuestionResult = {
  id: number;
  question: string;
  kind: string;
  expectsAnswer: boolean;
  expectedSources: string[];
  /** 検索上位に入った文書（sourceKey、重複除去・順位順） */
  retrievedSources: string[];
  /** 該当あり: 期待文書が検索上位に入ったか。該当なし: null */
  retrievalHit: boolean | null;
  found: boolean | null;
  answer: string | null;
  citations: Array<{ fileName: string; pageNumber: number; section: string | null }>;
  /** 出典のうち期待文書由来の割合（出典なしは null） */
  citationAccuracy: number | null;
  /** 出典のセクションが期待セクションと一致したか（判定不能は null） */
  sectionMatch: boolean | null;
  facts: string[][];
  missingFacts: string[][] | null;
  /** 正答判定（mock は null = 測定対象外） */
  correct: boolean | null;
  latencyMs: number | null;
  /** 応答時間の内訳（ms）。LLM を呼ばなかった場合 generateMs は null */
  stages: { embedMs: number; searchMs: number | null; generateMs: number | null } | null;
  /** Claude のトークン使用量（mock・未呼び出しは null） */
  usage: TokenUsage | null;
  error: string | null;
};

export type EvalSummary = {
  mode: EvalMode;
  startedAt: string;
  model: string;
  embeddingModel: string;
  rag: SearchOptions;
  documents: number;
  chunks: number;
  total: number;
  answerable: number;
  correctCount: number | null;
  accuracy: number | null;
  retrievalHitRate: number | null;
  citationAccuracy: number | null;
  notFoundCorrect: { correct: number; total: number } | null;
  latencyMs: { p50: number; p95: number; max: number } | null;
  /** 応答時間の内訳の平均（ms） */
  stageAvgMs: { embed: number; search: number; generate: number } | null;
  /** Claude のトークン合計と推定費用（料金表にないモデル・mock は cost null） */
  tokens: { calls: number; input: number; output: number; estimatedCostUsd: number | null } | null;
  targets: { accuracy80: boolean | null; latency5s: boolean | null };
  errors: number;
};

export type EvalReport = { summary: EvalSummary; results: QuestionResult[] };

export const TARGET_ACCURACY = 0.8;
export const TARGET_LATENCY_MS = 5000;

const NO_SOURCE = /記載なし/;

export function expectedSourcesOf(q: TestQuestion): string[] {
  if (NO_SOURCE.test(q.sourceDocument)) return [];
  return q.sourceDocument
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function expectsAnswer(q: TestQuestion): boolean {
  return q.kind.startsWith("該当あり");
}

/** "第2章 宿泊費・日当" / "5. 駐車場の利用" → 見出しの本文部分（番号を除く） */
export function sectionTitles(section: string): string[] {
  if (NO_SOURCE.test(section)) return [];
  return section
    .split("/")
    .map((s) =>
      normalizeText(s)
        .replace(/^第[0-9一二三四五六七八九十]+章\s*/, "")
        .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
        .replace(/\s+/g, ""),
    )
    .filter(Boolean);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** 検索結果を記録するラッパー（answerQuestion と同じ検索結果を採点に使う）。 */
class RecordingSearcher implements ChunkSearcher {
  last: RetrievedChunk[] = [];
  constructor(private readonly inner: ChunkSearcher) {}
  async search(embedding: number[], options: SearchOptions) {
    this.last = await this.inner.search(embedding, options);
    return this.last;
  }
}

/** mock モード用: 1 番目の資料を引用するだけの回答生成（回答内容は採点しない）。 */
export class MockEvalGenerator implements AnswerGenerator {
  async generate(input: Parameters<AnswerGenerator["generate"]>[0]) {
    return {
      status: "answered" as const,
      answer: `（モック回答）[${input.sources[0].id}]`,
      citedSourceIds: [input.sources[0].id],
    };
  }
}

export async function runEvaluation(opts: {
  mode: EvalMode;
  pdfFiles: Array<{ fileName: string; data: Uint8Array }>;
  questions: TestQuestion[];
  embedder: EmbeddingProvider;
  generator: AnswerGenerator;
  rag: SearchOptions;
  model: string;
  only?: number[];
  now?: () => number;
  onProgress?: (r: QuestionResult) => void;
}): Promise<EvalReport> {
  const now = opts.now ?? (() => performance.now());
  const startedAt = new Date().toISOString();

  // 1. インメモリ索引の構築（評価では全文書を internal として扱う）
  const repo = new InMemoryDocumentRepository();
  const storage = new InMemoryFileStorage();
  for (const f of opts.pdfFiles) {
    await ingestDocument(
      { fileName: f.fileName, data: f.data, visibility: "internal" },
      { embedder: opts.embedder, repo, storage },
    );
  }
  const searcher = new RecordingSearcher(new InMemoryRlsSearcher(repo));
  const fileToSource = new Map(
    [...repo.documents.values()].map((d) => [d.fileName, d.sourceKey] as const),
  );

  // 2. 各質問の実行と採点
  const targets = opts.only?.length
    ? opts.questions.filter((q) => opts.only!.includes(q.id))
    : opts.questions;
  const results: QuestionResult[] = [];

  for (const q of targets) {
    const expected = expectedSourcesOf(q);
    const answerable = expectsAnswer(q);
    const facts = answerable ? extractKeyFacts(q.expectedAnswer) : [];
    searcher.last = [];

    let response: ChatResponse | null = null;
    let error: string | null = null;
    let metrics: AnswerMetrics | null = null;
    const t0 = now();
    try {
      response = await answerQuestion(q.question, {
        embedder: opts.embedder,
        searcher,
        generator: opts.generator,
        rag: opts.rag,
        onMetrics: (m) => {
          metrics = m;
        },
      });
    } catch (e) {
      error = e instanceof Error ? e.name : "UnknownError";
    }
    const elapsed = now() - t0;

    const retrievedSources = [...new Set(searcher.last.map((c) => toSourceKey(c.fileName)))];
    const retrievalHit = answerable
      ? retrievedSources.some((s) => expected.includes(s))
      : null;

    const citations = (response?.citations ?? []).map((c) => ({
      fileName: c.fileName,
      pageNumber: c.pageNumber,
      section: c.section,
    }));
    const citedSources = citations.map((c) => fileToSource.get(c.fileName) ?? toSourceKey(c.fileName));
    const citationAccuracy =
      answerable && citations.length > 0
        ? citedSources.filter((s) => expected.includes(s)).length / citations.length
        : null;

    const titles = sectionTitles(q.sourceSection);
    const sectionMatch =
      answerable && titles.length > 0 && citations.length > 0
        ? citations.some((c) => {
            const sec = normalizeText(c.section ?? "").replace(/\s+/g, "");
            return titles.some((t) => sec.includes(t));
          })
        : null;

    let correct: boolean | null = null;
    let missing: string[][] | null = null;
    if (opts.mode === "live") {
      if (error || !response) {
        correct = false;
      } else if (answerable) {
        missing = missingFacts(response.answer, facts);
        correct =
          response.found &&
          missing.length === 0 &&
          citedSources.some((s) => expected.includes(s));
      } else {
        correct = !response.found && response.citations.length === 0;
      }
    }

    const r: QuestionResult = {
      id: q.id,
      question: q.question,
      kind: q.kind,
      expectsAnswer: answerable,
      expectedSources: expected,
      retrievedSources,
      retrievalHit,
      found: response?.found ?? null,
      answer: response?.answer ?? null,
      citations,
      citationAccuracy,
      sectionMatch,
      facts,
      missingFacts: missing,
      correct,
      latencyMs: opts.mode === "live" ? Math.round(elapsed) : null,
      stages:
        opts.mode === "live" && metrics
          ? {
              embedMs: (metrics as AnswerMetrics).embedMs,
              searchMs: (metrics as AnswerMetrics).searchMs,
              generateMs: (metrics as AnswerMetrics).generateMs,
            }
          : null,
      usage: opts.mode === "live" && metrics ? (metrics as AnswerMetrics).usage : null,
      error,
    };
    results.push(r);
    opts.onProgress?.(r);
  }

  return { summary: summarize(opts, results, startedAt, repo), results };
}

function summarize(
  opts: { mode: EvalMode; model: string; embedder: EmbeddingProvider; rag: SearchOptions },
  results: QuestionResult[],
  startedAt: string,
  repo: InMemoryDocumentRepository,
): EvalSummary {
  const answerable = results.filter((r) => r.expectsAnswer);
  const notFound = results.filter((r) => !r.expectsAnswer);
  const hits = answerable.filter((r) => r.retrievalHit).length;
  const citAcc = answerable
    .map((r) => r.citationAccuracy)
    .filter((v): v is number => v !== null);

  const live = opts.mode === "live";
  const correctCount = live ? results.filter((r) => r.correct).length : null;
  const accuracy = live && results.length ? correctCount! / results.length : null;
  const latencies = results
    .map((r) => r.latencyMs)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  const latencyMs =
    live && latencies.length
      ? {
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
          max: latencies[latencies.length - 1],
        }
      : null;

  return {
    mode: opts.mode,
    startedAt,
    model: opts.model,
    embeddingModel: opts.embedder.model,
    rag: opts.rag,
    documents: repo.documents.size,
    chunks: repo.chunks.size,
    total: results.length,
    answerable: answerable.length,
    correctCount,
    accuracy,
    retrievalHitRate: answerable.length ? hits / answerable.length : null,
    citationAccuracy: citAcc.length ? citAcc.reduce((a, b) => a + b, 0) / citAcc.length : null,
    notFoundCorrect:
      live && notFound.length
        ? { correct: notFound.filter((r) => r.correct).length, total: notFound.length }
        : null,
    latencyMs,
    targets: {
      accuracy80: accuracy === null ? null : accuracy >= TARGET_ACCURACY,
      latency5s: latencyMs === null ? null : latencyMs.p95 <= TARGET_LATENCY_MS,
    },
    stageAvgMs: live ? averageStages(results) : null,
    tokens: live ? totalTokens(opts.model, results) : null,
    errors: results.filter((r) => r.error).length,
  };
}

function averageStages(results: QuestionResult[]): EvalSummary["stageAvgMs"] {
  const avg = (xs: Array<number | null | undefined>) => {
    const v = xs.filter((x): x is number => typeof x === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0;
  };
  const s = results.map((r) => r.stages).filter((x) => x !== null);
  if (s.length === 0) return null;
  return {
    embed: avg(s.map((x) => x.embedMs)),
    search: avg(s.map((x) => x.searchMs)),
    generate: avg(s.map((x) => x.generateMs)),
  };
}

/** モデル名表記（"claude-opus-5-5（effort=...）"）から料金表のキーを取り出して費用を推定する。 */
function totalTokens(model: string, results: QuestionResult[]): EvalSummary["tokens"] {
  const used = results.map((r) => r.usage).filter((u): u is TokenUsage => u !== null);
  const input = used.reduce((a, u) => a + u.inputTokens, 0);
  const output = used.reduce((a, u) => a + u.outputTokens, 0);
  const modelId = model.split(/[（(\s]/)[0];
  return {
    calls: used.length,
    input,
    output,
    estimatedCostUsd: estimateClaudeCostUsd(modelId, { inputTokens: input, outputTokens: output }),
  };
}
