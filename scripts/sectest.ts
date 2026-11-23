/**
 * T-1〜T-3 実環境セキュリティテスト（AI API は呼ばない）
 *
 *   npm run sectest                       # = plan: 現状確認と作成予定の表示のみ（読み取り専用）
 *   npm run sectest -- setup --execute    # ⚠ DB 変更: ダミー文書 2 件（部署限定・restricted）を作成
 *   npm run sectest -- verify [--app-url http://localhost:3000]   # 検証（読み取り + ログイン）
 *   npm run sectest -- cleanup            # 削除予定の表示のみ（ドライラン）
 *   npm run sectest -- cleanup --execute  # ⚠ DB 変更: マニフェストに記録したテスト用データだけを削除
 *
 * 必要な環境変数（.env.local）:
 *   setup / cleanup: SUPABASE_SERVICE_ROLE_KEY
 *   verify: VERIFY_USER_EMAIL / VERIFY_USER_PASSWORD（app_users 登録済みの既存テストユーザー）
 *           VERIFY_UNREGISTERED_EMAIL / VERIFY_UNREGISTERED_PASSWORD（T-1 用。app_users に登録しない）
 *
 * 作成した ID は reports/sectest/manifest.json（.gitignore 対象）に記録し、削除はその ID だけを対象にする。
 * 出力にキー・パスワード・メールアドレス・本文は含めない。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describeError, formatVerifyReport, type VerifyResult } from "@/lib/verify/db-security";
import {
  EXPECTED_BASELINE,
  SECTEST_FIXTURES,
  SECTEST_PREFIX,
  baselineMismatches,
  buildRpcArgs,
  createCookieSessionClient,
  dummyEmbedding,
  expectedSearchHits,
  planCleanup,
  vectorLiteral,
  type Counts,
  type DbDocRow,
  type SectestManifest,
} from "@/lib/verify/sectest";

const BUCKET = "documents";
const OUT_DIR = path.join("reports", "sectest");
const MANIFEST = path.join(OUT_DIR, "manifest.json");
const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

try {
  process.loadEnvFile(".env.local");
} catch {
  // 環境変数のみを使う
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const argv = process.argv.slice(2);
const command = argv.find((a) => !a.startsWith("--")) ?? "plan";
const execute = argv.includes("--execute");
const appUrl = (() => {
  const i = argv.indexOf("--app-url");
  return i >= 0 ? argv[i + 1] : undefined;
})();

function admin(): SupabaseClient {
  if (!serviceKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です");
  return createClient(url, serviceKey, noSession);
}

async function counts(a: SupabaseClient): Promise<Counts> {
  const d = await a.from("documents").select("id", { count: "exact", head: true });
  const c = await a.from("document_chunks").select("id", { count: "exact", head: true });
  if (d.error || c.error) throw new Error(`件数の取得に失敗: ${describeError(d.error ?? c.error)}`);
  // service_role には app_users の権限を付与していない（最小権限）。取得できなければ null
  const u = await a.from("app_users").select("user_id", { count: "exact", head: true });
  return { documents: d.count ?? 0, chunks: c.count ?? 0, appUsers: u.error ? null : (u.count ?? 0) };
}

/** Supabase Auth のユーザー数（管理 API・読み取りのみ）。T-1 のユーザー作成・削除の確認用 */
async function authUserCount(a: SupabaseClient): Promise<number | null> {
  const r = await a.auth.admin.listUsers({ page: 1, perPage: 100 });
  return r.error ? null : r.data.users.length;
}

async function prefixedDocs(a: SupabaseClient): Promise<DbDocRow[]> {
  const r = await a
    .from("documents")
    .select("id, source_key, storage_path, visibility")
    .like("source_key", `${SECTEST_PREFIX}%`);
  if (r.error) throw new Error(`テスト用文書の確認に失敗: ${describeError(r.error)}`);
  return r.data as DbDocRow[];
}

const fmt = (c: Counts) =>
  `文書 ${c.documents} / チャンク ${c.chunks} / 登録ユーザー（app_users）${c.appUsers ?? "SQL Editor で確認"}`;
const SQL_HINT = "app_users の件数は SQL Editor で supabase/verify/03_sectest_state.sql を実行して確認してください";

function readManifest(): SectestManifest | null {
  return existsSync(MANIFEST) ? (JSON.parse(readFileSync(MANIFEST, "utf8")) as SectestManifest) : null;
}
function saveManifest(m: SectestManifest) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(MANIFEST, JSON.stringify(m, null, 2), "utf8");
}

