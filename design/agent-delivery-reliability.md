# Agent Delivery Reliability Supervision Design (2026-03-30)

## Problem

OpenClaw can promise follow-up but fail to deliver later. We want behavior that is delivery-first, not wording-first.

## Goal

- Detect commitments in outbound text.
- Track pending/delivered/overdue commitments.
- Produce internal reliability score and review summary.
- Keep this channel-agnostic and non-blocking.

## Existing Extensible Hooks (Inventory)

Current repo already has plugin-level preset hooks in `src/plugins/hooks.ts` and `src/plugins/types.ts`:

- Agent lifecycle: `before_model_resolve`, `before_prompt_build`, `llm_input`, `llm_output`, `agent_end`, `before_compaction`, `after_compaction`, `before_reset`.
- Message lifecycle: `message_received`, `before_dispatch`, `message_sending`, `message_sent`.
- Tool/session/subagent/gateway/install hooks.

Where they are wired today:

- Agent run hooks in `src/agents/pi-embedded-runner/run/attempt.ts`.
- Message send hooks in `src/infra/outbound/deliver.ts`.
- Dispatch hooks in `src/auto-reply/reply/dispatch-from-config.ts`.

## Why Not Add a New Plugin Hook Name First

For this feature, we need a lightweight, direct post-payload reliability tap at the reply orchestrator layer (`agent-runner` and `followup-runner`) with minimum blast radius. Adding a new global plugin hook name is possible, but requires broader plugin contract changes and compatibility rollout.

So phase 1 uses an internal extensible module at the existing reinforcement call site.

## Selected Design

### 1) Internal Extensible Reinforcement Hook Module

`src/agents/reinforcement-ledger.ts` is now a hook dispatcher module:

- `recordRunReinforcement(params)`
- `registerRunReinforcementHook(name, hook)`
- `listRunReinforcementHooks()`

Default registered hook: `delivery-reliability`.

### 2) Main-Flow Injection Points

- `src/auto-reply/reply/agent-runner.ts`
- `src/auto-reply/reply/followup-runner.ts`

Both now send:

- `source` (`agent-runner` / `followup-runner`)
- outbound `replyTexts`
- session/agent/workspace context

### 3) Reliability Ledger Data Model

Append-only logs in workspace:

- `state/reliability/commitments.jsonl`
- `state/reliability/evidence.jsonl`

`commitments.jsonl` stores commitment creation records:

- `id`, `agentId`, `sessionKey`, `runSource`, `createdAt`, `dueAt`, `type`, `promiseText`, `confidence`

`evidence.jsonl` stores status transitions:

- `id`, `commitmentId`, `sessionKey`, `status`, `occurredAt`, `reason`, `evidenceText?`

### 4) Commitment Extraction (Phase 1 Rules)

- Rule-based EN + ZH commitment regexes.
- Classes:
  - `followup_reply`
  - `task_execution`
  - `artifact_delivery`
- Due-time inference:
  - soon/immediately/等会/稍后 => short SLA
  - today/今天 => same-day window
  - tomorrow/明天 => +24h
  - fallback default SLA

### 5) Evidence and Overdue Resolution

- Delivery evidence is inferred from completion-cue text in later replies of same session.
- Overdue is marked when pending commitment crosses `dueAt`.
- Status is reconstructed by replaying evidence over commitment records.

### 6) Daily Memory Summary

Write/update:

- `memory/reliability-YYYY-MM-DD.md`

Includes:

- total/pending/delivered/overdue/cancelled counts
- delivery/on-time/overpromise rates
- reliability score
- top pending and overdue patterns
- one correction rule

## Scoring Formula (Implemented)

- `delivery_rate = delivered / (delivered + overdue)`
- `on_time_rate = delivered_on_time / delivered`
- `overpromise_rate = overdue / total`
- `score = 100 * (0.5 * delivery_rate + 0.3 * on_time_rate + 0.2 * (1 - overpromise_rate))`

## Safety

- Hook failures never block normal reply delivery (`Promise.allSettled` at dispatcher level).
- Logs are append-only.
- Feature runs from existing fire-and-forget reinforcement call path.

## Current Status

Implemented in this phase:

- Existing hook inventory verified.
- Design refined to internal extensible reinforcement module.
- Reliability extraction/tracking/scoring/summary pipeline implemented.
- Main reply + followup reply both wired to this module.
- Unit tests updated for extraction, delivery, overdue, and hook extensibility.

## Next Phases

- Optionally bridge this internal module with plugin hook outputs (`agent_end`, `message_sent`) for stronger delivery evidence.
- Add low-noise in-session reminder injection for overdue commitments.
- Add configurable commitment budget guardrails.
