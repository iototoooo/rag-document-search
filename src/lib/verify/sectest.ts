import { createHash } from "node:crypto";
import { createServerClient } from "@supabase/ssr";

/**
 * T-1〜T-3（未登録ユーザー・部署限定・restricted 文書）の実環境セキュリティテスト用ヘルパー。
 *
 * テストデータの識別:
 *   - source_key・ファイル名・Storage パス・chunk_key はすべて "zz-sectest-" で始まる
 *   - タイトルと本文に「セキュリティ検証用ダミー」と固有の合言葉（カナリア文字列）を入れる
 * Embedding は OpenAI を使わず決定的な合成ベクトルを使う（AI API の費用ゼロ）。
 * 漏えいがあれば、同じベクトルで検索したときに類似度 ≒1 で必ず 1 位に出るため検出できる。
 */

export const SECTEST_PREFIX = "zz-sectest-";
export const EMBEDDING_DIMENSIONS = 1536;
export const SECTEST_EMBEDDING_MODEL = "sectest-synthetic";

/** テスト前の状態（依頼時点の既存データ）。これと一致しないとセットアップしない */
export const EXPECTED_BASELINE = { documents: 5, chunks: 14, appUsers: 1 } as const;

export type SectestFixture = {
  sourceKey: string;
  fileName: string;
  title: string;
  visibility: "department" | "restricted";
  department: string | null;
  canary: string;
  seed: number;
};

export const SECTEST_FIXTURES: readonly SectestFixture[] = [
  {
    sourceKey: `${SECTEST_PREFIX}department`,
    fileName: `${SECTEST_PREFIX}department.pdf`,
    title: "【セキュリティ検証用ダミー】部署限定文書",
    visibility: "department",
    // 実在しない部署名（既存ユーザーの departments と一致させない）
    department: "sectest-dummy-dept",
    canary: "SECTEST-CANARY-DEPT-7Q2X",
    seed: 101,
  },
  {
    sourceKey: `${SECTEST_PREFIX}restricted`,
    fileName: `${SECTEST_PREFIX}restricted.pdf`,
    title: "【セキュリティ検証用ダミー】restricted 文書",
    visibility: "restricted",
    department: null,
    canary: "SECTEST-CANARY-RSTR-9K4M",
    seed: 202,
  },
];

export function fixtureContent(f: SectestFixture): string {
  return `セキュリティ検証用ダミー文書（${f.visibility}）。実在の社内情報は含まない。合言葉: ${f.canary}`;
}

/** 決定的な単位ベクトル（seed ごとに異なり、既存チャンクとはほぼ無相関）。 */
export function dummyEmbedding(seed: number, dims = EMBEDDING_DIMENSIONS): number[] {
  const v = Array.from({ length: dims }, (_, i) => Math.sin((i + 1) * seed * 12.9898) * 43758.5453 % 1);
  const norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return v.map((x) => Number((x / norm).toFixed(7)));
}

/** 検索 RPC（match_document_chunks）の 1 回あたりの最大件数 */
export const SEARCH_RPC_MAX = 20;

export function cosine(a: number[], b: number[]): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    d += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return d / Math.sqrt(na * nb);
}

/**
 * 検索 RPC が返すはずの件数。RPC は「類似度 >= max(しきい値, 0)」の行だけを返し、最大 20 件。
 * 合成ベクトルは実文書と無相関なので、類似度が負になるチャンクは結果に含まれない（漏えいとは無関係）。
 */
export function expectedSearchHits(visibleEmbeddings: number[][], query: number[], threshold = 0): number {
  const n = visibleEmbeddings.filter((e) => cosine(e, query) >= Math.max(threshold, 0)).length;
  return Math.min(n, SEARCH_RPC_MAX);
}

