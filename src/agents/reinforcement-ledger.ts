import fs from "node:fs/promises";
import path from "node:path";
import { generateSecureUuid } from "../infra/secure-random.js";

export type RecordRunReinforcementParams = {
  agentId: string;
  workspaceDir: string;
  sessionKey?: string;
  successfulReply: boolean;
  modelSwitchNotice?: string;
  fallbackRecovered: boolean;
  /** Source of this reinforcement record for debugging and future policy routing. */
  source?: "agent-runner" | "followup-runner";
  /** Outbound text payloads generated in this run, used for commitment/evidence extraction. */
  replyTexts?: string[];
  /** Testability override; defaults to Date.now(). */
  recordedAtMs?: number;
};

export type RunReinforcementHook = (params: RecordRunReinforcementParams) => Promise<void> | void;

type CommitmentType = "followup_reply" | "task_execution" | "artifact_delivery";

type CommitmentRecord = {
  id: string;
  agentId: string;
  sessionKey: string;
  runSource: "agent-runner" | "followup-runner" | "unknown";
  createdAt: number;
  dueAt: number;
  type: CommitmentType;
  promiseText: string;
  confidence: number;
};

type CommitmentStatus = "delivered" | "overdue" | "cancelled";

type CommitmentEvidenceRecord = {
  id: string;
  commitmentId: string;
  sessionKey: string;
  status: CommitmentStatus;
  occurredAt: number;
  reason: string;
  evidenceText?: string;
};

type ScoredCommitment = {
  commitment: CommitmentRecord;
  status: "pending" | CommitmentStatus;
  statusAt?: number;
};

type CommitmentPattern = {
  type: CommitmentType;
  regex: RegExp;
  confidence: number;
};

const DEFAULT_SESSION_KEY = "agent:main:unknown";
const DEFAULT_PROMISE_DUE_MS = 30 * 60_000;
const PROMISE_DUE_SOON_MS = 10 * 60_000;
const PROMISE_DUE_TODAY_MS = 6 * 60 * 60_000;
const PROMISE_DUE_TOMORROW_MS = 24 * 60 * 60_000;

const commitmentPatterns: ReadonlyArray<CommitmentPattern> = [
  {
    type: "followup_reply",
    regex:
      /\b(?:i(?:'m| am)?|we(?:'re| are)?|i(?:'ll| will)|we(?:'ll| will))\b.{0,30}\b(?:reply|follow up|get back|update you)\b/i,
    confidence: 0.86,
  },
  {
    type: "task_execution",
    regex:
      /\b(?:i(?:'m| am)?|we(?:'re| are)?|i(?:'ll| will)|we(?:'ll| will))\b.{0,30}\b(?:check|investigate|fix|handle|implement|do)\b/i,
    confidence: 0.8,
  },
  {
    type: "artifact_delivery",
    regex: /\b(?:i(?:'ll| will)|we(?:'ll| will))\b.{0,30}\b(?:share|send|provide|post)\b/i,
    confidence: 0.78,
  },
  {
    type: "followup_reply",
    regex: /我.{0,8}(?:会|先|马上|等会|稍后).{0,16}(?:回复|回你|跟进|告诉你)/,
    confidence: 0.87,
  },
  {
    type: "task_execution",
    regex: /我.{0,8}(?:会|先|马上|等会|稍后).{0,16}(?:检查|处理|修复|做|排查)/,
    confidence: 0.82,
  },
  {
    type: "artifact_delivery",
    regex: /我.{0,8}(?:会|先|马上|等会|稍后).{0,16}(?:发你|给你|贴上|提供).{0,10}(?:结果|日志|代码|截图)/,
    confidence: 0.8,
  },
];

