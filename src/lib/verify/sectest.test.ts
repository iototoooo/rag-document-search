import { describe, expect, it } from "vitest";
import {
  EXPECTED_BASELINE,
  SECTEST_FIXTURES,
  SECTEST_PREFIX,
  baselineMismatches,
  buildRpcArgs,
  createCookieSessionClient,
  dummyEmbedding,
  expectedSearchHits,
  minimalPdf,
  planCleanup,
  type SectestManifest,
} from "./sectest";

const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe("テスト用データの生成（DB には接続しない）", () => {
  it("ダミーは部署限定 1 件・restricted 1 件で、internal を含まない", () => {
    expect(SECTEST_FIXTURES.map((f) => f.visibility)).toEqual(["department", "restricted"]);
  });

  it("source_key・ファイル名・Storage パス・chunk_key がすべてテスト用の接頭辞で始まる", () => {
    for (const f of SECTEST_FIXTURES) {
      const { storagePath, args } = buildRpcArgs(f);
      expect(args.p_document.source_key.startsWith(SECTEST_PREFIX)).toBe(true);
      expect(args.p_document.file_name.startsWith(SECTEST_PREFIX)).toBe(true);
      expect(storagePath.startsWith(SECTEST_PREFIX)).toBe(true);
      expect(args.p_document.storage_path).toBe(storagePath);
      expect(args.p_chunks.every((c) => c.chunk_key.startsWith(SECTEST_PREFIX))).toBe(true);
      expect(args.p_document.visibility).not.toBe("internal");
      expect(args.p_document.title).toContain("セキュリティ検証用ダミー");
      expect(args.p_chunks[0].content).toContain(f.canary);
      expect(args.p_document.content_hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("合成 Embedding は 1536 次元の単位ベクトルで決定的、2 件は互いにほぼ無相関", () => {
    const [a, b] = SECTEST_FIXTURES.map((f) => dummyEmbedding(f.seed));
    expect(a).toHaveLength(1536);
    expect(dot(a, a)).toBeCloseTo(1, 4);
    expect(dummyEmbedding(SECTEST_FIXTURES[0].seed)).toEqual(a);
    expect(Math.abs(dot(a, b))).toBeLessThan(0.2);
  });

  it("最小 PDF は %PDF で始まり、xref のオフセットが各オブジェクトを指す", () => {
    const pdf = new TextDecoder().decode(minimalPdf("HELLO (test)"));
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    const offsets = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(5);
    offsets.forEach((off, i) => expect(pdf.slice(off).startsWith(`${i + 1} 0 obj`)).toBe(true));
    expect(pdf).toContain("\\(test\\)");
  });
});

describe("検索件数の期待値", () => {
  it("類似度が負のチャンクは RPC が返さないため数えない（最大 20 件）", () => {
    const q = [1, 0];
    expect(expectedSearchHits([[1, 0], [0.5, 0.5], [-1, 0], [0, 1]], q)).toBe(3); // 1, 0.71, -1, 0 → 3 件
    expect(expectedSearchHits(Array.from({ length: 30 }, () => [1, 0]), q)).toBe(20);
  });
});

describe("件数の照合", () => {
  it("既存の状態（文書 5・チャンク 14・登録ユーザー 1）と一致しなければ差分を返す", () => {
    expect(baselineMismatches(EXPECTED_BASELINE)).toEqual([]);
    expect(baselineMismatches({ documents: 6, chunks: 14, appUsers: 2 })).toEqual([
      "documents: 期待 5 / 実際 6",
      "appUsers: 期待 1 / 実際 2",
    ]);
  });

  it("app_users を取得できない（null）場合は比較対象外（SQL Editor で確認）", () => {
    expect(baselineMismatches({ documents: 5, chunks: 14, appUsers: null })).toEqual([]);
  });
});

describe("削除対象の照合（planCleanup）", () => {
  const manifest: SectestManifest = {
    version: 1,
    projectHost: "x.supabase.co",
    createdAt: "2026-11-24T00:00:00Z",
    baseline: { documents: 5, chunks: 14, appUsers: 1 },
    items: [
      { sourceKey: "zz-sectest-department", visibility: "department", documentId: "d1", chunkIds: ["c1"], storagePath: "zz-sectest-department/a.pdf", storageUploaded: true },
      { sourceKey: "zz-sectest-restricted", visibility: "restricted", documentId: "d2", chunkIds: ["c2"], storagePath: "zz-sectest-restricted/b.pdf", storageUploaded: true },
    ],
  };
  const rows = [
    { id: "d1", source_key: "zz-sectest-department", storage_path: "zz-sectest-department/a.pdf", visibility: "department" },
    { id: "d2", source_key: "zz-sectest-restricted", storage_path: "zz-sectest-restricted/b.pdf", visibility: "restricted" },
  ];

  it("マニフェストと DB が一致すれば、その 2 件と Storage 2 件だけが対象", () => {
    const p = planCleanup(manifest, rows);
    expect(p.problems).toEqual([]);
    expect(p.targets.map((t) => t.id)).toEqual(["d1", "d2"]);
    expect(p.storagePaths).toEqual(["zz-sectest-department/a.pdf", "zz-sectest-restricted/b.pdf"]);
  });

  it("source_key が記録と違う・internal になっている行は対象にせず問題として報告", () => {
    const p = planCleanup(manifest, [
      { ...rows[0], source_key: "zz-sectest-other" },
      { ...rows[1], visibility: "internal" },
    ]);
    expect(p.targets).toEqual([]);
    expect(p.problems).toHaveLength(2);
  });

  it("マニフェストにテスト用以外の値があれば報告（既存文書を消さない）", () => {
    const bad = { ...manifest, items: [{ ...manifest.items[0], sourceKey: "demo-doc1-travel-rules" }] };
    const p = planCleanup(bad, rows.slice(0, 1));
    expect(p.targets).toEqual([]);
    expect(p.problems.join()).toContain("テスト用以外");
  });

  it("マニフェストにないテスト用の行があれば報告（勝手に消さない）", () => {
    const p = planCleanup(manifest, [...rows, { id: "d9", source_key: "zz-sectest-x", storage_path: null, visibility: "restricted" }]);
    expect(p.problems.join()).toContain("d9");
  });

  it("文書作成前に中断した場合は Storage だけを対象にする", () => {
    const partial = { ...manifest, items: [{ ...manifest.items[0], documentId: null }] };
    const p = planCleanup(partial, []);
    expect(p.problems).toEqual([]);
    expect(p.targets).toEqual([]);
    expect(p.storagePaths).toEqual(["zz-sectest-department/a.pdf"]);
  });
});

describe("アプリ用 Cookie セッション（fetch はモック）", () => {
  it("ログインするとアプリと同じ形式の Cookie を保持し、ログアウトで消える", async () => {
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp, role: "authenticated" })}.sig`;
    const calls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      calls.push(u);
      if (u.includes("/auth/v1/token")) {
        return new Response(
          JSON.stringify({
            access_token: accessToken,
            token_type: "bearer",
            expires_in: 3600,
            expires_at: exp,
            refresh_token: "r1",
            user: { id: "u1", aud: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 204 });
    }) as typeof fetch;

    const s = createCookieSessionClient("https://abc.supabase.co", "sb_publishable_x", { fetch: fakeFetch });
    const r = await s.client.auth.signInWithPassword({ email: "a@example.com", password: "x" });
    expect(r.error).toBeNull();
    expect(s.cookieCount()).toBeGreaterThan(0);
    expect(s.cookieHeader()).toMatch(/^sb-abc-auth-token(\.\d+)?=/);
    expect(calls.some((c) => c.includes("grant_type=password"))).toBe(true);

    await s.client.auth.signOut({ scope: "local" });
    expect(s.cookieCount()).toBe(0);
  });
});