// ---------------------------------------------------------------------
async function plan() {
  const a = admin();
  const c = await counts(a);
  const pre = await prefixedDocs(a);
  console.log(`接続先: ${new URL(url).host}`);
  console.log(`現在: ${fmt(c)}（想定: ${fmt(EXPECTED_BASELINE)}）`);
  const mm = baselineMismatches(c);
  console.log(mm.length ? `⚠ 想定と異なります: ${mm.join(", ")}` : "想定どおり");
  console.log(`Auth ユーザー数: ${(await authUserCount(a)) ?? "取得不可"}（T-1 のユーザー作成前は 1、作成後は 2 の想定）`);
  if (c.appUsers === null) console.log(SQL_HINT);
  console.log(`テスト用（${SECTEST_PREFIX}）の既存文書: ${pre.length} 件`);
  console.log(`マニフェスト: ${existsSync(MANIFEST) ? "あり（前回のテストデータが残っている可能性）" : "なし"}`);
  console.log("\nsetup --execute で作成するもの（AI API 呼び出しなし・費用 $0）:");
  for (const f of SECTEST_FIXTURES) {
    const { storagePath } = buildRpcArgs(f);
    console.log(`  - documents 1 行: ${f.sourceKey}（visibility=${f.visibility}${f.department ? `, department=${f.department}` : ""}）`);
    console.log(`    document_chunks 1 行（合成 Embedding）、Storage 1 件: ${storagePath}`);
  }
  console.log(`作成後の想定: ${fmt({ ...EXPECTED_BASELINE, documents: EXPECTED_BASELINE.documents + 2, chunks: EXPECTED_BASELINE.chunks + 2 })}`);
}

// ---------------------------------------------------------------------
async function setup() {
  const a = admin();
  const before = await counts(a);
  const problems = [
    ...baselineMismatches(before),
    ...((await prefixedDocs(a)).length ? ["テスト用の文書が既にあります（先に cleanup）"] : []),
    ...(existsSync(MANIFEST) ? ["マニフェストが残っています（先に cleanup）"] : []),
  ];
  console.log(`作成前: ${fmt(before)}`);
  if (before.appUsers === null) console.log(SQL_HINT);
  if (problems.length) throw new Error(`前提条件を満たさないため中止しました:\n- ${problems.join("\n- ")}`);
  if (!execute) {
    console.log("ドライランです。作成するには --execute を付けてください。");
    return;
  }

  const manifest: SectestManifest = {
    version: 1,
    projectHost: new URL(url).host,
    createdAt: new Date().toISOString(),
    baseline: before,
    items: [],
  };
  for (const f of SECTEST_FIXTURES) {
    const { pdf, storagePath, args } = buildRpcArgs(f);
    const item = { sourceKey: f.sourceKey, visibility: f.visibility, documentId: null as string | null, chunkIds: [] as string[], storagePath, storageUploaded: false };
    manifest.items.push(item);
    saveManifest(manifest); // 途中で失敗しても cleanup できるよう、各段階で記録する

    const up = await a.storage.from(BUCKET).upload(storagePath, pdf, { contentType: "application/pdf", upsert: false });
    if (up.error) throw new Error(`Storage へのアップロードに失敗（${f.sourceKey}）: ${describeError(up.error)}。cleanup を実行してください`);
    item.storageUploaded = true;
    saveManifest(manifest);

    const rpc = await a.rpc("replace_document_with_chunks", args);
    if (rpc.error || typeof rpc.data !== "string") {
      throw new Error(`文書の作成に失敗（${f.sourceKey}）: ${describeError(rpc.error)}。cleanup を実行してください`);
    }
    item.documentId = rpc.data;
    const ch = await a.from("document_chunks").select("id").eq("document_id", rpc.data);
    item.chunkIds = ((ch.data ?? []) as Array<{ id: string }>).map((r) => r.id);
    saveManifest(manifest);
    console.log(`作成: ${f.sourceKey} → 文書 ${item.documentId}、チャンク ${item.chunkIds.length} 件`);
  }

  const after = await counts(a);
  const expected = { ...before, documents: before.documents + 2, chunks: before.chunks + 2 };
  const mm = baselineMismatches(after, expected);
  console.log(`作成後: ${fmt(after)}（想定: ${fmt(expected)}）${mm.length ? ` ⚠ ${mm.join(", ")}` : " OK"}`);
  console.log(`記録: ${MANIFEST}`);
}

