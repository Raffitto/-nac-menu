# NAC OS 7.4 — private hosted pilot package

This is not a hosted pilot. No production site was deployed, no production environment variable was changed, and PR #83 was not applied to production. Restaurant Pilot Mode, Guest Online Ordering, and Guest Payments stay off.

## Verified account facts

Read from the Netlify account API on 10 November 2026 for team `raffiazarian2`:

- Plan: Pro, `credit-pro`, lifecycle `active`.
- Monthly credits: 3,000. The account field `credits.used` was 0. `usages_exceeded` was empty. The usage period started 2026-10-19 and the next period starts 2026-11-19.
- `member_monthly_dollar_price`: 20.
- Auto recharge is **on**. The account will buy 1,500 credits at $0.00667 each, which is $10, when monthly credits run out. This is the same pack price as the public Pro auto-recharge rate.
- Credit rollover is off. The public docs say rollover starts only at 5,000 monthly credits.
- Included projects: 500. Concurrent builds included: 3.
- `nac-os.netlify.app` and `nacmenu.netlify.app` are on this Pro team. `nac-khobar-reviews.netlify.app` is on the dev team plan.

The account API did not return a separate function-invocation cap. Functions are not priced as one credit per call.

## Official Netlify rates

From the Netlify credit-plan documentation, updated through the 14 April 2026 changelog:

| Meter | Rate |
| --- | --- |
| Functions compute | 10 credits per GB-hour. Default memory is 1 GB. |
| Web requests | 2 credits per 10,000 requests. This includes function calls. |
| Web bandwidth | 20 credits per GB. |
| Production deploy | 15 credits each. |
| Deploy previews and branch deploys | 0 credits. |

A 3,000-credit Pro plan does not roll unused credits into the next month. Exceeding the allotment with auto recharge on spends $10 per 1,500 extra credits without a separate purchase click.

## Supabase

The Supabase CLI did not return this account’s project list or plan. The NAC Supabase plan, current database size, connection count, and auth MAUs were **not verified**.

Official public quotas, which are not this project’s invoice:

- Free: 50,000 auth MAUs, 500 MB database, 200 realtime connections, 2 million realtime messages. Direct and pooler limits depend on compute size. Micro compute, which is a paid compute size, lists 60 direct and 200 pooler connections.
- Pro: from $25 per month, 100,000 MAUs, 8 GB disk, 250 GB egress, 500 realtime connections, 5 million realtime messages.

Do not create a second Supabase project until the owner confirms it will not add a paid compute charge.

## Estimated restaurant usage

These estimates use the verified Netlify rates and the measured local durations: 22 ms for a full snapshot and 4 ms for an unchanged revision. They assume 95 percent of polls are unchanged, so the average call is about 5 ms at 1 GB. Payload size is an assumption of 500 bytes per call and is marked as such.

A visible mixed device uses 693 calls an hour: 60 percent waiter or kitchen, 30 percent reception or cashier, 10 percent management. A hidden device does not poll. One service day is 12 hours.

| Devices | Calls per day | Web-request credits per day | Compute credits per day |
| --- | ---: | ---: | ---: |
| 3 | 24,948 | 5.0 | 0.3 |
| 5 | 41,580 | 8.3 | 0.6 |
| 10 | 83,160 | 16.6 | 1.2 |
| 20 | 166,320 | 33.3 | 2.3 |
| 40 | 332,640 | 66.5 | 4.6 |

Bandwidth at the assumed 500 bytes is about 0.4 credits per day for 10 devices. A 10-device pilot every day for 30 days is about 540 credits from requests, compute, and that bandwidth assumption. That is inside 3,000 credits. Web requests alone reach 3,000 credits at about 15 million requests, which is roughly 60 mixed devices every day for 30 days. Production deploys of the existing sites also spend 15 credits each and are separate from this table.

This estimate is not a measured hosted bill. `/health` now returns process-local counts for requests, unchanged reads, snapshots, errors, auth failures, and total duration. Those counts reset when the function cold-starts and contain no guest data. The Netlify usage page is the bill.

## Isolation

A separate schema on the production database is not sufficient. The hosted function must use a different Postgres role and a connection string that cannot read production guest or sales tables.

The safe shape, which was not created:

1. A new Supabase project, or a database the owner confirms is empty and not the production project.
2. Apply PR #83 there, then the owner-control and pilot migrations. Do not run `seed.sql` if it would be mistaken for production, and do not copy real guest rows.
3. Create `nac_restaurant_api` with no bypass of row security.
4. A new Netlify project, not `nac-os` or `nacmenu`, with password protection. Set `RESTAURANT_DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` only on that project.
5. Set `REACT_APP_RESTAURANT_HOSTED=1` only on that project’s admin build.
6. Leave production environment variables unchanged.
7. Leave Pilot Mode, Guest Ordering, and Guest Payments off until the owner turns the pilot on for one test branch.

Deploy previews of the existing production sites were not used. They would still be deploys of those sites.

## What remains an owner decision

- Confirm the Supabase organization plan and whether a second project is free.
- Confirm auto recharge should stay on. It can charge $10 without another approval once 3,000 credits are spent.
- Approve the new project and the isolated migration.
- Approve turning Restaurant Pilot Mode on for the test branch only.
