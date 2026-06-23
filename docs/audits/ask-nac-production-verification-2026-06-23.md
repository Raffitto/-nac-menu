# NAC OS Production Verification — 23 June 2026

End-of-day stabilization pass after dashboard trust fixes, Edge Ask NAC parity (v46), and YTD aggregation chunking (v47).

---

## 1. Deployment status

| Component | Status | Version / note |
|-----------|--------|----------------|
| **Git `main`** | Pushed | `7a82c91` — YTD chunked fetch fix |
| **Netlify frontend** | Live | `nac-os.netlify.app` — dashboard trust pass deployed earlier today |
| **Edge `ask-nac`** | Live | **v47** (2026-06-23 00:08 UTC) — monthly chunking + coverage |
| **Edge `vault-drive-sync`** | Unchanged | v30 — not deployed tonight |
| **Migrations** | None applied | External Context migration still pending |

---

## 2. Git status

- Branch: `main`
- Up to date with `origin/main` after push of `7a82c91`
- Working tree clean (pre-docs commit)
- No secrets in repo; verifier scripts only

---

## 3. Frontend status

- Overview / Operational Dashboard loads on production
- Today / 7D / MTD switching clears metrics during fetch (no stale carry-over observed on 7D switch)
- Review page opens label correct: **"Review page opens"** with subtitle *Review funnel step — not public review count*
- Google Redirects label correct: *Not actual google reviews*
- Add-on engagement uses funnel-consistent denominator (72.7% conversion on Khobar sample)
- Active Guests renders (live count, branch-unscoped by design)
- Recent Activity renders (may show empty on low traffic)
- **Knowledge Status**: `Document registry could not be loaded` — pre-existing timeout, not a regression from today
- No console crash observed; `window.__NAC_DASHBOARD_AUDIT__` available

---

## 4. Edge status

- `ask-nac` v47 includes:
  - Business semantics / YTD routing (from v46)
  - Coverage awareness + analytical confidence layers
  - Monthly chunked `structured_facts` fetch for wide ranges
  - Daily breakdown skipped for YTD to reduce JS overhead
- Production `"delivery apps this year"` no longer returns DB connection/timeout error

---

## 5. Database status

- Cash-up structured facts available for Khobar approx. **2026-02-01 – 2026-06-20**
- Latest uploaded cash-up day: **20 June 2026**
- Yesterday (22 June 2026) honestly missing — no report uploaded yet
- YTD queries use 6 monthly sub-queries; no migration/index added
- Document registry query times out intermittently (dashboard Knowledge Status)

---

## 6. Ask NAC prompt verification

Production checks on `nac-os.netlify.app`, branch **NAC (Khobar)**, Edge **v47**.

| # | Prompt | Route / answer type | Period shown | Source | Coverage | Confidence | Latency | GM useful? | Pass |
|---|--------|---------------------|--------------|--------|----------|------------|---------|------------|------|
| 1 | show latest cash up | `vault_cash_up_summary` | 20 June 2026 | Cash-up vault | N/A (single day) | Present | ~20s | Yes — net sales, guests, delivery | **PASS** |
| 2 | sales yesterday | `vault_cash_up_summary` | 22 June 2026 | Cash-up vault | Honest missing | Low | ~15s | Yes — states no report | **PASS** (not Foodics MTD) |
| 3 | sales this year | `vault_cash_up_summary` | 2026 year-to-date | Cash-up vault | Feb 1 – Jun 20 partial | Medium | ~75s | Yes — 1.1M SAR + coverage note | **PASS** (slow) |
| 4 | delivery apps this year | `vault_cash_up_summary` | 2026 year-to-date | Cash-up vault | 78 days partial | Medium | **~106s** | Yes — Hunger/Jahez/Keeta/Chefz | **PASS** (slow) |
| 5 | how many delivery orders this year and how much money | `vault_cash_up_summary` | 2026 year-to-date | Cash-up vault | Partial orders | Medium | ~90s est. | Yes (routing verified local) | **PASS** (routing; prod not re-run EOD) |
| 6 | compare June 1-15 vs June 16-20 | `vault_cash_up_summary` | 1–15 June 2026 | Cash-up vault | Range compare | Medium | ~30s est. | Yes (routing verified local) | **PASS** (routing) |
| 7 | why were sales down yesterday | `vault_business_reasoning` | 22 Jun vs prior day | NIL + vault | Partial current day | Low | ~20s | Yes — reasoning mode | **PASS** |
| 8 | guests yesterday | `vault_cash_up_summary` | 22 June 2026 | Cash-up vault | Honest missing | Low | ~15s est. | Yes (routing verified local) | **PASS** (routing) |
| 9 | average check this month | `vault_cash_up_summary` | June 2026 (to date) | Cash-up vault | MTD partial | Medium | ~30s est. | Yes (routing verified local) | **PASS** (routing) |
| 10 | top delivery platform this year | `vault_cash_up_summary` | 2026 year-to-date | Cash-up vault | YTD partial | Medium | ~90s est. | Yes (routing verified local) | **PASS** (routing) |

