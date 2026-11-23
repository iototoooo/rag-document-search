import { describe, expect, it } from "vitest";
import { assertSafeDeployEnv, findDeployEnvViolations } from "./deploy-guard";

const jwt = (role: string) =>
  [
    Buffer.from('{"alg":"HS256"}').toString("base64url"),
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "sig",
  ].join(".");

const safe = {
  VERCEL: "1",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x",
  OPENAI_API_KEY: "sk-x",
  ANTHROPIC_API_KEY: "sk-ant-x",
  ALLOWED_EMAIL_DOMAINS: "corp.example.jp",
};

describe("deploy-guard", () => {
  it("公開してよい設定だけなら違反なし", () => {
    expect(findDeployEnvViolations(safe)).toEqual([]);
    expect(() => assertSafeDeployEnv(safe)).not.toThrow();
  });

  it("service_role キー・検証用パスワードが設定されていると違反（値は出さない）", () => {
    const v = findDeployEnvViolations({ ...safe, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc", VERIFY_USER_PASSWORD: "pw123456" });
    expect(v.join()).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(v.join()).toContain("VERIFY_USER_PASSWORD");
    expect(v.join()).not.toContain("sb_secret_abc");
    expect(v.join()).not.toContain("pw123456");
  });

  it("NEXT_PUBLIC_ に秘密らしい名前・service_role キーの値があると違反", () => {
    expect(findDeployEnvViolations({ ...safe, NEXT_PUBLIC_OPENAI_API_KEY: "sk-x" })).toHaveLength(1);
    expect(findDeployEnvViolations({ ...safe, NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("service_role") })).toHaveLength(1);
    expect(findDeployEnvViolations({ ...safe, NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_x" })).toHaveLength(1);
  });

  it("Vercel 上ではビルドを止め、ローカル（VERCEL なし）では止めない", () => {
    const bad = { ...safe, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_abc" };
    expect(() => assertSafeDeployEnv(bad)).toThrow(/ビルドを中止/);
    expect(() => assertSafeDeployEnv({ ...bad, VERCEL: undefined })).not.toThrow();
  });
});
