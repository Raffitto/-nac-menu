# Hosted restaurant API

This is a development adapter. It is not a production release. Restaurant Pilot Mode, Guest Online Ordering, and Guest Payments stay off. Do not merge this branch to `main` until the owner approves a release. A merge to `main` publishes the NAC OS website.

## What runs where

The business rules stay in `scripts/local-restaurant/server.mjs`. `netlify/functions/restaurant.mjs` is a stateless wrapper. It does not start the localhost server and it does not open a server-sent-event stream.

Staff identity in hosted mode is the Supabase access token already used by NAC OS. The function calls Supabase Auth `/auth/v1/user` with the anon key, then reads `restaurant_staff_grants` for that email. The role and branch come from that table. A role or branch sent by the browser is not authority. A missing grant, a revoked grant, or a branch the person does not have returns a refusal.

The database connection is `RESTAURANT_DATABASE_URL`, a server-side connection string for the restricted `nac_restaurant_api` role through the Supabase pooler. It must not be a `REACT_APP_` variable. The anon key may be public. The database password and the service-role key must not be in the browser bundle.

Local development can still use the password session on `127.0.0.1`. That path is refused when `RESTAURANT_AUTH_MODE=supabase`. Production builds do not call `127.0.0.1` unless `REACT_APP_RESTAURANT_API` is set. Leave that unset. Set `REACT_APP_RESTAURANT_HOSTED=1` only on a non-production admin build when a hosted test is approved.

Screens poll every 2 seconds and refetch when the browser tab becomes visible. The hosted function answers `/events` with `realtime: "poll"` after the pilot gate. It does not hold a Postgres `LISTEN`.

## Gates

All three owner switches default off. A missing row, a missing table, or an API that cannot be reached means off. Staff operations for a branch whose pilot is off return `pilot_disabled`. Guest ordering routes stay `guest_ordering_disabled`. Payment capture stays `payment_not_authorized`.

## Required server environment

Set these in Netlify, not in the repository:

- `RESTAURANT_DATABASE_URL` — pooled Postgres URL for `nac_restaurant_api`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

If any one is missing, the function returns `service_unavailable` and does not report the pilot as on.

Apply PR #83 migrations only to an isolated database until a separate production migration is approved. Do not run `scripts/local-restaurant/seed.sql` against production. It contains synthetic staff.

## Limits and cost

Netlify synchronous functions on the current platform: 60 second timeout, 1024 MB memory, 6 MB buffered payload. This adapter returns after 20 seconds with `timeout` rather than holding the request. Use one pooled connection per warm instance (`max: 1`).

The screens poll every 2 seconds while open. One signed-in device is about 30 requests a minute. Ten devices are about 18,000 requests an hour, each doing a short read. That can consume included function invocations and database connections on the existing Netlify and Supabase plans. It is not a new subscription, and it is not free beyond those included quotas. Read the current invocation and connection limits in the Netlify and Supabase dashboards before a hosted test. Do not buy a larger plan for this step.

## Rollback

Unset `REACT_APP_RESTAURANT_HOSTED`. Remove or disable the `restaurant` function. Do not apply restaurant migrations to production. The public guest menu does not depend on the function while the ordering switch is off.

## Not done

The function has not been deployed. Production migrations have not been applied. Pilot Mode has not been enabled. Passkeys remain a localhost development option and are refused in hosted mode.
