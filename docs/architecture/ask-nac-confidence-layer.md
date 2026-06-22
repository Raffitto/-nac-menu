# Ask NAC Confidence Layer

## Purpose

Every analytical Ask NAC answer should state how much a GM can rely on it. Confidence is derived from data coverage, source quality, and metric-specific limitations — not from LLM self-assessment.

## Levels

| Level | When |
|-------|------|
| **High** | Direct structured cash-up source; requested period matches available days; complete sales coverage |
| **Medium** | Partial coverage; missing days/months; delivery orders start later than sales; derived calculations; partial vault parse |
| **Low** | No matching facts; sparse data; major missing coverage |

## Implementation

| File | Role |
|------|------|
| `src/intelligence/askNac/confidence/analyticalConfidence.js` | `resolveAnalyticalConfidence()`, `formatConfidenceLine()` |
| `src/intelligence/askNac/coverage/coverageAwareness.js` | Base coverage assessment + explanation text |
| `src/intelligence/askNac/vault/vaultAnswerBuilder.js` | Sets `confidence` + `dataConfidence` on range aggregation responses |
| `src/intelligence/askNac/askNacContract.js` | `CONFIDENCE_LEVELS`, `dataConfidence` field on response |
| `src/intelligence/nil/confidenceScoring.js` | NIL / why-mode statement confidence (unchanged, complementary) |
| `src/intelligence/askNac/confidence/dataConfidenceLayer.js` | Executive network ranking safeguard (unchanged) |

## Answer format

```
Confidence: Medium — sales coverage is partial — 45 cash-up day(s) found for a 174-day requested window. Delivery order tracking starts later, so order totals are partial.
```

Rendered via:
- `directAnswer` append (coverage lines)
- `insights` array (non-duplicated coverage lines)
- `warnings` array (coverage notes)
- `confidence` + `dataConfidence` structured fields on `AskNacResponse`

## Interpretation layer (Assistant GM)

| File | Role |
|------|------|
| `src/intelligence/askNac/interpretation/operationalInterpretation.js` | Traffic vs spend interpretation, recommended actions |
| `src/intelligence/askNac/vault/vaultSalesPerformanceIntelligence.js` | Compare answers include interpretation |
| `src/intelligence/nil/businessReasoningEngine.js` | Enhanced spend-driven / traffic-driven hypotheses |

## Remaining risks

- Single-day cash-up executive brief path still uses `vaultConfidence()` — not yet unified with `resolveAnalyticalConfidence()`.
- Confidence does not yet propagate to WhatsApp transport.
- Edge orchestrator must mirror `analyticalConfidence` + `coverageAwareness` for production parity.

## Tests

- `src/intelligence/askNac/confidence/analyticalConfidence.test.js`
- `src/intelligence/askNac/coverage/coverageAwareness.test.js`
- `tmp-vault-verify/trust-integrity-verify.mjs`
