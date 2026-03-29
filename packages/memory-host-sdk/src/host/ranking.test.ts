import { describe, expect, it } from "vitest";
import { blendScoreWithRecency, resolveRecencyScore } from "./ranking.js";

describe("memory ranking", () => {
  it("gives newer entries higher recency score", () => {
    const now = Date.UTC(2026, 0, 10);
    const fresh = resolveRecencyScore({
      nowMs: now,
      updatedAtMs: now,
      halfLifeDays: 14,
    });
    const stale = resolveRecencyScore({
      nowMs: now,
      updatedAtMs: now - 30 * 86_400_000,
      halfLifeDays: 14,
    });
    expect(fresh).toBeGreaterThan(stale);
  });

  it("blends similarity score with recency boost", () => {
    const score = blendScoreWithRecency({
      score: 0.2,
      recencyScore: 1,
      recencyBoost: 0.5,
    });
    expect(score).toBeCloseTo(0.6);
  });
});
