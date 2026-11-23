import type { ChunkDraft, DocumentRecord, RetrievedChunk } from "./types";

/**
 * 外部サービス（Embedding API・Claude API・Supabase）との境界インターフェース。
 * 実装は差し替え可能にし、テストではモックを注入する。
 */

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  /** 入力順と同じ順序でベクトルを返す。 */
  embed(texts: string[]): Promise<number[][]>;
}

export type SearchOptions = {
  /** コサイン類似度のしきい値（0〜1） */
  threshold: number;
  /** 最大取得件数 */
  count: number;
};

/**
 * ベクトル検索。実装は必ず「リクエストユーザーの権限で動く Supabase クライアント」
 * （anon キー + ユーザー JWT）を使い、RLS を適用すること。service_role で呼ばない。
 */
export interface ChunkSearcher {
  search(embedding: number[], options: SearchOptions): Promise<RetrievedChunk[]>;
}

/** LLM に渡す根拠資料。id はサーバー側で振る連番（1始まり）。 */
export type SourceForPrompt = {
  id: number;
  fileName: string;
  title: string;
  pageNumber: number;
  section: string | null;
  content: string;
};

/** 1 回の LLM 呼び出しのトークン使用量（費用集計用。本文は含まない）。 */
export type TokenUsage = { inputTokens: number; outputTokens: number };

export type GeneratedAnswer = (
  | { status: "answered"; answer: string; citedSourceIds: number[] }
  | { status: "not_found" }
  | { status: "refused" }
) & { usage?: TokenUsage };

export interface AnswerGenerator {
  generate(input: {
    question: string;
    sources: SourceForPrompt[];
  }): Promise<GeneratedAnswer>;
}

/** 取り込み時の文書保存先（service_role で動くサーバー専用 CLI からのみ使用）。 */
export interface DocumentRepository {
  findBySourceKey(sourceKey: string): Promise<DocumentRecord | null>;
  /**
   * 文書メタデータとチャンクを 1 トランザクションで置き換える。
   * 同じ sourceKey の既存チャンクは削除され、重複登録されない。
   */
  replaceDocument(input: {
    document: Omit<DocumentRecord, "id">;
    chunks: Array<ChunkDraft & { embedding: number[] }>;
  }): Promise<{ documentId: string }>;
}

/** 非公開 Storage への原本アップロード（取り込み CLI 専用）。 */
export interface DocumentFileStorage {
  upload(path: string, data: Uint8Array, contentType: string): Promise<void>;
}
