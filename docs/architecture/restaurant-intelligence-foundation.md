# Restaurant intelligence foundation

Shadow calculations only. They do not post stock, rewrite receipts, or fill Marlon's live sheet.

## Decisions

- Reuse the existing recipe-explosion rules: exact inventory identity, yield applied once, circular recipes stop.
- Reuse the existing decimal helpers. Do not add a new numeric library.
- Do not vendor Grocy or ERPNext. Their ledgers overlap inventory already in NAC, and Grocy is AGPL.
- A supplier SKU, a Foodics id, and a menu product stay different identities.
- Sumac Powder stays unresolved. The item master has no SKU.
- Theoretical consumption is labeled incomplete when any recipe line fails.
- NULL cost stays NULL. It is not zero and it does not enter a total.
- Finished-product wastage is one event. Nested ingredients are an explanation, not a second deduction.

## Not in this release

Ask NAC can ask how much of a named ingredient a branch should have consumed. The answer uses stored recipe quantities and Foodics sales linked by menu id. If that link or the sales period is missing, the answer says so and does not invent a quantity. Wastage questions stay on the vault breakage intent.

