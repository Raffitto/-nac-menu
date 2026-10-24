# NAC reconciliation development checkpoint — 2026-10-24

This branch implements read-model corrections only. It has no production data migration,
no deploy step, no recipe writes and no automatic proposal-to-confirmed promotion.

## Implemented

- `src/lib/data/nacMenuIdentities.json`: 12 guide-confirmed Foodics variants, 30 exact
  observed Khobar placement bindings. Product/variant keys are stable code identifiers,
  not newly created database UUIDs. Family/portion relationships preserve separate SKUs.
- `menuIdentity.js`: exact-ID matching with branch, declared SKU and external UUID conflict
  checks. English label, price, nutrition, tags and clone hints cannot create a binding.
- `canonicalGuestCatalogue.js`: normalize only the confirmed current Big NAC label.
  Never rewrite unknown or historical-looking rows to current prices/calories. An explicit
  discontinued external Big NAC UUID is filtered from public display, not deleted.
- `eggPreparation.js`: confirmed placement identity takes precedence over mutable display
  text/price/nutrition; retain legacy fallback for unbound environments. The49SAR bun is
  separate. Existing scrambled default and three photographs remain.
- `App.js`: configured branch document title; explicit requested-branch context for filtering.
- `mappingTargetResolution.js`: menu item/add-on/missing/ambiguous typed validation, used by
  offline audit. This does not assert that production previously rejected add-ons.
- `guestAvailability.js`: opt-in branch-scoped stock projection; no default temporary override.
  `availability-proposal.json` is review-only. Shared branch data and unknown restock date
  prevent safely activating this temporary decision by default.

## Reproduce without service access

From this repository, with dependencies installed from its lockfile:

```sh
CI=true REACT_APP_SUPABASE_URL='' REACT_APP_SUPABASE_ANON_KEY='' npm test -- --watchAll=false --runInBand --runTestsByPath src/lib/canonicalGuestCatalogue.test.js src/lib/menuIdentity.test.js src/lib/mappingTargetResolution.test.js src/lib/guestAvailability.test.js src/lib/eggPreparation.test.js src/lib/menuVisibility.duplicate.test.js src/lib/khobarSeasonalMenuRelease.integration.test.js src/App.test.js src/lib/menuPlacements.test.js src/lib/menuBranchScope.test.js src/lib/menuCatalogueState.test.js src/lib/menuAddon.test.js src/lib/menuPresentation.test.js src/lib/guestCatalogueBranch.test.js src/components/EggPreparationPicker.test.js src/lib/menuApi.foodBibleCatalogue.test.js src/lib/menuApi.linkedPlacements.test.js
node scripts/reconciliation/audit.mjs
node scripts/reconciliation/verify-recipes.mjs /absolute/path/to/outputs/nac-master-reconciliation
CI=true REACT_APP_SUPABASE_URL='' REACT_APP_SUPABASE_ANON_KEY='' npm run build
```

The fixture includes only saved scoped Foodics IDs, menu/add-on records and historic links.
It contains no credentials and no recipe quantities. The recipe script compares frozen
SHA256 hashes against the external evidence package, with125/188/788 count checks.

## Exceptions — do not guess

- The10th working dessert slot is not a verified missing product.8 products appear in
  the image; Burnt Vanilla Cheesecake is additionally named in prior decisions. Nothing
  establishes another product. Existing Churros/Choux/etc are not evidence for that slot.
- Breakfast Halloumi9b622fd0-c99b-4c96-8a5a-a8e73daf6f3a is721cal. The300cal griddle
  recipe is explicitly linked to Daytime, not breakfast. Do not attach it or alter calories.
- Three300cal Halloumi placements and Pineapple Juice remain supported proposals only.
  Their exact IDs/reference integrity are verified, but no confirmed alias decision or
  branch assignment is invented. All20 proposed bindings stay outside the runtime registry.
- Branch-independent visibility is required, but toggling shared Khobar retrieval now
  would expose retained166-row branch catalogues with unverified current identities,
 18 retained differences and unproven Foodics operational assignments. Prepare parity
  review before cutover; do not overwrite branch rows or silently fall back to Khobar.
- Other modifiers/order-taking UX, version-conflicted nutrition/wording/prices and temporary
  stock activation remain gated by explicit evidence/policy. No historical sales rewriting.

No merge, production database mutation or deployment is included in this branch.
