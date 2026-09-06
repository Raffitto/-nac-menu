---
name: nac-menu-schema-safety
description: Prevents Menu queries from selecting nonexistent columns. Use when changing MenuManager selects, catalogue lists, editor hydration, or menu_items SQL.
---

# NAC menu schema safety

Before selecting DB fields, inspect the actual schema. Never assume a field exists.

Explicitly prevent repeats of `menu_items.sku`.

Catalogue query and editor query are separate contracts:

- Catalogue: slim `MENU_CATALOGUE_SELECT` for Breakfast/item lists
- Editor: load `desc_en` / `desc_ar` and full row only when an item opens

Do not add Menu refactors during unrelated milestones. Keep `src/dashboard/MenuManager.production.test.js` as the schema-contract gate.
