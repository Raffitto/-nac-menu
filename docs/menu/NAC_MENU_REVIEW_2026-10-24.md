# NAC Menu Builder and guest integration — draft release candidate

This branch continues9f9c0da and incorporates current main3bae4f8 without changing main.
No production database access, migration, deployment, historical deletion or recipe write
was performed. The PR is a draft for owner review, not approval to release.

## Implementation

- Exact confirmed registry:12 variants/30 Khobar placement UUIDs. Unknown and proposed
  identities do not become confirmed from a name, equal price, tag or clone hint.
- Big NAC label normalization preserves stored prices/nutrition; an explicit retired
  external identity is hidden without deleting or rewriting historical records.
- Egg preparation identity survives presentation changes; Scrambled default, three photos,
  fixed selection delta and separate Egg Bun behavior remain.
- Branch document titles use existing configured English display names.
- Typed historical target audit handles341 menu targets and10 valid add-on targets.
- Branch-specific cache entries are invalidated after edits, avoiding stale guest reads.
- Guest data retains source branch provenance. Linked content/visibility propagation
  excludes foreign-branch members even if a placement group collides across branches.
  Group read failures stop synchronization; branch retargeting through a linked edit fails.
- Timed-hidden rows expose only their earliest wake-up timestamp before public filtering.
  The guest hook refetches at expiry even if every hidden card was filtered out. Long
  timeouts are capped at the browser-safe limit. Active=false still stays hidden; sold-out
  cards remain visible. No cron job, row restoration write or recipe change is needed.
- Temporary availability override infrastructure is opt-in. The Khobar small-water proposal
  remains inactive pending stock confirmation and a branch-isolated application path.

## Coverage and limits

`src/lib/menuBuilder.integration.test.js` executes the actual API using an in-memory
PostgREST test double for Khobar, Riyadh and Jeddah. It covers category/section creation
and edits, bilingual product creation, linked content sync, independent branch prices,
availability, add-ons, allergens, sold-out vs hidden, hide expiry and retained recipe links.
It rejects historical deletes in the test store. `useMenuData.visibility.test.js` verifies
automatic restoration in an open tab with fake timers. Existing MenuManager UI, Food Bible,
recipe editor, publishing, branch/RBAC and guest component suites remain part of full Jest.

These tests verify application behavior, not deployed RLS, actual authenticated write
permissions, database transaction atomicity or production publish-RPC availability. Before
release, perform owner-approved writes only in a disposable staging database and validate
branch-specific editor permissions and publish/realtime behavior there. Do not test writes
against production to close this gate.

## Three branch retrieval modes

Default remains the existing shared Khobar catalogue. Set the build-time environment value
`REACT_APP_GUEST_CATALOGUE_MODE=branch` only after reviewing each branch's stored menu.
In independent mode all3 canonical branch IDs fetch their own rows; invalid/unscoped
requests fail rather than fetch every branch. Explicit shared mode remains available.
No environment setting was changed on Netlify.

Existing Riyadh/Jeddah catalogues have166 rows each and18 retained differences from Khobar.
Their current Foodics operational eligibility has not been affirmatively established.
Do not silently clone Khobar identities/prices/stock states or activate independent mode
without parity approval. This is a release configuration/data readiness gate, not a missing
branch data-fetch implementation.

## Unresolved identities — preserved

- Dessert working slot10 is a count/evidence gap, not a proved missing live product.
- Breakfast Halloumi9b622fd0-c99b-4c96-8a5a-a8e73daf6f3a remains unbound (721cal versus
  the300cal grilled candidate; no explicit recipe link for breakfast).
- Three300cal Halloumi rows and Pineapple Juice have verified exact Foodics/digital reference
  integrity but remain proposals. All20 proposed bindings remain outside the runtime registry.
- Printed nutrition/wording version conflicts and ordering-modifier UX policy remain gated.
- No Le Cafe NAC evidence or mapping is used.

## Data and migrations

No schema migration or backfill is required by this PR. Existing recipe, version, ingredient,
subrecipe, quantity, approval and historical sales tables are untouched. The frozen saved
recipe snapshot and three manifests still hash identically with125 recipes/188 versions/
788 lines. This does not imply the live database cannot be changed by other users.

Run `node scripts/reconciliation/audit.mjs` and
`node scripts/reconciliation/verify-recipes.mjs <saved-evidence-directory>` for local checks.
The evidence directory is external; no recipe quantities or production credentials are
embedded in this PR's fixtures.

## No-deploy guard and rollback

The Netlify ignore script exits0 for exactly `codex/nac-master-menu-reconciliation`, before
examining runtime diffs. Main and unrelated branches retain their existing behavior.
Do not remove that guard or manually start a preview deployment during review.
The final review commit also carries a skip-Netlify marker.

Before merge: close the draft PR to reject the change; no database rollback is necessary.
After an owner-approved future merge: revert this PR's resulting merge/squash commit using
normal branch protection/review, then deploy the prior approved build only when separately
authorized. Restore the previous guest-catalogue mode setting if it was changed later.
There are no destructive migrations or historical-data reversals to execute. Do not revert
unrelated newer main security/RBAC commits.
