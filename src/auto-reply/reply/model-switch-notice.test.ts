import { describe, expect, it } from "vitest";
import { buildModelSwitchNotice } from "./model-switch-notice.js";

describe("buildModelSwitchNotice", () => {
  it("returns undefined when model does not change", () => {
    const notice = buildModelSwitchNotice({
      requestedProvider: "anthropic",
      requestedModel: "claude-opus-4-5",
      usedProvider: "anthropic",
      usedModel: "claude-opus-4-5",
      attempts: [{ provider: "anthropic", model: "claude-opus-4-5", error: "timeout" }],
    });
    expect(notice).toBeUndefined();
  });

  it("formats model switch with reason and attempt count", () => {
    const notice = buildModelSwitchNotice({
      requestedProvider: "anthropic",
      requestedModel: "claude-opus-4-5",
      usedProvider: "openai",
      usedModel: "gpt-5-mini",
      attempts: [
        {
          provider: "anthropic",
          model: "claude-opus-4-5",
          error: "429",
          reason: "rate_limit",
        },
      ],
    });
    expect(notice).toBe(
      "Model switch: anthropic/claude-opus-4-5 -> openai/gpt-5-mini (reason: rate-limit) after 1 failed attempt.",
    );
  });
});
