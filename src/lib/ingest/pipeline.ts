import { createHash } from "node:crypto";
import path from "node:path";
import type {
  DocumentFileStorage,
  DocumentRepository,
  EmbeddingProvider,
} from "@/lib/contracts/ports";
import type {
  ChunkDraft,
  DocumentMimeType,
  DocumentVisibility,
} from "@/lib/contracts/types";
import { extractPdfText } from "@/lib/documents/pdf";
import { chunkPages, type ChunkOptions, type PageText } from "./chunker";
import { normalizeForIngest } from "./text";

/**
 * 文書 1 件の取り込み。
 * 1. 元バイト列の SHA-256 を計算し、既存文書と内容・Embedding モデル・公開範囲が同じならスキップ
 * 2. テキスト抽出 → 正規化 → チャンク分割 → Embedding
 * 3. 非公開 Storage へ原本をアップロード（決定的なパス）
 * 4. 文書メタデータとチャンクを 1 トランザクションで置換（重複登録しない）
 * 本文・抽出テキストはログに出さない（sourceKey と件数のみ）。
 */

/** DB の vector(1536) 列と一致させる次元数 */
export const DB_EMBEDDING_DIMENSIONS = 1536;

export type IngestInput = {
  fileName: string;
  data: Uint8Array;
  /** 公開範囲は呼び出し側で必ず明示する（既定値を持たない） */
  visibility: DocumentVisibility;
  title?: string;
  department?: string | null;
};

export type IngestLogger = (message: string, meta?: Record<string, string | number>) => void;

export type IngestDeps = {
  embedder: EmbeddingProvider;
  repo: DocumentRepository;
  storage: DocumentFileStorage;
  logger?: IngestLogger;
  chunkOptions?: Partial<ChunkOptions>;
};

export type IngestResult = {
  status: "skipped" | "ingested";
  sourceKey: string;
  chunkCount: number;
  pageCount: number | null;
  tokenCounts: number[];
};

const SOURCE_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function toSourceKey(fileName: string): string {
  const base = path.basename(fileName);
  const key = base.replace(/\.[^.]+$/, "");
  if (!SOURCE_KEY_RE.test(key)) {
    throw new Error("ファイル名には英数字・ドット・ハイフン・アンダースコアのみ使用できます");
  }
  return key;
}

export function detectMimeType(fileName: string): DocumentMimeType {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  throw new Error("対応していないファイル形式です（PDF / Markdown のみ）");
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 1 ページ目の先頭行をタイトルとして推定する（長すぎる場合は sourceKey） */
export function inferTitle(pages: PageText[], fallback: string): string {
  const first = pages[0]?.text.split("\n").find((l) => l.trim().length > 0)?.trim() ?? "";
  const cleaned = first.replace(/^#+\s*/, "").replace(/\*\*/g, "").trim();
  return cleaned && cleaned.length <= 60 ? cleaned : fallback;
}

async function extractPages(data: Uint8Array, mimeType: DocumentMimeType): Promise<PageText[]> {
  if (mimeType === "application/pdf") {
    // pdf.js がバッファを転送（detach）する場合があるため、コピーを渡す
    const { pages } = await extractPdfText(data.slice());
    return pages.map((text, i) => ({ pageNumber: i + 1, text: normalizeForIngest(text) }));
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  return [{ pageNumber: 1, text: normalizeForIngest(text) }];
}

/** Embedding 入力: 文書タイトルを前置して文脈を補う（保存する content には含めない） */
export function embeddingInput(title: string, chunk: Pick<ChunkDraft, "content">): string {
  return `${title}\n${chunk.content}`;
}

export async function ingestDocument(
  input: IngestInput,
  deps: IngestDeps,
): Promise<IngestResult> {
  const sourceKey = toSourceKey(input.fileName);
  const mimeType = detectMimeType(input.fileName);
  const log = deps.logger ?? (() => {});

  if (input.data.byteLength === 0) throw new Error("空のファイルは取り込めません");

  const contentHash = sha256Hex(input.data);
  const existing = await deps.repo.findBySourceKey(sourceKey);
  if (
    existing &&
    existing.contentHash === contentHash &&
    existing.embeddingModel === deps.embedder.model &&
    existing.visibility === input.visibility &&
    (existing.department ?? null) === (input.department ?? null)
  ) {
    log("skip: unchanged", { sourceKey });
    return { status: "skipped", sourceKey, chunkCount: 0, pageCount: existing.pageCount, tokenCounts: [] };
  }

  const pages = await extractPages(input.data, mimeType);
  const chunks = chunkPages(sourceKey, pages, deps.chunkOptions);
  if (chunks.length === 0) {
    throw new Error("テキストを抽出できませんでした（画像のみの PDF の可能性があります）");
  }
  const keys = new Set(chunks.map((c) => c.chunkKey));
  if (keys.size !== chunks.length) throw new Error("chunkKey が重複しています");

  const title = input.title?.trim() || inferTitle(pages, sourceKey);
  const vectors = await deps.embedder.embed(chunks.map((c) => embeddingInput(title, c)));
  if (vectors.length !== chunks.length) {
    throw new Error("Embedding の件数がチャンク数と一致しません");
  }
  for (const v of vectors) {
    if (v.length !== deps.embedder.dimensions || v.some((x) => !Number.isFinite(x))) {
      throw new Error("Embedding の次元数または値が不正です");
    }
  }

  const ext = mimeType === "application/pdf" ? "pdf" : "md";
  const storagePath = `${sourceKey}/${contentHash}.${ext}`;
  await deps.storage.upload(storagePath, input.data, mimeType);

  await deps.repo.replaceDocument({
    document: {
      sourceKey,
      fileName: path.basename(input.fileName),
      title,
      mimeType,
      contentHash,
      pageCount: mimeType === "application/pdf" ? pages.length : null,
      storagePath,
      visibility: input.visibility,
      department: input.department ?? null,
      embeddingModel: deps.embedder.model,
    },
    chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
  });

  log(existing ? "replaced" : "ingested", { sourceKey, chunks: chunks.length });
  return {
    status: "ingested",
    sourceKey,
    chunkCount: chunks.length,
    pageCount: mimeType === "application/pdf" ? pages.length : null,
    tokenCounts: chunks.map((c) => c.tokenCount),
  };
}
