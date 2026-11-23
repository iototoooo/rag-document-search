/**
 * ユーザー単位の簡易レート制限（固定ウィンドウ・インメモリ）。
 * 単一プロセス向けの MVP 実装。複数インスタンス構成では共有ストアに置き換えること。
 */
export class InMemoryRateLimiter {
  private readonly hits = new Map<string, { windowStart: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** 許可されれば true。 */
  take(key: string): boolean {
    const t = this.now();
    const entry = this.hits.get(key);
    if (!entry || t - entry.windowStart >= this.windowMs) {
      this.hits.set(key, { windowStart: t, count: 1 });
      this.prune(t);
      return true;
    }
    if (entry.count >= this.limit) return false;
    entry.count += 1;
    return true;
  }

  private prune(t: number) {
    if (this.hits.size < 1000) return;
    for (const [k, v] of this.hits) {
      if (t - v.windowStart >= this.windowMs) this.hits.delete(k);
    }
  }
}
