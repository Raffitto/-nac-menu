# Ask NAC Business Semantics Layer

## Purpose

Maps restaurant GM language to canonical metric terms **before** deterministic intent routing and vault period resolution. Ask NAC must understand what a manager means, not just match keywords.

## Implementation

| File | Role |
|------|------|
| `src/intelligence/askNac/nlu/businessSemantics.js` | `applyBusinessSemantics()`, `BUSINESS_SEMANTICS_REPLACEMENTS` |
| `src/intelligence/askNac/nlu/normalizeQuestion.js` | Runs business semantics first, then existing phrase replacements |
| `src/intelligence/askNac/nlu/businessSemantics.test.js` | Unit tests |

## Canonical mappings

| Manager says | Normalized to |
|--------------|---------------|
| sales / revenue / how much did we make | net sales |
| guests / covers | guest count |
| checks | orders |
| average check / avg check | average spend |
| delivery (standalone) | delivery sales |
| delivery apps / platforms | delivery platforms |
| Hunger / HungerStation | hunger delivery platform |
| Jahez | jahez delivery platform |
| Talabat | talabat delivery platform |
| Google rating | Google Business rating |
| reviews (via existing NLU) | Google reviews |

Protected phrases: `delivery sales`, `delivery orders`, and `delivery platform(s)` are not corrupted by generic sales replacement (negative lookbehind on `sales`).

## Routing interaction

- `intentRouter.js` — boosted `vault_cash_up_summary` score (34) for single-day net sales questions (e.g. yesterday).
- `vaultSalesPerformanceIntelligence.js` — `scoreSalesPerformanceQueryFocus()` recognizes yesterday and YTD delivery/sales phrasing after normalization.

## Edge parity

Edge NLU (`supabase/functions/_shared/askNacNlu.ts`) has a subset of phrase replacements. Full business semantics mirror is **not yet deployed to Edge** — client orchestrator fallback includes full semantics.

## Remaining risks

- Aggressive synonym expansion can still mis-route ambiguous phrases (e.g. "top sales items" — mitigated by ordering specific patterns first).
- Edge function may lag client semantics until shared module is extracted to `_shared/`.

## Tests

- `src/intelligence/askNac/nlu/businessSemantics.test.js`
- `src/intelligence/askNac/vault/vaultFlexiblePeriod.test.js` (sales yesterday routing)
- `tmp-vault-verify/trust-integrity-verify.mjs`
