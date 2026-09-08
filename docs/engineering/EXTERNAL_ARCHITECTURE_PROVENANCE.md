# External architecture provenance

Inventory Truth Engine v1. No proprietary commercial source was copied. No unreviewed installers were run against NAC.

## Commercial systems studied (public docs / help / observable workflows only)

| System | Used as | Notes |
|---|---|---|
| Supy | ADOPT concepts / INSPIRE | Ingredient master, POS-linked theoretical usage, variance vs counts, prep/sub-recipe, mobile counting. Reject live depletion as “actual”. |
| Foodics | ADOPT operational semantics / REJECT silent failures | Storage vs ingredient UOM + factor, recipes, production yield, PO/receive/transfer/count. Prevent SKU reuse, name mismatch, missing cost-as-zero. |
| Squirrel Systems | INSPIRE ONLY (backlog) | Multi-site config, local resilience, KDS routing. Not in v1. |
| Restaurant365 | ADOPT formula concept | Theoretical = POS × recipe BOM. Actual = beginning + purchases ± transfers − ending **only when counts exist**. Unmapped items cannot have theoretical usage. |
| MarketMan / MarginEdge / Crunchtime / Yellow Dog / Apicbase / Toast / Oracle MICROS / Lightspeed | INSPIRE | Fill gaps: invoice-to-recipe, menu engineering gates, central kitchen. |
| Odoo Inventory | INSPIRE ONLY | Stock as derived ledger. LGPL Python — not imported. |

## Open-source evaluation

| Project | License | Verdict | Reason |
|---|---|---|---|
| NAC `inventoryIntelligence` + Food Bible graph | existing | **ADOPT** | Exact decimals, dimensional UOM, WAC, cycle detection already in-tree. |
| @emisso/inventory | MIT | **REJECT** | v0.1.0, tiny usage, Zod runtime, too young for supply chain. |
| saitodisse/bom-recipe-calculator | MIT | **INSPIRE ONLY** | Float costing, Deno-oriented, 3 stars. |
| prudhvimanvith/Gourmet | MIT | **REJECT** | 0 stars, full POS app, not a library. |
| Odoo stock | LGPL | **INSPIRE ONLY** | Python monolith; do not vendor. |
| ERPNext stock | GPL | **REJECT** | Copyleft unfit for embedding. |
| InvenTree | MIT | **INSPIRE ONLY** | Python inventory; not recipe/POS native. |
| convert-units / decimal.js | MIT | **REJECT** | NAC already has stricter decimal + UOM. |

## Code actually reused

None from external repositories.

Adapted in-tree:

- `src/inventory/inventoryIntelligence.js` — decimal math, compatible UOM, weighted average
- `src/inventory/foodBible.js` — cycle detection concepts, kitchen identity
- `src/dashboard/health/dataIntegrityScan.js` — cost/recipe issue classification
- `src/lib/rbacQueryScope.js` — branch clamp
- Foodics-runtime commerce schema (`commerce_orders`, `commerce_order_items`) — **contract only**, not copied source. Item-mix authority for theoretical consumption.

## Supply-chain

No new npm dependencies. Research clones were not added to the NAC app tree. No installer scripts executed.
