import { describe, expect, it } from "vitest";
import { describeError, formatVerifyReport, isPermissionDenied, zeroVectorLiteral } from "./db-security";

describe("db-security helpers", () => {
  it("42501 / permission denied を権限エラーと判定する", () => {
    expect(isPermissionDenied({ code: "42501", message: "x" })).toBe(true);
    expect(isPermissionDenied({ message: "permission denied for function x" })).toBe(true);
    expect(isPermissionDenied({ code: "P0001", message: "p_chunks must be a non-empty array" })).toBe(false);
    expect(isPermissionDenied(null)).toBe(false);
  });

  it("エラー説明にメッセージ本文を含めない", () => {
    const d = describeError({ code: "42501", message: "permission denied for table documents", hint: "GRANT ..." });
    expect(d).toBe("42501");
  });

  it("ゼロベクトルは 1536 次元", () => {
    const v = zeroVectorLiteral();
    expect(v.startsWith("[0,")).toBe(true);
    expect(v.slice(1, -1).split(",")).toHaveLength(1536);
  });

  it("レポートに件数を集計する", () => {
    const r = formatVerifyReport([
      { group: "g", name: "a", status: "ok", detail: "" },
      { group: "g", name: "b", status: "ng", detail: "" },
      { group: "h", name: "c", status: "skip", detail: "" },
    ]);
    expect(r).toContain("結果: OK 1 / NG 1 / SKIP 1");
    expect(r).toContain("## h");
  });
});
