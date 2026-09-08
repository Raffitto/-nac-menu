# Inventory Truth Engine v1

Analytical layer over existing NAC inventory + Foodics sales. It answers what should have been consumed, what it cost where evidence exists, and whether actual/variance are computable.

## Chain

`SALE → MENU ITEM → RECIPE → SUB-RECIPE → INGREDIENT → THEORETICAL CONSUMPTION → COST → ACTUAL (if source exists) → VARIANCE (only if comparable)`

Missing is never zero. Actual is not fabricated from theoretical depletion.

## Code

- Engine: `src/inventory/truth/`
- Loader: `src/lib/inventoryTruthApi.js`
- UI: Inventory → Truth (`src/inventory/InventoryTruthView.jsx`)
- Super Admin readiness: Settings → Data Health

## Canonical ingredient

Identity is `inventory_ingredients.id`. SKU is used only when a uniquely verified supplier catalogue SKU exists. Names are not permanent identity. Ambiguous names/SKUs are flagged, never auto-merged.

`inventory_ingredients` has no SKU column. Catalogue `supplier_sku` is the only SKU source.

## UOM

Dimensional conversions only: kg↔g, L↔ml, piece↔piece. No invented density, cup, spoon, bottle, bag, or box factors unless a verified per-ingredient factor exists.

Statuses: `EXACT`, `CONVERTED`, `MISSING_CONVERSION`, `INCOMPATIBLE`, `UNKNOWN`.

## Recipe graph

Uses `inventory_recipes` + active `inventory_recipe_versions` + lines. Multiple active versions are not silently chosen. Inactive/retired versions are not used. Circular and missing sub-recipes are flagged. Sub-recipes expand into base ingredients only — the sub-recipe is not also counted as consumption.

Yield: schema default 100 is treated as `YIELD_UNKNOWN`. A non-default `yield_percentage` is source-backed. No invented cooking loss.

## Theoretical consumption

Primary item-quantity source is **canonical commerce** (`commerce_order_items`), owned by the Foodics bridge / commerce pipeline. That table is not created in this repo’s migrations; Inventory Truth probes it at runtime.

Fallback is manual `foodics_sales_items` when commerce is absent from schema or the requested period is outside commerce coverage. Overlapping sources are never summed.

Cash Up remains headline sales. Theoretical consumption never claims a date past `min(latestCompletedBusinessDate, commerce publishedThrough)`.

Unmapped sales stay visible (`recipeUncoveredSoldRows`, `unmappedRevenue`). Period default in UI is the previous completed Sunday–Saturday NAC week.

Postgres already has recursive BOM costing (`inventory_recipe_cost_component`, depth ≤ 10) for recipe **cost snapshots**. Theoretical **quantity** expansion stays in JS so coverage, traces, and missing-recipe status remain explicit. Do not treat that RPC as actual consumption.

### SQL cost graph vs JS quantity graph

Do not collapse these implementations.

| Topic | `inventory_recipe_cost_component` | Inventory Truth JS graph |
|---|---|---|
| Purpose | Snapshot unit cost | Quantity, traces, coverage |
| Version choice | All matching `active` versions as-of, ordered by `version_number desc` — multiple actives can contribute lines | Refuses multiple active versions |
| Missing cost | `coalesce(..., 0)` | Missing stays null / classified |
| Yield | Multiplies `yield_waste_factor` | Default 100 → `YIELD_UNKNOWN`, no invented loss |
| Sub-recipes | Recursive cost, coalesced to 0 if missing | Expand to ingredients; missing child is an issue |
| UOM | Uses `canonical_quantity` | Dimensional convert or block |

### Ledger quantity contract

The theoretical ledger stores `quantityTheoreticallyConsumed`. Graph expansion may use `quantityBase` internally. Food-cost calculation reads only `quantityTheoreticallyConsumed` via `THEORETICAL_LEDGER_CONTRACT`.

### Food Bible cost stub

`fetchCanonicalCostContext()` stays an empty stub. Wiring it would introduce a second Food Bible load path and is not the Truth cost policy. Integration debt, not a second costing system.

## Cost

Hierarchy, never collapsed:

1. `inventory_ingredient_cost_state` with purchase evidence (`last_purchase_at` or `last_purchase_price`)
2. `inventory_ingredient_cost_history`
3. Unavailable

