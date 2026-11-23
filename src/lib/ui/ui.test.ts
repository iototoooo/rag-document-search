import { describe, expect, it, vi } from "vitest";
import { NOT_FOUND_MESSAGE } from "@/lib/contracts/types";
import { documentFileUrl } from "@/lib/contracts/api";
import {
  canSubmitQuestion,
  errorMessageFor,
  parseChatApiResponse,
  splitAnswerWithCitations,
} from "./chat-api";
import { shouldSubmitOnKeyDown } from "./keyboard";
import { LOGIN_FAILED_MESSAGE, LOGIN_INVALID_INPUT_MESSAGE, performLogin, type LoginDeps } from "./login";
import { decideProxyAction, isApiPath } from "./proxy-rules";
import { sanitizeRedirectPath } from "./redirect";

describe("sanitizeRedirectPath", () => {
  it.each([
    ["/", "/"],
    ["/?q=1#a", "/?q=1#a"],
    ["/history", "/history"],
  ])("サイト内パス %s は許可", (input, expected) => {
    expect(sanitizeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
    "evil",
    "/login",
    "/login?next=/",
    "/%0d%0aSet-Cookie:x",
    "/a\u0000b",
    "",
    undefined,
    123,
  ])("危険・不正な値 %s は / に置き換える", (input) => {
    const out = sanitizeRedirectPath(input);
    expect(out.startsWith("/")).toBe(true);
    expect(out.startsWith("//")).toBe(false);
    if (input !== "/%0d%0aSet-Cookie:x") expect(out).toBe("/");
  });
});

describe("decideProxyAction", () => {
  it("/api 配下は未ログインでもリダイレクトしない（API が 401 を返す）", () => {
    expect(decideProxyAction({ pathname: "/api/chat", search: "", isAuthenticated: false })).toEqual({
      action: "next",
    });
    expect(isApiPath("/api")).toBe(true);
    expect(isApiPath("/apis")).toBe(false);
  });

  it("未ログインでページにアクセスすると /login へ", () => {
    expect(decideProxyAction({ pathname: "/", search: "", isAuthenticated: false })).toEqual({
      action: "redirect",
      location: "/login",
    });
    expect(
      decideProxyAction({ pathname: "/history", search: "?a=1", isAuthenticated: false }),
    ).toEqual({ action: "redirect", location: `/login?next=${encodeURIComponent("/history?a=1")}` });
  });

  it("/login は除外、ログイン済みは通す", () => {
    expect(decideProxyAction({ pathname: "/login", search: "", isAuthenticated: false }).action).toBe(
      "next",
    );
    expect(decideProxyAction({ pathname: "/loginx", search: "", isAuthenticated: false }).action).toBe(
      "redirect",
    );
    expect(decideProxyAction({ pathname: "/", search: "", isAuthenticated: true }).action).toBe("next");
  });
});

describe("shouldSubmitOnKeyDown", () => {
  it("Enter で送信、Shift+Enter・IME 変換中は送信しない", () => {
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: false })).toBe(true);
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: true })).toBe(false);
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: false, isComposing: true })).toBe(false);
    expect(shouldSubmitOnKeyDown({ key: "Enter", shiftKey: false, keyCode: 229 })).toBe(false);
    expect(shouldSubmitOnKeyDown({ key: "a", shiftKey: false })).toBe(false);
  });
});

describe("canSubmitQuestion", () => {
  it("空白のみ・上限超過は送信不可", () => {
    expect(canSubmitQuestion("   ", 10)).toBe(false);
    expect(canSubmitQuestion("質問", 10)).toBe(true);
    expect(canSubmitQuestion("a".repeat(11), 10)).toBe(false);
    expect(canSubmitQuestion(`  ${"a".repeat(10)}  `, 10)).toBe(true);
  });
});

const okBody = {
  answer: "日当は1日2,500円です [1]。",
  found: true,
  citations: [
    {
      id: 1,
      documentId: "3f1c2a7e-5b6d-4c8e-9a0b-1c2d3e4f5a6b",
      chunkId: "c1",
      fileName: "demo-doc1-travel-rules.pdf",
      title: "出張旅費規程（抜粋）",
      pageNumber: 1,
      section: "第2章 宿泊費・日当",
      snippet: "出張の日当は1日2,500円",
    },
  ],
};

