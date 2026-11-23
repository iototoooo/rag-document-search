import { describe, expect, it, vi } from "vitest";
import { authorizeUser, isEmailDomainAllowed, type AuthCapableClient } from "./authorize";

type UserShape = { id: string; email?: string | null; email_confirmed_at?: string | null } | null;

function mockClient(opts: {
  user?: UserShape;
  authError?: unknown;
  appUser?: { is_active: boolean } | null;
  dbError?: unknown;
}) {
  const eq = vi.fn(() => ({
    maybeSingle: async () => ({ data: opts.appUser ?? null, error: opts.dbError ?? null }),
  }));
  const client: AuthCapableClient = {
    auth: {
      getUser: async () => ({ data: { user: opts.user ?? null }, error: opts.authError ?? null }),
    },
    from: () => ({ select: () => ({ eq }) }),
  };
  return { client, eq };
}

const confirmed = { id: "u1", email: "taro@example.com", email_confirmed_at: "2026-01-01" };

describe("isEmailDomainAllowed", () => {
  it("完全一致のみ許可する", () => {
    expect(isEmailDomainAllowed("a@example.com", ["example.com"])).toBe(true);
    expect(isEmailDomainAllowed("a@EXAMPLE.com", ["example.com"])).toBe(true);
    expect(isEmailDomainAllowed("a@evil-example.com", ["example.com"])).toBe(false);
    expect(isEmailDomainAllowed("a@example.com.evil", ["example.com"])).toBe(false);
    expect(isEmailDomainAllowed("a@sub.example.com", ["example.com"])).toBe(false);
    expect(isEmailDomainAllowed("noatmark", ["example.com"])).toBe(false);
  });
  it("未設定なら絞り込みなし", () => {
    expect(isEmailDomainAllowed("a@any.test", [])).toBe(true);
  });
});

describe("authorizeUser", () => {
  const opts = { allowedEmailDomains: ["example.com"] };

  it("未ログインは UNAUTHENTICATED", async () => {
    const { client } = mockClient({ user: null });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("Auth エラーは UNAUTHENTICATED", async () => {
    const { client } = mockClient({ user: confirmed, authError: new Error("jwt expired") });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("ドメインが一致しても app_users に登録がなければ FORBIDDEN", async () => {
    const { client, eq } = mockClient({ user: confirmed, appUser: null });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(eq).toHaveBeenCalledWith("user_id", "u1");
  });

  it("app_users が無効なら FORBIDDEN", async () => {
    const { client } = mockClient({ user: confirmed, appUser: { is_active: false } });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("メール未確認は FORBIDDEN", async () => {
    const { client } = mockClient({
      user: { ...confirmed, email_confirmed_at: null },
      appUser: { is_active: true },
    });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("許可ドメイン外は app_users が有効でも FORBIDDEN", async () => {
    const { client } = mockClient({
      user: { ...confirmed, email: "x@other.test" },
      appUser: { is_active: true },
    });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("DB エラーは FORBIDDEN（フェイルクローズ）", async () => {
    const { client } = mockClient({ user: confirmed, dbError: new Error("db down") });
    expect(await authorizeUser(client, opts)).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it("全条件を満たせば ok", async () => {
    const { client } = mockClient({ user: confirmed, appUser: { is_active: true } });
    expect(await authorizeUser(client, opts)).toEqual({
      ok: true,
      user: { id: "u1", email: "taro@example.com" },
    });
  });
});
