import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "@/lib/contracts/types";
import { buildCitations, makeSnippet, numberSources, toPromptSources } from "./citations";

function chunk(n: number, content = `本文${n}`): RetrievedChunk {
  return {
    chunkId: `c${n}`,
    documentId: `d${n}`,
    chunkKey: `k${n}`,
    fileName: `file${n}.pdf`,
    title: `文書${n}`,
    pageNumber: n,
    section: null,
    content,
    similarity: 0.9,
  };
}

const numbered = numberSources([chunk(1), chunk(2)]);

describe("numberSources / toPromptSources", () => {
  it("1 始まりの連番を振り、LLM には ID 以外の内部 ID を渡さない", () => {
    const s = toPromptSources(numbered);
    expect(s.map((x) => x.id)).toEqual([1, 2]);
    expect(JSON.stringify(s)).not.toContain("c1");
    expect(JSON.stringify(s)).not.toContain("d1");
  });
});

describe("buildCitations", () => {
  it("サーバー側一覧に存在する ID だけを出典にする", () => {
    const r = buildCitations(numbered, "日当は2500円です[1]。", [1, 99]);
    expect(r?.citations.map((c) => c.id)).toEqual([1]);
    expect(r?.citations[0]).toMatchObject({
      documentId: "d1",
      chunkId: "c1",
      fileName: "file1.pdf",
      pageNumber: 1,
    });
  });

  it("本文中の存在しない [n] を除去する", () => {
    const r = buildCitations(numbered, "日当は2500円です[99]。精算は7日以内[2]。", [99, 2]);
    expect(r?.answer).toBe("日当は2500円です。精算は7日以内[2]。");
    expect(r?.citations.map((c) => c.id)).toEqual([2]);
  });

  it("複数番号のマーカーは有効なものだけ残す", () => {
    const r = buildCitations(numbered, "回答[1, 99、2]", []);
    expect(r?.answer).toBe("回答[1, 2]");
    expect(r?.citations.map((c) => c.id)).toEqual([1, 2]);
  });

  it("重複を除去する", () => {
    const r = buildCitations(numbered, "a[1] b[1]", [1, 1, 1]);
    expect(r?.citations).toHaveLength(1);
  });

  it("有効な出典が 0 件なら null", () => {
    expect(buildCitations(numbered, "根拠のない回答[99]", [99])).toBeNull();
    expect(buildCitations(numbered, "マーカーなし", [])).toBeNull();
    expect(buildCitations(numbered, "小数[1]", [1.5])).not.toBeNull(); // マーカー [1] は有効
    expect(buildCitations(numbered, "小数のみ", [1.5])).toBeNull();
  });
});

describe("makeSnippet", () => {
  it("200 文字以内に収め、空白を詰める", () => {
    const long = "あ".repeat(500);
    const s = makeSnippet(long);
    expect(Array.from(s)).toHaveLength(200);
    expect(s.endsWith("…")).toBe(true);
    expect(makeSnippet("a\n\n b")).toBe("a b");
  });
});
