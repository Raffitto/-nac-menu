---
taskId: NAC-FOODICS-0001
permission: AUTO_WITH_GUARDRAILS
complexity: HIGH
deterministic: false
testBudget: foodicsBridge|commerceCanonical|schedulerCatchup|proofEvidence|idempotency
deploy: none-unless-explicitly-required-and-credentials-available
onDemandAllowed: false
mergeToMain: false
issuedAt: 2026-08-19T17:18:00+03:00
---

# NAC-FOODICS-0001 — Autonomous Completed-Day Acquisition + Verifiable Proof

## Objective

Make the existing Foodics acquisition path materially more autonomous, recoverable, idempotent, and auditable without depending on fragile screenshots or manual proof. Prioritize the already-working authenticated Foodics list/detail acquisition path. Treat official async export/email transport as secondary unless it can be solved economically with mature open-source tooling and no Microsoft admin dependency.

This is a substantial reliability milestone, not an Ask NAC wording/micro-fix cycle.

## Known baseline — do not rediscover

- Branch: `release/ask-nac-fabric-founding-day`.
- Existing nightly bridge target: 01:30 Asia/Riyadh.
- Never acquire the current Riyadh business date; newest safe date is the previous completed date.
- Laptop may be fully offline one day/week, typically Monday. Recovery must backfill all missing completed dates oldest-first on next available run.
- Existing live acquisition uses authenticated Foodics list + per-order detail and has already produced canonical orders/items/sessions.
- Existing qualified unattended proof history includes Aug 14 and Aug 15, but old evidence must not be upgraded beyond what it actually proves.
- Official Foodics exports are sent to `foh.khobar@nacriyadh.com`.
- Microsoft Graph delegated mailbox access is blocked by admin consent. Outlook desktop AppleScript is not viable.
- Do not claim screenshots/videos prove the full chain unless machine evidence proves each stage.
- Prefer mature free/open-source components before writing custom orchestration/browser/state machinery.
- Paid/on-demand model usage: 0. Respect the user's allowed development budget conservatively; do not exceed the existing control-plane soft/hard guardrails and do not fabricate usage percentages.

## Track A — harden production-capable authenticated acquisition

Implement or strengthen the pipeline so each run:

1. Resolves the newest completed Riyadh business date.
2. Reads authoritative publication/acquisition state.
3. Detects every missing completed date.
4. Acquires gaps oldest-first.
5. Validates Foodics listing/detail completeness before publication.
6. Canonicalizes orders/items/sessions into NAC-owned entities.
7. Publishes atomically/idempotently.
8. Persists deterministic acquisition evidence.
9. Never publishes the current Riyadh date.
10. Never duplicates an already-published date.
11. Recovers automatically after a full missed/offline Monday.
12. Leaves partial runs retryable and never counts them as qualified success.
13. Allows one qualified reliability proof per business date only.
14. Makes an already-successful rerun a no-op except integrity verification.

Prefer explicit run-state semantics if the current implementation is ambiguous, e.g. `DISCOVERED -> ACQUIRING -> VALIDATED -> CANONICALIZED -> PUBLISHED`, with explicit failure/retry states.

## Track B — official export path, bounded investigation only

First assess mature free/open-source browser automation/session-reuse approaches such as Playwright/CDP where appropriate. Determine whether the existing legitimate authenticated web sessions can support a reliable chain:

Foodics export request -> matching async email -> deterministic attachment/file download -> checksum/validation -> ingestion.

Do not weaken browser security, request unnecessary credentials, build a custom mail client, or spend the milestone fighting Microsoft admin consent. If unattended reliable transport is not feasible without external admin/user interaction, classify it explicitly as `BLOCKED_EXTERNAL_DEPENDENCY` and keep authenticated Foodics acquisition as the production source.

## Machine proof standard

Every successful completed-business-date run should persist an inspectable proof record/bundle containing, where available:

- run ID
- invocation source (scheduler/manual/catch-up)
- Riyadh start/completion timestamps
- target business date
- acquisition method
- listing count
- successfully fetched order-detail count
- item count
- raw/source artifact checksum(s)
- canonical order/item/session counts
- previous and new publication watermark
- publication destination/version
- idempotency result
- final state/status

If official export becomes viable, additionally persist export request identifier/time, matching email identifier/time, downloaded filename, downloaded checksum, validation result, and ingestion result.

Proof must come from machine state/logs/artifacts, not a retrospective human description.

## Reliability semantics

Reliability means eventual acquisition of every completed Foodics business date after the machine returns online — not that a laptop-off 01:30 launch fires every calendar day.

Do not reset prior proof history. Re-evaluate assurance level honestly; preserve weaker historic proofs without silently counting them under stricter criteria.

Target remains 5 qualified unattended completed-date runs, but do not fabricate additional proofs in CI where production reality cannot be observed.

## Canonical architecture direction

Keep Foodics as a source adapter, not the domain model. Preserve or improve source-neutral NAC canonical entities for orders, order items, products, modifiers, payments, discounts, branches, tables/table sessions, covers, employees/creators, timestamps/business dates, and channels/order types where existing scope permits. Do not attempt a full POS replacement in this task.

## Focused tests required

Cover at minimum:

- normal previous-day acquisition
- current-day exclusion
- one missed-day catch-up
- full Monday-off / multi-date catch-up
- oldest-first gap ordering
- partial detail-fetch failure
- retry/recovery after partial failure
- duplicate-run idempotency
- publication watermark correctness
- one proof increment per business date
- checksum/evidence persistence
- malformed source response
- legitimate zero-order business date
- Riyadh midnight/date-boundary behavior
- interrupted-run recovery

Run focused relevant suites only, then one broader relevant integration/build gate. No repeated full-repo runs.

## Deployment/cost discipline

- No Netlify.
- No main merge.
- No unrelated Ask NAC redeploy.
- No paid services/models.
- No on-demand Cursor spend.
- Avoid Supabase migrations unless absolutely necessary; prefer existing durable stores if they fit.
- If credentials required for production proof/deploy are absent in the cloud worker, do not fake success. Complete all code/tests possible, persist the blocker precisely, and stop at `awaiting_review`.

## Final handoff

Update `ai-control/LAST_HANDOFF.md`, `STATE.json`, and `CURRENT_STATUS.md`, commit/push this branch, then stop at `awaiting_review`.

Report:

- PASS / PARTIAL / BLOCKED
- architecture chosen
- files changed
- authenticated Foodics acquisition readiness
- official export-chain status
- catch-up and idempotency behavior
- proof/evidence design
- reliability counter/assurance status without fabrication
- focused tests/build results
- deploys (expected none unless truly required/authorized)
- exact external blockers
- whether a full laptop-off Monday now recovers automatically on next available run
- paid/on-demand usage: 0
- Netlify: untouched
- migration status
- commit SHA
- highest-leverage next recommendation
