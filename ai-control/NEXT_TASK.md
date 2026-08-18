---
taskId: NAC-COMMERCE-0003
permission: AUTO_WITH_GUARDRAILS
complexity: MEDIUM
deterministic: false
testBudget: commerceSemantics|commerceEdgeWiring|commerceTableMix|fabric|rbac
deploy: ask-nac-edge-once-if-green
onDemandAllowed: false
mergeToMain: false
issuedAt: 2026-08-19T00:19:00+03:00
---

# NAC-COMMERCE-0003 — Semantic Regression Cleanup + One Production Edge Acceptance

## Objective

Turn the two locally proven canonical table-mix milestones into one production-accepted Ask NAC capability with minimal extra work: fix the single pre-existing `formatThroughPeriod` July-label regression if it is truly isolated, run focused commerce/Fabric checks, deploy Ask NAC Edge exactly once, then perform bounded live acceptance for canonical table-mix and authority behavior.

This is NOT a broad cleanup or new feature build.

## Required work

1. Reproduce the single pre-existing `commerceSemantics` failure mentioned in NAC-COMMERCE-0002.
2. If the failure is an isolated formatting/label defect, fix the smallest shared semantic/period-formatting code path so the test passes generically. Do not special-case July.
3. Re-run only focused suites needed to protect:
   - commerce semantics
   - commerce Edge wiring
   - canonical table-mix
   - Fabric routing/authority
   - RBAC/branch scope
4. If focused tests are green and there is no material regression, deploy only the `ask-nac` Edge function once from the current working branch.
5. Perform bounded read-only live acceptance against Khobar with authenticated existing path. No production writes other than the approved Edge deploy.

## Live acceptance probes

Use natural questions, not test-only handlers. At minimum prove:

- `What percentage of tables were dessert-focused in July?`
- `What about August?` as a period-only follow-up preserves the table-mix focus.
- `Compare July and August dessert-focused tables.`
- `What percentage of food-containing tables also ordered dessert?`
- One headline-sales question still uses Cash Up authority and does NOT swap to Foodics/commerce check totals.

For table-mix answers, verify:

- canonical commerce-session source/authority
- branch = Khobar only
- requested period is correct
- unclassified/coverage warnings remain calibrated
- no fabricated data if coverage is unavailable

## Production discipline

- Ask NAC Edge deploy: at most ONE deploy if acceptance gate is green.
- No Netlify.
- No main merge.
- No migration.
- No new paid API/model.
- No on-demand Cursor spend.
- No WhatsApp work.
- No unrelated refactors.
- Do not rerun the full repo suite.

## Failure behavior

If the semantic test failure is not isolated or the focused gate reveals a broader regression:

- do NOT deploy
- stop with PARTIAL/BLOCKED handoff
- state the exact failure and safest next repair

If Edge deploy succeeds but live acceptance exposes a regression:

- do not stack multiple speculative redeploys
- diagnose once, make one bounded repair only if clearly deterministic and low-risk; otherwise stop and report

## Budget guardrail

Individual Cursor usage percentage is not officially observable. Do not claim precision. Respect the conservative 88–89% soft-stop intent and no on-demand spillover. If the remaining included-model budget appears insufficient for a coherent fix+deploy+acceptance unit, stop before deployment and hand off cleanly.

## Final handoff

Write `ai-control/LAST_HANDOFF.md`, update `STATE.json` and `CURRENT_STATUS.md`, commit/push the working branch, then stop in `awaiting_review`.

Report:

- PASS / PARTIAL / BLOCKED
- semantic regression root cause and generic fix
- files changed
- focused test counts
- Edge version deployed, if any
- live table-mix results for the acceptance probes
- follow-up inheritance proof
- Cash Up authority proof
- branch/RBAC proof
- latency if readily observable
- paid/on-demand usage: 0
- Netlify: untouched
- migration: none
- commit SHA
- highest-leverage next recommendation
