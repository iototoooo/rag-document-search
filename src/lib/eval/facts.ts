import { normalizeText } from "@/lib/documents/normalize";

/**
 * 期待回答から「回答に必ず含まれるべき要点」（数値＋単位・時刻）を抽出する。
 * 各要点は表記ゆれの候補（いずれか一致で可）の配列。
 * 例: "1泊12,000円" → [["12000円"]]、"11:00〜15:00" → [["11:00","11時"], ["15:00","15時"]]
 */

const UNIT = "(?:ヶ月|か月|カ月|ケ月|営業日|時間|文字|日|円|分|回|%|件|名|人)";
const NUMBER_WITH_UNIT = new RegExp(`(\\d{1,3}(?:,\\d{3})+|\\d+)\\s*${UNIT}`, "g");
const TIME = /(\d{1,2}):(\d{2})/g;

/** 照合用の正規化（NFKC・空白除去・数値の桁区切り除去・「か月」表記の統一）。 */
export function normalizeForMatch(text: string): string {
  return normalizeText(text)
    .replace(/\s+/g, "")
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/[かカケ]月/g, "ヶ月")
    .replace(/[〜～]/g, "~");
}

export function extractKeyFacts(expectedAnswer: string): string[][] {
  const text = normalizeForMatch(expectedAnswer);
  const facts: string[][] = [];
  const seen = new Set<string>();

  for (const m of text.matchAll(TIME)) {
    const hhmm = `${Number(m[1])}:${m[2]}`;
    if (seen.has(hhmm)) continue;
    seen.add(hhmm);
    const alts = [hhmm];
    if (m[2] === "00") alts.push(`${Number(m[1])}時`);
    facts.push(alts);
  }
  // 時刻部分を除いてから数値＋単位を抽出する（"11:00" の "00" を拾わない）
  const withoutTimes = text.replace(TIME, " ");
  for (const m of withoutTimes.matchAll(NUMBER_WITH_UNIT)) {
    const fact = m[0];
    if (seen.has(fact)) continue;
    seen.add(fact);
    facts.push([fact]);
  }
  return facts;
}

/** 回答に含まれない要点を返す（空配列なら全要点を満たす）。 */
export function missingFacts(answer: string, facts: string[][]): string[][] {
  const a = normalizeForMatch(answer);
  return facts.filter((alts) => !alts.some((f) => a.includes(f)));
}
