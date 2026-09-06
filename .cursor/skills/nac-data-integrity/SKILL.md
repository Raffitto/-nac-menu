---
name: nac-data-integrity
description: Classifies NAC identity, recipe, cost, and mapping gaps without auto-merging. Use when changing Data Health, Food Bible links, inventory costs, SKUs, or sales-to-menu mapping.
---

# NAC data integrity

Detect:

- SKU collisions
- identity ambiguity
- recipe/subrecipe breakage
- cost gaps
- UOM issues
- legacy contamination
- sales/menu mapping gaps
- inventory mapping gaps

Never auto-fix ambiguous production identities. Do not fabricate costs.

Kitchen/recipe-expected items can be Needs review. Beverage, retail, modifiers, OCR placeholders, and inactive rows stay Informational / capability gaps. Data Health should answer "what needs action?" with Critical / Needs review / Informational groups.
