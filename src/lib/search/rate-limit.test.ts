import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./rate-limit";

describe("InMemoryRateLimiter", () => {
  it("ウィンドウ内の上限を超えると拒否し、経過後にリセットする", () => {
    let t = 0;
    const rl = new InMemoryRateLimiter(2, 1000, () => t);
    expect(rl.take("u")).toBe(true);
    expect(rl.take("u")).toBe(true);
    expect(rl.take("u")).toBe(false);
    expect(rl.take("other")).toBe(true);
    t = 1000;
    expect(rl.take("u")).toBe(true);
  });
});
