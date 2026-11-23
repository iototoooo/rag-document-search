import { describe, expect, it } from "vitest";
import { detectHeading, MAX_HEADING_LENGTH } from "./sections";
import { displayWidth, foldCjkRadicals, normalizeForIngest } from "./text";
import { estimateTokens } from "./tokens";

describe("normalizeForIngest / foldCjkRadicals", () => {
  it("NFKC で変換されない部首補助文字を通常の漢字にする", () => {
    expect(foldCjkRadicals("上⻑の承認・国⺠の祝日")).toBe("上長の承認・国民の祝日");
  });
  it("康熙部首（NFKC）と部首補助の両方を処理する", () => {
    expect(normalizeForIngest("改定⽇ 上⻑")).toBe("改定日 上長");
  });
  it("表示幅は全角 2・半角 1", () => {
    expect(displayWidth("ab日本")).toBe(6);
    expect(displayWidth("ｱ")).toBe(1);
  });
});

describe("estimateTokens", () => {
  it("CJK は 1 文字 1 トークン、空白は数えない", () => {
    expect(estimateTokens("出張旅費")).toBe(4);
    expect(estimateTokens("出張 旅費\n")).toBe(4);
  });
  it("ASCII 語は 4 文字ごとに約 1.3 トークン", () => {
    expect(estimateTokens("Slack")).toBe(3); // ceil(5/4)=2 語相当 × 1.3 = 2.6 → 3
    expect(estimateTokens("VPN")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
  it("記号は 1 文字 1 トークン", () => {
    expect(estimateTokens("(10)")).toBe(4); // ( + 10(1.3) + ) = 3.3 → 4
  });
});

describe("detectHeading", () => {
  it.each([
    ["第2章 宿泊費・日当", 1],
    ["第3章 申請と精算(手続)", 1],
    ["1. 予約の基本フロー", 1],
    ["2. 機器・PC の取り扱い", 1],
    ["1.2 詳細ルール", 2],
    ["## 5. 駐車場の利用", 2],
  ])("見出し: %s", (line, level) => {
    expect(detectHeading(line)?.level).toBe(level);
  });

  it("Markdown の装飾を除去する", () => {
    expect(detectHeading("# **出張旅費規程**")).toEqual({ text: "出張旅費規程", level: 1 });
  });

  it.each([
    "1. 利用したい会議室を #facility-desk に申請する。", // 句点で終わる手順
    "3. 総務部が3営業日以内に入館証を発行する。",
    "会議室の利用は1回2時間までとする。",
    "AcmeVault(鍵管理)", // 区切りなし
    "3 回まで",
    "1. 2025",
    "Chat 部署連絡 全社員",
    "",
    `1. ${"長".repeat(MAX_HEADING_LENGTH)}`,
  ])("見出しではない: %s", (line) => {
    expect(detectHeading(line)).toBeNull();
  });
});
