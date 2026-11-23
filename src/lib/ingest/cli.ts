import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { DocumentVisibility } from "@/lib/contracts/types";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { summarizeError } from "@/lib/observability/log";
import { InMemoryDocumentRepository, InMemoryFileStorage } from "./memory";
import { DB_EMBEDDING_DIMENSIONS, ingestDocument, type IngestDeps } from "./pipeline";

/**
 * 取り込み CLI のロジック（scripts/ingest.ts から呼ぶ。テスト可能な形で分離）。
 * 既定はドライラン（モック Embedding + インメモリ保存。外部通信なし）。
 */

export type CliOptions = {
  execute: boolean;
  dir: string;
};

export const DEFAULT_INPUT_DIR = path.join("samples", "pdf");
/** MVP では公開許可済みのダミー文書のみを "internal" として取り込む */
export const MVP_VISIBILITY: DocumentVisibility = "internal";

export function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { execute: false, dir: DEFAULT_INPUT_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--execute") opts.execute = true;
    else if (a === "--dry-run") opts.execute = false;
    else if (a === "--dir") {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error("--dir にはディレクトリを指定してください");
      opts.dir = v;
    } else if (a.startsWith("--dir=")) {
      opts.dir = a.slice("--dir=".length);
      if (!opts.dir) throw new Error("--dir にはディレクトリを指定してください");
    } else {
      throw new Error(`不明な引数です: ${a}`);
    }
  }
  return opts;
}

/** ディレクトリ直下の PDF を名前順で返す（サブディレクトリ・シンボリックリンク先は辿らない） */
export function listPdfFiles(dir: string): string[] {
  const abs = path.resolve(dir);
  if (!statSync(abs).isDirectory()) throw new Error("指定パスがディレクトリではありません");
  return readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => path.join(abs, e.name))
    .sort();
}

export type FileSummary = {
  fileName: string;
  status: "ingested" | "skipped" | "error";
  pageCount: number | null;
  chunkCount: number;
  minTokens: number;
  avgTokens: number;
  maxTokens: number;
  error?: string;
};

export async function runIngest(
  files: string[],
  deps: IngestDeps,
  visibility: DocumentVisibility = MVP_VISIBILITY,
): Promise<FileSummary[]> {
  const rows: FileSummary[] = [];
  for (const file of files) {
    const fileName = path.basename(file);
    try {
      const data = new Uint8Array(readFileSync(file));
      const r = await ingestDocument({ fileName, data, visibility }, deps);
      const t = r.tokenCounts;
      rows.push({
        fileName,
        status: r.status,
        pageCount: r.pageCount,
        chunkCount: r.chunkCount,
        minTokens: t.length ? Math.min(...t) : 0,
        avgTokens: t.length ? Math.round(t.reduce((a, b) => a + b, 0) / t.length) : 0,
        maxTokens: t.length ? Math.max(...t) : 0,
      });
    } catch (e) {
      // エラーメッセージ本文は出さず、種類だけを記録する
      const s = summarizeError(e);
      rows.push({
        fileName,
        status: "error",
        pageCount: null,
        chunkCount: 0,
        minTokens: 0,
        avgTokens: 0,
        maxTokens: 0,
        error: [s.name, s.status, s.code].filter((x) => x !== undefined).join(":"),
      });
    }
  }
  return rows;
}

export function formatSummary(rows: FileSummary[]): string {
  const header = "file | status | pages | chunks | tokens(min/avg/max)";
  const lines = rows.map(
    (r) =>
      `${r.fileName} | ${r.status}${r.error ? `(${r.error})` : ""} | ${r.pageCount ?? "-"} | ${r.chunkCount} | ${r.minTokens}/${r.avgTokens}/${r.maxTokens}`,
  );
  const total = rows.reduce((a, r) => a + r.chunkCount, 0);
  const errors = rows.filter((r) => r.status === "error").length;
  return [header, ...lines, `total: ${rows.length} files, ${total} chunks, ${errors} errors`].join(
    "\n",
  );
}

export function createDryRunDeps(): IngestDeps & {
  repo: InMemoryDocumentRepository;
  storage: InMemoryFileStorage;
} {
  return {
    embedder: new MockEmbeddingProvider(DB_EMBEDDING_DIMENSIONS),
    repo: new InMemoryDocumentRepository(),
    storage: new InMemoryFileStorage(),
  };
}
