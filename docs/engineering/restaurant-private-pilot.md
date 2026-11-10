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

## 7.5 cost stop

No Supabase project was created. No Netlify project was created. Billing settings were not changed. Auto recharge is still on.

The production Supabase host, read from the `nac-os` production environment without printing the key, is `zeyhvjuraqnlbdycgrme.supabase.co`. The Supabase dashboard in this session is at the sign-in page. The saved CLI token returns 401. The organization plan and the number of free project slots are therefore not verified. A second schema inside that production database is not an acceptable shortcut.

Official Supabase billing, which is not this organization’s invoice:

- A Free organization may have two active projects at $0. Free projects pause after one week without activity. The two-project limit counts across every organization where the user is an owner or administrator. Paused projects do not count.
- Plans cannot be mixed in one organization. A paid organization cannot hold a Free project.
- Paid organizations cannot launch Nano compute. A new project is Micro or larger.
- Micro compute is $0.01344 per hour, about $10 per month. Paid plans include $10 of compute credit, which covers one Micro or Nano project. A second running project is extra compute. Compute credits do not cover the spend cap, and paused projects are not billed for compute.
- If the existing organization is Pro, the verified incremental charge for one isolated Micro project is about **$10 per month**, billed hourly, on top of the subscription already paid. The first project continues to consume the $10 credit.
- If the organization is Free and fewer than two projects are active, a second project is **$0** until it is paused or the quota is exceeded. That condition was not verified, so the project was not created.

Netlify does not need a new subscription for one private test site. The Pro team includes 500 projects and password protection. Creating the site is not a new plan. Publishing it on a production branch costs 15 credits. Branch deploys cost 0 credits. Because auto recharge is on, crossing 3,000 credits buys 1,500 more for $10 without another approval. Leave auto recharge unchanged until the owner turns it off for the test period.

## Prepared configuration, not applied

Set these only on the future private Netlify project. Do not set them on `nac-os` or `nacmenu`.

| Name | Where | Rule |
| --- | --- | --- |
| `RESTAURANT_DATABASE_URL` | Server only | Pooled URL for `nac_restaurant_api` on the isolated project. Not a `REACT_APP_` variable. |
| `SUPABASE_URL` | Server only | Isolated project URL. |
| `SUPABASE_ANON_KEY` | Server, and `REACT_APP_SUPABASE_ANON_KEY` for staff sign-in | Public anon key of the isolated project. Never the service-role key. |
| `REACT_APP_SUPABASE_URL` | Build of the private site | Isolated project URL. |
| `REACT_APP_PLATFORM_MODE` | Build of the private site | `admin`. |
| `REACT_APP_RESTAURANT_HOSTED` | Build of the private site | `1` only after the isolated database exists. |
| `REACT_APP_RESTAURANT_API` | Leave unset | The hosted build uses `/api/restaurant`. |

Hosted mode already refuses the development password. Staff role and branch come from `restaurant_staff_grants`. Do not insert `@nac.test` accounts. Create real Supabase users for the people who will test, then grant only the branch they may use.

Migration order on the empty project only, after owner approval:

1. The NAC branch helpers the restaurant SQL calls: `nac_normalize_branch_id` and `nac_auth_email`.
2. PR #83, in filename order, from `20261109183000` through `20261110133000`.
3. Do not run `scripts/local-restaurant/seed.sql`.
4. Leave `restaurant_owner_settings` empty. Missing rows mean Pilot Mode, Guest Ordering, and Guest Payments are off.
5. After a separate approval, the owner may set Pilot Mode on for one test branch. That call must not set the other two flags.

Access control:

- Netlify password protection on the private project.
- Supabase Auth session on every staff request.
- Row security and `restaurant_staff_grants` for branch scope.
- No Foodics or SevenRooms credentials on the project.

Rollback:

- Pause or delete the isolated Supabase project. Pausing stops compute charges.
- Delete the private Netlify project.
- Do not change `nac-os` or `nacmenu` environment variables.
- Do not merge PR #83, #84, or #85.

## Owner approval required before any provisioning

1. Sign in to Supabase and confirm whether a free project slot exists. If it does not, the isolated database is about $10 per month on Micro compute.
2. Turn off Netlify auto recharge for the test period, or accept that a credit overrun charges $10 automatically.
3. Approve creation of the empty project and the private Netlify site.
4. Approve Restaurant Pilot Mode for that isolated branch only, after the migration. Guest Ordering and Guest Payments stay off.
