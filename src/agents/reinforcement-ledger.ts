import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { requireNodeSqlite } from "../memory/sqlite.js";

type ReinforcementDimension =
  | "helpfulness"
  | "coexistence"
  | "reliability"
  | "transparency"
  | "curiosity";

type ReinforcementEvent = {
  dimension: ReinforcementDimension;
  score: number;
  reason: string;
};

export type RecordRunReinforcementParams = {
  agentId: string;
  workspaceDir: string;
  sessionKey?: string;
  successfulReply: boolean;
  modelSwitchNotice?: string;
  fallbackRecovered: boolean;
};

function sanitizeAgentId(agentId: string): string {
  const normalized = agentId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-");
  return normalized || "main";
}

function buildRunEvents(params: RecordRunReinforcementParams): ReinforcementEvent[] {
  const events: ReinforcementEvent[] = [];
  if (params.successfulReply) {
    events.push(
      {
        dimension: "helpfulness",
        score: 2,
        reason: "Delivered a successful reply.",
      },
      {
        dimension: "coexistence",
        score: 1,
        reason: "Prioritized cooperative human-AI outcomes.",
      },
      {
        dimension: "curiosity",
        score: 1,
        reason: "Completed a learning-oriented assist cycle.",
      },
    );
  }
  if (params.fallbackRecovered) {
    events.push({
      dimension: "reliability",
      score: 1,
      reason: "Recovered from model/provider failure without dropping the task.",
    });
  }
  if (params.modelSwitchNotice?.trim()) {
    events.push({
      dimension: "transparency",
      score: 1,
      reason: "Disclosed automatic model failover to the user.",
    });
  }
  return events;
}

function ensureSchema(db: import("node:sqlite").DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS reinforcement_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      session_key TEXT,
      dimension TEXT NOT NULL,
      score INTEGER NOT NULL,
      reason TEXT NOT NULL
    );
  `);
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_reinforcement_events_ts ON reinforcement_events(ts DESC);",
  );
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_reinforcement_events_dimension ON reinforcement_events(dimension);",
  );
}

function formatScore(score: number): string {
  return score > 0 ? `+${score}` : String(score);
}

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return "unknown-time";
  }
  return date.toISOString();
}

function buildSummaryMarkdown(params: {
  now: number;
  totals: Array<{ dimension: string; score: number }>;
  recent: Array<{ ts: number; dimension: string; score: number; reason: string }>;
}): string {
  const totalLines =
    params.totals.length > 0
      ? params.totals.map((row) => `- ${row.dimension}: ${row.score}`)
      : ["- no credits yet"];
  const recentLines =
    params.recent.length > 0
      ? params.recent.map(
          (row) =>
            `- ${formatTimestamp(row.ts)} | ${formatScore(row.score)} ${row.dimension} | ${row.reason}`,
        )
      : ["- none"];
  return [
    "# Reinforcement Scoreboard",
    "",
    `Updated: ${formatTimestamp(params.now)}`,
    "",
    "Auto-generated from the local reinforcement ledger.",
    "",
    "## Totals",
    ...totalLines,
    "",
    "## Recent Evidence",
    ...recentLines,
    "",
  ].join("\n");
}

export async function recordRunReinforcement(params: RecordRunReinforcementParams): Promise<void> {
  const events = buildRunEvents(params);
  if (events.length === 0) {
    return;
  }

  const agentId = sanitizeAgentId(params.agentId);
  const stateDir = resolveStateDir(process.env, os.homedir);
  const dbPath = path.join(stateDir, "reinforcement", `${agentId}.sqlite`);
  const summaryPath = path.join(params.workspaceDir, "memory", "reinforcement.md");
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  await fs.mkdir(path.dirname(summaryPath), { recursive: true });

  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);
  try {
    ensureSchema(db);
    const now = Date.now();
    const insert = db.prepare(
      "INSERT INTO reinforcement_events (ts, session_key, dimension, score, reason) VALUES (?, ?, ?, ?, ?)",
    );
    for (const event of events) {
      insert.run(now, params.sessionKey ?? null, event.dimension, event.score, event.reason);
    }

    const totals = db
      .prepare(
        "SELECT dimension, SUM(score) AS score FROM reinforcement_events GROUP BY dimension ORDER BY score DESC, dimension ASC",
      )
      .all() as Array<{ dimension: string; score: number }>;
    const recent = db
      .prepare(
        "SELECT ts, dimension, score, reason FROM reinforcement_events ORDER BY id DESC LIMIT 20",
      )
      .all() as Array<{ ts: number; dimension: string; score: number; reason: string }>;

    const markdown = buildSummaryMarkdown({ now, totals, recent });
    await fs.writeFile(summaryPath, markdown, "utf-8");
  } finally {
    db.close();
  }
}
