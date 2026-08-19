# LAST_HANDOFF

- task ID: **NAC-FOODICS-0001**
- result: **PARTIAL**

## Summary

Hardened authenticated Foodics completed-day acquisition in-repo: Riyadh calendar safety, oldest-first gap catch-up (including Monday-off), explicit run states, listing/detail completeness, atomic publish, contiguous watermark, checksummed evidence, and one qualified proof increment per business date. Official export/email chain is classified **BLOCKED_EXTERNAL_DEPENDENCY**. Cloud worker could not observe live Foodics or increment production reliability proofs — those remain unfabricated.

## Architecture chosen

Production source remains **authenticated Foodics list + per-order detail** (`/core-api/listing?url=/orders` + getting/detail), feeding existing NAC canonical orders/items/sessions. Foodics stays a source adapter.

Run states: `DISCOVERED → ACQUIRING → VALIDATED → CANONICALIZED → PUBLISHED`, with `ACQUIRE_FAILED` / `VALIDATE_FAILED` / `CANONICALIZE_FAILED` / `PUBLISH_FAILED` / `INTERRUPTED` retryable, and `IDEMPOTENT_NOOP` for a successful rerun (integrity list/checksum only).

Scheduler semantics: 01:30 Asia/Riyadh. Newest safe date is the previous Riyadh civil date; the current Riyadh date is never acquired. Reliability = eventual catch-up of every completed date after the machine is back, not that 01:30 fires every calendar day.

## Files changed

```
supabase/functions/_shared/companyIntelligence/commerce/acquisitionCalendar.ts
supabase/functions/_shared/companyIntelligence/commerce/acquisitionEngine.ts
supabase/functions/_shared/companyIntelligence/commerce/acquisitionEvidence.ts
supabase/functions/_shared/companyIntelligence/commerce/officialExportPath.ts
supabase/functions/_shared/companyIntelligence/commerce/foodicsAdapter.ts
supabase/functions/_shared/companyIntelligence/commerce/proofRetention.ts
supabase/functions/_shared/companyIntelligence/commerce/mailboxAdapter.ts
supabase/functions/_shared/companyIntelligence/commerce/sourceAdapter.ts
supabase/functions/_shared/companyIntelligence/commerce/orchestrator.ts
supabase/functions/_shared/companyIntelligence/commerce/index.ts
supabase/functions/_shared/companyIntelligence/externalReality/ossReferenceRegistry.ts
docs/architecture/oss-reference-registry.md
src/intelligence/askNac/shared/foodicsBridge.test.js
src/intelligence/askNac/shared/aiControlProtocol.test.js
ai-control/LAST_HANDOFF.md
ai-control/STATE.json
ai-control/CURRENT_STATUS.md
```

## Authenticated Foodics acquisition readiness

**Code: ready.** Deterministic engine covers:

| Requirement | Behavior |
|---|---|
| Newest completed Riyadh date | `newestSafeCompletedDate` = yesterday Asia/Riyadh |
| Current-day exclusion | Never listed, never published |
| Gap detection | Unpublished completed dates + open failed runs |
| Oldest-first | Sorted ISO dates, Monday-off included |
| Listing/detail completeness | Fetch count must match listing; partial → `ACQUIRE_FAILED` |
| Canonicalize | Existing `adaptFoodicsConsoleOrder` + dine-in sessions |
| Atomic publish | Orders/items/sessions + watermark together in store |
| Idempotent rerun | `noop_verified` if listing checksum matches; no second proof |
| Zero-order day | Publishes empty, watermark may advance, **not** qualified proof |
| Interrupted recovery | Persists fetched details; resumes remaining IDs |

**Live laptop bridge: not executed here.** Existing runtime still lives outside this repo (`foodics-bridge` on the operator laptop). Next operator step is to call `runAuthenticatedFoodicsBridge` from the 01:30 job.

## Official export-chain status

**BLOCKED_EXTERNAL_DEPENDENCY**

