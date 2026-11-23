/**
 * 実 DB のセキュリティ検証（読み取り専用・AI API は呼ばない）
 *
 *   npm run verify:db                                  # 未認証（anon）・管理者読み取り・Storage
 *   npm run verify:db -- --app-url http://localhost:3000   # 起動中のアプリへの未認証アクセスも確認
 *
 * 認証済みユーザーの確認（RLS・pgvector 検索・PDF 取得）は、.env.local に
 * VERIFY_USER_EMAIL / VERIFY_USER_PASSWORD を設定した場合だけ行う。
 *   - ログインは画面からのログインと同じ扱い（Supabase Auth にログイン記録・セッションが残る）。
 *     終了時にこの端末のセッションだけをログアウトする（他のブラウザのログインは維持）。
 *   - データの追加・変更・削除は行わない。取り込み RPC は「拒否されること」だけを確認し、
 *     万一実行できても書き込み前に必ずエラーになる引数（空のチャンク配列）で呼ぶ。
 *
 * 出力は件数と判定のみ（キー・本文・ID・メールアドレスは表示しない）。NG があれば終了コード 1。
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  describeError,
  formatVerifyReport,
  isPermissionDenied,
  zeroVectorLiteral,
  type VerifyResult,
} from "@/lib/verify/db-security";

const BUCKET = "documents";
const results: VerifyResult[] = [];
const add = (group: string, name: string, ok: boolean | null, detail: string) =>
  results.push({ group, name, status: ok === null ? "skip" : ok ? "ok" : "ng", detail });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // 環境変数のみを使う
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です");
  console.log(`接続先 Supabase: ${new URL(url).host}（読み取り専用の検証）`);

  // ---------- 管理者（service_role）による現状の把握（読み取りのみ） ----------
  let storagePath: string | null = null;
  let documentId: string | null = null;
  let internalDocs = 0;
  let internalChunks = 0;
  let totalChunks = 0;
  const G0 = "0. 現状（service_role・読み取りのみ）";
  if (serviceKey) {
    const admin = createClient(url, serviceKey, noSession);
    const docs = await admin.from("documents").select("id, visibility, storage_path");
    if (docs.error) {
      add(G0, "documents の読み取り", false, describeError(docs.error));
    } else {
      const rows = docs.data as Array<{ id: string; visibility: string; storage_path: string | null }>;
      const internal = rows.filter((r) => r.visibility === "internal");
      internalDocs = internal.length;
      const other = rows.length - internal.length;
      add(G0, "文書の件数と公開範囲", true, `全 ${rows.length} 件（internal ${internalDocs} / それ以外 ${other}）`);
      const first = internal.find((r) => r.storage_path);
      storagePath = first?.storage_path ?? null;
      documentId = first?.id ?? null;
      const ids = internal.map((r) => r.id);
      const all = await admin.from("document_chunks").select("id", { count: "exact", head: true });
      const inn = ids.length
        ? await admin.from("document_chunks").select("id", { count: "exact", head: true }).in("document_id", ids)
        : { count: 0, error: null };
      totalChunks = all.count ?? 0;
      internalChunks = inn.count ?? 0;
      add(G0, "チャンクの件数", !all.error && !inn.error, `全 ${totalChunks} 件（internal 文書 ${internalChunks}）`);
    }
    const bucket = await admin.storage.getBucket(BUCKET);
    add(G0, "Storage バケットが非公開", bucket.error ? false : bucket.data.public === false,
      bucket.error ? describeError(bucket.error) : `public=${bucket.data.public}`);
  } else {
    add(G0, "service_role キー", null, "未設定のため現状の把握を省略");
  }

  // ---------- 未認証（anon キーのみ） ----------
  const G1 = "1. 未認証（anon キーのみ）";
  const anon = createClient(url, anonKey, noSession);
  for (const t of ["documents", "document_chunks", "app_users"]) {
    const r = await anon.from(t).select("*").limit(1);
    const denied = isPermissionDenied(r.error) || (!r.error && (r.data?.length ?? 0) === 0);
    add(G1, `${t} を読めない`, denied, r.error ? `拒否（${describeError(r.error)}）` : `0 行`);
  }
  {
    const r = await anon.rpc("match_document_chunks", {
      query_embedding: zeroVectorLiteral(),
      match_threshold: 0,
      match_count: 1,
    });
    add(G1, "検索 RPC を実行できない", isPermissionDenied(r.error), r.error ? `拒否（${describeError(r.error)}）` : "実行できてしまった");
  }
  {
    const r = await anon.rpc("replace_document_with_chunks", { p_document: {}, p_chunks: [] });
    add(G1, "取り込み RPC を実行できない", isPermissionDenied(r.error), r.error ? `拒否（${describeError(r.error)}）` : "実行できてしまった");
  }
  {
    const r = await anon.storage.from(BUCKET).list("", { limit: 10 });
    add(G1, "Storage の一覧を取得できない", !!r.error || (r.data?.length ?? 0) === 0,
      r.error ? `拒否（${describeError(r.error)}）` : `${r.data?.length ?? 0} 件`);
  }
  if (storagePath) {
    const r = await anon.storage.from(BUCKET).download(storagePath);
    add(G1, "Storage の PDF をダウンロードできない", !!r.error, r.error ? "拒否" : "取得できてしまった");
    const pub = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${storagePath}`);
    add(G1, "公開 URL で PDF を取得できない", pub.status !== 200, `HTTP ${pub.status}`);
  } else {
    add(G1, "Storage の PDF", null, "検証用の保存済み PDF がないため省略");
  }

  // ---------- 認証済みユーザー（任意） ----------
  const G2 = "2. 認証済みユーザー（app_users で許可済み）";
  const email = process.env.VERIFY_USER_EMAIL ?? "";
  const password = process.env.VERIFY_USER_PASSWORD ?? "";
  if (!email || !password) {
    add(G2, "ログインして確認", null, "VERIFY_USER_EMAIL / VERIFY_USER_PASSWORD が未設定のため省略");
  } else {
    const user: SupabaseClient = createClient(url, anonKey, noSession);
    const login = await user.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.user) {
      add(G2, "ログイン", false, describeError(login.error));
    } else {
      const uid = login.data.user.id;
      try {
        const me = await user.from("app_users").select("user_id, is_active");
        const rows = (me.data ?? []) as Array<{ user_id: string; is_active: boolean }>;
        add(G2, "app_users は自分の行だけ見える", !me.error && rows.length === 1 && rows[0].user_id === uid && rows[0].is_active,
          me.error ? describeError(me.error) : `${rows.length} 行`);

        const docs = await user.from("documents").select("id, visibility");
        const drows = (docs.data ?? []) as Array<{ visibility: string }>;
        const allInternal = drows.every((d) => d.visibility === "internal");
        add(G2, "見える文書はすべて internal", !docs.error && allInternal,
          docs.error ? describeError(docs.error) : `${drows.length} 件（internal 以外 ${drows.filter((d) => d.visibility !== "internal").length}）`);
        if (serviceKey) {
          add(G2, "internal 文書がすべて見える（件数一致）", drows.length === internalDocs, `${drows.length} / ${internalDocs}`);
        }

        const ch = await user.from("document_chunks").select("id", { count: "exact", head: true });
        add(G2, "見えるチャンク数 = internal 文書のチャンク数", !ch.error && (!serviceKey || ch.count === internalChunks),
          ch.error ? describeError(ch.error) : `${ch.count} / ${serviceKey ? internalChunks : "?"}`);

        // 実 pgvector 検索: 既存チャンクの Embedding をそのままクエリにする（AI API を呼ばない）
        const sample = await user.from("document_chunks").select("id, embedding").limit(1).maybeSingle();
        if (sample.error || !sample.data) {
          add(G2, "pgvector 検索", false, sample.error ? describeError(sample.error) : "チャンクなし");
        } else {
          const s = sample.data as { id: string; embedding: string };
          const t0 = performance.now();
          const rpc = await user.rpc("match_document_chunks", {
            query_embedding: s.embedding,
            match_threshold: 0,
            match_count: 20,
          });
          const ms = Math.round(performance.now() - t0);
          const hits = (rpc.data ?? []) as Array<{ chunk_id: string; document_id: string; similarity: number }>;
          const top = hits[0];
          add(G2, "pgvector 検索が動く（自分自身が 1 位・類似度≒1）",
            !rpc.error && !!top && top.chunk_id === s.id && top.similarity > 0.999,
            rpc.error ? describeError(rpc.error) : `${hits.length} 件・1 位の類似度 ${top?.similarity.toFixed(4)}・${ms} ms`);
          const visibleIds = new Set(((docs.data ?? []) as Array<{ id: string }>).map((d) => d.id));
          add(G2, "検索結果はすべて閲覧可能な文書のもの", hits.every((h) => visibleIds.has(h.document_id)),
            `${hits.filter((h) => !visibleIds.has(h.document_id)).length} 件が範囲外`);
          add(G2, "検索件数が上限（match_count）以内", hits.length <= 20, `${hits.length} 件`);
        }

        const ing = await user.rpc("replace_document_with_chunks", { p_document: {}, p_chunks: [] });
        add(G2, "取り込み RPC を実行できない", isPermissionDenied(ing.error),
          ing.error ? `拒否（${describeError(ing.error)}）` : "実行できてしまった");

        if (storagePath) {
          const dl = await user.storage.from(BUCKET).download(storagePath);
          let isPdf = false;
          if (dl.data) isPdf = new TextDecoder().decode(new Uint8Array(await dl.data.arrayBuffer()).slice(0, 5)) === "%PDF-";
          add(G2, "internal 文書の PDF をダウンロードできる（RLS 経由）", !dl.error && isPdf, dl.error ? describeError(dl.error) : "PDF を取得");
        }
      } finally {
        await user.auth.signOut({ scope: "local" });
      }
    }
  }

  // ---------- 起動中のアプリ（任意） ----------
  const appUrl = arg("--app-url");
  const G3 = "3. アプリへの未認証アクセス";
  if (!appUrl) {
    add(G3, "アプリ", null, "--app-url 未指定のため省略");
  } else {
    const root = await fetch(appUrl, { redirect: "manual" });
    const loc = root.headers.get("location") ?? "";
    add(G3, "トップページはログイン画面へ転送", root.status >= 300 && root.status < 400 && /\/login/.test(loc), `HTTP ${root.status}`);
    const login = await fetch(`${appUrl}/login`);
    add(G3, "セキュリティヘッダー", login.headers.get("x-content-type-options") === "nosniff" && !!login.headers.get("x-frame-options"),
      `nosniff=${login.headers.get("x-content-type-options") ?? "なし"}・X-Frame-Options=${login.headers.get("x-frame-options") ?? "なし"}`);
    if (documentId) {
      const f = await fetch(`${appUrl}/api/documents/${documentId}/file`);
      add(G3, "実在文書の PDF API は 401", f.status === 401, `HTTP ${f.status}`);
      const f2 = await fetch(`${appUrl}/api/documents/${documentId}/file`, { headers: { Authorization: `Bearer ${anonKey}` } });
      add(G3, "anon キーを付けても PDF API は 401", f2.status === 401, `HTTP ${f2.status}`);
    }
    const chat = await fetch(`${appUrl}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: "検証" }),
    });
    add(G3, "チャット API は 401（AI API は呼ばれない）", chat.status === 401, `HTTP ${chat.status}`);
  }

  console.log(formatVerifyReport(results));
  process.exitCode = results.some((r) => r.status === "ng") ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : "検証に失敗しました");
  process.exitCode = 1;
});
