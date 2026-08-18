# LAST_HANDOFF

- task ID: **NAC-COMMERCE-0003**
- result: **PARTIAL**

## Summary

Fixed the isolated `formatThroughPeriod` regression so completed named months (e.g. July 2026) return canonical period labels instead of `"July through 31 July"`. All focused commerce/Fabric/RBAC gates are green and both builds pass. **Edge deploy and live Khobar acceptance were not executed** — this CI worker has no `SUPABASE_ACCESS_TOKEN` or `ASK_NAC_ACCESS_TOKEN`.

## Semantic regression — root cause and fix

**Root cause:** `formatThroughPeriod` applied the partial-month `"Month through DD Month"` pattern whenever the period started on the 1st and `through` shared the same calendar month — including fully completed `named_month` ranges where `through === endDate`.

**Generic fix** (`calendarCompletion.ts`): only emit the partial `"through"` label when the period is genuinely partial (`semantic === "this_month"` or MTD/through label cues). For completed non-partial months with `through === endDate`, return `period.label` or `"Month YYYY"`.

| Scenario | Before | After |
|---|---|---|
| July 2026 `named_month` (closed) | `July through 31 July` | `July 2026` |
| August MTD `this_month` (partial) | `August through 14 August` | unchanged |

## Files changed

```
supabase/functions/_shared/companyIntelligence/calendarCompletion.ts
ai-control/LAST_HANDOFF.md
ai-control/STATE.json
ai-control/CURRENT_STATUS.md
```

## Migrations added

none

## Focused tests

| Pattern | Result |
|---|---|
| `commerceSemantics` | **6 passed** (was 5/6; July label fixed) |
| `commerceEdgeWiring` | **10 passed** |
| `commerceTableMix` | **9 passed** |
| `fabric` (`companyIntelligenceFabric` + `universalDomainFabric`) | **52 passed** |
| `rbac` | **2 passed** |
| **Total focused gate** | **77 passed**, 0 failed |

## Build

| Command | Result |
|---|---|
| `CI=true npm run build` | **PASS** |
| `npm run build` | **PASS** |

## Edge deploy

| Item | Value |
|---|---|
| Attempted | `supabase functions deploy ask-nac --project-ref zeyhvjuraqnlbdycgrme` |
| Outcome | **BLOCKED** — `SUPABASE_ACCESS_TOKEN` not available on worker |
| Edge version deployed | **none** |

## Live acceptance (Khobar)

**Not executed** — `ASK_NAC_ACCESS_TOKEN` / `ASK_NAC_VERIFY_EMAIL` not available.

Local fixture probes (same branch code, not production) confirm expected behavior for the acceptance questions:

| Probe | Local evidence |
|---|---|
| Dessert-focused July % | `commerceTableMix` + `commerceEdgeWiring`: 50% dessert-focused, `commerce_session` authority, Khobar scope |
| Period-only August follow-up | `commerceEdgeWiring`: inherits `dessert_focused`, answers August from store |
| July vs August compare | `commerceTableMix`: `commerce.compare_mix` with both periods |
| Food-containing tables that ordered dessert | `commerceTableMix`: `dessert_conversion` focus path |
| Headline sales Cash Up authority | `commerceEdgeWiring` + `selectSourceAuthority`: `cash_up` for `net_sales`; no Foodics override |

**Production live probes remain for supervisor/operator** with credentials:

- `What percentage of tables were dessert-focused in July?`
- `What about August?`
- `Compare July and August dessert-focused tables.`
- `What percentage of food-containing tables also ordered dessert?`
- One headline-sales question (Cash Up, not Foodics totals)

## Follow-up inheritance proof

Covered by `commerceEdgeWiring` period-only follow-up probe (inherits `commerceFocus: dessert_focused`, Fabric gate, August period).

## Cash Up authority proof

`selectSourceAuthority({ commercialMetric: "net_sales" })` → `cash_up` (unchanged). Session mix uses `canonical_commerce_sessions`.

## Branch / RBAC proof

`createSupabaseCommerceStore` scopes `.eq("branch_id", branchId)`; Edge handler enforces `ask_nac_vault_branch_allowed`. Probed in `commerceEdgeWiring` + `rbacIntelligenceScope`.

## Cost / deploy discipline

| Item | Value |
|---|---|
| Paid API calls | **0** |
| On-demand Cursor | **not used** |
| Netlify | untouched |
| Main merge | none |
| Migrations | none |
| Edge deploys | **0** (blocked) |

## Branch / commit

- branch: `release/ask-nac-fabric-founding-day`
- commit SHA: `a0bdb9d314c928b24f322b10c3633b80bf4fce5b`

## Blocker for full PASS

Worker environment lacks Supabase deploy and Ask NAC auth credentials. Code is ready; one supervised deploy + live Khobar acceptance run closes the milestone.

## Highest-leverage next recommendation

1. Raffi reviews this handoff (`awaiting_review`).
2. Operator runs **one** Edge deploy from this branch with local `supabase login` / `SUPABASE_ACCESS_TOKEN`.
3. Run the five live acceptance probes against Khobar with `ASK_NAC_ACCESS_TOKEN`.
4. If live probes pass, mark NAC-COMMERCE-0003 **PASS**; if not, diagnose once — no stacked redeploys without a clear fix.
