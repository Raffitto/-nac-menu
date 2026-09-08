# Next NAC runtime work

Completed in the Sunday-week / coverage / mapping milestone:

1. Persistent available dates on Fabric coverage contracts
2. Sunday-start comparable-week semantics
3. Kitchen/no-recipe classification (no auto-merge)
4. Cash Up range RPC returns `availableDates` and skips a second coverage fetch on the simple path

Still open:

1. Explicit Refresh `get_bi_dashboard` still ~8s
2. Inventory/sales mapping capability gap (Truth Engine v1 calculates theoretical; Foodics inventory actuals are still not imported)
3. Wire Netlify ignore for non-runtime paths after a dedicated review
4. Apply remaining recipe exact-mapping repairs only with a reversible admin action
5. Inventory Truth v2: posted count-to-count actual consumption, Ask NAC inventory contracts, procurement writes
6. Foodics-replacement milestone (not now): POS orders/modifiers, payments, tables, KDS, stock ledger writes, PR/PO/receive, production, transfers, counts, waste, staff/RBAC, audit, CRM/loyalty, accounting, offline devices

Completed in Inventory Truth Engine v1 (local until a production-worthy deploy decision):

1. Canonical ingredient identity + SKU collision detect-only
2. Recipe graph expansion with no double-count
3. Theoretical consumption from canonical commerce item-mix, with manual Foodics as fallback only
4. Cost coverage that does not treat default 0 as cost
5. Actual/variance stay unavailable without independent stock evidence
6. v1.1: commerce source precedence, coverage clipping, quantity contract, empty-movement safety, network ingredient visibility

Open after v1.1 (local until a production-worthy deploy decision):

1. Authorized Super Admin session is required before live Maldon/Honey/Steak/cost counts can be claimed
2. Independent actual consumption still needs posted count-to-count data, not RPC existence
3. `fetchCanonicalCostContext()` Food Bible stub remains unwired on purpose
