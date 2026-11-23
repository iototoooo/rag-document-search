import { describe, expect, it } from "vitest";
import {
  getAnthropicEnv,
  getAuthConfig,
  getEmbeddingEnv,
  getPublicSupabaseEnv,
  getRagConfig,
  getServiceRoleEnv,
} from "./env";

const supabase = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "dummy-anon",
};

describe("env", () => {
  it("公開用 Supabase 設定を検証する", () => {
    expect(getPublicSupabaseEnv(supabase).NEXT_PUBLIC_SUPABASE_URL).toBe(
      "https://example.supabase.co",
    );
    expect(() =>
      getPublicSupabaseEnv({ ...supabase, NEXT_PUBLIC_SUPABASE_URL: "not-a-url" }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("service_role キー欠落時はキー名のみ報告し、値を含めない", () => {
    expect(() => getServiceRoleEnv(supabase)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => getServiceRoleEnv(supabase)).not.toThrow(/dummy-anon/);
  });

  it("Embedding・Claude の既定値を補完する", () => {
    const e = getEmbeddingEnv({ OPENAI_API_KEY: "x" });
    expect(e.EMBEDDING_MODEL).toBe("text-embedding-3-small");
    expect(e.EMBEDDING_DIMENSIONS).toBe(1536);
    const a = getAnthropicEnv({ ANTHROPIC_API_KEY: "x" });
    expect(a.ANTHROPIC_MODEL).toBe("claude-opus-5-5");
    expect(a.ANTHROPIC_EFFORT).toBe("low");
    expect(a.ANTHROPIC_MAX_TOKENS).toBe(8000);
    expect(a.ANTHROPIC_MAX_RETRIES).toBe(1);
    expect(a.ANTHROPIC_SERVER_FALLBACK).toBe(false);
    expect(() => getAnthropicEnv({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("課金上の安全装置: 許可リスト外のモデル・上限超過・次元数不一致を拒否する", () => {
    const base = { ANTHROPIC_API_KEY: "x" };
    expect(() => getAnthropicEnv({ ...base, ANTHROPIC_MODEL: "claude-fable-5-2" })).toThrow(
      /ANTHROPIC_MODEL/,
    );
    expect(() => getAnthropicEnv({ ...base, ANTHROPIC_EFFORT: "max" })).toThrow(/ANTHROPIC_EFFORT/);
    expect(() => getAnthropicEnv({ ...base, ANTHROPIC_MAX_TOKENS: "64000" })).toThrow(
      /ANTHROPIC_MAX_TOKENS/,
    );
    expect(() => getAnthropicEnv({ ...base, ANTHROPIC_MAX_RETRIES: "5" })).toThrow(
      /ANTHROPIC_MAX_RETRIES/,
    );
    expect(getAnthropicEnv({ ...base, ANTHROPIC_SERVER_FALLBACK: "true" }).ANTHROPIC_SERVER_FALLBACK).toBe(true);
    expect(getAnthropicEnv({ ...base, ANTHROPIC_MODEL: "claude-haiku-5-5" }).ANTHROPIC_MODEL).toBe(
      "claude-haiku-5-5",
    );
    expect(() => getEmbeddingEnv({ OPENAI_API_KEY: "x", EMBEDDING_DIMENSIONS: "3072" })).toThrow(
      /EMBEDDING_DIMENSIONS/,
    );
    expect(() =>
      getEmbeddingEnv({ OPENAI_API_KEY: "x", EMBEDDING_MODEL: "text-embedding-3-large" }),
    ).toThrow(/EMBEDDING_MODEL/);
  });

  it("検索パラメータは既定値と範囲検証を持つ", () => {
    expect(getRagConfig({})).toEqual({ threshold: 0.3, count: 6 });
    expect(getRagConfig({ RAG_MATCH_THRESHOLD: "0.5", RAG_MATCH_COUNT: "3" })).toEqual({
      threshold: 0.5,
      count: 3,
    });
    expect(() => getRagConfig({ RAG_MATCH_COUNT: "100" })).toThrow(/RAG_MATCH_COUNT/);
    expect(() => getRagConfig({ RAG_MATCH_THRESHOLD: "2" })).toThrow(/RAG_MATCH_THRESHOLD/);
  });

  it("許可ドメインを小文字の配列に正規化する", () => {
    expect(getAuthConfig({ ALLOWED_EMAIL_DOMAINS: " Example.COM, , test.local" })).toEqual({
      allowedEmailDomains: ["example.com", "test.local"],
    });
    expect(getAuthConfig({}).allowedEmailDomains).toEqual([]);
  });
});

describe(".env.example", () => {
  it("記載された既定値がすべての設定スキーマを通る（空のキーはダミー値で補完）", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const text = readFileSync(path.resolve(__dirname, "../../../.env.example"), "utf8");
    const env: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2] === "" ? "dummy-value" : m[2];
    }
    expect(Object.keys(env)).toContain("ANTHROPIC_SERVER_FALLBACK");
    expect(() => getPublicSupabaseEnv(env)).not.toThrow();
    expect(() => getServiceRoleEnv(env)).not.toThrow();
    expect(() => getEmbeddingEnv(env)).not.toThrow();
    expect(getAnthropicEnv(env)).toMatchObject({
      ANTHROPIC_MODEL: "claude-opus-5-5",
      ANTHROPIC_EFFORT: "low",
      ANTHROPIC_SERVER_FALLBACK: false,
    });
    expect(getRagConfig(env)).toEqual({ threshold: 0.3, count: 6 });
    expect(getAuthConfig(env).allowedEmailDomains).toEqual(["example.com"]);
  });
});
