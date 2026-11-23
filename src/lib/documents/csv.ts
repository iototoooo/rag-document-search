/**
 * RFC 4180 準拠の最小CSVパーサー（ダブルクォート・エスケープ・改行入りセル対応）。
 * テスト質問CSVの読み込みに使用する。
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export type TestQuestion = {
  id: number;
  question: string;
  expectedAnswer: string;
  sourceDocument: string;
  sourceSection: string;
  kind: string;
};

export function parseTestQuestions(input: string): TestQuestion[] {
  const [header, ...rows] = parseCsv(input);
  if (!header || header.length < 6) {
    throw new Error("テスト質問CSVのヘッダーが不正です");
  }
  const columns = header.length;
  return rows.map((r, idx) => {
    if (r.length < columns) throw new Error(`CSV ${idx + 2}行目の列数が不足しています`);
    // 期待回答（3列目）に「12,000円」のようなクォートされていないカンマが含まれる場合、
    // 列が増える。前2列・後3列は固定なので、余分な列は期待回答に戻す。
    const extra = r.length - columns;
    const expectedAnswer = r.slice(2, 3 + extra).join(",");
    const [sourceDocument, sourceSection, kind] = r.slice(3 + extra);
    const id = Number(r[0]);
    if (!Number.isInteger(id)) throw new Error(`CSV ${idx + 2}行目の番号が不正です`);
    return { id, question: r[1], expectedAnswer, sourceDocument, sourceSection, kind };
  });
}