// ---------------------------------------------------------------------
async function verify() {
  const manifest = readManifest();
  if (!manifest) throw new Error("マニフェストがありません。先に setup --execute を実行してください");
  const dummyDocIds = manifest.items.map((i) => i.documentId).filter((x): x is string => !!x);
  const dummyChunkIds = new Set(manifest.items.flatMap((i) => i.chunkIds));
  const canaries = SECTEST_FIXTURES.map((f) => f.canary);
  const results: VerifyResult[] = [];
  const add = (group: string, name: string, ok: boolean | null, detail: string) =>
    results.push({ group, name, status: ok === null ? "skip" : ok ? "ok" : "ng", detail });

  // 管理者側の前提（テストデータが存在すること）
  let internalDocId: string | null = null;
  let internalPath: string | null = null;
  /** 登録ユーザーの検索で返るはずの件数（internal チャンクとの類似度から算出。null = 算出不可） */
  const expectedHits = new Map<number, number>();
  if (serviceKey) {
    const a = admin();
    const pre = await prefixedDocs(a);
    add("0. 前提（service_role・読み取り）", "テスト用文書 2 件が存在", pre.length === 2 && dummyDocIds.every((id) => pre.some((r) => r.id === id)),
      `${pre.length} 件（department ${pre.filter((r) => r.visibility === "department").length} / restricted ${pre.filter((r) => r.visibility === "restricted").length}）`);
    const internal = await a.from("documents").select("id, storage_path").eq("visibility", "internal").limit(1).maybeSingle();
    internalDocId = (internal.data as { id: string } | null)?.id ?? null;
    internalPath = (internal.data as { storage_path: string } | null)?.storage_path ?? null;
    const ids = ((await a.from("documents").select("id").eq("visibility", "internal")).data ?? []).map((d) => (d as { id: string }).id);
    const embs = ((await a.from("document_chunks").select("embedding").in("document_id", ids)).data ?? []).map(
      (r) => JSON.parse((r as { embedding: string }).embedding) as number[],
    );
    for (const f of SECTEST_FIXTURES) expectedHits.set(f.seed, expectedSearchHits(embs, dummyEmbedding(f.seed)));
  }

  /** 1 ユーザー分の検証。expectRegistered=true なら internal 5 件が見え、テスト文書だけ見えないこと */
  async function checkUser(group: string, email: string, password: string, expectRegistered: boolean) {
    if (!email || !password) {
      add(group, "ログイン", null, "メール・パスワードが未設定のため省略");
      return;
    }
    const s = createCookieSessionClient(url, anonKey);
    const login = await s.client.auth.signInWithPassword({ email, password });
    if (login.error || !login.data.user) {
      add(group, "ログイン", false, describeError(login.error));
      return;
    }
    try {
      const c = s.client;
      const me = await c.from("app_users").select("user_id");
      add(group, expectRegistered ? "app_users は自分の 1 行のみ" : "app_users に自分の行がない（未登録）",
        !me.error && (me.data?.length ?? -1) === (expectRegistered ? 1 : 0), me.error ? describeError(me.error) : `${me.data?.length} 行`);

      const docs = await c.from("documents").select("id, visibility");
      const drows = (docs.data ?? []) as Array<{ id: string; visibility: string }>;
      const expectedDocs = expectRegistered ? EXPECTED_BASELINE.documents : 0;
      add(group, `見える文書が ${expectedDocs} 件・すべて internal`, !docs.error && drows.length === expectedDocs && drows.every((d) => d.visibility === "internal"),
        docs.error ? describeError(docs.error) : `${drows.length} 件（internal 以外 ${drows.filter((d) => d.visibility !== "internal").length}）`);

      const cnt = await c.from("documents").select("id", { count: "exact", head: true });
      add(group, "件数（count）にもテスト文書が含まれない", !cnt.error && cnt.count === expectedDocs, `${cnt.count}`);
      const chunkCnt = await c.from("document_chunks").select("id", { count: "exact", head: true });
      const expectedChunks = expectRegistered ? EXPECTED_BASELINE.chunks : 0;
      add(group, `見えるチャンクが ${expectedChunks} 件`, !chunkCnt.error && chunkCnt.count === expectedChunks, `${chunkCnt.count}`);

      const direct = await c.from("documents").select("id").in("id", dummyDocIds);
      add(group, "テスト文書を ID 指定でも取得できない", !direct.error && (direct.data?.length ?? 0) === 0, `${direct.data?.length ?? 0} 件`);
      const directChunks = await c.from("document_chunks").select("id").in("id", [...dummyChunkIds]);
      add(group, "テストチャンクを ID 指定でも取得できない", !directChunks.error && (directChunks.data?.length ?? 0) === 0, `${directChunks.data?.length ?? 0} 件`);

      // pgvector 検索: テスト文書と同じベクトルで検索（漏えいすれば類似度≒1 で 1 位に出る）
      for (const f of SECTEST_FIXTURES) {
        const rpc = await c.rpc("match_document_chunks", {
          query_embedding: vectorLiteral(dummyEmbedding(f.seed)),
          match_threshold: 0,
          match_count: 50,
        });
        const hits = (rpc.data ?? []) as Array<{ chunk_id: string; document_id: string; content: string; file_name: string; similarity: number }>;
        const leaked = hits.filter((h) => dummyChunkIds.has(h.chunk_id) || dummyDocIds.includes(h.document_id) || h.file_name.startsWith(SECTEST_PREFIX) || canaries.some((k) => h.content.includes(k)));
        const top = hits[0]?.similarity ?? 0;
        const visibleIds = new Set(drows.map((d) => d.id));
        const outside = hits.filter((h) => !visibleIds.has(h.document_id)).length;
        // 件数の期待値: 未登録は 0、登録済みは internal チャンクのうち類似度 >= 0 のもの（service_role で算出）
        const want = expectRegistered ? (expectedHits.get(f.seed) ?? null) : 0;
        add(group, `検索に ${f.visibility} 文書が出ない（出典にも出ない）`,
          !rpc.error && leaked.length === 0 && outside === 0 && (want === null || hits.length === want),
          rpc.error ? describeError(rpc.error) : `${hits.length} 件（期待 ${want ?? "算出不可"}）・漏えい ${leaked.length}・閲覧範囲外 ${outside}・1 位の類似度 ${top.toFixed(3)}`);
      }

      for (const item of manifest!.items) {
        const dl = await c.storage.from(BUCKET).download(item.storagePath);
        add(group, `${item.visibility} の PDF を Storage から取得できない`, !!dl.error, dl.error ? "拒否" : "取得できてしまった");
      }
      if (internalPath) {
        const dl = await c.storage.from(BUCKET).download(internalPath);
        add(group, expectRegistered ? "internal の PDF は取得できる（対照）" : "internal の PDF も取得できない", expectRegistered ? !dl.error : !!dl.error, dl.error ? "拒否" : "取得");
      }

      // アプリ経由（ブラウザと同じ Cookie）
      if (appUrl) {
        const headers = { Cookie: s.cookieHeader() };
        for (const item of manifest!.items) {
          if (!item.documentId) continue;
          const r = await fetch(`${appUrl}/api/documents/${item.documentId}/file`, { headers });
          const want = expectRegistered ? 404 : 403;
          add(group, `アプリ: ${item.visibility} の PDF API は ${want}`, r.status === want, `HTTP ${r.status}`);
        }
        if (internalDocId) {
          const r = await fetch(`${appUrl}/api/documents/${internalDocId}/file`, { headers });
          const want = expectRegistered ? 200 : 403;
          add(group, `アプリ: internal の PDF API は ${want}${expectRegistered ? "（対照）" : ""}`, r.status === want, `HTTP ${r.status}`);
        }
        if (!expectRegistered) {
          // 未登録ユーザーは認可で止まるため、Embedding・LLM は呼ばれない（費用なし）
          const chat = await fetch(`${appUrl}/api/chat`, {
            method: "POST",
            headers: { ...headers, "content-type": "application/json" },
            body: JSON.stringify({ question: "セキュリティ検証" }),
          });
          add(group, "アプリ: チャット API は 403（AI API は呼ばれない）", chat.status === 403, `HTTP ${chat.status}`);
          const page = await fetch(appUrl, { headers, redirect: "manual" });
          const html = page.status === 200 ? await page.text() : "";
          add(group, "アプリ: 画面は「利用権限がありません」", html.includes("利用権限がありません"), `HTTP ${page.status}`);
        }
        // 登録ユーザーの /api/chat は Claude・OpenAI を呼ぶため、このテストでは実行しない
      } else {
        add(group, "アプリ経由の確認", null, "--app-url 未指定のため省略");
      }
    } finally {
      await s.client.auth.signOut({ scope: "local" });
    }
  }

  await checkUser("1. 登録済みユーザー（T-2・T-3）", process.env.VERIFY_USER_EMAIL ?? "", process.env.VERIFY_USER_PASSWORD ?? "", true);
  await checkUser("2. 未登録ユーザー（T-1）", process.env.VERIFY_UNREGISTERED_EMAIL ?? "", process.env.VERIFY_UNREGISTERED_PASSWORD ?? "", false);

  const report = formatVerifyReport(results);
  console.log(report);
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-verify.md`);
  writeFileSync(file, `# T-1〜T-3 検証結果\n\n\`\`\`\n${report}\n\`\`\`\n`, "utf8");
  console.log(`保存先: ${file}`);
  process.exitCode = results.some((r) => r.status === "ng") ? 1 : 0;
}

