export function resolveRecencyScore(params: {
  updatedAtMs?: number;
  nowMs: number;
  halfLifeDays: number;
}): number {
  const now = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const updatedAt =
    typeof params.updatedAtMs === "number" && Number.isFinite(params.updatedAtMs)
      ? params.updatedAtMs
      : now;
  const ageMs = Math.max(0, now - updatedAt);
  const days = ageMs / 86_400_000;
  const halfLifeDays = Math.max(1, params.halfLifeDays);
  return Math.exp(-days / halfLifeDays);
}

export function blendScoreWithRecency(params: {
  score: number;
  recencyScore: number;
  recencyBoost: number;
}): number {
  const base = Number.isFinite(params.score) ? params.score : 0;
  const recency = Number.isFinite(params.recencyScore) ? params.recencyScore : 0;
  const boost = Math.max(0, Math.min(1, params.recencyBoost));
  const mixed = (1 - boost) * base + boost * recency;
  return Math.max(0, Math.min(1, mixed));
}
