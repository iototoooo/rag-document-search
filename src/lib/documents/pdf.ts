import { extractText } from "unpdf";

export type PdfText = {
  totalPages: number;
  pages: string[];
};

/** PDFのバイト列からページごとのテキストを抽出する。 */
export async function extractPdfText(data: Uint8Array): Promise<PdfText> {
  const { totalPages, text } = await extractText(data, { mergePages: false });
  return { totalPages, pages: text };
}
