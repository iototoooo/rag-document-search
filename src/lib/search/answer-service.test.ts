import { describe, expect, it, vi } from "vitest";
import { NOT_FOUND_MESSAGE } from "@/lib/contracts/types";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { answerQuestion } from "./answer-service";
import { RecordingGenerator, RlsFakeSearcher, type FakeDoc } from "./testing";

const internalDoc: FakeDoc = {
  documentId: "doc-internal",
  fileName: "demo-doc1-travel-rules.pdf",
  title: "出張旅費規程",
  visibility: "internal",
  chunks: [
    { chunkId: "ci-1", pageNumber: 1, section: "第2章 宿泊費・日当", content: "出張の日当は1日2,500円を支給する。" },
  ],
};

// 権限のない部署限定文書（質問と非常によく一致する内容）
const departmentDoc: FakeDoc = {
  documentId: "doc-secret-dept",
  fileName: "secret-hr-salary-table.pdf",
  title: "人事部限定 給与テーブル",
  visibility: "department",
  chunks: [
    { chunkId: "cs-1", pageNumber: 3, section: "給与", content: "出張の日当は1日2,500円を支給する。極秘給与表あり。" },
    { chunkId: "cs-2", pageNumber: 4, section: "給与", content: "出張の日当は1日2,500円を支給する。役員報酬。" },
  ],
};

const canReadInternalOnly = (d: FakeDoc) => d.visibility === "internal";

function deps(generator = new RecordingGenerator(), docs = [internalDoc, departmentDoc]) {
  const embedder = new MockEmbeddingProvider(256);
  const searcher = new RlsFakeSearcher(docs, canReadInternalOnly);
  return { embedder, searcher, generator, rag: { threshold: 0.3, count: 6 } };
}

describe("answerQuestion", () => {
  it("検索結果を根拠に回答し、出典にファイル名・ページを付ける", async () => {
    const d = deps();
    const r = await answerQuestion("出張の日当はいくらですか？", d);
    expect(r.found).toBe(true);
    expect(r.citations[0]).toMatchObject({
      fileName: "demo-doc1-travel-rules.pdf",
      pageNumber: 1,
      documentId: "doc-internal",
    });
  });

  it("権限のない文書の本文・ファイル名・ID・件数がレスポンスにも LLM 入力にも出ない", async () => {
    const gen = new RecordingGenerator();
    const d = deps(gen);
    const r = await answerQuestion("出張の日当は1日2,500円を支給？", d);

    const responseText = JSON.stringify(r);
    const llmInput = JSON.stringify(gen.inputs);
    for (const leaked of ["doc-secret-dept", "secret-hr-salary-table", "極秘", "役員報酬", "人事部限定", "cs-1"]) {
      expect(responseText).not.toContain(leaked);
      expect(llmInput).not.toContain(leaked);
    }
    // LLM に渡した資料は閲覧可能な 1 件だけ（部署文書の件数が反映されない）
    expect(gen.inputs[0].sources).toHaveLength(1);
    expect(r.citations).toHaveLength(1);
  });

  it("閲覧可能な文書がない場合、部署文書が一致しても NOT_FOUND かつ LLM を呼ばない", async () => {
    const gen = new RecordingGenerator();
    const spy = vi.spyOn(gen, "generate");
    const r = await answerQuestion("出張の日当は1日2,500円を支給？", deps(gen, [departmentDoc]));
    expect(r).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("しきい値を超えるチャンクがなければ LLM を呼ばず NOT_FOUND", async () => {
    const gen = new RecordingGenerator();
    const spy = vi.spyOn(gen, "generate");
    const d = deps(gen);
    d.rag = { threshold: 0.99, count: 6 };
    const r = await answerQuestion("社員食堂の営業時間を教えてください。", d);
    expect(r).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("LLM が根拠なしと判断したら NOT_FOUND", async () => {
    const r = await answerQuestion("日当は？", deps(new RecordingGenerator("not-found")));
    expect(r).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
  });

  it("refusal は found=false の定型文", async () => {
    const r = await answerQuestion("日当は？", deps(new RecordingGenerator("refuse")));
    expect(r).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
  });

  it("存在しない出典だけを返した場合は NOT_FOUND", async () => {
    const r = await answerQuestion("日当は？", deps(new RecordingGenerator("cite-99")));
    expect(r).toEqual({ answer: NOT_FOUND_MESSAGE, found: false, citations: [] });
  });

  it("設定した件数・しきい値で検索する", async () => {
    const d = deps();
    d.rag = { threshold: 0.42, count: 3 };
    await answerQuestion("日当は？", d);
    expect(d.searcher.calls[0].options).toEqual({ threshold: 0.42, count: 3 });
  });
});