const completionCueRegexes: ReadonlyArray<RegExp> = [
  /\b(?:done|completed|fixed|implemented|resolved|finished)\b/i,
  /\b(?:here(?:'s| is)|updated|result below|output below)\b/i,
  /(?:已完成|完成了|处理好了|修好了|结果如下|更新如下|已处理)/,
];

const commitmentCueRegexes: ReadonlyArray<RegExp> = commitmentPatterns.map((pattern) => pattern.regex);

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizePromiseKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

function resolvePromiseDueMs(text: string): number {
  if (/(?:马上|等会|稍后|很快|soon|immediately|right away|shortly)/i.test(text)) {
    return PROMISE_DUE_SOON_MS;
  }
  if (/(?:今天|today)/i.test(text)) {
    return PROMISE_DUE_TODAY_MS;
  }
  if (/(?:明天|tomorrow)/i.test(text)) {
    return PROMISE_DUE_TOMORROW_MS;
  }
  return DEFAULT_PROMISE_DUE_MS;
}

function extractCommitments(params: {
  texts: string[];
  nowMs: number;
  sessionKey: string;
  agentId: string;
  runSource: "agent-runner" | "followup-runner" | "unknown";
  existingPending: ReadonlyArray<ScoredCommitment>;
}): CommitmentRecord[] {
  const extracted: CommitmentRecord[] = [];
  const pendingKeys = new Set(
    params.existingPending
      .filter((entry) => entry.status === "pending")
      .map((entry) => normalizePromiseKey(entry.commitment.promiseText)),
  );

  for (const rawText of params.texts) {
    const text = normalizeText(rawText);
    if (!text) {
      continue;
    }
    if (/不会/.test(text)) {
      continue;
    }
    for (const pattern of commitmentPatterns) {
      if (!pattern.regex.test(text)) {
        continue;
      }
      const promiseKey = normalizePromiseKey(text);
      if (pendingKeys.has(promiseKey)) {
        continue;
      }
      const createdAt = params.nowMs;
      extracted.push({
        id: generateSecureUuid(),
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        runSource: params.runSource,
        createdAt,
        dueAt: createdAt + resolvePromiseDueMs(text),
        type: pattern.type,
        promiseText: text,
        confidence: pattern.confidence,
      });
      pendingKeys.add(promiseKey);
      break;
    }
  }

  return extracted;
}

function isCompletionEvidenceText(text: string): boolean {
  if (commitmentCueRegexes.some((regex) => regex.test(text))) {
    return false;
  }
  return completionCueRegexes.some((regex) => regex.test(text));
}

function resolveReliabilityPaths(workspaceDir: string, nowMs: number) {
  const reliabilityDir = path.join(workspaceDir, "state", "reliability");
  const daily = new Date(nowMs).toISOString().slice(0, 10);
  return {
    reliabilityDir,
    commitmentsPath: path.join(reliabilityDir, "commitments.jsonl"),
    evidencePath: path.join(reliabilityDir, "evidence.jsonl"),
    summaryPath: path.join(workspaceDir, "memory", `reliability-${daily}.md`),
  };
}

async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const records: T[] = [];
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        records.push(JSON.parse(trimmed) as T);
      } catch {
        // Ignore malformed lines; keep append-only resilience.
      }
    }
    return records;
  } catch {
    return [];
  }
}

