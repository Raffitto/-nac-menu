# NAC GitHub control plane (tiny)

Source of truth: files in `ai-control/`, not chat paste.

## Loop

1. Supervisor (ChatGPT) writes `NEXT_TASK.md` (new `taskId`) and commits/pushes the working branch.
2. Worker runs **once** (no busy-wait):
   - GitHub Action `workflow_dispatch` or push of `ai-control/NEXT_TASK.md`
   - **or** comment `@cursor` on the Control Room issue (Cursor Cloud Agent, laptop off, no VPS)
3. Worker reads `STATE.json` + `NEXT_TASK.md`. If `taskId` equals `lastCompletedTaskId`, exit.
4. If `lock` is held or HEAD moved unexpectedly vs `headSha`, stop and report. Never force-push.
5. Execute allowed scope only. Focused tests only.
6. Write `LAST_HANDOFF.md`, set `STATE.json` to `awaiting_review`, push.
7. Supervisor reads the repo and issues the next task — or leaves idle.

If no new task ID: do nothing.

## Laptop off

Preferred: **Cursor Cloud Agents** (`@cursor` on the Control Room GitHub issue, or cursor.com/agents). Runs on Cursor VMs, not Raffi’s Mac.

Fallback: GitHub Actions `nac-ai-control.yml` (event-driven, concurrency 1). Deterministic tasks run without a model. Agent tasks need repository secret `CURSOR_API_KEY` (never commit it) or `@cursor`.

## Budget

Individual Cursor Models % is **not** on a public API. Baseline 69%. Soft stop ~88–89%. No on-demand.
