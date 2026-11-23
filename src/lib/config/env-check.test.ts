import { describe, expect, it } from "vitest";
import { checkSupabaseEnv, detectSupabaseKeyKind, formatCheckReport } from "./env-check";

/** 署名部はダミー。role クレームだけを持つテスト用 JWT 形式の文字列 */
const fakeJwt = (role: string) =>
  [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ iss: "supabase", role })).toString("base64url"),
    "dummysignature",
  ].join(".");

const ANON = fakeJwt("anon");
const SERVICE = fakeJwt("service_role");

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghij.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  ALLOWED_EMAIL_DOMAINS: "corp.example.jp",
};

const levelOf = (env: Record<string, string>, key: string) =>
  checkSupabaseEnv(env).filter((i) => i.key === key).map((i) => i.level);

describe("detectSupabaseKeyKind", () => {
  it("新形式・旧形式（JWT）のキー種別を判定する", () => {
    expect(detectSupabaseKeyKind("sb_publishable_xxx")).toBe("publishable");
    expect(detectSupabaseKeyKind("sb_secret_xxx")).toBe("secret");
    expect(detectSupabaseKeyKind(ANON)).toBe("jwt-anon");
    expect(detectSupabaseKeyKind(SERVICE)).toBe("jwt-service_role");
    expect(detectSupabaseKeyKind("garbage")).toBe("unknown");
  });
});

describe("checkSupabaseEnv", () => {
  it("正しい設定はすべて OK", () => {
    expect(checkSupabaseEnv(good).every((i) => i.level === "ok")).toBe(true);
    expect(
      checkSupabaseEnv({
        ...good,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_abc",
        SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc",
      }).every((i) => i.level === "ok"),
    ).toBe(true);
  });

  it("anon 欄に service_role / Secret key を入れると NG（ブラウザ公開の防止）", () => {
    expect(levelOf({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE }, "NEXT_PUBLIC_SUPABASE_ANON_KEY")).toContain("error");
    expect(
      levelOf({ ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_abc" }, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    ).toContain("error");
  });

  it("service_role 欄に anon key を入れると NG", () => {
    expect(levelOf({ ...good, SUPABASE_SERVICE_ROLE_KEY: ANON }, "SUPABASE_SERVICE_ROLE_KEY")).toEqual(["error"]);
  });

  it("service_role キーが未設定なら注意のみ（ログイン確認には不要）", () => {
    expect(levelOf({ ...good, SUPABASE_SERVICE_ROLE_KEY: "" }, "SUPABASE_SERVICE_ROLE_KEY")).toEqual(["warn"]);
  });

  it("NEXT_PUBLIC_ 変数に service_role と同じ値・秘密らしい名前があると NG", () => {
    expect(levelOf({ ...good, NEXT_PUBLIC_FOO: SERVICE }, "NEXT_PUBLIC_FOO")).toContain("error");
    expect(levelOf({ ...good, NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: "x" }, "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY")).toContain("error");
  });

  it("URL: 未設定・テンプレート値・http・パス付きは NG", () => {
    const k = "NEXT_PUBLIC_SUPABASE_URL";
    expect(levelOf({ ...good, [k]: "" }, k)).toEqual(["error"]);
    expect(levelOf({ ...good, [k]: "https://your-project-ref.supabase.co" }, k)).toEqual(["error"]);
    expect(levelOf({ ...good, [k]: "http://abcdefghij.supabase.co" }, k)).toEqual(["error"]);
    expect(levelOf({ ...good, [k]: "https://abcdefghij.supabase.co/rest/v1" }, k)).toEqual(["error"]);
  });

  it("ALLOWED_EMAIL_DOMAINS: example.com は注意、メールアドレス形式は NG、空は注意", () => {
    const k = "ALLOWED_EMAIL_DOMAINS";
    expect(levelOf({ ...good, [k]: "example.com" }, k)).toEqual(["warn"]);
    expect(levelOf({ ...good, [k]: "user@corp.example.jp" }, k)).toEqual(["error"]);
    expect(levelOf({ ...good, [k]: "" }, k)).toEqual(["warn"]);
    expect(levelOf({ ...good, [k]: "a.co.jp, B.example.com" }, k)).toEqual(["ok"]);
  });

  it("レポートにキーや URL の値を含めない", () => {
    const bad = { ...good, NEXT_PUBLIC_SUPABASE_ANON_KEY: SERVICE, NEXT_PUBLIC_X: SERVICE };
    const report = formatCheckReport(checkSupabaseEnv(bad)) + formatCheckReport(checkSupabaseEnv(good));
    expect(report).not.toContain(SERVICE);
    expect(report).not.toContain(ANON);
    expect(report).not.toContain("abcdefghij");
    expect(report).not.toContain("corp.example.jp");
  });
});