async function appendJsonl(filePath: string, records: unknown[]): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const lines = records
    .map((record) => {
      try {
        return JSON.stringify(record);
      } catch {
        return null;
      }
    })
    .filter((line): line is string => Boolean(line));
  if (lines.length === 0) {
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function applyEvidenceToCommitments(
  commitments: ReadonlyArray<CommitmentRecord>,
  evidence: ReadonlyArray<CommitmentEvidenceRecord>,
): ScoredCommitment[] {
  const byId = new Map<string, ScoredCommitment>();
  for (const record of commitments) {
    byId.set(record.id, {
      commitment: record,
      status: "pending",
    });
  }

  const sortedEvidence = [...evidence].sort((left, right) => left.occurredAt - right.occurredAt);
  for (const entry of sortedEvidence) {
    const current = byId.get(entry.commitmentId);
    if (!current) {
      continue;
    }
    byId.set(entry.commitmentId, {
      commitment: current.commitment,
      status: entry.status,
      statusAt: entry.occurredAt,
    });
  }

  return [...byId.values()].sort(
    (left, right) => left.commitment.createdAt - right.commitment.createdAt,
  );
}

function computeScore(entries: ReadonlyArray<ScoredCommitment>): {
  total: number;
  pending: number;
  delivered: number;
  overdue: number;
  cancelled: number;
  deliveredOnTime: number;
  deliveryRate: number;
  onTimeRate: number;
  overpromiseRate: number;
  score: number;
} {
  const total = entries.length;
  let pending = 0;
  let delivered = 0;
  let overdue = 0;
  let cancelled = 0;
  let deliveredOnTime = 0;

  for (const entry of entries) {
    if (entry.status === "pending") {
      pending += 1;
      continue;
    }
    if (entry.status === "delivered") {
      delivered += 1;
      if ((entry.statusAt ?? Number.POSITIVE_INFINITY) <= entry.commitment.dueAt) {
        deliveredOnTime += 1;
      }
      continue;
    }
    if (entry.status === "overdue") {
      overdue += 1;
      continue;
    }
    if (entry.status === "cancelled") {
      cancelled += 1;
    }
  }

  const deliveredPlusOverdue = delivered + overdue;
  const deliveryRate = deliveredPlusOverdue > 0 ? delivered / deliveredPlusOverdue : 1;
  const onTimeRate = delivered > 0 ? deliveredOnTime / delivered : 1;
  const overpromiseRate = total > 0 ? overdue / total : 0;
  const score = Math.round(
    100 * (0.5 * deliveryRate + 0.3 * onTimeRate + 0.2 * (1 - overpromiseRate)),
  );

  return {
    total,
    pending,
    delivered,
    overdue,
    cancelled,
    deliveredOnTime,
    deliveryRate,
    onTimeRate,
    overpromiseRate,
    score,
  };
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

async function writeDailySummary(params: {
  summaryPath: string;
  nowMs: number;
  entries: ReadonlyArray<ScoredCommitment>;
  score: ReturnType<typeof computeScore>;
}): Promise<void> {
  const nowIso = new Date(params.nowMs).toISOString();
  const outstanding = params.entries
    .filter((entry) => entry.status === "pending")
    .slice(0, 5)
    .map(
      (entry) =>
        `- ${entry.commitment.promiseText} (session: ${entry.commitment.sessionKey}, due: ${new Date(entry.commitment.dueAt).toISOString()})`,
    );
  const overdueByText = new Map<string, number>();
  for (const entry of params.entries) {
    if (entry.status !== "overdue") {
      continue;
    }
    overdueByText.set(
      entry.commitment.promiseText,
      (overdueByText.get(entry.commitment.promiseText) ?? 0) + 1,
    );
  }
  const overduePatterns = [...overdueByText.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5)
    .map(([text, count]) => `- ${text} (${count})`);

  const lines = [
    `# Reliability Review (${new Date(params.nowMs).toISOString().slice(0, 10)})`,
    "",
    "## Snapshot",
    `- GeneratedAt: ${nowIso}`,
    `- Total commitments: ${params.score.total}`,
    `- Pending: ${params.score.pending}`,
    `- Delivered: ${params.score.delivered}`,
    `- Overdue: ${params.score.overdue}`,
    `- Cancelled: ${params.score.cancelled}`,
    `- Delivery rate: ${formatPercent(params.score.deliveryRate)}`,
    `- On-time rate: ${formatPercent(params.score.onTimeRate)}`,
    `- Overpromise rate: ${formatPercent(params.score.overpromiseRate)}`,
    `- Reliability score: ${params.score.score}`,
    "",
    "## Outstanding Commitments",
    ...(outstanding.length > 0 ? outstanding : ["- none"]),
    "",
    "## Overdue Patterns",
    ...(overduePatterns.length > 0 ? overduePatterns : ["- none"]),
    "",
    "## Correction Rule",
    "- Before saying 'I will follow up later', complete one concrete action now or state an explicit deadline.",
    "",
  ];

  await fs.mkdir(path.dirname(params.summaryPath), { recursive: true });
  await fs.writeFile(params.summaryPath, lines.join("\n"), "utf8");
}

async function runReliabilityLedger(params: RecordRunReinforcementParams): Promise<void> {
  const nowMs = params.recordedAtMs ?? Date.now();
  const sessionKey = params.sessionKey?.trim() || DEFAULT_SESSION_KEY;
  const runSource = params.source ?? "unknown";
  const texts = [
    ...(params.replyTexts ?? []),
    ...(typeof params.modelSwitchNotice === "string" ? [params.modelSwitchNotice] : []),
  ]
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);

  const paths = resolveReliabilityPaths(params.workspaceDir, nowMs);
  const [commitments, evidence] = await Promise.all([
    readJsonlFile<CommitmentRecord>(paths.commitmentsPath),
    readJsonlFile<CommitmentEvidenceRecord>(paths.evidencePath),
  ]);

  let scored = applyEvidenceToCommitments(commitments, evidence);
  const newCommitments = extractCommitments({
    texts,
    nowMs,
    sessionKey,
    agentId: params.agentId,
    runSource,
    existingPending: scored,
  });

  const newEvidence: CommitmentEvidenceRecord[] = [];
  if (newCommitments.length > 0) {
    await appendJsonl(paths.commitmentsPath, newCommitments);
    scored = applyEvidenceToCommitments([...commitments, ...newCommitments], evidence);
  }

  const pendingForSession = scored.filter(
    (entry) => entry.status === "pending" && entry.commitment.sessionKey === sessionKey,
  );

  if (texts.length > 0 && pendingForSession.length > 0) {
    const resolvedIds = new Set<string>();
    for (const text of texts) {
      if (!isCompletionEvidenceText(text)) {
        continue;
      }
      const target = pendingForSession.find((entry) => !resolvedIds.has(entry.commitment.id));
      if (!target) {
        break;
      }
      resolvedIds.add(target.commitment.id);
      newEvidence.push({
        id: generateSecureUuid(),
        commitmentId: target.commitment.id,
        sessionKey,
        status: "delivered",
        occurredAt: nowMs,
        reason: "completion_cue",
        evidenceText: text.slice(0, 400),
      });
    }
  }

  const latestScored =
    newEvidence.length > 0
      ? applyEvidenceToCommitments(
          [...commitments, ...newCommitments],
          [...evidence, ...newEvidence],
        )
      : scored;

  for (const entry of latestScored) {
    if (entry.status !== "pending") {
      continue;
    }
    if (entry.commitment.dueAt > nowMs) {
      continue;
    }
    newEvidence.push({
      id: generateSecureUuid(),
      commitmentId: entry.commitment.id,
      sessionKey: entry.commitment.sessionKey,
      status: "overdue",
      occurredAt: nowMs,
      reason: "deadline_passed",
    });
  }

  if (newEvidence.length > 0) {
    await appendJsonl(paths.evidencePath, newEvidence);
  }

  const finalScored = applyEvidenceToCommitments(
    [...commitments, ...newCommitments],
    [...evidence, ...newEvidence],
  );
  const score = computeScore(finalScored);
  await writeDailySummary({
    summaryPath: paths.summaryPath,
    nowMs,
    entries: finalScored,
    score,
  });
}

const reinforcementHooks = new Map<string, RunReinforcementHook>([
  ["delivery-reliability", runReliabilityLedger],
]);

export function registerRunReinforcementHook(name: string, hook: RunReinforcementHook): () => void {
  if (!name.trim()) {
    throw new Error("reinforcement hook name is required");
  }
  reinforcementHooks.set(name, hook);
  return () => {
    reinforcementHooks.delete(name);
  };
}

export function listRunReinforcementHooks(): string[] {
  return [...reinforcementHooks.keys()].toSorted((left, right) => left.localeCompare(right));
}

export async function recordRunReinforcement(params: RecordRunReinforcementParams): Promise<void> {
  if (!params.workspaceDir?.trim()) {
    return;
  }

  const tasks: Promise<void>[] = [];
  for (const hook of reinforcementHooks.values()) {
    tasks.push(
      (async () => {
        await hook(params);
      })(),
    );
  }
  await Promise.allSettled(tasks);
}
