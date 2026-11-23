import { describe, expect, it } from "vitest";
import type { AnswerGenerator } from "@/lib/contracts/ports";
import { parseTestQuestions, type TestQuestion } from "@/lib/documents/csv";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { extractKeyFacts, missingFacts, normalizeForMatch } from "./facts";
import { toMarkdown } from "./report";
import { MockEvalGenerator, runEvaluation, sectionTitles } from "./runner";
import { DEMO_QUESTIONS_CSV, demoFiles } from "../../../tests/fixtures/demo-corpus";

describe("extractKeyFacts / missingFacts", () => {
  it("数値＋単位と時刻を要点として抽出する", () => {
    expect(extractKeyFacts("入社3ヶ月経過後に5日付与される")).toEqual([["3ヶ月"], ["5日"]]);
    expect(extractKeyFacts("1泊12,000円")).toEqual([["12000円"]]);
    expect(extractKeyFacts("11:00〜15:00")).toEqual([
      ["11:00", "11時"],
      ["15:00", "15時"],
    ]);
    expect(extractKeyFacts("10文字以上・60日ごとに更新・直近5回分と同一は不可")).toEqual([
      ["10文字"],
      ["60日"],
      ["5回"],
    ]);
    expect(extractKeyFacts("所属長の承認後、総務部が3営業日以内に発行")).toEqual([["3営業日"]]);
  });

  it("表記ゆれ（桁区切り・全角・か月・時表記）を吸収して照合する", () => {
    expect(normalizeForMatch("３，０００ 円")).toBe("3000円");
    expect(missingFacts("月額3000円です", [["3000円"]])).toEqual([]);
    expect(missingFacts("入社3か月後に5日", extractKeyFacts("入社3ヶ月経過後に5日"))).toEqual([]);
    expect(missingFacts("受付は11時から15時まで", extractKeyFacts("11:00〜15:00"))).toEqual([]);
    expect(missingFacts("月2回まで", extractKeyFacts("月4回まで"))).toEqual([["4回"]]);
  });

  it("セクション名から番号を除いた見出しを得る", () => {
    expect(sectionTitles("第2章 宿泊費・日当")).toEqual(["宿泊費・日当"]);
    expect(sectionTitles("5. 駐車場の利用 / 4. 施設")).toEqual(["駐車場の利用", "施設"]);
    expect(sectionTitles("（記載なし）")).toEqual([]);
  });
});