// ---------------------------------------------------------------------
async function cleanup() {
  const manifest = readManifest();
  const a = admin();
  const before = await counts(a);
  const rows = await prefixedDocs(a);
  console.log(`削除前: ${fmt(before)}、テスト用文書 ${rows.length} 件、Auth ユーザー ${(await authUserCount(a)) ?? "取得不可"}`);
  if (!manifest) {
    if (rows.length) throw new Error("マニフェストがないのにテスト用文書があります。自動削除せず、手動で確認してください");
    console.log("削除対象はありません。");
    return;
  }
  if (manifest.projectHost !== new URL(url).host) throw new Error("マニフェストの接続先と現在の接続先が異なるため中止しました");

  const p = planCleanup(manifest, rows);
  if (p.problems.length) throw new Error(`照合で問題が見つかったため中止しました:\n- ${p.problems.join("\n- ")}`);
  console.log("削除対象（マニフェストと DB の照合済み）:");
  for (const t of p.targets) console.log(`  - 文書 ${t.id}（${t.source_key}, ${t.visibility}）とそのチャンク`);
  for (const sp of p.storagePaths) console.log(`  - Storage: ${sp}`);
  const expectedAfter = manifest.baseline;
  console.log(`削除後の想定: ${fmt(expectedAfter)}`);
  if (!execute) {
    console.log("ドライランです。削除するには --execute を付けてください。");
    return;
  }

  for (const t of p.targets) {
    // ID・接頭辞・非 internal の 3 条件で絞り込み、1 行ずつ削除（チャンクは外部キーで連鎖削除）
    const del = await a.from("documents").delete().eq("id", t.id).like("source_key", `${SECTEST_PREFIX}%`).neq("visibility", "internal").select("id");
    if (del.error || del.data?.length !== 1) throw new Error(`文書 ${t.id} の削除に失敗: ${describeError(del.error)}`);
    console.log(`削除: 文書 ${t.id}`);
  }
  if (p.storagePaths.length) {
    const rm = await a.storage.from(BUCKET).remove(p.storagePaths);
    if (rm.error) throw new Error(`Storage の削除に失敗: ${describeError(rm.error)}`);
    console.log(`削除: Storage ${rm.data?.length ?? 0} 件`);
  }

  const after = await counts(a);
  const left = await prefixedDocs(a);
  const leftFiles = await a.storage.from(BUCKET).list("", { limit: 1000, search: SECTEST_PREFIX });
  const mm = baselineMismatches(after, expectedAfter);
  console.log(`削除後: ${fmt(after)}、テスト用文書 ${left.length} 件、テスト用 Storage フォルダ ${leftFiles.data?.length ?? "?"} 件、Auth ユーザー ${(await authUserCount(a)) ?? "取得不可"}`);
  if (after.appUsers === null) console.log(SQL_HINT);
  if (mm.length || left.length) throw new Error(`削除後の状態が想定と異なります: ${mm.join(", ")}`);
  renameSync(MANIFEST, MANIFEST.replace(/\.json$/, `.done-${Date.now()}.json`));
  console.log("元の状態に戻りました（マニフェストは .done として保管）。");
  console.log("T-1 の未登録テストユーザーは Dashboard の Authentication > Users で削除してください。");
}

const commands: Record<string, () => Promise<void>> = { plan, setup, verify, cleanup };
if (!url || !anonKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY が未設定です");
  process.exitCode = 1;
} else if (!commands[command]) {
  console.error(`不明なコマンド: ${command}（plan / setup / verify / cleanup）`);
  process.exitCode = 1;
} else {
  commands[command]().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : "失敗しました");
    process.exitCode = 1;
  });
}
