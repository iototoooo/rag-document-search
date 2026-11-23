import type { ChatResponse } from "@/lib/contracts/api";
import type {
  AnswerGenerator,
  ChunkSearcher,
  EmbeddingProvider,
  TokenUsage,
} from "@/lib/contracts/ports";
import { NOT_FOUND_MESSAGE } from "@/lib/contracts/types";
import { buildCitations, numberSources, toPromptSources } from "@/lib/answer/citations";

/**
 * 1 回の回答処理の計測値（応答時間の内訳・費用集計用）。
 * 質問文・資料・回答は含めない（ログに出しても安全な値のみ）。
 */
export type AnswerMetrics = {
  embedMs: number;
  searchMs: number | null;
  /** LLM を呼ばなかった場合（検索 0 件など）は null */
  generateMs: number | null;
  chunkCount: number;
  usage: TokenUsage | null;
  outcome: "answered" | "not_found" | "refused" | "no_sources" | "invalid_citations" | "error";
};

export type AnswerDeps = {
  embedder: EmbeddingProvider;
  searcher: ChunkSearcher;
  generator: AnswerGenerator;
  rag: { threshold: number; count: number };
  /** 計測値の受け取り（任意）。例外時も計測済みの範囲で呼ばれる */
  onMetrics?: (m: AnswerMetrics) => void;
  now?: () => number;
};

export function notFound(): ChatResponse {
  return { answer: NOT_FOUND_MESSAGE, found: false, citations: [] };
}

/**
 * 質問 → Embedding → 検索（RLS 適用済み）→ 回答生成 → 出典検証。
 * 根拠がない場合は LLM を呼ばずに「該当する情報が見つかりません」を返す。
 */
export async function answerQuestion(question: string, deps: AnswerDeps): Promise<ChatResponse> {
  const now = deps.now ?? (() => performance.now());
  const m: AnswerMetrics = {
    embedMs: 0,
    searchMs: null,
    generateMs: null,
    chunkCount: 0,
    usage: null,
    outcome: "error",
  };
  const round = (ms: number) => Math.round(ms);

  try {
    let t = now();
    const [embedding] = await deps.embedder.embed([question]);
    m.embedMs = round(now() - t);
    if (!embedding) {
      m.outcome = "no_sources";
      return notFound();
    }

    t = now();
    const chunks = await deps.searcher.search(embedding, deps.rag);
    m.searchMs = round(now() - t);
    m.chunkCount = chunks.length;
    if (chunks.length === 0) {
      m.outcome = "no_sources";
      return notFound();
    }

    const numbered = numberSources(chunks);
    t = now();
    const generated = await deps.generator.generate({
      question,
      sources: toPromptSources(numbered),
    });
    m.generateMs = round(now() - t);
    m.usage = generated.usage ?? null;

    // refusal・根拠なしはいずれも利用者には「見つかりません」として返す
    if (generated.status !== "answered") {
      m.outcome = generated.status;
      return notFound();
    }

    const built = buildCitations(numbered, generated.answer, generated.citedSourceIds);
    if (!built) {
      m.outcome = "invalid_citations";
      return notFound();
    }

    m.outcome = "answered";
    return { answer: built.answer, found: true, citations: built.citations };
  } finally {
    deps.onMetrics?.(m);
  }
}
