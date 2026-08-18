# LAST_HANDOFF

- task ID: **NAC-COMMERCE-0001**
- result: **PASS**

## Summary

Delivered canonical table-mix intelligence end-to-end: a single deterministic `computeTableMix` / `computeTableMixFromStore` aggregator over existing archetype + session metrics, wired into Ask NAC Fabric orchestration so commerce session questions answer from canonical order/item rows for arbitrary supported periods (not only pre-published snapshots).

## Architecture / capability

| Layer | Action |
|---|---|
| **Reused** | `archetypes.ts`, `metrics.ts` (`buildDineInSessions`, `summarizeServiceMix`, `compareServiceMix`), `synthesis.ts`, `intent.ts`, `capabilityRegistry` (`commerce.session_mix`, `commerce.compare_mix`) |
| **Added** | `commerce/tableMix.ts` — typed `TableMixResult` + `TableMixDiagnostics`, RBAC-aware store fetch, evidence/coverage diagnostics |
| **Wired** | `orchestrationSpine.ts` — computes from `commerceStore` when published snapshot absent; comparison only when explicit compare intent + comparison period resolved |

## Supported question families

- Dessert-focused table share (“What % of our tables were dessert tables in July?”)
- Food-containing share
- Dessert conversion within food-containing sessions (`full-service / food-containing`)
- Dessert-at-all (basket) vs dessert-focused distinction preserved
- Session mix / dessert tables vs food tables
- Period comparison with percentage-point deltas (explicit compare intent only)
- Average check by archetype
- RBAC branch isolation; coverage/unclassified diagnostics surfaced

## Deterministic archetype semantics (unchanged, consolidated)

| Archetype | Rule |
|---|---|
| `dessert_only` | dessert, no food |
| `dessert_and_coffee` | dessert + coffee, no food |
| `dessert-focused` | `dessert_only + dessert_and_coffee` (excludes full-service) |
| `food_only` / `food_and_beverage` / `full_service` | food-containing family |
| `full_service` | food + dessert |
| `unclassified` | unknown-only baskets or zero known items — never silently reassigned |

## Comparison semantics

- Both periods computed independently with identical semantics.
- Deltas in **percentage points** for shares/conversion (`compareTableMixPeriods` → `mixComparisonAnswer`).
- Comparison attached only when orchestration `requiresComparison` is true (not inferred from single-period questions).

## Coverage / evidence behavior

- `TableMixDiagnostics`: order–item join rate, unmapped item rows, unclassified session count/share, `CommerceQuality` dimensions.
- Limitation text appended when join &lt; 90% or unclassified &gt; 15%.
- `buildEvidenceSummary` attached; Cash Up remains headline sales authority.

## RBAC proof

- `computeTableMixFromStore` enforces `assertBranchScopePreserved` + `allowedBranchIds`.
- Orchestration returns explicit branch-access denial when RBAC blocks.

## Cash Up authority proof

- `selectSourceAuthority({ commercialMetric: "net_sales" })` → `cash_up`.
- Session mix uses `canonical_commerce_sessions`; no silent override in aggregator or synthesis.

## Files changed

```
supabase/functions/_shared/companyIntelligence/commerce/tableMix.ts          (new)
supabase/functions/_shared/companyIntelligence/commerce/index.ts
supabase/functions/_shared/companyIntelligence/commerce/intent.ts
supabase/functions/_shared/companyIntelligence/commerce/synthesis.ts
supabase/functions/_shared/companyIntelligence/orchestrationSpine.ts
src/intelligence/askNac/shared/commerceTableMix.test.js                      (new)
ai-control/LAST_HANDOFF.md
ai-control/STATE.json
ai-control/CURRENT_STATUS.md
```

## Migrations added

none

## Focused tests

`commerceTableMix|commerceArchetypes|commerceMetrics|commerceIntegrity|commerceOrchestrator` — **45 passed**

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
- handoff commit SHA: `f8a40684c237f54a06ee480332af25ca1ecbaeac`

## Highest-leverage next recommendation

1. Raffi reviews this handoff (`awaiting_review`).
2. Wire live `commerceStore` (Supabase) in Ask NAC Edge handler if not already passing through on every commerce turn.
3. Publish July/Aug snapshots via existing `publish-commerce-from-db.mjs` for offline regression against real Khobar shape.
4. Optional: refactor publish script to call `computeTableMix` directly (remove inline duplication).