export function vectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** ASCII テキスト 1 行だけの最小 PDF（1 ページ）。ビューアで開ける正しい構造にする。 */
export function minimalPdf(text: string): Uint8Array {
  const safe = text.replace(/[^\x20-\x7e]/g, "?").replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 12 Tf 50 750 Td (${safe}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

export function fixturePdf(f: SectestFixture): Uint8Array {
  return minimalPdf(`SECURITY TEST DUMMY (${f.visibility}) ${f.canary}`);
}

export function storagePathOf(f: SectestFixture, pdf: Uint8Array): string {
  return `${f.sourceKey}/${sha256Hex(pdf)}.pdf`;
}

/** 取り込み RPC（replace_document_with_chunks）の引数。既存の取り込み CLI と同じ形式。 */
export function buildRpcArgs(f: SectestFixture) {
  const pdf = fixturePdf(f);
  const content = fixtureContent(f);
  return {
    pdf,
    storagePath: storagePathOf(f, pdf),
    args: {
      p_document: {
        source_key: f.sourceKey,
        file_name: f.fileName,
        title: f.title,
        mime_type: "application/pdf",
        content_hash: sha256Hex(pdf),
        page_count: 1,
        storage_path: storagePathOf(f, pdf),
        visibility: f.visibility,
        department: f.department,
        embedding_model: SECTEST_EMBEDDING_MODEL,
      },
      p_chunks: [
        {
          chunk_key: `${f.sourceKey}:0`,
          chunk_index: 0,
          page_number: 1,
          page_end: 1,
          section: "セキュリティ検証用ダミー",
          content,
          token_count: 32,
          content_hash: sha256Hex(content),
          embedding: dummyEmbedding(f.seed),
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------
// 作成記録（マニフェスト）と削除対象の照合
// ---------------------------------------------------------------------

export type ManifestItem = {
  sourceKey: string;
  visibility: string;
  documentId: string | null;
  chunkIds: string[];
  storagePath: string;
  storageUploaded: boolean;
};

export type SectestManifest = {
  version: 1;
  projectHost: string;
  createdAt: string;
  baseline: { documents: number; chunks: number; appUsers: number | null };
  items: ManifestItem[];
};

/**
 * appUsers は service_role に app_users の権限を付与していない（最小権限）ため取得できない場合がある。
 * その場合は null とし、SQL Editor（supabase/verify/03_sectest_state.sql）で確認する。
 */
export type Counts = { documents: number; chunks: number; appUsers: number | null };

export function baselineMismatches(
  actual: Counts,
  expected: { documents: number; chunks: number; appUsers: number | null } = EXPECTED_BASELINE,
): string[] {
  const out: string[] = [];
  for (const k of ["documents", "chunks", "appUsers"] as const) {
    if (actual[k] === null || expected[k] === null) continue; // 取得できない値は SQL Editor で確認
    if (actual[k] !== expected[k]) out.push(`${k}: 期待 ${expected[k]} / 実際 ${actual[k]}`);
  }
  return out;
}

export type DbDocRow = { id: string; source_key: string; storage_path: string | null; visibility: string };

/**
 * 削除対象の決定。次の 3 条件をすべて満たす行だけを削除対象にする:
 *   1. マニフェストに記録した ID と一致
 *   2. source_key がテスト用の接頭辞で始まる（かつマニフェストの source_key と一致）
 *   3. visibility が internal ではない
 * 条件に合わない行や、マニフェストにないテスト用の行があれば problems に入れ、削除は行わない。
 */
export function planCleanup(manifest: SectestManifest, prefixedRows: DbDocRow[]) {
  const problems: string[] = [];
  const targets: DbDocRow[] = [];
  const byId = new Map(prefixedRows.map((r) => [r.id, r]));
  const manifestIds = new Set(manifest.items.map((i) => i.documentId).filter((x): x is string => !!x));

  for (const item of manifest.items) {
    if (!item.sourceKey.startsWith(SECTEST_PREFIX) || !item.storagePath.startsWith(SECTEST_PREFIX)) {
      problems.push(`マニフェストにテスト用以外の値があります: ${item.sourceKey}`);
      continue;
    }
    if (!item.documentId) continue; // 文書作成前に中断した（Storage のみ削除対象）
    const row = byId.get(item.documentId);
    if (!row) {
      problems.push(`記録した文書 ${item.documentId} が DB に見つかりません（削除済み？）`);
      continue;
    }
    if (row.source_key !== item.sourceKey || !row.source_key.startsWith(SECTEST_PREFIX)) {
      problems.push(`文書 ${row.id} の source_key が記録と一致しません`);
      continue;
    }
    if (row.visibility === "internal") {
      problems.push(`文書 ${row.id} が internal です（テスト用ではない可能性）`);
      continue;
    }
    targets.push(row);
  }
  for (const r of prefixedRows) {
    if (!manifestIds.has(r.id)) problems.push(`マニフェストにないテスト用の文書があります: ${r.id}（手動で確認）`);
  }
  const storagePaths = manifest.items
    .filter((i) => i.storageUploaded && i.storagePath.startsWith(SECTEST_PREFIX))
    .map((i) => i.storagePath);
  return { targets, storagePaths, problems };
}

// ---------------------------------------------------------------------
// アプリ（Next.js）に実際のログイン Cookie で問い合わせるためのクライアント
// ---------------------------------------------------------------------

/**
 * @supabase/ssr のクライアントでログインし、アプリと同じ形式の Cookie を手元に保持する。
 * cookieHeader() を fetch の Cookie ヘッダーに付けると、ブラウザでログインした状態と同じになる。
 */
export function createCookieSessionClient(
  url: string,
  anonKey: string,
  options: { fetch?: typeof fetch } = {},
) {
  const jar = new Map<string, string>();
  const client = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
    ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
  });
  return {
    client,
    cookieHeader: () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    cookieCount: () => jar.size,
  };
}
