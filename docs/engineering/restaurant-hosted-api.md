# Hosted restaurant API

This is a development adapter. It is not a production release. Restaurant Pilot Mode, Guest Online Ordering, and Guest Payments stay off. Do not merge this branch to `main` until the owner approves a release. A merge to `main` publishes the NAC OS website.

## What runs where

The business rules stay in `scripts/local-restaurant/server.mjs`. `netlify/functions/restaurant.mjs` is a stateless wrapper. It does not start the localhost server and it does not open a server-sent-event stream.

Staff identity in hosted mode is the Supabase access token already used by NAC OS. The function calls Supabase Auth `/auth/v1/user` with the anon key, then reads `restaurant_staff_grants` for that email. The role and branch come from that table. A role or branch sent by the browser is not authority. A missing grant, a revoked grant, or a branch the person does not have returns a refusal.

The database connection is `RESTAURANT_DATABASE_URL`, a server-side connection string for the restricted `nac_restaurant_api` role through the Supabase pooler. It must not be a `REACT_APP_` variable. The anon key may be public. The database password and the service-role key must not be in the browser bundle.

Local development can still use the password session on `127.0.0.1`. That path is refused when `RESTAURANT_AUTH_MODE=supabase`. Production builds do not call `127.0.0.1` unless `REACT_APP_RESTAURANT_API` is set. Leave that unset. Set `REACT_APP_RESTAURANT_HOSTED=1` only on a non-production admin build when a hosted test is approved.

A visible waiter or kitchen screen polls every 4 seconds. Reception and cashier poll every 8 seconds. Management polls every 20 seconds. A hidden tab or a locked phone does not poll. Unlocking the phone, returning to the tab, or reconnecting the network refreshes immediately. A poll that finds the same audit revision does not replace the screen data. The worst case before a visible screen shows another station's change is one interval plus the request time. On the isolated local database a full state read took 22 ms, including 14 ms to build the snapshot. The same revision returned in 4 ms and did not replace the screen. A waiter therefore sees a kitchen change within about 4 seconds. The hosted function answers `/events` with `realtime: "poll"` after the pilot gate. It does not hold a Postgres `LISTEN`.

Supabase Realtime is already part of the current Supabase project. It is not a separate product, and this change does not enable it for restaurant tables. A direct browser subscription would skip the API snapshot that removes guest phone numbers from the kitchen view, and it would not apply the pilot gate. Polling stays the hosted path until a reviewed publication and a phone-safe view exist.

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

These counts assume a visible screen for a 12-hour service and the new intervals. A hidden device adds no polls. A realistic mix is 60 percent waiter or kitchen (900 calls an hour), 30 percent reception or cashier (450), and 10 percent management (180). That is 693 calls an hour per active device.

| Active visible devices | Calls per hour | Calls per 12-hour service |
| --- | ---: | ---: |
| 5 | 3,465 | 41,580 |
| 10 | 6,930 | 83,160 |
| 20 | 13,860 | 166,320 |
| 40 | 27,720 | 332,640 |

If every device is a waiter, use 900 calls an hour each: 4,500, 9,000, 18,000, and 36,000 an hour. The previous 2-second poll was 1,800 an hour per device. An unchanged revision still invokes the function, and the response is a small JSON object instead of the full floor. This uses the existing Netlify and Supabase plans. It is not a new subscription, and it is not free beyond the included quotas. Verified account quotas are listed separately when the dashboards can be read.

## Rollback

Unset `REACT_APP_RESTAURANT_HOSTED`. Remove or disable the `restaurant` function. Do not apply restaurant migrations to production. The public guest menu does not depend on the function while the ordering switch is off.

## Not done

The function has not been deployed. Production migrations have not been applied. Pilot Mode has not been enabled. Passkeys remain a localhost development option and are refused in hosted mode.
