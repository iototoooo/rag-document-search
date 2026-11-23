import { describe, expect, it } from "vitest";
import { minimalPdf } from "@/lib/verify/sectest";
import { normalizeText } from "./normalize";
import { extractPdfText } from "./pdf";

/** 手元で生成した最小の PDF でテキスト抽出を確認する（教材の PDF は使わない） */
describe("extractPdfText", () => {
  it("1 ページの PDF からページ数と本文を取り出せる", async () => {
    const { totalPages, pages } = await extractPdfText(minimalPdf("Demo travel rules: hotel limit 12000 yen"));
    expect(totalPages).toBe(1);
    expect(pages).toHaveLength(1);
    expect(normalizeText(pages[0])).toContain("hotel limit 12000 yen");
  });

  it("PDF でないデータは例外になる", async () => {
    await expect(extractPdfText(new TextEncoder().encode("not a pdf"))).rejects.toThrow();
  });
});
