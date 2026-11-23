import { apiErrorResponse } from "@/lib/contracts/api";
import type { AuthorizationResult } from "@/lib/auth/authorize";
import { logError } from "@/lib/observability/log";

/**
 * 出典 PDF の配信。
 * - 最初に認証・認可（401 / 403）
 * - 文書の取得・Storage のダウンロードはすべてユーザー権限のクライアント（RLS 適用）で行う
 * - 存在しない文書・閲覧権限のない文書・ダウンロード失敗は区別せず 404
 * - 公開 URL / 署名付き URL は発行せず、サーバーから直接返す
 */

export type DocumentFileRecord = {
  fileName: string;
  mimeType: string;
  storagePath: string | null;
};

export type DocumentFileDeps = {
  authorize(): Promise<AuthorizationResult>;
  /** RLS 適用済みクライアントで取得。見えない場合は null */
  findDocument(documentId: string): Promise<DocumentFileRecord | null>;
  /** RLS 適用済みクライアントで Storage から取得。失敗時は null */
  downloadFile(storagePath: string): Promise<Uint8Array | null>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** RFC 6266 / 5987 形式の Content-Disposition（inline）。 */
export function contentDispositionInline(fileName: string): string {
  const safe = fileName.replace(/[\r\n"]/g, "").slice(0, 200) || "document.pdf";
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `inline; filename="document.pdf"; filename*=UTF-8''${encoded}`;
}

export function createDocumentFileHandler(deps: DocumentFileDeps) {
  return async function handle(documentId: string): Promise<Response> {
    const auth = await deps.authorize();
    if (!auth.ok) return apiErrorResponse(auth.code);

    if (!isUuid(documentId)) return apiErrorResponse("NOT_FOUND");

    let doc: DocumentFileRecord | null;
    try {
      doc = await deps.findDocument(documentId);
    } catch (error) {
      logError("documents.file.find", error);
      return apiErrorResponse("NOT_FOUND");
    }
    if (!doc || !doc.storagePath || doc.mimeType !== "application/pdf") {
      return apiErrorResponse("NOT_FOUND");
    }

    let data: Uint8Array | null;
    try {
      data = await deps.downloadFile(doc.storagePath);
    } catch (error) {
      logError("documents.file.download", error);
      return apiErrorResponse("NOT_FOUND");
    }
    if (!data) return apiErrorResponse("NOT_FOUND");

    return new Response(data as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(data.byteLength),
        "Content-Disposition": contentDispositionInline(doc.fileName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "Cross-Origin-Resource-Policy": "same-origin",
        // 他サイトへの埋め込みを禁止（ブラウザ内蔵 PDF ビューアの互換性のため sandbox は付けない）
        "Content-Security-Policy": "frame-ancestors 'self'",
      },
    });
  };
}
