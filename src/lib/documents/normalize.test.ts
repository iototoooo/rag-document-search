import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("康熙部首を通常の漢字に変換する", () => {
    expect(normalizeText("施行\u2F47: 2030年4\u2F491\u2F47／\u2F08事課")).toBe(
      "施行日: 2030年4月1日/人事課",
    );
  });

  it("NFKC で変換されない部首補助（⻑ U+2ED1 等）も通常の漢字にする", () => {
    expect(normalizeText("上⻑の承認・国⺠の祝日")).toBe("上長の承認・国民の祝日");
  });

  it("全角英数を半角にし、余分な空白・改行を整理する", () => {
    expect(normalizeText("  ＡＢＣ１２３\u3000 \r\n\r\n\r\n次 ")).toBe("ABC123\n\n次");
  });
});