- Destination mailbox: `foh.khobar@nacriyadh.com`
- Playwright/CDP (Apache-2.0, EVALUATE): can click export in a Foodics web session; cannot retrieve the async email attachment
- Microsoft Graph delegated mailbox: blocked by admin consent
- IMAP credentials: absent
- Outlook AppleScript: not viable
- No custom mail client built; no Playwright dependency added

Production source stays authenticated list/detail.

## Catch-up and idempotency

- One missed day at 01:30: acquire that completed date
- Monday-off: next available run backfills all missing completed dates oldest-first (`2026-08-16` then `2026-08-17` when last published is `2026-08-15` and as-of is Tuesday 01:30)
- Open failed dates remain gaps even if a later date published
- Watermark is **contiguous complete-through**, not max published date
- Successful rerun: integrity verification only

## Proof/evidence design

Each run persists an inspectable record: run ID, invocation source, Riyadh start/end, business date, method `authenticated_read`, listing/detail/item counts, SHA-256 checksums, canonical order/item/session counts, previous/new watermark, destination `commerce_orders+commerce_order_items+commerce_sessions`, version `commerce-sessions-v1`, idempotency result, final state. Official-export fields are present and null.

Qualified `FULL_CHAIN_PROOF_SUCCESS` increments at most once per business date. Partial/interrupted/empty/malformed never increment. Historic Aug 14 / Aug 15 proofs are **not** upgraded.

## Reliability counter / assurance (no fabrication)

| Item | Value |
|---|---|
| Target | 5 qualified unattended completed-date runs |
| Incremented this task | **0** (no live Foodics session in cloud worker) |
| Historic Aug 14 / Aug 15 | Preserved at original assurance; not reclassified under the new machine-proof standard |
| CI fixtures | Prove engine behavior only — not production full-chain proofs |

## Focused tests / build

| Pattern | Result |
|---|---|
| `foodicsBridge` | **9 passed** |
| `commerceOrchestrator` | **10 passed** |
| `commerceIntegrity` | **7 passed** |
| `foodicsAdapter` | **4 passed** |
| `aiControlProtocol` | **3 passed** |
| **Focused gate** | **33 passed**, 0 failed |
| `CI=true npm run build` | **PASS** |

`npm test --watchAll=false` full-repo was not repeated (task: focused suites only, then one build gate).

## Deploys

none — Netlify untouched; no main merge; no Edge deploy; no paid services.

## Exact external blockers

1. **Live Foodics session / laptop bridge runtime** not available on this cloud worker — cannot produce a qualified production completed-day proof.
2. **Official export email transport** — `BLOCKED_EXTERNAL_DEPENDENCY` (Graph admin consent / no IMAP).
3. Prior: `SUPABASE_ACCESS_TOKEN` / `ASK_NAC_ACCESS_TOKEN` still absent (unrelated Edge/live Ask NAC).

## Monday-off recovery

**In engine: yes.** On the next available `runAuthenticatedFoodicsBridge` invocation, missing completed dates are acquired oldest-first automatically. This is not a claim that the laptop 01:30 launch itself fires while the machine is off.

## Cost / deploy discipline

| Item | Value |
|---|---|
| Paid API calls | **0** |
| On-demand Cursor | **not used** |
| Netlify | untouched |
| Main merge | none |
| Migrations | **none** (used existing commerce tables as the destination contract; durable run store is injected) |
| Edge deploys | **0** |

## Branch / commit

- control-plane branch: `release/ask-nac-fabric-founding-day`
- worker branch: `cursor/nac-foodics-0001-41e7`
- commit SHA: `fbb504ee808eddd54cffce695b2c1e8a0ba34061`

## Highest-leverage next recommendation

1. Raffi reviews this handoff (`awaiting_review`).
2. Operator wires the existing laptop `foodics-bridge` 01:30 job to `runAuthenticatedFoodicsBridge` (authenticated list/detail only).
3. After the next completed Riyadh date is acquired unattended, inspect the persisted evidence record — that is the first candidate for a **new** qualified proof under the stricter machine standard. Do not backfill Aug 14/15 as qualified.
4. Do not spend further cycles on Microsoft Graph / Outlook / custom mail until mailbox access exists.
