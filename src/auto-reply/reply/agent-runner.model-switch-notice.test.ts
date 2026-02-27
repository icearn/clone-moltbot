import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateContext } from "../templating.js";
import type { FollowupRun, QueueSettings } from "./queue.js";
import { createMockTypingController } from "./test-helpers.js";

const runEmbeddedPiAgentMock = vi.fn();
const runWithModelFallbackMock = vi.fn();

vi.mock("../../agents/model-fallback.js", () => ({
  runWithModelFallback: (params: { run: (provider: string, model: string) => Promise<unknown> }) =>
    runWithModelFallbackMock(params),
}));

vi.mock("../../agents/pi-embedded.js", () => ({
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: (params: unknown) => runEmbeddedPiAgentMock(params),
}));

vi.mock("./queue.js", async () => {
  const actual = await vi.importActual<typeof import("./queue.js")>("./queue.js");
  return {
    ...actual,
    enqueueFollowupRun: vi.fn(),
    scheduleFollowupDrain: vi.fn(),
  };
});

import { runReplyAgent } from "./agent-runner.js";

describe("runReplyAgent model switch notice", () => {
  beforeEach(() => {
    runEmbeddedPiAgentMock.mockReset();
    runWithModelFallbackMock.mockReset();
  });

  it("prepends a visible model switch notice when fallback changes provider/model", async () => {
    runEmbeddedPiAgentMock.mockResolvedValueOnce({
      payloads: [{ text: "working" }],
      meta: {
        agentMeta: {
          provider: "openai",
          model: "gpt-5-mini",
        },
      },
    });
    runWithModelFallbackMock.mockImplementationOnce(
      async ({ run }: { run: (provider: string, model: string) => Promise<unknown> }) => ({
        result: await run("openai", "gpt-5-mini"),
        provider: "openai",
        model: "gpt-5-mini",
        attempts: [
          {
            provider: "anthropic",
            model: "claude-opus-4-5",
            error: "rate limit",
            reason: "rate_limit",
          },
        ],
      }),
    );

    const typing = createMockTypingController();
    const sessionCtx = {
      Provider: "whatsapp",
      OriginatingTo: "+15550001111",
      AccountId: "primary",
      MessageSid: "msg",
    } as unknown as TemplateContext;
    const resolvedQueue = { mode: "interrupt" } as unknown as QueueSettings;
    const followupRun = {
      prompt: "hello",
      summaryLine: "hello",
      enqueuedAt: Date.now(),
      run: {
        agentId: "main",
        agentDir: "/tmp/agent",
        sessionId: "session",
        sessionKey: "agent:main:direct:test",
        messageProvider: "whatsapp",
        sessionFile: "/tmp/session.jsonl",
        workspaceDir: "/tmp",
        config: {},
        skillsSnapshot: {},
        provider: "anthropic",
        model: "claude-opus-4-5",
        thinkLevel: "low",
        verboseLevel: "off",
        elevatedLevel: "off",
        bashElevated: {
          enabled: false,
          allowed: false,
          defaultLevel: "off",
        },
        timeoutMs: 1_000,
        blockReplyBreak: "message_end",
      },
    } as unknown as FollowupRun;

    const result = await runReplyAgent({
      commandBody: "hello",
      followupRun,
      queueKey: "main",
      resolvedQueue,
      shouldSteer: false,
      shouldFollowup: false,
      isActive: false,
      isStreaming: false,
      typing,
      sessionCtx,
      sessionKey: "agent:main:direct:test",
      defaultModel: "anthropic/claude-opus-4-5",
      resolvedVerboseLevel: "off",
      isNewSession: false,
      blockStreamingEnabled: false,
      resolvedBlockStreamingBreak: "message_end",
      shouldInjectGroupIntro: false,
      typingMode: "instant",
    });

    expect(Array.isArray(result)).toBe(true);
    const payloads = result as Array<{ text?: string }>;
    expect(String(payloads[0]?.text ?? "")).toContain("Model switch:");
    expect(String(payloads[1]?.text ?? "")).toContain("working");
  });
});
