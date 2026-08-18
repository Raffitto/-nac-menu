---
taskId: NAC-COMMERCE-0002
permission: AUTO
complexity: HIGH
deterministic: false
testBudget: commerceStore|edgeWiring|tableMix|fabric|rbac
deploy: none
onDemandAllowed: false
mergeToMain: false
issuedAt: 2026-08-18T23:35:36+03:00
---

# NAC-COMMERCE-0002 — Live Commerce Store Wiring & Real-Data Regression

## Objective

Close the highest-leverage gap left by NAC-COMMERCE-0001: prove that Ask NAC's real Edge request path supplies the canonical commerce store on commerce/session turns, then validate the new deterministic table-mix intelligence against existing real Khobar canonical data without deploying production.

This is an integration/proof milestone, not a new analytics engine.

## Required work

1. Trace the actual Ask NAC Edge entry path into `orchestrationSpine.ts` and determine whether `commerceStore` is supplied on every relevant authenticated commerce turn.
2. If the live request path does not supply it reliably, add the smallest shared adapter/wiring needed to construct the existing allowlisted `CommerceStore` from the current Supabase/auth context.
3. Preserve RBAC and branch scope at the adapter boundary. No unrestricted raw SQL/tool access.
4. Keep Cash Up canonical for headline sales. Canonical commerce remains session/table/item evidence only.
5. Ensure a commerce question can reach `computeTableMixFromStore` when no published snapshot exists.
6. Verify period-only follow-ups still inherit commerce/table-mix context through the existing Fabric conversation state where supported.
7. Exercise real-data regression using existing canonical Khobar July/August records or existing publication/read tooling. Do not mutate production data. Read-only is preferred.
8. Where the repository already has `publish-commerce-from-db.mjs`, reuse it or its query layer for regression evidence; do not create a parallel ingestion path.
9. If cheap and clearly reducing duplication, refactor the publish script to call the shared `computeTableMix` implementation rather than maintaining inline archetype aggregation. Do this only if focused and low-risk.

## Acceptance probes

Prove, with focused tests and read-only verification where available:

- Edge/Fabric integration passes a real `commerceStore` into orchestration for authorized commerce turns.
- Branch scope/RBAC cannot be widened by the store adapter.
- Missing published snapshot still falls back to canonical store computation.
- Dessert-focused share, food-containing share, and dessert conversion return deterministic answers from canonical sessions.
- Explicit comparison computes both periods through identical semantics.
- Period-only follow-up preserves prior commerce intent/metric/branch context where the existing conversation framework allows it.
- Coverage/unclassified diagnostics survive the Edge path.
- Cash Up authority for headline sales remains unchanged.
- Existing commerce/Fabric focused regressions remain green.
- If real Khobar July/August canonical data is readable, record observed counts/shares as regression evidence in the handoff, but do not hardcode them into production logic.

## Architecture constraints

- Reuse `commerce/tableMix.ts`, existing semantic commerce store/query abstractions, existing Supabase client/auth scope, and current publication tooling.
- Search the OSS registry first only if a generic adapter problem appears; do not add a framework.
- No unrestricted database-agent access.
- No duplicated archetype semantics.
- No phrase-specific routing.
- No fabricated metrics when rows/mappings are incomplete.

## Scope discipline

Do not:

- deploy Ask NAC Edge
- deploy Netlify
- merge main
- mutate production data
- add migrations unless absolutely required for compile correctness (prefer none)
- add paid services/APIs
- use on-demand Cursor spend
- touch WhatsApp
- rebuild the supervisor/agent framework
- repeatedly run broad full-repo tests

Use focused tests. Run one relevant build/typecheck at the end if useful.

## Budget guardrail

Individual Cursor usage percentage is not officially observable. Do not claim precision. Respect the conservative ~88–89% soft-stop intent. If evidence suggests the remaining included-model budget is becoming tight, stop cleanly with a partial handoff rather than using on-demand spend.

## Final handoff

Write `ai-control/LAST_HANDOFF.md`, update `STATE.json` and `CURRENT_STATUS.md`, commit/push the working branch, then stop in `awaiting_review`.

Report:

- PASS / PARTIAL / BLOCKED
- actual Edge-to-Fabric commerce-store path discovered
- wiring added or reused
- exact files changed
- RBAC/branch-scope proof
- canonical-store fallback proof
- follow-up-context proof
- real-data regression evidence, if safely readable
- Cash Up authority proof
- focused tests and counts
- build/typecheck result if run
- paid calls: 0
- deploys: none
- Netlify untouched
- branch/commit SHA
- highest-leverage next recommendation