`weighted_average_cost = 0` with no purchase evidence is **not** a verified zero. Verified zero requires purchase evidence. Missing cost is excluded from theoretical food cost and reported separately.

## Movement / count RPC audit

These already exist. RPC existence is not operational data.

| RPC | Read/write | Source tables | Auth | Notes |
|---|---|---|---|---|
| `inventory_stock_as_of` | read | `inventory_movements` | authenticated + branch allowed | Point-in-time derived stock |
| `inventory_create_operational_movement` | write | `inventory_movements` | `inventory_can_approve` | wastage, adjustment, return, staff meal, complimentary, production |
| `inventory_create_transfer` | write | `inventory_movements` | `inventory_can_approve` | paired transfer_out / transfer_in |
| `inventory_reverse_movement` | write | `inventory_movements` | `inventory_can_approve` | correction pair |
| `inventory_approve_stock_count` | write | `inventory_stock_counts`, lines, movements | `inventory_can_approve` | posts `physical_count_adjustment` |

No Inventory UI posts these. `sale_consumption` is never written. Empty movement/count probes stay `actualConsumption = null` / `UNAVAILABLE`. Whether production has posted rows is UNKNOWN without an authorized Super Admin session.

## Actual consumption

NAC has movement and stock-count **tables and RPCs** (`inventory_create_operational_movement`, `inventory_create_transfer`, `inventory_approve_stock_count`, `inventory_stock_as_of`), but Foodics inventory consumption is not imported and `sale_consumption` is never posted.

- Empty movements + empty posted counts → `ACTUAL_CONSUMPTION_UNAVAILABLE`
- `sale_consumption` movements are POS-linked theoretical depletions, not independent actuals
- Opening/transfer/waste/count APIs exist without UI — presence of an API is not evidence of posted data
- Variance is `actual − theoretical` and only when both sides are valid and UOM-compatible

`fetchCanonicalCostContext()` in `inventoryApi.js` remains an empty Food Bible stub. Truth Engine v1 reads `inventory_ingredient_cost_state` directly. Wiring that stub is a later Food Bible cost-display task, not a second cost policy.

## RBAC

Super Admin / network vault roles: any requested branch. Branch managers: own `branchIds` only. Data Health remains Super Admin. Existing inventory RLS is unchanged. No new security-definer RPCs.

## Performance

Foundation queries are explicit column lists in parallel. Theoretical uses aggregated sold quantities, not per-order browser expansion. Recipe graph is computed once per load. Sales calculation is on demand.

## Ask NAC later

Deterministic contracts already exist in the engine (`exploreIngredient`, `traceIngredientQuantity`, coverage/status enums). Do not answer inventory questions from memory. If actual/cost/UOM is unavailable, say so.

## Competitor capability (implementation-oriented)

| Capability | NAC today | Strongest public pattern | v1 design |
|---|---|---|---|
| Ingredient master | `inventory_ingredients` | Supy / Foodics | Canonical ID; no invented SKU |
| Recipe / sub-recipe / BOM | Food Bible graph | Supy + R365 mapping | Recursive expand, no double-count |
| UOM | Dimensional + invoice pack aliases | Foodics storage↔ingredient factor | Recipe path rejects packaging units |
| Theoretical usage | **new** | Supy / R365 POS × recipe | Aggregated sales × graph |
| Actual usage | Schema only, no Foodics import | R365 opening+purchases−closing | UNAVAILABLE until posted counts |
| Variance | Price alerts only | Supy / R365 AvT | Only when both sides valid |
| Cost | cost_state / history | Foodics auto vs fixed; R365 item costing | Evidence hierarchy; 0 ≠ missing |
| Stock ledger | `inventory_movements` unused | Odoo derived stock | Future: derived, not mutable number |
| Procurement | Invoice OCR + receipts schema | Supy PR/PO | Not implemented in v1 |
| Multi-branch / POS resilience | RLS + branch clamp | Squirrel | Clamp now; POS backlog later |

## Future ledger (not implemented)

Current stock should become a derived sum of posted movements. Movement types already exist on `inventory_movements`. Procurement write-path (PR → approve → receive → adjust) remains future work. See `docs/engineering/BACKLOG.md`.
