# Food Bible / Cost Control — End-of-day checkpoint (2026-08-07)

Status: **PREVIEW / REVIEW ONLY**
Branch: `feature/inventory-cost-control-phase-a`
Final source commit this day: `219cd8d10316b76218ed8d90c65d4190a7e1e447` (*Add Foodics legacy recipe reconciliation preview*).
Netlify: **NOT DEPLOYED**
Production culinary apply: **NONE from today's Food Bible / Foodics work**

This document locks today's architecture and business decisions and holds the Chef Review backlog for the next session. It does not authorize production mutation.

---

## 1. Source-authority decisions (locked)

### A. Food Bible

- Authoritative NAC Food Bible PDFs are the **primary recipe specification source**.
- If Food Bible quantity conflicts with Foodics recipe quantity: **Food Bible wins operationally**.
- Preserve the Foodics value as legacy evidence and record `SOURCE_RECIPE_CONFLICT`.
- Do not invent missing yields, quantities, or substitutions.

### B. Foodics

- Foodics is **LEGACY EVIDENCE**, not NAC OS master data.
- Foodics `sk-xxxx` IDs, ingredient mappings, recipe quantities, `ingredient_cost`, prefixes, and prep naming must **not** become canonical automatically.
- Preserve as external references only, e.g.:
  - `external_system = foodics`
  - `external_product_sku`
  - `external_inventory_item_sku`

### C. Cost

- Foodics `ingredient_cost` is **`LEGACY_FOODICS_REFERENCE` only**.
- It must never silently become WAC, trusted historical cost, ledger cost, or recipe cost truth.
- Real branch cost must come from purchase / receipt / invoice / historical ledger evidence (Khobar for current focus).

### D. Zero / blank cost

- Foodics zero or blank cost does **not** mean free.
- Default: `MISSING_OR_UNRELIABLE_COST`.
- Legitimate zero only after explicit Phase C / human approval.

---

## 2. Company / brand architecture (locked)

```
COMPANY / GROUP
  -> BRAND
    -> MARKET / COUNTRY (where required)
      -> BRANCH
```

- **SPT = Sum Plus Things** — different restaurant brand under the same company as NAC.
- Do **not** hardcode Khobar-only foundations.
- Current operational focus: **NAC → KSA → Khobar**.
- Shared real-world items may later be reusable at company scope.
- Keep separate where appropriate: brand recipes, prep recipes, market adaptations, branch stock, purchases, WAC, availability, variance.
- SPT culinary data must not contaminate NAC recipes.
- Unknown Foodics prefixes (`MT-`, `SN-`, `Cart-`, trial-only): `BRAND_SCOPE_UNRESOLVED` until confirmed.

---

## 3. Canonical model principle (locked)

Keep explicit record types:

- `PURCHASED_INGREDIENT`
- `PREP_SUBRECIPE`
- `FINISHED RECIPE` (finished dish)
- `MENU PRODUCT / PLACEMENT`
- `PACKAGING`
- `BEVERAGE`
- `CLEANING_CHEMICAL`
- `OPERATING_SUPPLY`
- `EQUIPMENT_CONSUMABLE`
- `OTHER` / `UNRESOLVED`

Keep identity layers separate:

- NAC OS canonical UUID
- Foodics external SKU
- supplier SKU / alias
- invoice description
- legacy name
- source-document evidence

Managers should not need Foodics `sk` numbers in normal operation.

---

## 4. Recipe graph principle (locked)

Manager-visible model:

```
PURCHASED INGREDIENT
        ↓
PREP / SUBRECIPE
        ↓
FINISHED DISH
        ↓
MENU PLACEMENTS
```

Same culinary dish across brunch / daytime / evening = **one finished recipe → multiple placements**, when name/price/menu evidence supports it.

---

## 5. KSA market rules (locked)

| Topic | Decision |
|---|---|
| Vodka Tomato Sauce | International source title preserved; KSA operational name **Tomato Sauce** |
| Spirits / vodka as ingredients | Not created as KSA operational ingredients unless an explicitly approved KSA equivalent exists |
| Wine (operational) | Must be **0.0% alcohol** wine when used in KSA |
| Wine vinegar | Remains vinegar |
| Mirin | `REVIEW_ALCOHOL_BEARING` — no invented replacement |
| Sake | Excluded unless approved KSA 0.0% equivalent is explicitly provided |

Do not invent substitutions in software.

---

## 6. Chef Review backlog (do not solve now)

For the upcoming session with restaurant chef + user + NAC OS review.

### RIGATONI

| # | Question | Source | Food Bible | Foodics legacy | Proposed operational | Impact if unresolved |
|---|---|---|---|---|---|---|
| R1 | Confirm finished portion qtys vs Foodics | Rigatoni PDF p1–2; Foodics `sk-1174` | Basil 2g, Parm 22g, salt 2g, pasta 200g, Tomato Sauce 400g | Basil 6g, Parm 21g, salt 1g; pasta via `NAC-Pasta Cooking` 130g; sauce mix 300ml | Keep Food Bible qtys; Foodics as conflict evidence | Cannot approve portion cost |
| R2 | Confirm Tomato Sauce prep (ex-Vodka) yield/reduction | Tomato Sauce prep; yield 16.5 kg | Batch ingredients as extracted | `NAC-Tomato Sauce` / `NAC-Tomato Sauce mix` | KSA title Tomato Sauce; no vodka ingredient | Prep identity/cost blocked |
| R3 | Confirm pasta: raw De Cecco vs cooked prep identity | Food Bible pasta line; Foodics `sk-1172` | Rigatonni pasta 200g | `NAC-Pasta Cooking (Rigatoni)` 130g | Separate purchased pasta vs cooking prep | Graph mis-model risk |

