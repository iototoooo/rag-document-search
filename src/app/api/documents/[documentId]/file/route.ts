import { apiErrorResponse } from "@/lib/contracts/api";
import { logError } from "@/lib/observability/log";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { authorizeWithSupabase } from "@/lib/auth/server";
import { createDocumentFileHandler } from "./handler";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await params;

  let supabase: Awaited<ReturnType<typeof createUserSupabaseClient>>;
  try {
    // service_role ではなく、リクエストユーザーの権限で動くクライアント（RLS 適用）
    supabase = await createUserSupabaseClient();
  } catch (error) {
    logError("documents.file.client", error);
    return apiErrorResponse("INTERNAL");
  }

  const handle = createDocumentFileHandler({
    authorize: () => authorizeWithSupabase(supabase),
    async findDocument(id) {
      const { data, error } = await supabase
        .from("documents")
        .select("file_name, mime_type, storage_path")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return {
        fileName: data.file_name as string,
        mimeType: data.mime_type as string,
        storagePath: (data.storage_path as string | null) ?? null,
      };
    },
    async downloadFile(path) {
      const { data, error } = await supabase.storage.from("documents").download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
  });

  return handle(documentId);
}
