---
taskId: NAC-FOODICS-0002
permission: AUTO_WITH_GUARDRAILS
complexity: MEDIUM
deterministic: false
testBudget: foodicsBridge|schedulerCatchup|proofEvidence|launchdWiring
deploy: none
onDemandAllowed: false
mergeToMain: false
issuedAt: 2026-08-19T19:19:00+03:00
---

# NAC-FOODICS-0002 — Wire 01:30 Mac Runtime to Authenticated Bridge + First-Proof Readiness

## Objective

Finish the repo-side wiring needed so Raffi's already-open Mac can run the hardened authenticated Foodics bridge through the existing 01:30 LaunchAgent without manual babysitting. The cloud worker cannot control the Mac, so this milestone must make the local install/update path deterministic, safe, and as close to one-step/self-healing as practical.

## Known baseline — do not rediscover

- `NAC-FOODICS-0001` is complete at code/test level and stopped PARTIAL only because cloud has no live Foodics session.
- The hardened runtime path is `runAuthenticatedFoodicsBridge`.
- Existing scheduler label: `com.nac.foodics-bridge.nightly`.
- Intended schedule: 01:30 Asia/Riyadh.
- Current-day acquisition is forbidden; newest safe date is previous completed Riyadh business date.
- Missed/offline days must backfill oldest-first when the Mac is next online, with no duplicate publication/proof counts.
- Proof must be machine-generated; screenshots are not sufficient.
- Official export/email remains `BLOCKED_EXTERNAL_DEPENDENCY`; do not reopen that work.
- No Netlify, no Ask NAC work, no main merge, no paid/on-demand models.

## Required work

1. Locate the existing local scheduler/install/runtime code and determine exactly what the LaunchAgent currently invokes.
2. Wire the scheduled local command to the hardened `runAuthenticatedFoodicsBridge` path while preserving existing authenticated Foodics session/profile handling.
3. Ensure the command can be run safely at login/next-online after a missed scheduled day and will catch up all missing completed dates oldest-first.
4. Ensure an already-published date becomes an idempotent no-op/integrity check rather than duplicate publication.
5. Ensure machine proof artifacts/logs from `NAC-FOODICS-0001` are written to a stable local path accessible for later review and can distinguish scheduler/manual/catch-up invocation.
6. Add a deterministic install/update script for the LaunchAgent if one does not already exist, so the operator does not need to hand-edit plist files. It should validate paths, create required log/proof directories, install/reload the agent safely, and report the installed command/schedule.
7. Add a read-only status/diagnostic command that reports: agent loaded state if locally observable, configured schedule, last run/proof if present, publishedThrough/watermark if accessible, next missing completed date, and whether the local runtime appears ready. It must not fabricate when unavailable.
8. Do not require secrets to be committed to the repository. Reuse existing legitimate local session/profile/env mechanisms.

## Validation

Focused tests must cover at least:

- scheduler entrypoint invokes authenticated bridge
- 01:30 schedule retained
- current-day exclusion retained
- multi-day/Monday catch-up retained
- idempotent rerun retained
- proof path/metadata includes invocation source
- install/update logic is repeatable and non-destructive
- status command handles missing local runtime/session gracefully

Run focused suites and one build/integration gate only. No repeated full-suite runs.

## Production/runtime boundary

The cloud agent must NOT claim it installed or executed the LaunchAgent on Raffi's Mac. It may only prepare and validate repo-side wiring. If there is a mature existing remote mechanism already committed and authorized that can safely deliver the update to the Mac, use it; otherwise produce the exact local one-step command/script path required and state that physical Mac execution remains the only external step.

Do not create new remote-access infrastructure or weaken macOS/browser security just to avoid this boundary.

## Final handoff

Update `ai-control/LAST_HANDOFF.md`, `STATE.json`, and `CURRENT_STATUS.md`, commit/push this branch, then stop at `awaiting_review`.

Report:

- PASS / PARTIAL / BLOCKED
- exact scheduler entrypoint before/after
- files changed
- focused tests/build result
- install/update mechanism
- status/diagnostic mechanism
- proof artifact path and fields
- whether Monday-off catch-up remains proven at code level
- whether any physical Mac action remains, and the exact single command if so
- paid/on-demand usage: 0
- Netlify: untouched
- migrations: none unless absolutely unavoidable
- commit SHA
- highest-leverage next step