### CAJUN CHICKEN

| # | Question | Source | Food Bible | Foodics legacy | Proposed operational | Impact if unresolved |
|---|---|---|---|---|---|---|
| C1 | Confirm fillet → sauce → sweet corn graph | Cajun PDF | Fillet 1 unit; sauce 50g; corn 40g | Nested `NAC-Cajun Chicken` 207g; sauce 85g; corn 50g | Food Bible structure; Foodics nested as evidence | Wrong prep nesting |
| C2 | Cajun Sauce missing yield | Cajun Sauce prep | Yield missing; cream/shallots/spice/butter present | Sauce portion 85g on finished product | Ask chef for yield / batch size | Cannot cost sauce |
| C3 | Vinegar in method, absent from table | Method text | No vinegar qty | n/a | Flag inconsistency; do not invent | Incomplete recipe |
| C4 | Sweet Corn `g 1110` ambiguity | Sweet Corn prep | Inputs 1000+100+salt; unpaired 1110 | Portion 50g | Confirm if 1110 is yield/total | Yield blocked |
| C5 | Foodics nested prep qtys vs Bible | Foodics `sk-0631` | See C1 | 207 / 85 / 50 | Bible wins for definition | False confidence if Foodics applied |

### HALLOUMI

| # | Question | Source | Food Bible | Foodics legacy | Proposed operational | Impact if unresolved |
|---|---|---|---|---|---|---|
| H1 | Missing finished yield | Halloumi.pdf | Ingredients only; yield missing | n/a | Ask chef for yield / pax | Portion cost blocked |
| H2 | Halloumi vs Grilled Halloumi menu | Khobar menu + Foodics `sk-0628` / `sk-2125` | Recipe title HALLOUMI | `Halloumi Grilled` product; separate Grilled Halloumi Cheese plate | One culinary recipe only if chef confirms | Duplicate recipes |
| H3 | Halloumi Fries separate | Foodics `sk-0613` | Not this PDF | Fries uses 250g cheese + honey sriracha | Explicitly separate product | Wrong cost linkage |
| H4 | Cheese qty 95g vs 120g | Bible vs Foodics `sk-1081` | 95g | 120g | Bible wins pending chef | Cost variance |

### TRUFFLE BURGER

| # | Question | Source | Food Bible | Foodics legacy | Proposed operational | Impact if unresolved |
|---|---|---|---|---|---|---|
| T1 | Qty conflicts (cheese, salt, dressing, lettuce, butter) | Truffle burger PDF; `sk-0629` | Jack 40g; salt 5g; dressing 10g; gem 50g; butter 10g | Jack 20g; salt 1g; dressing 25g; gem 18.6g; butter 5g | Bible wins; log conflicts | Cost/portion wrong |
| T2 | Monterey Jack vs Provolone | Foodics has both | Monterey Jack 40g | Jack 20g + Provolone 20g | Ask which cheese(s) are live KSA | Wrong cheese identity |
| T3 | Truffle mayo match + missing Foodics cost | Bible 40g; Foodics 40g | 40g | 40g, blank cost | Identity strong; cost from Khobar evidence | Cost missing |
| T4 | Black truffle paste vs Tartufo Nero | Prep mayo/dressing | Both named in prep | n/a on finished lines | Possible duplicate / distinct forms — chef decide | Duplicate canonicals |
| T5 | Unpaired prep quantity rows | PDF extract | Orphan qty flags | n/a | Confirm batch lines | Prep incomplete |
| T6 | Modifiers stock effect | Foodics modifiers | n/a | Steak Cook Option; Burger slice | `REVIEW_REQUIRED` — no stock assumption | Inventory variance errors |

### MISO / ALCOHOL

| # | Question | Source | Food Bible | Foodics | Proposed operational | Impact if unresolved |
|---|---|---|---|---|---|---|
| M1 | Mirin KSA decision | Miso-related PDF | Mirin present → `REVIEW_ALCOHOL_BEARING` | Not shortlist-applied | Hold apply until chef/policy | Cannot approve miso cohort |
| M2 | Any other alcohol-bearing adaptations | Method/tables | Preserve evidence | Legacy only | No invented 0.0% replacements | Policy risk |

---

## 7. Release gates (unchanged)

- Authenticated real non-super-admin branch-user RLS smoke test remains mandatory before wider rollout / Netlify deploy of this chapter.
- Do not weaken RLS or create Auth Admin users to force the gate.
- This gate is **not** a blocker for ending today's development checkpoint.

---

## 8. Recommended first action next session

Continue the **real data** chapter only:

1. Chef Review session using the backlog above (shortlist first).
2. Canonical ingredient identity for approved shortlist leaves.
3. Attach real Khobar purchase / invoice / ledger cost evidence.
4. Approve a small recipe onboarding cohort (preview → review → apply) only after chef + cost gates pass.
5. Only later: trusted recipe costing UI maturity and Netlify consideration.
