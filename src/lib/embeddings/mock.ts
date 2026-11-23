import type { EmbeddingProvider } from "@/lib/contracts/ports";

/**
 * テスト・ローカル確認用の決定的な Embedding（外部 API を呼ばない）。
 * 文字 bigram をハッシュして次元に加算し、L2 正規化する。
 * 共通する文字列が多いほどコサイン類似度が高くなる。
 */
export class MockEmbeddingProvider implements EmbeddingProvider {
  readonly model = "mock-embedding";
  constructor(readonly dimensions = 1536) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const s = text.normalize("NFKC");
    for (let i = 0; i < s.length - 1; i++) {
      const gram = s.slice(i, i + 2);
      let h = 2166136261;
      for (let j = 0; j < gram.length; j++) {
        h ^= gram.charCodeAt(j);
        h = Math.imul(h, 16777619);
      }
      v[(h >>> 0) % this.dimensions] += 1;
    }
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
