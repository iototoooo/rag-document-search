import { describe, expect, it } from "vitest";
import { parseCsv, parseTestQuestions } from "./csv";

describe("parseCsv", () => {
  it("クォート内のカンマ・改行・エスケープを扱える", () => {
    const rows = parseCsv('a,"b,c","d""e"\r\n1,"x\ny",3\n');
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "x\ny", "3"],
    ]);
  });

  it("BOMを除去する", () => {
    expect(parseCsv("﻿h1,h2\n")).toEqual([["h1", "h2"]]);
  });
});

describe("parseTestQuestions", () => {
  it("列数不足の行でエラーになる", () => {
    expect(() => parseTestQuestions("a,b,c,d,e,f\n1,2\n")).toThrow();
  });

  it("期待回答内のクォートされていないカンマで列がずれても復元する", () => {
    const [q] = parseTestQuestions(
      "番号,質問,期待される回答,出典文書,出典セクション,種別\n" +
        "5,宿泊費は?,1泊12,000円,doc1 / doc2,2. 宿泊費,該当あり\n",
    );
    expect(q).toEqual({
      id: 5,
      question: "宿泊費は?",
      expectedAnswer: "1泊12,000円",
      sourceDocument: "doc1 / doc2",
      sourceSection: "2. 宿泊費",
      kind: "該当あり",
    });
  });
});
