# Ask NAC Coverage Awareness Layer

## Purpose

Ask NAC must never silently substitute available data for requested data. When a manager asks for YTD delivery performance, answering June-only without disclosure is a trust failure.

## Implementation

| File | Role |
|------|------|
| `src/intelligence/askNac/coverage/coverageAwareness.js` | `assessPeriodCoverage()`, `buildCoverageAnswerLines()` |
| `src/intelligence/askNac/vault/vaultCashUpAggregation.js` | Adds `salesCoverageStart/End`, `deliveryOrderCoverageStart` |
| `src/intelligence/askNac/vault/vaultPeriodParser.js` | `year_to_date` period type for "this year" / YTD |
| `src/intelligence/askNac/vault/vaultSalesPerformanceIntelligence.js` | `appendCoverageToAggregateAnswer()` |
| `src/intelligence/askNac/vault/vaultAnswerBuilder.js` | Attaches coverage notes, warnings, `dataConfidence` on range answers |
| `src/intelligence/askNac/coverage/coverageAwareness.test.js` | Unit tests |

## Coverage logic

For analytical vault questions:

1. **Requested period** — from `parseVaultPeriodFromQuestion()` (includes `year_to_date`).
2. **Available period** — from aggregated `dailyBreakdown` dates with sales facts.
3. **Completeness** — `complete` / `partial` / `unavailable` based on expected calendar days vs `dayCount`.
4. **Metric-specific coverage** — delivery order tracking start date surfaced separately from sales coverage.
5. **Answer behavior**:
   - Complete → answer normally + brief coverage line + confidence
   - Partial → answer available data + explicit limitation
   - Unavailable → state missing data; do not substitute a different period

## Example answer structure (YTD delivery)

```
Requested period: 2026 year-to-date.
Available sales coverage: 2026-01-02 – 2026-05-31.
Delivery order tracking begins on April 2026 — order totals are partial for the full requested window.
Confidence: Medium — sales coverage is partial...
```

## Period parsing additions

- `this year`, `year to date`, `ytd` → `periodType: year_to_date`, Jan 1 → today
- Added to `isVaultCashUpAnalyticsPeriod()` allowed types
- Intent router YTD + delivery/sales queries score 36 for `vault_cash_up_summary`

## Remaining risks

- Expected calendar days assumes continuous coverage; does not yet account for branch holidays or closed days.
- Coverage registry (`ask_nac_data_coverage`) is consulted for warnings but not yet fully merged into `assessPeriodCoverage()` ratio.
- Edge `vaultPeriodParser.ts` needs `year_to_date` parity for production Edge deploy.

## Tests

- `src/intelligence/askNac/coverage/coverageAwareness.test.js`
- `src/intelligence/askNac/vault/vaultFlexiblePeriod.test.js`
- `tmp-vault-verify/trust-integrity-verify.mjs`
