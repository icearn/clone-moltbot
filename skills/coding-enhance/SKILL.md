---
name: coding-enhance
description: Adds file-change reporting for development tasks when the user explicitly appends `/coding enhance` to the request. Use when explaining or maintaining the `/coding enhance` behavior, file-path reporting rules, or the prompt-level implementation for development-task traceability.
---

# Coding Enhance

Treat `/coding enhance` as a prompt-level traceability flag for development requests.

## Behavior

- Only activate when the user's current request explicitly includes `/coding enhance`.
- When active, use best coding practices for implementation work.
- Keep changes clear, maintainable, and consistent with local code patterns.
- Add or improve comments when they materially help future readers understand intent, non-obvious logic, assumptions, or edge cases; avoid noisy comment spam.
- For shell/exec work, do not blindly use one long compound command when separate commands would be safer and clearer.
- Prefer splitting independent shell steps into smaller commands for easier approval, auditing, retries, and failure isolation.
- Keep commands combined only when shared shell state or shell operators are genuinely required.
- If the task creates or modifies files, include a short explicit list of those file paths in the next user-facing reply.
- Prefer workspace-relative paths when practical.
- If no files changed, do not mention the rule or emit an empty list.

## Scope

- This is meant for coding / development work, not ordinary chat.
- The behavior should be injected by OpenClaw prompt-building logic, not left to agent memory or ad-hoc judgment.

## Maintenance

- If the implementation changes, keep this skill aligned with the actual runtime behavior.
- Keep this file short; the source of truth is the installed prompt-build code.
