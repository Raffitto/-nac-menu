# Restaurant persistence foundation

Branch: `feature/nac-reservations-persistence`, cut from production `main` at `fba256f2`.

The existing branch `feature/nac-restaurant-reservations` is preserved, including `8923546d` and `c710a577`. It is 71 commits ahead of `main` and is not a reservations-only diff. Do not open or merge that branch into production. Do not merge PR #82.

## Why this branch exists

Reservation runtime on the long branch imports Ask NAC and inventory adapters that are not on `main`. Several of its commits also change catalogue and Foodics-read files. A pull request from that branch would mix those workstreams into the reservation review.

This branch adds only the database foundation. It does not copy the simulated host desk, does not change the guest menu, and does not write Foodics.

## Dependency sequence

1. Keep PR #82 and the catalogue/Foodics commits isolated.
2. Review and, only after approval, apply this migration to a non-production database.
3. Only after that database is accepted, connect the simulated host desk to these functions. Until then the desk remains browser-local and must be described as a simulation.
4. Hettin and the Laysen Valley label stay on the unmerged identity migration. This foundation rejects Hettin. Laysen Valley is not stored as a new branch id.

## What the migration does

It creates empty tables for layouts, layout versions, stable table ids, guests, reservations, waitlist entries, dining sessions, orders, joins, and audit events. Staff mutations go through security-definer functions that reuse `nac_menu_can_edit_branch`. Direct table writes are not granted. Anonymous access is revoked. Occupied tables cannot be renamed or retired. A stale revision returns `service_conflict`. An open session blocks cancellation. Moving a table keeps the order on the same session.

No historical guests, reservations, capacities, or Khobar coordinates are inserted.

## Rollback

On an isolated database that has never held production rows, the commented `DROP TABLE` list at the bottom of the migration removes only these new tables. Do not run it on production. There is no change to existing NAC tables, so leaving this migration unapplied is a complete production rollback.
