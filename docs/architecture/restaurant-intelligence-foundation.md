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

Ask NAC still routes wastage questions to the existing vault breakage intent. The new explanation function is available to that layer and is not a second chatbot.
