import { describe, expect, it } from "vitest";
import { summarizeError } from "./log";

describe("summarizeError", () => {
  it("メッセージ本文（質問・秘密情報を含みうる）を出力しない", () => {
    const err = Object.assign(new Error("question: 給与は? key=sk-secret"), {
      status: 500,
      code: "E1",
    });
    const s = summarizeError(err);
    expect(s).toEqual({ name: "Error", status: 500, code: "E1" });
    expect(JSON.stringify(s)).not.toContain("sk-secret");
  });

  it("非オブジェクトは型名のみ", () => {
    expect(summarizeError("secret text")).toEqual({ name: "string" });
  });
});