describe("parseChatApiResponse", () => {
  it("正常応答を契約どおりに解析する", () => {
    const r = parseChatApiResponse(200, JSON.stringify(okBody));
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.data.citations[0].pageNumber).toBe(1);
  });

  it("該当なし応答（found=false）は出典を表示しない", () => {
    const r = parseChatApiResponse(
      200,
      JSON.stringify({ answer: NOT_FOUND_MESSAGE, found: false, citations: okBody.citations }),
    );
    expect(r).toEqual({
      kind: "ok",
      data: { answer: NOT_FOUND_MESSAGE, found: false, citations: [] },
    });
  });

  it("401 はログイン案内付きのエラー（サーバーメッセージに依存しない）", () => {
    const r = parseChatApiResponse(
      401,
      JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "ログインが必要です" } }),
    );
    expect(r).toEqual({
      kind: "error",
      code: "UNAUTHENTICATED",
      message: errorMessageFor("UNAUTHENTICATED"),
      requiresLogin: true,
    });
  });

  it("403 は権限エラー、ログイン案内なし", () => {
    const r = parseChatApiResponse(403, JSON.stringify({ error: { code: "FORBIDDEN", message: "x" } }));
    expect(r).toMatchObject({ kind: "error", code: "FORBIDDEN", requiresLogin: false });
  });

  it("400 はサーバーの検証メッセージを表示する", () => {
    const r = parseChatApiResponse(
      400,
      JSON.stringify({ error: { code: "INVALID_REQUEST", message: "質問を入力してください" } }),
    );
    expect(r).toMatchObject({ kind: "error", message: "質問を入力してください" });
  });

  it("500 のサーバーメッセージ（内部情報の可能性）は表示しない", () => {
    const r = parseChatApiResponse(
      500,
      JSON.stringify({ error: { code: "INTERNAL", message: "stack trace secret" } }),
    );
    expect(r).toMatchObject({ kind: "error", code: "INTERNAL" });
    if (r.kind === "error") expect(r.message).not.toContain("secret");
  });

  it("JSON でない応答・契約違反の応答はエラー", () => {
    expect(parseChatApiResponse(502, "<html>Bad Gateway</html>")).toMatchObject({
      kind: "error",
      code: "INTERNAL",
    });
    expect(parseChatApiResponse(401, "not json")).toMatchObject({
      kind: "error",
      code: "UNAUTHENTICATED",
      requiresLogin: true,
    });
    expect(parseChatApiResponse(200, JSON.stringify({ answer: 1 }))).toMatchObject({
      kind: "error",
      code: "INTERNAL",
    });
    expect(
      parseChatApiResponse(
        200,
        JSON.stringify({ ...okBody, citations: [{ ...okBody.citations[0], pageNumber: 0 }] }),
      ),
    ).toMatchObject({ kind: "error" });
  });
});

describe("splitAnswerWithCitations", () => {
  it("一覧にある番号だけを出典参照にし、存在しない番号はテキストのまま", () => {
    expect(splitAnswerWithCitations("A [1] B [9] C[2]", [1, 2])).toEqual([
      { type: "text", text: "A " },
      { type: "citation", id: 1 },
      { type: "text", text: " B [9] C" },
      { type: "citation", id: 2 },
    ]);
  });
});

describe("documentFileUrl", () => {
  it("PDF の該当ページを開く URL", () => {
    expect(documentFileUrl("abc", 3)).toBe("/api/documents/abc/file#page=3");
  });
});

describe("performLogin", () => {
  function deps(overrides: Partial<LoginDeps> = {}) {
    return {
      signIn: vi.fn(async () => ({ error: null })),
      authorize: vi.fn(async () => ({ ok: true as const, user: { id: "u1", email: "a@example.com" } })),
      signOut: vi.fn(async () => {}),
      ...overrides,
    } satisfies LoginDeps;
  }
  const input = { email: " taro@example.com ", password: "pw", next: "/history" };

  it("成功時は検証済みのリダイレクト先を返す", async () => {
    const d = deps();
    expect(await performLogin(d, input)).toEqual({ ok: true, redirectTo: "/history" });
    expect(d.signIn).toHaveBeenCalledWith("taro@example.com", "pw");
    expect(d.signOut).not.toHaveBeenCalled();
  });

  it("外部へのリダイレクト指定は / に置き換える", async () => {
    expect(await performLogin(deps(), { ...input, next: "//evil.example" })).toEqual({
      ok: true,
      redirectTo: "/",
    });
  });

  it("パスワード認証に成功しても未許可ならサインアウトし、汎用エラー", async () => {
    const d = deps({ authorize: vi.fn(async () => ({ ok: false as const, code: "FORBIDDEN" as const })) });
    expect(await performLogin(d, input)).toEqual({ ok: false, state: { error: LOGIN_FAILED_MESSAGE } });
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });

  it("認可処理の例外もサインアウトして拒否（フェイルクローズ）", async () => {
    const d = deps({
      authorize: vi.fn(async () => {
        throw new Error("db");
      }),
    });
    expect((await performLogin(d, input)).ok).toBe(false);
    expect(d.signOut).toHaveBeenCalled();
  });

  it("認証失敗は理由を区別しない汎用エラー", async () => {
    const d = deps({ signIn: vi.fn(async () => ({ error: new Error("Invalid login credentials") })) });
    expect(await performLogin(d, input)).toEqual({ ok: false, state: { error: LOGIN_FAILED_MESSAGE } });
    expect(d.authorize).not.toHaveBeenCalled();
  });

  it("入力不正は認証 API を呼ばない", async () => {
    const d = deps();
    expect(await performLogin(d, { email: "not-an-email", password: "", next: null })).toEqual({
      ok: false,
      state: { error: LOGIN_INVALID_INPUT_MESSAGE },
    });
    expect(d.signIn).not.toHaveBeenCalled();
  });
});
