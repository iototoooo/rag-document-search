import type { EvalReport, QuestionResult } from "./runner";
import { TARGET_ACCURACY, TARGET_LATENCY_MS } from "./runner";

const pct = (v: number | null) => (v === null ? "測定対象外" : `${(v * 100).toFixed(1)}%`);
const yn = (v: boolean | null) => (v === null ? "—" : v ? "○" : "×");
const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function judge(v: boolean | null): string {
  if (v === null) return "未測定";
  return v ? "達成" : "**未達**";
}

/** 評価結果を Markdown に整形する（モックと実 API を見出しで明確に区別する）。 */
export function toMarkdown(report: EvalReport): string {
  const s = report.summary;
  const modeLabel =
    s.mode === "live"
      ? "実API（OpenAI Embedding + Claude）"
      : "モック（外部通信なし）— 正答率・応答時間は測定対象外";
  const lines: string[] = [];

  lines.push(`# 精度検証結果（${s.mode === "live" ? "実API" : "モック"}）`, "");
  lines.push(`- 実行モード: **${modeLabel}**`);
  lines.push(`- 実行日時: ${s.startedAt}`);
  lines.push(`- 回答モデル: ${s.mode === "live" ? s.model : "（モック）"}`);
  lines.push(`- Embedding: ${s.embeddingModel}`);
  lines.push(`- 検索設定: しきい値 ${s.rag.threshold} / 件数 ${s.rag.count}`);
  lines.push(`- 索引: 文書 ${s.documents} 件 / チャンク ${s.chunks} 件（インメモリ。DB・RLS・ネットワーク遅延は含まない）`);
  lines.push("");

  lines.push("## サマリー", "");
  lines.push("| 指標 | 結果 | 目標 | 判定 |", "| --- | --- | --- | --- |");
  lines.push(
    `| 正答率 | ${pct(s.accuracy)}${s.correctCount !== null ? `（${s.correctCount}/${s.total}）` : ""} | ${TARGET_ACCURACY * 100}%以上 | ${judge(s.targets.accuracy80)} |`,
  );
  lines.push(`| 検索ヒット率（該当あり ${s.answerable} 問） | ${pct(s.retrievalHitRate)} | — | — |`);
  lines.push(`| 出典の正確性（期待文書の割合） | ${pct(s.citationAccuracy)} | — | — |`);
  lines.push(
    `| 該当なし質問の正答 | ${s.notFoundCorrect ? `${s.notFoundCorrect.correct}/${s.notFoundCorrect.total}` : "測定対象外"} | 全問 | ${s.notFoundCorrect ? judge(s.notFoundCorrect.correct === s.notFoundCorrect.total) : "未測定"} |`,
  );
  lines.push(
    `| 応答時間 p50 / p95 / 最大 | ${s.latencyMs ? `${s.latencyMs.p50} / ${s.latencyMs.p95} / ${s.latencyMs.max} ms` : "測定対象外"} | p95 ${TARGET_LATENCY_MS / 1000}秒以内 | ${judge(s.targets.latency5s)} |`,
  );
  lines.push(`| エラー | ${s.errors} 件 | 0 件 | ${s.errors === 0 ? "達成" : "**未達**"} |`);
  if (s.stageAvgMs) {
    lines.push(
      `| 内訳の平均（Embedding / 検索 / 回答生成） | ${s.stageAvgMs.embed} / ${s.stageAvgMs.search} / ${s.stageAvgMs.generate} ms | — | — |`,
    );
  }
  if (s.tokens) {
    const cost = s.tokens.estimatedCostUsd === null ? "料金表なし" : `約 $${s.tokens.estimatedCostUsd.toFixed(4)}`;
    lines.push(
      `| Claude トークン（${s.tokens.calls} 回） | 入力 ${s.tokens.input} / 出力 ${s.tokens.output}（推定 ${cost}） | — | — |`,
    );
  }
  lines.push("");

  lines.push("## 質問別の結果", "");
  lines.push(
    "| # | 種別 | 検索ヒット | 回答 | 出典（ファイル p.ページ） | 出典正確性 | セクション一致 | 不足要点 | 正答 | 時間(ms) | 内訳 E/S/G (ms) | トークン 入/出 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const r of report.results) lines.push(row(r));
  lines.push("");

  lines.push("## 目標未達時の原因と改善策（記入欄）", "");
  lines.push("| # | 事象 | 原因（検索/チャンク/プロンプト/モデル/データ） | 改善策 | 再検証日 |");
  lines.push("| --- | --- | --- | --- | --- |");
  const failed = report.results.filter((r) => r.correct === false || r.retrievalHit === false || r.error);
  if (failed.length === 0) lines.push("| — | — | — | — | — |");
  for (const r of failed) {
    const ev = r.error
      ? `エラー: ${r.error}`
      : r.retrievalHit === false
        ? "期待文書が検索上位に入らない"
        : r.expectsAnswer
          ? "回答の要点不足または出典不一致"
          : "該当なし質問に回答してしまった";
    lines.push(`| ${r.id} | ${ev} |  |  |  |`);
  }
  lines.push("");
  return lines.join("\n");
}

function row(r: QuestionResult): string {
  const answer =
    r.found === null ? "（エラー）" : r.found ? cell((r.answer ?? "").slice(0, 60)) : "該当なし";
  const cites = r.citations.map((c) => `${c.fileName} p.${c.pageNumber}`).join("<br>") || "—";
  const missing =
    r.missingFacts === null ? "—" : r.missingFacts.length ? r.missingFacts.map((m) => m[0]).join(", ") : "なし";
  return `| ${r.id} | ${r.expectsAnswer ? "該当あり" : "該当なし"} | ${yn(r.retrievalHit)} | ${answer} | ${cites} | ${r.citationAccuracy === null ? "—" : pct(r.citationAccuracy)} | ${yn(r.sectionMatch)} | ${missing} | ${yn(r.correct)} | ${r.latencyMs ?? "—"} | ${r.stages ? `${r.stages.embedMs}/${r.stages.searchMs ?? "—"}/${r.stages.generateMs ?? "—"}` : "—"} | ${r.usage ? `${r.usage.inputTokens}/${r.usage.outputTokens}` : "—"} |`;
}
