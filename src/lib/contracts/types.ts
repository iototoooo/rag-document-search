/**
 * RAG 全体で共有するドメイン型。
 * ここを変更する場合は main で変更し、各 feature ブランチへマージすること。
 */

/** 文書の公開範囲。MVP で検索対象になるのは "internal"（許可済み全社員）のみ。 */
export type DocumentVisibility = "internal" | "department" | "restricted";

export type DocumentMimeType = "application/pdf" | "text/markdown";

/** documents テーブル 1 行に対応する。 */
export type DocumentRecord = {
  id: string;
  /** ファイル名から拡張子を除いた一意キー（例: "demo-doc1-travel-rules"） */
  sourceKey: string;
  fileName: string;
  title: string;
  mimeType: DocumentMimeType;
  /** 元ファイルバイト列の SHA-256（hex）。再取り込み判定に使う */
  contentHash: string;
  pageCount: number | null;
  /** 非公開 Storage バケット "documents" 内のパス */
  storagePath: string | null;
  visibility: DocumentVisibility;
  department: string | null;
  embeddingModel: string;
};

/** 取り込み処理が生成するチャンク（Embedding 前）。 */
export type ChunkDraft = {
  /** `${sourceKey}:p${pageNumber}:c${chunkIndex}` 形式。文書内で決定的に決まる */
  chunkKey: string;
  chunkIndex: number;
  /** チャンク先頭のページ番号（1始まり） */
  pageNumber: number;
  /** チャンク末尾のページ番号（1始まり、pageNumber 以上） */
  pageEnd: number;
  section: string | null;
  content: string;
  tokenCount: number;
  contentHash: string;
};

/** match_document_chunks RPC が返す 1 行（RLS 適用後の結果のみ）。 */
export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  chunkKey: string;
  fileName: string;
  title: string;
  pageNumber: number;
  section: string | null;
  content: string;
  similarity: number;
};

/**
 * 回答に付与する出典。サーバー側で RetrievedChunk から生成し、
 * LLM が出力した番号はこの一覧に存在するものだけを採用する。
 */
export type Citation = {
  /** 1 回の回答内での出典番号（本文中の [1] 等に対応） */
  id: number;
  documentId: string;
  chunkId: string;
  fileName: string;
  title: string;
  pageNumber: number;
  section: string | null;
  /** 根拠箇所の短い抜粋（最大 200 文字） */
  snippet: string;
};

/** 根拠がないときに返す固定文言。 */
export const NOT_FOUND_MESSAGE = "該当する情報が見つかりません";

/** 認証・認可済みユーザー。 */
export type AuthorizedUser = {
  id: string;
  email: string;
};
