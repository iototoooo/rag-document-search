import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * マイグレーション SQL の静的セキュリティ検査（DB には接続しない）。
 * 実 DB での確認は supabase/verify/01_after_migration_checks.sql で行う。
 */

const dir = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const sql = files.map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
// コメントを除去して判定する
const code = sql.replace(/--.*$/gm, "");
const norm = code.replace(/\s+/g, " ").toLowerCase();

describe("supabase/migrations の静的検査", () => {
  it("ファイルはタイムスタンプ順に 3 本（スキーマ → 取り込み RPC → service_role 権限）", () => {
    expect(files).toEqual([
      "20261122000000_rag_schema.sql",
      "20261122000100_ingest_rpc.sql",
      "20261123000000_service_role_ingest_grants.sql",
    ]);
  });

  it("service_role には取り込み対象 2 テーブルの読み書きだけを付与する（app_users は対象外）", () => {
    const grants = [...norm.matchAll(/grant ([^;]+) on ([^;]+) to service_role;/g)].map((m) => ({
      privs: m[1].trim(),
      target: m[2].trim(),
    }));
    // ファイル順: 取り込み RPC の実行権限 → テーブル権限
    expect(grants).toEqual([
      { privs: "execute", target: "function public.replace_document_with_chunks(jsonb, jsonb)" },
      { privs: "select, insert, update, delete", target: "public.documents, public.document_chunks" },
    ]);
    expect(norm).not.toMatch(/grant [^;]* on [^;]*app_users[^;]* to service_role/);
    expect(norm).not.toMatch(/grant all[^;]* to service_role/);
  });

  it("作成したすべての public テーブルで RLS を有効化している", () => {
    const tables = [...norm.matchAll(/create table public\.(\w+)/g)].map((m) => m[1]);
    expect(tables.sort()).toEqual(["app_users", "document_chunks", "documents"]);
    for (const t of tables) {
      expect(norm).toContain(`alter table public.${t} enable row level security`);
    }
  });

  it("ポリシーは SELECT のみで、authenticated 限定", () => {
    const policies = [...norm.matchAll(/create policy (\w+) on ([\w.]+) for (\w+) to (\w+)/g)];
    expect(policies.length).toBe(4);
    for (const [, , , cmd, role] of policies) {
      expect(cmd).toBe("select");
      expect(role).toBe("authenticated");
    }
    // anon にはどの権限も付与しない
    expect(norm).not.toMatch(/grant [^;]* to [^;]*\banon\b/);
  });

  it("文書は visibility = 'internal' のみ閲覧可（department / restricted を許可するポリシーがない）", () => {
    const docPolicy = norm.match(/create policy documents_select_internal[^;]+;/)?.[0] ?? "";
    expect(docPolicy).toContain("visibility = 'internal'");
    expect(docPolicy).toContain("public.is_active_app_user()");
    expect(norm).not.toMatch(/using \([^;]*visibility = 'department'/);
    expect(norm).not.toMatch(/using \([^;]*visibility = 'restricted'/);
    // 既定値は最も厳しい restricted
    expect(norm).toContain("visibility text not null default 'restricted'");
  });

  it("Embedding 列は vector(1536)（text-embedding-3-small と一致）", () => {
    expect(norm).toContain("embedding extensions.vector(1536) not null");
    expect(norm).toContain("query_embedding extensions.vector(1536)");
    expect(norm).toContain("::extensions.vector(1536)");
  });

  it("検索 RPC は security invoker・search_path 固定・anon 実行不可", () => {
    const fn = norm.match(/create function public\.match_document_chunks[\s\S]+?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("security invoker");
    expect(fn).not.toContain("security definer");
    expect(fn).toContain("set search_path = ''");
    expect(norm).toMatch(/revoke execute on function public\.match_document_chunks\([^)]*\) from public, anon;/);
  });

  it("取り込み RPC は service_role のみ実行可", () => {
    expect(norm).toMatch(
      /revoke execute on function public\.replace_document_with_chunks\(jsonb, jsonb\) from public, anon, authenticated;/,
    );
    expect(norm).toMatch(/grant execute on function public\.replace_document_with_chunks\(jsonb, jsonb\) to service_role;/);
  });

  it("security definer 関数は is_active_app_user のみで、search_path 固定", () => {
    const definers = [...norm.matchAll(/create function public\.(\w+)[^$]*?security definer/g)].map(
      (m) => m[1],
    );
    expect(definers).toEqual(["is_active_app_user"]);
    const fn = norm.match(/create function public\.is_active_app_user[\s\S]+?\$\$;/)?.[0] ?? "";
    expect(fn).toContain("set search_path = ''");
    expect(fn).toContain("(select auth.uid())");
  });

  it("テーブル権限: anon は剥奪、authenticated は SELECT のみ", () => {
    expect(norm).toContain(
      "revoke all on public.app_users, public.documents, public.document_chunks from public, anon, authenticated;",
    );
    expect(norm).toContain(
      "grant select on public.app_users, public.documents, public.document_chunks to authenticated;",
    );
    expect(norm).not.toMatch(/grant (insert|update|delete|all)[^;]* to (anon|authenticated)/);
  });

  it("Storage バケット documents は非公開で、書き込みポリシーがない", () => {
    expect(norm).toMatch(/insert into storage\.buckets[^;]*'documents', 'documents', false/);
    expect(norm).toContain("on conflict (id) do update set public = false");
    expect(norm).not.toMatch(/create policy \w+ on storage\.objects for (insert|update|delete|all)/);
  });
});

describe("supabase/verify の確認用 SQL は読み取り専用", () => {
  const verifyDir = path.resolve(__dirname, "..", "..", "supabase", "verify");
  const readOnlyFiles = readdirSync(verifyDir).filter((f) => /^0\d_.*\.sql$/.test(f));

  it("01・02・03 が存在する", () => {
    expect(readOnlyFiles).toEqual([
      "01_after_migration_checks.sql",
      "02_security_checklist.sql",
      "03_sectest_state.sql",
    ]);
  });

  for (const f of readOnlyFiles) {
    it(`${f} に書き込み・定義変更の文がない`, () => {
      const body = readFileSync(path.join(verifyDir, f), "utf8")
        .replace(/--.*$/gm, "")
        .replace(/'[^']*'/g, "''")
        .toLowerCase();
      expect(body).not.toMatch(
        /\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|set|begin|commit|call|do|copy)\b/,
      );
      expect(body).toMatch(/\bselect\b/);
    });
  }

  it("02 の一括チェックは番号が 1 から連番で重複しない", () => {
    const body = readFileSync(path.join(verifyDir, "02_security_checklist.sql"), "utf8");
    const nos = [...body.matchAll(/select (\d+), '/g)].map((m) => Number(m[1]));
    expect(nos).toEqual(Array.from({ length: nos.length }, (_, i) => i + 1));
    expect(nos.length).toBe(41);
  });

  it("No.41 は service_role の documents・document_chunks への 4 権限を個別に確認する", () => {
    const body = readFileSync(path.join(verifyDir, "02_security_checklist.sql"), "utf8").replace(/--.*$/gm, "");
    const s = body.slice(body.indexOf("union all select 41, '")).replace(/\s+/g, " ");
    expect(s).toContain("has_table_privilege('service_role'");
    expect(s).toContain("array['public.documents', 'public.document_chunks']");
    expect(s).toContain("array['SELECT', 'INSERT', 'UPDATE', 'DELETE']");
    expect(s).toContain("'(なし)'");
  });

  describe("security definer 関数の許可リスト（No.30・31）", () => {
    const body = readFileSync(path.join(verifyDir, "02_security_checklist.sql"), "utf8").replace(
      /--.*$/gm,
      "",
    );
    /** "union all select N, ..." から次の "union all select" までを取り出す */
    const item = (no: number) => {
      const start = body.indexOf(`union all select ${no}, '`);
      const end = body.indexOf("union all select", start + 1);
      expect(start, `No.${no}`).toBeGreaterThan(-1);
      return body.slice(start, end).replace(/\s+/g, " ");
    };

    it("No.30 は件数ではなく、許可リスト外の関数名を列挙して「(なし)」と比較する", () => {
      const s = item(30);
      expect(s).toContain("'(なし)',"); // 期待値
      expect(s).toContain("string_agg(p.proname");
      expect(s).toContain("p.prosecdef");
      expect(s).not.toMatch(/count\(\*\)/);
      // 許可リストはちょうど 2 関数・引数なしのみ
      const allow = s.match(/p\.proname in \(([^)]*)\)/)?.[1] ?? "";
      expect(allow.split(",").map((x) => x.trim())).toEqual([
        "'is_active_app_user'",
        "'rls_auto_enable'",
      ]);
      expect(s).toContain("pg_get_function_identity_arguments(p.oid) = ''");
    });

    it("No.31 は rls_auto_enable の definer・search_path=pg_catalog・イベントトリガー関数を個別に検証する", () => {
      const s = item(31);
      expect(s).toContain("p.prosecdef");
      expect(s).toContain("= 'search_path=pg_catalog'");
      expect(s).toContain("p.prorettype = 'event_trigger'::regtype");
      // 不一致時は実際の設定を actual に表示する
      expect(s).toContain("'definer='");
      // 存在しないプロジェクトでも OK
      expect(s).toMatch(/\), 'OK'\)\s*$/);
    });

    it("is_active_app_user 側の設定（definer・search_path 空・anon 不可）は No.27〜29 で検証している", () => {
      expect(item(27)).toContain("to_regprocedure('public.is_active_app_user()')");
      expect(item(28)).toContain(`search_path=""`);
      expect(item(29)).toContain("has_function_privilege('anon'");
    });

    it("本システムのマイグレーションが作る security definer 関数は is_active_app_user のみ（許可リストと整合）", () => {
      const definers = [
        ...norm.matchAll(/create function public\.(\w+)[^$]*?security definer/g),
      ].map((m) => m[1]);
      expect(definers).toEqual(["is_active_app_user"]);
    });
  });
});
