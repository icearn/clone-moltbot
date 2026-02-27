import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordRunReinforcement } from "./reinforcement-ledger.js";

const ORIGINAL_STATE_DIR = process.env.OPENCLAW_STATE_DIR;

afterEach(() => {
  if (ORIGINAL_STATE_DIR === undefined) {
    delete process.env.OPENCLAW_STATE_DIR;
  } else {
    process.env.OPENCLAW_STATE_DIR = ORIGINAL_STATE_DIR;
  }
});

describe("recordRunReinforcement", () => {
  it("writes reinforcement summary into workspace memory", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reinforcement-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });
    process.env.OPENCLAW_STATE_DIR = path.join(tempRoot, "state");

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: true,
      modelSwitchNotice: "Model switch: anthropic/a -> openai/b.",
      fallbackRecovered: true,
    });

    const summaryPath = path.join(workspaceDir, "memory", "reinforcement.md");
    const summary = await fs.readFile(summaryPath, "utf-8");
    expect(summary).toContain("Reinforcement Scoreboard");
    expect(summary).toContain("helpfulness");
    expect(summary).toContain("transparency");
    expect(summary).toContain("reliability");
    expect(summary).toContain("coexistence");
    expect(summary).toContain("curiosity");
  });
});
