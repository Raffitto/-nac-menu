# NAC Autonomous Engineering Status

**AWAITING REVIEW** (`awaiting_review`)

| Field | Value |
|---|---|
| Completed task | `NAC-COMMERCE-0002` |
| Title | Live Commerce Store Wiring & Real-Data Regression |
| Result | **PASS** |
| Branch | `release/ask-nac-fabric-founding-day` |
| Completed | 2026-08-18 ~23:48 Asia/Riyadh |
| Prior milestone | `NAC-COMMERCE-0001` — PASS |
| Budget policy | soft stop ~88–89%; no on-demand |
| Deployments | none |

## Delivered

- Traced and documented Edge → `processAskNacOnEdge` → `createSupabaseCommerceStore` → `runCompanyIntelligenceOrchestration` path.
- Fixed routing: `prefersCanonicalTableMix` bypasses semantic commerce; single-period table-mix no longer auto-attaches MoM compare.
- Period-only follow-ups inherit `commerceFocus` via conversation `filters.commerceFocus`.
- 10 new `commerceEdgeWiring` acceptance probes + existing `commerceTableMix` (19 total) green.
- `publish-commerce-from-db.mjs` refactored to shared `computeTableMix` / `compareTableMixPeriods`.
- Real Khobar July/August counts: **not readable** in CI (no Supabase credentials); local read-only run recommended.

## Next expected action

Supervisor reviews handoff and issues next `NEXT_TASK.md` taskId, or leaves idle.