### Performance notes (tomorrow priority)

| Query | Latency | Issue | Next action |
|-------|---------|-------|-------------|
| delivery apps this year | **~106s** | 6 sequential monthly DB round-trips + OpenAI narration | Consider parallel month fetch or pre-aggregated RPC |
| sales this year | **~75s** | Same YTD chunk path | Same as above |
| latest cash up | ~20s | Acceptable | Monitor |
| why were sales down yesterday | ~20s | Acceptable | Monitor |
| sales yesterday | ~15s | Acceptable | Monitor |

**Critical behaviors confirmed:**
- `"sales yesterday"` does **not** route to Foodics MTD
- `"delivery apps this year"` does **not** timeout post-v47
- YTD answers disclose partial coverage (Feb–Jun, not full Jan–Dec)

---

## 7. Dashboard verification

| Check | Result | Classification |
|-------|--------|----------------|
| Overview loads | Yes | Fixed today |
| Executive Summary loads | Yes | Stable |
| Today / 7D / MTD switching | Works; metrics clear on switch | Fixed today (stale state) |
| Loading / skeleton on switch | Observed on 7D switch | Fixed today |
| Review page opens label | Correct label + subtitle | Fixed today |
| Google Redirects vs review opens | Not swapped; Today shows 216 redirects / 297 opens | Fixed today |
| Funnel % sane | No impossible 100% from swap | Fixed today |
| Add-on interactions consistent | 72.7% uses funnel denominator | Fixed today |
| Active guests | Renders (1 live) | Stable (network-wide by design) |
| Recent activity | Renders | Stable |
| Console crash | None observed | Stable |
| Menu QR same across Today/MTD (Khobar: 22) | Same value on Khobar sample | **Pre-existing / sparse data** — verify raw `menu_events` tomorrow |
| Document registry timeout | Knowledge Status error in Ask NAC | **Pre-existing** — not introduced today |
| Review RPC partial fallback | Possible on wide ranges | **Pre-existing** — surfaced in dashboard audit |

---

## 8. Known remaining risks

1. **YTD Ask NAC answers work but are slow** (~75–106s) — usable for GM, not snappy
2. **Document registry timeout** visible in Company Knowledge panel
3. **Menu QR identical across periods** may reflect low Khobar traffic or rollup approximation — not proven regression
4. **Review RPC fallback** can degrade to partial/today-only data on timeout
5. **External Context migration** not applied
6. **WhatsApp** not implemented
7. **True RAG** not active — Ask NAC uses structured facts + optional OpenAI narration
8. **Cash-up coverage gap** — latest data 20 Jun; yesterday queries honestly missing

---

## 9. Tomorrow priority list

1. **YTD performance** — parallelize monthly chunk fetches or add safe aggregation RPC (measure before migrating)
2. **Document registry timeout** — investigate `ask_nac_files` registry query / index
3. **Menu QR period parity** — compare Khobar raw `menu_events` vs rollup for Today vs MTD
4. **Upload 21–22 Jun cash-up** when available — unblocks yesterday sales/guests answers
5. **Optional**: run `node tmp-vault-verify/ytd-aggregation-verify.mjs --prod` with `ASK_NAC_ACCESS_TOKEN` for CI-style prod probes

---

## Tests run (23 June EOD)

| Command | Result |
|---------|--------|
| `npm test -- --watchAll=false` | **903/903 passed** |
| `CI=true npm run build` | **PASS** |
| `npm run build` | **PASS** |
| `node tmp-vault-verify/edge-parity-verify.mjs` | **4/4 passed** |
| `node tmp-vault-verify/ytd-aggregation-verify.mjs` | **11/11 passed** |
| `node tmp-vault-verify/trust-integrity-verify.mjs` | **39/39 passed** |

Prod API verifiers (`--prod`) not run EOD — requires `ASK_NAC_ACCESS_TOKEN` (not in repo). Browser manual verification used instead.

---

## Confirmed fixed (last few days)

- Dashboard funnel value swap (Google Redirects vs review page opens)
- Stale dashboard metrics during period switch
- Add-on engagement denominator mismatch
- Ask NAC `"sales yesterday"` Foodics MTD misroute
- Ask NAC YTD period parsing (`this year`, `delivery apps this year`)
- Edge semantics / coverage / confidence parity (v46)
- YTD aggregation DB timeout (v47 chunked fetch)
- NIL traffic vs spend interpretation improvements

## Still not fixed

- YTD query latency (functional but slow)
- Document registry load timeout
- Full-year cash-up coverage (partial YTD only)
- External context / WhatsApp / true RAG
