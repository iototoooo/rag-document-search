import { describe, expect, it } from "vitest";
import { chunkPages, unwrapLines } from "./chunker";
import { estimateTokens } from "./tokens";

describe("unwrapLines", () => {
  it("最長行に近い幅で文末記号のない行だけを次行と連結する", () => {
    const lines = [
      "出張の宿泊費は、1泊12,000円を上限として実費を支給する。ただし特別な事情がある場合、上限",
      "は別に定める。",
      "短い行",
      "次の行。",
    ];
    expect(unwrapLines(lines)).toEqual([
      "出張の宿泊費は、1泊12,000円を上限として実費を支給する。ただし特別な事情がある場合、上限は別に定める。",
      "短い行",
      "次の行。",
    ]);
  });

  it("見出し行とは連結しない", () => {
    const long = "あ".repeat(40);
    expect(unwrapLines([long, "第2章 休日"])).toEqual([long, "第2章 休日"]);
  });

  it("英数字同士の連結には空白を入れる", () => {
    const a = `${"あ".repeat(30)}Google`;
    expect(unwrapLines([a, "Workspace を使う。"])[0]).toBe(`${a} Workspace を使う。`);
  });
});

describe("chunkPages", () => {
  const pages = [
    {
      pageNumber: 1,
      text: ["規程タイトル", "第1章 総則", "総則の本文。", "第2章 休暇", "休暇の本文。"].join("\n"),
    },
    { pageNumber: 2, text: ["前ページから続く本文。", "第3章 退職", "退職の本文。"].join("\n") },
  ];

  it("chunkKey・連番・ページ番号・ハッシュを付与する", () => {
    const chunks = chunkPages("doc-a", pages, { minTokens: 0 });
    expect(chunks.map((c) => c.chunkKey)).toEqual([
      "doc-a:p1:c0",
      "doc-a:p1:c1",
      "doc-a:p1:c2",
      "doc-a:p2:c3",
      "doc-a:p2:c4",
    ]);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2, 3, 4]);
    for (const c of chunks) {
      expect(c.pageEnd).toBe(c.pageNumber);
      expect(c.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(c.tokenCount).toBe(Math.max(1, estimateTokens(c.content)));
    }
  });

  it("セクションを判定し、前ページの見出しを引き継ぐ", () => {
    const chunks = chunkPages("doc-a", pages, { minTokens: 0 });
    expect(chunks.map((c) => c.section)).toEqual([
      null,
      "第1章 総則",
      "第2章 休暇",
      "第2章 休暇",
      "第3章 退職",
    ]);
    // 続きのチャンクは見出しを先頭に持つ（文書内の実テキスト）
    expect(chunks[3].content).toBe("第2章 休暇\n前ページから続く本文。");
  });

  it("小さいセクションは同一ページ内で結合し、ページはまたがない", () => {
    const chunks = chunkPages("doc-a", pages, { minTokens: 300 });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[0].section).toBe("第1章 総則 / 第2章 休暇");
    expect(chunks[1].pageNumber).toBe(2);
  });

  it("長いセクションは maxTokens 以下に分割し、overlap を付ける", () => {
    const body = Array.from({ length: 30 }, (_, i) => `${"本文".repeat(10)}${i}番目の行です。`);
    const chunks = chunkPages(
      "long",
      [{ pageNumber: 1, text: ["第1章 長い章", ...body].join("\n") }],
      { maxTokens: 120, minTokens: 0, overlapTokens: 30 },
    );
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) {
      expect(c.tokenCount).toBeLessThanOrEqual(120);
      expect(c.section).toBe("第1章 長い章");
    }
    // 隣接チャンクの末尾行が次チャンクの先頭に重複している
    const lastLine = chunks[0].content.split("\n").at(-1)!;
    expect(chunks[1].content.startsWith(lastLine)).toBe(true);
    // すべての本文行がいずれかのチャンクに含まれる
    for (const line of body) expect(chunks.some((c) => c.content.includes(line))).toBe(true);
  });

  it("1 行が maxTokens を超える場合も分割する", () => {
    const longLine = "あ".repeat(500);
    const chunks = chunkPages("x", [{ pageNumber: 1, text: longLine }], {
      maxTokens: 100,
      minTokens: 0,
      overlapTokens: 0,
    });
    expect(chunks.length).toBe(5);
    expect(chunks.map((c) => c.content).join("")).toBe(longLine);
  });

  it("空ページはチャンクを作らず、不正な設定・ページ番号はエラー", () => {
    expect(chunkPages("x", [{ pageNumber: 1, text: "" }])).toEqual([]);
    expect(() => chunkPages("x", [{ pageNumber: 0, text: "a" }])).toThrow();
    expect(() => chunkPages("x", [], { maxTokens: 100, overlapTokens: 100 })).toThrow();
  });

  it("同じ入力から同じチャンクを生成する（決定的）", () => {
    expect(chunkPages("doc-a", pages)).toEqual(chunkPages("doc-a", pages));
  });
});
