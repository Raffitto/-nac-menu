# Local restaurant service checkpoint

This integration branch is cut from `origin/main` `fba256f2`. It does not vendor the restaurant schema. Apply PR #83 first. `scripts/local-restaurant/migrate.sh` reads that SQL from `LOCAL_RESTAURANT_MIGRATIONS` and does not run on API startup.



Development only. This does not authorize a production deploy or a production migration.

## Migration order

Apply these files, in order, to an empty local database first, then the later files on the existing development database. `scripts/local-restaurant/migrate.sh` reapplies only the files from `20261109210000` onward. Do not replay `20261109183000` or `20261109193000` onto the database that is already serving the desk.

1. `20261109183000_restaurant_service_foundation.sql`
2. `20261109193000_restaurant_service_permissions.sql`
3. `20261109201000_restaurant_service_turnover.sql`
4. `20261109210000_restaurant_order_modifiers.sql`
5. `20261109211000_restaurant_dev_access.sql`
6. `20261109220000_restaurant_bill_adjustments.sql`
7. `20261109223000_restaurant_unpaid_checks.sql`
8. `20261109224000_restaurant_kitchen_items.sql`
9. `20261109225000_restaurant_waitlist_visits.sql`
10. `20261109230000_restaurant_passkeys.sql`
11. `20261109231000_restaurant_guest_access.sql`
12. `20261110120000_restaurant_owner_controls.sql` — guest ordering and guest payments, both default off. A missing row is off. Only the owner emails in the NAC directory can change them. Hettin is rejected. Laysen Valley uses `riyadh`.
13. `20261110133000_restaurant_pilot_mode.sql` — Restaurant Pilot Mode, default off. A separate function changes only that flag. It does not turn guest ordering or guest payments on.

The same SQL is on `feature/nac-reservations-persistence`, PR #83, unmerged. The API does not create schema on startup.

## Event contract

Before a staff transaction commits, the API sends `pg_notify('restaurant_service', json)`. The payload is `{ id, branchId, revision }`. `GET /events` writes that payload only to a session for the same branch. A duplicate event refetches state. It does not create an order.

## Permissions

`restaurant_can` grants `guest_contact`, `service_write`, `kitchen_read`, `bill_read`, and `layout_write` by role and branch. Discounts and voids require a manager or administrator grant. A cashier can split an open bill. Passwords and passkeys both require a grant whose `revoked_at` is null. Setting `revoked_at` makes the current session fail on the next request.

## Rollback

Stop the local API. Do not drop the shared development tables to undo one feature. Each later migration file names its own drop statements in the header comment. Restoring the previous API commit and leaving the new columns in place is the safe rollback. Passkey rows and request logs can be ignored by the older API.

## Verification

`node scripts/local-restaurant/journey.mjs` runs the local journey. `CI=true npx react-scripts test --watchAll=false --runInBand --forceExit --testPathPattern=src/restaurant/` runs the restaurant unit tests.
