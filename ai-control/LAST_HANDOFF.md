# LAST_HANDOFF

- task ID: **NAC-COMMERCE-0002**
- result: **PASS**

## Summary

Verified and hardened the live Edge → Fabric commerce-store path: authenticated `ask-nac` requests that enter the management-intelligence spine now reliably reach `computeTableMixFromStore` for session-evidence table-mix questions (no published snapshot required). Fixed routing precedence so canonical table-mix beats semantic commerce for dessert-focused / session-mix focuses, suppressed implicit MoM compare on single-period table-mix turns, and persisted `commerceFocus` across period-only follow-ups.

## Edge → Fabric commerce-store path (discovered)

```
POST supabase/functions/ask-nac/index.ts
  → auth.getUser() + optional ask_nac_vault_branch_allowed RPC
  → processAskNacOnEdge(supabase, …)                     [askNacOrchestrator.ts]
  → isManagementIntelligenceQuestion(…)                  [orchestrationSpine.ts]
  → loadPublishedCommerce + createSupabaseCommerceStore(supabase)
  → runCompanyIntelligenceOrchestration({ commerceStore, publishedCommerce, … })
  → prefersCanonicalTableMix focus → computeTableMixFromStore (when snapshot absent)
```

**Wiring status:** `createSupabaseCommerceStore(supabase)` was already present on the Fabric spine path; no new adapter module required. Routing fixes ensure the store is actually used for table-mix commerce turns.

## RBAC / branch-scope proof

- `createSupabaseCommerceStore` scopes all fetches with `.eq("branch_id", branchId)` — no `.in()` widening.
- Edge handler enforces `ask_nac_vault_branch_allowed` before orchestration.
- `computeTableMixFromStore` enforces `assertBranchScopePreserved` + `allowedBranchIds`; orchestration returns branch-access denial when blocked (tested).

## Canonical-store fallback proof

- With `publishedCommerce: null` and memory/Supabase store, dessert-focused July question returns deterministic `commerce_session` answer from `computeTableMixFromStore` (50% dessert-focused on fixture data).
- Explicit compare ("July vs August") uses `commerce.compare_mix` with both periods computed via identical `computeTableMix` semantics.

## Follow-up context proof

- Table-mix completion persists `filters.commerceFocus` on `nextConversation`.
- Period-only "What about August?" inherits `dessert_focused`, stays on Fabric gate, and answers from store for August period at Khobar.

## Cash Up authority proof

- `selectSourceAuthority({ commercialMetric: "net_sales" })` → `cash_up` (unchanged).
- Session mix remains `canonical_commerce_sessions`; no headline override in aggregator or synthesis.

## Real-data regression evidence

**Not readable in this worker environment** — no `.env.local` / Supabase service-role credentials on the CI VM. `scripts/publish-commerce-from-db.mjs` refactored to call shared `computeTableMix` / `compareTableMixPeriods` (same query layer); run locally against Khobar July/August when credentials are available:

```bash
node scripts/publish-commerce-from-db.mjs khobar 2026-07-01 2026-07-31
node scripts/publish-commerce-from-db.mjs khobar 2026-08-01 2026-08-14
```

Do not hardcode observed production counts into logic.

## Files changed

```
src/intelligence/askNac/shared/commerceEdgeWiring.test.js          (new — 10 probes)
supabase/functions/_shared/companyIntelligence/commerce/intent.ts
supabase/functions/_shared/companyIntelligence/orchestrationSpine.ts
supabase/functions/_shared/companyIntelligence/turnSemantics.ts
scripts/publish-commerce-from-db.mjs
ai-control/LAST_HANDOFF.md
ai-control/STATE.json
ai-control/CURRENT_STATUS.md
```

## Migrations added

none

## Focused tests

| Pattern | Result |
|---|---|
| `commerceEdgeWiring` | **10 passed** |
| `commerceTableMix` | **9 passed** |
| broader commerce suite (`commerceOrchestrator\|…`) | **60 passed**, 1 pre-existing failure in `commerceSemantics` (`formatThroughPeriod` label) — unrelated to this task |

## Build

`CI=true npm run build` — **PASS**

## Cost / deploy

| Item | Value |
|---|---|
| Paid API calls | **0** |
| Deploys | **none** |
| Netlify | untouched |
| On-demand Cursor | **not used** |

## Branch / commit

- branch: `release/ask-nac-fabric-founding-day`
- commit SHA: `3b2ad4170baab1202eb1c89c5bf564857bfdf625`

## Highest-leverage next recommendation

1. Raffi reviews this handoff (`awaiting_review`).
2. Run `publish-commerce-from-db.mjs` read-only against Khobar July/August with local credentials; record observed session counts/shares in a follow-up handoff (evidence only).
3. Deploy Ask NAC Edge when approved (`AUTO_WITH_GUARDRAILS`) so production picks up routing fixes.
4. Optional: fix pre-existing `formatThroughPeriod` July label regression in `commerceSemantics.test.js`.
