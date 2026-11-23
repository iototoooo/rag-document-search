import { describe, expect, it, vi } from "vitest";
import type { AuthorizationResult } from "@/lib/auth/authorize";
import {
  contentDispositionInline,
  createDocumentFileHandler,
  type DocumentFileDeps,
  type DocumentFileRecord,
} from "./handler";

const DOC_ID = "3f1c2a7e-5b6d-4c8e-9a0b-1c2d3e4f5a6b";
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
const visibleDoc: DocumentFileRecord = {
  fileName: "demo-doc1-travel-rules.pdf",
  mimeType: "application/pdf",
  storagePath: "demo-doc1-travel-rules.pdf",
};

function setup(opts: {
  auth?: AuthorizationResult;
  doc?: DocumentFileRecord | null;
  file?: Uint8Array | null;
  findThrows?: boolean;
}) {
  const deps = {
    authorize: vi.fn(async () => opts.auth ?? { ok: true as const, user: { id: "u1", email: "a@example.com" } }),
    findDocument: vi.fn(async () => {
      if (opts.findThrows) throw new Error("db error with secret detail");
      return opts.doc === undefined ? visibleDoc : opts.doc;
    }),
    downloadFile: vi.fn(async () => (opts.file === undefined ? PDF_BYTES : opts.file)),
  } satisfies DocumentFileDeps;
  return { deps, handle: createDocumentFileHandler(deps) };
}

async function bodyText(res: Response) {
  return await res.text();
}

describe("GET /api/documents/{id}/file", () => {
  it("未認証は 401 で、DB・Storage を呼ばない", async () => {
    const { deps, handle } = setup({ auth: { ok: false, code: "UNAUTHENTICATED" } });
    const res = await handle(DOC_ID);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
    expect(deps.findDocument).not.toHaveBeenCalled();
    expect(deps.downloadFile).not.toHaveBeenCalled();
  });

  it("未許可ユーザーは 403 で、DB・Storage を呼ばない", async () => {
    const { deps, handle } = setup({ auth: { ok: false, code: "FORBIDDEN" } });
    const res = await handle(DOC_ID);
    expect(res.status).toBe(403);
    expect(deps.findDocument).not.toHaveBeenCalled();
  });

  it("UUID でない ID は 404（DB を呼ばない）", async () => {
    const { deps, handle } = setup({});
    const res = await handle("../../etc/passwd");
    expect(res.status).toBe(404);
    expect(deps.findDocument).not.toHaveBeenCalled();
  });

  it("RLS で見えない文書は 404 で、存在しない文書と同一の応答になる", async () => {
    const hidden = setup({ doc: null });
    const res1 = await hidden.handle(DOC_ID);
    const missing = setup({ doc: null });
    const res2 = await missing.handle("00000000-0000-4000-8000-000000000000");
    expect(res1.status).toBe(404);
    expect(res2.status).toBe(404);
    const [b1, b2] = [await bodyText(res1), await bodyText(res2)];
    expect(b1).toBe(b2);
    expect(b1).not.toContain("demo-doc1");
    expect(res1.headers.get("Content-Type")).not.toContain("pdf");
    expect(hidden.deps.downloadFile).not.toHaveBeenCalled();
  });

  it("DB 例外も 404（内部情報を返さない）", async () => {
    const { handle } = setup({ findThrows: true });
    const res = await handle(DOC_ID);
    expect(res.status).toBe(404);
    expect(await bodyText(res)).not.toContain("secret");
  });

  it("PDF 以外・保存先なしは 404", async () => {
    expect((await setup({ doc: { ...visibleDoc, mimeType: "text/markdown" } }).handle(DOC_ID)).status).toBe(404);
    expect((await setup({ doc: { ...visibleDoc, storagePath: null } }).handle(DOC_ID)).status).toBe(404);
  });

  it("Storage 取得失敗（Storage 側 RLS で拒否を含む）は 404", async () => {
    const { handle } = setup({ file: null });
    expect((await handle(DOC_ID)).status).toBe(404);
  });

  it("閲覧可能な文書は 200 で PDF を返し、キャッシュ・埋め込みを制限する", async () => {
    const { deps, handle } = setup({});
    const res = await handle(DOC_ID);
    expect(res.status).toBe(200);
    expect(deps.findDocument).toHaveBeenCalledWith(DOC_ID);
    expect(deps.downloadFile).toHaveBeenCalledWith("demo-doc1-travel-rules.pdf");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    expect(res.headers.get("Content-Disposition")).toContain("inline;");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
  });
});

describe("contentDispositionInline", () => {
  it("日本語ファイル名を RFC 5987 でエンコードし、ヘッダーインジェクションを防ぐ", () => {
    const v = contentDispositionInline('出張旅費規程\r\nX-Evil: 1".pdf');
    expect(v).not.toMatch(/[\r\n]/);
    expect(v).toContain("filename*=UTF-8''");
    expect(v).toContain(encodeURIComponent("出張旅費規程"));
    expect(v.startsWith("inline;")).toBe(true);
  });
});
