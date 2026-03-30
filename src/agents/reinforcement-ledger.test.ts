import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  listRunReinforcementHooks,
  recordRunReinforcement,
  registerRunReinforcementHook,
} from "./reinforcement-ledger.js";

async function readJsonl(filePath: string): Promise<unknown[]> {
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

describe("recordRunReinforcement", () => {
  it("extracts commitments and writes reliability summary", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reinforcement-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: true,
      fallbackRecovered: false,
      source: "agent-runner",
      replyTexts: ["我先检查一下，等会回复你。"],
      recordedAtMs: Date.parse("2026-03-30T10:00:00.000Z"),
    });

    const commitmentsPath = path.join(workspaceDir, "state", "reliability", "commitments.jsonl");
    const evidencePath = path.join(workspaceDir, "state", "reliability", "evidence.jsonl");
    const summaryPath = path.join(workspaceDir, "memory", "reliability-2026-03-30.md");

    const commitments = await readJsonl(commitmentsPath);
    expect(commitments.length).toBe(1);
    expect((commitments[0] as { type?: unknown }).type).toBe("followup_reply");

    await expect(fs.access(evidencePath)).rejects.toBeDefined();
    const summary = await fs.readFile(summaryPath, "utf8");
    expect(summary).toContain("Total commitments: 1");
    expect(summary).toContain("Pending: 1");
  });

  it("marks commitment delivered when completion evidence appears", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reinforcement-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: true,
      fallbackRecovered: false,
      source: "agent-runner",
      replyTexts: ["I will check this and reply soon."],
      recordedAtMs: Date.parse("2026-03-30T10:00:00.000Z"),
    });

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: true,
      fallbackRecovered: false,
      source: "followup-runner",
      replyTexts: ["Done, result below: fixed the issue and verified the build."],
      recordedAtMs: Date.parse("2026-03-30T10:05:00.000Z"),
    });

    const evidencePath = path.join(workspaceDir, "state", "reliability", "evidence.jsonl");
    const evidence = await readJsonl(evidencePath);
    const delivered = evidence.find((entry) => (entry as { status?: string }).status === "delivered");
    expect(delivered).toBeDefined();

    const summaryPath = path.join(workspaceDir, "memory", "reliability-2026-03-30.md");
    const summary = await fs.readFile(summaryPath, "utf8");
    expect(summary).toContain("Delivered: 1");
    expect(summary).toContain("Overdue: 0");
  });

  it("marks pending commitments overdue after due time", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reinforcement-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: true,
      fallbackRecovered: false,
      source: "agent-runner",
      replyTexts: ["我会等会回复你。"],
      recordedAtMs: Date.parse("2026-03-30T10:00:00.000Z"),
    });

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: false,
      fallbackRecovered: false,
      source: "agent-runner",
      replyTexts: [],
      recordedAtMs: Date.parse("2026-03-30T10:11:00.000Z"),
    });

    const evidencePath = path.join(workspaceDir, "state", "reliability", "evidence.jsonl");
    const evidence = await readJsonl(evidencePath);
    const overdue = evidence.find((entry) => (entry as { status?: string }).status === "overdue");
    expect(overdue).toBeDefined();
  });

  it("supports registering extra reinforcement hooks", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-reinforcement-"));
    const workspaceDir = path.join(tempRoot, "workspace");
    await fs.mkdir(workspaceDir, { recursive: true });

    const calls: string[] = [];
    const unregister = registerRunReinforcementHook("test-hook", async (params) => {
      calls.push(params.agentId);
    });

    expect(listRunReinforcementHooks()).toContain("test-hook");

    await recordRunReinforcement({
      agentId: "main",
      workspaceDir,
      sessionKey: "agent:main:direct:test",
      successfulReply: false,
      fallbackRecovered: false,
      source: "agent-runner",
      replyTexts: [],
      recordedAtMs: Date.parse("2026-03-30T10:00:00.000Z"),
    });
    expect(calls).toEqual(["main"]);

    unregister();
    expect(listRunReinforcementHooks()).not.toContain("test-hook");
  });
});
