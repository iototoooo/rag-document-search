import "server-only";
import OpenAI from "openai";
import type { EmbeddingProvider } from "@/lib/contracts/ports";

const MAX_BATCH = 96;

/**
 * OpenAI Embeddings API（既定: text-embedding-3-small, 1536 次元）。
 * 入力テキストはログに出さない。
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly client: OpenAI;

  constructor(
    options: { apiKey: string; model: string; dimensions: number; maxRetries?: number },
    client?: OpenAI,
  ) {
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.client =
      client ?? new OpenAI({ apiKey: options.apiKey, maxRetries: options.maxRetries ?? 1, timeout: 30_000 });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const res = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        dimensions: this.dimensions,
        encoding_format: "float",
      });
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      if (sorted.length !== batch.length) {
        throw new Error("Embedding API の応答件数が入力と一致しません");
      }
      for (const d of sorted) {
        if (d.embedding.length !== this.dimensions) {
          throw new Error("Embedding の次元数が設定と一致しません");
        }
        out.push(d.embedding);
      }
    }
    return out;
  }
}