describe("精度検証ランナー（架空の文書・外部通信なし）", () => {
  const csv = () => DEMO_QUESTIONS_CSV;
  const pdfFiles = () => demoFiles();

  it("CSV の列ずれ（Q1 の金額カンマ）が評価データに影響しない", () => {
    const qs = parseTestQuestions(csv());
    expect(qs.map((q) => q.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const q of qs) expect(q.kind).toMatch(/^該当(あり|なし)/);
    const docs = demoFiles().map((f) => f.fileName.replace(/\.md$/, ""));
    for (const q of qs) {
      for (const s of q.sourceDocument.split("/").map((x) => x.trim())) {
        expect(s === "（記載なし）" || docs.includes(s), `Q${q.id}: ${s}`).toBe(true);
      }
    }
    const q1 = qs.find((q) => q.id === 1)!;
    expect(q1.expectedAnswer).toBe("1泊12,000円まで");
    expect(extractKeyFacts(q1.expectedAnswer)).toEqual([["12000円"]]);
    expect(q1.sourceDocument).toBe("demo-doc1-travel-rules");
    expect(q1.kind).toBe("該当あり");
    // 該当あり 5 問はすべて要点を 1 つ以上持つ
    for (const q of qs.filter((x) => x.kind === "該当あり")) {
      expect(extractKeyFacts(q.expectedAnswer).length, `Q${q.id}`).toBeGreaterThan(0);
    }
  });

  it("モックモードでは正答率・応答時間を測定しない（null）", async () => {
    const report = await runEvaluation({
      mode: "mock",
      pdfFiles: pdfFiles(),
      questions: parseTestQuestions(csv()),
      embedder: new MockEmbeddingProvider(1536),
      generator: new MockEvalGenerator(),
      rag: { threshold: 0, count: 6 },
      model: "mock",
    });
    const s = report.summary;
    expect(s.total).toBe(7);
    expect(s.answerable).toBe(5);
    expect(s.accuracy).toBeNull();
    expect(s.latencyMs).toBeNull();
    expect(s.targets).toEqual({ accuracy80: null, latency5s: null });
    expect(s.retrievalHitRate).toBeGreaterThanOrEqual(0.7);
    expect(report.results.every((r) => r.correct === null)).toBe(true);
    const md = toMarkdown(report);
    expect(md).toContain("モック（外部通信なし）");
    expect(md).toContain("測定対象外");
  });

  /** 期待回答をそのまま返す「理想的な」生成器（採点ロジックの検証用。実 API ではない） */
  class OracleGenerator implements AnswerGenerator {
    constructor(
      private readonly qs: TestQuestion[],
      private readonly wrongOn: number[] = [],
    ) {}
    async generate(input: Parameters<AnswerGenerator["generate"]>[0]) {
      const q = this.qs.find((x) => x.question === input.question)!;
      if (q.kind.startsWith("該当なし") && !this.wrongOn.includes(q.id)) {
        return { status: "not_found" as const };
      }
      const expected = q.sourceDocument.split("/").map((s) => s.trim());
      const src = input.sources.find((s) => expected.some((e) => s.fileName.startsWith(e))) ?? input.sources[0];
      return {
        status: "answered" as const,
        answer: `${q.expectedAnswer}[${src.id}]`,
        citedSourceIds: [src.id],
        usage: { inputTokens: 1000, outputTokens: 100 },
      };
    }
  }

  it("採点: 理想回答は 100%、該当なし質問に答えると不正解、遅延は応答時間に反映される", async () => {
    const qs = parseTestQuestions(csv());
    let t = 0;
    const report = await runEvaluation({
      mode: "live",
      pdfFiles: pdfFiles(),
      questions: qs,
      embedder: new MockEmbeddingProvider(1536),
      generator: new OracleGenerator(qs, [6]),
      rag: { threshold: 0, count: 20 },
      model: "oracle",
      now: () => (t += 1000),
    });
    const s = report.summary;
    expect(s.retrievalHitRate).toBe(1); // count=20 で全チャンクが対象
    expect(s.correctCount).toBe(6);
    expect(s.accuracy).toBeCloseTo(6 / 7);
    expect(s.notFoundCorrect).toEqual({ correct: 1, total: 2 });
    expect(report.results.find((r) => r.id === 6)!.correct).toBe(false);
    expect(s.latencyMs).toEqual({ p50: 1000, p95: 1000, max: 1000 });
    expect(s.targets).toEqual({ accuracy80: true, latency5s: true });
    // 回答した 6 問分のトークンを集計（not_found は usage なし）。料金表にないモデルは費用 null
    expect(s.tokens).toEqual({ calls: 6, input: 6000, output: 600, estimatedCostUsd: null });
    expect(report.results.every((r) => r.stages !== null)).toBe(true);
    expect(s.stageAvgMs).not.toBeNull();
    const md = toMarkdown(report);
    expect(md).toContain("実API");
    expect(md).toContain("Claude トークン（6 回）");
  });

  it("--only で文書に記載のない 2 問だけを個別に検証できる", async () => {
    const qs = parseTestQuestions(csv());
    const report = await runEvaluation({
      mode: "live",
      pdfFiles: pdfFiles(),
      questions: qs,
      embedder: new MockEmbeddingProvider(1536),
      generator: new OracleGenerator(qs),
      rag: { threshold: 0, count: 6 },
      model: "oracle",
      only: [6, 7],
    });
    expect(report.results.map((r) => r.id)).toEqual([6, 7]);
    expect(report.summary.notFoundCorrect).toEqual({ correct: 2, total: 2 });
    expect(report.results.every((r) => r.citations.length === 0)).toBe(true);
  });
});
