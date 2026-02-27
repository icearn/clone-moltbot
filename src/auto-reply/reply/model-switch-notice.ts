import type { FallbackAttempt } from "../../agents/model-fallback.js";

type ModelSwitchNoticeParams = {
  requestedProvider?: string;
  requestedModel?: string;
  usedProvider?: string;
  usedModel?: string;
  attempts?: FallbackAttempt[];
};

function normalizeRef(provider?: string, model?: string): string {
  const p = String(provider ?? "").trim();
  const m = String(model ?? "").trim();
  if (!p && !m) {
    return "";
  }
  if (!p) {
    return m;
  }
  if (!m) {
    return p;
  }
  return `${p}/${m}`;
}

function formatReason(reason?: string): string | undefined {
  const normalized = String(reason ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return undefined;
  }
  switch (normalized) {
    case "rate_limit":
      return "rate-limit";
    default:
      return normalized.replaceAll("_", "-");
  }
}

export function buildModelSwitchNotice(params: ModelSwitchNoticeParams): string | undefined {
  const requested = normalizeRef(params.requestedProvider, params.requestedModel);
  const used = normalizeRef(params.usedProvider, params.usedModel);
  if (!requested || !used || requested === used) {
    return undefined;
  }
  const attempts = params.attempts ?? [];
  const reason =
    formatReason(attempts.find((entry) => entry.reason)?.reason) ??
    formatReason(attempts[0]?.reason);
  const attemptsSuffix =
    attempts.length > 0
      ? ` after ${attempts.length} failed attempt${attempts.length === 1 ? "" : "s"}`
      : "";
  const reasonSuffix = reason ? ` (reason: ${reason})` : "";
  return `Model switch: ${requested} -> ${used}${reasonSuffix}${attemptsSuffix}.`;
}
