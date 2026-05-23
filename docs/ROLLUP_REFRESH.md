# Menu events daily rollup — refresh path

After [security hardening](../supabase/security_hardening_2026_05_23.sql), **`refresh_menu_events_daily_rollup` is not callable with staff dashboard JWTs** (authenticated role). That is intentional: the function rewrites aggregated rows and must not be triggered from the browser.

## How dashboards still get data

| Range | Primary source | If rollup is stale |
|--------|----------------|---------------------|
| **Today** | `get_bi_dashboard` (live `menu_events`) | Client fallback reads `menu_events` (authenticated) |
| **7D / Month** | `get_bi_dashboard_from_rollup` / `get_session_analytics_from_rollup` | Falls back to `get_bi_dashboard` or client aggregation |

Rollup refresh keeps **7D** and **This Month** fast. **Today** does not depend on the rollup.

## Approved refresh methods

### 1. Scheduled pg_cron (preferred)

**File:** [supabase/rollup_refresh_cron.sql](../supabase/rollup_refresh_cron.sql)

1. Apply migrations in order:
   - `session_analytics_rollup.sql`
   - `security_hardening_2026_05_23.sql`
2. In Supabase: **Database → Extensions → enable `pg_cron`** (Pro plan or higher).
3. Run `rollup_refresh_cron.sql` in the **SQL Editor**.

**Schedule:** every day at **03:15 Asia/Riyadh** (15 minutes after the NAC business-day boundary at 03:00).

```sql
select public.refresh_menu_events_daily_rollup(45);
```

Cron expression used: `15 0 * * *` (00:15 **UTC** = 03:15 Riyadh, UTC+3, no DST).

**Verify:**

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'nac_refresh_menu_events_daily_rollup';
```

**Recent runs:**

```sql
select *
from cron.job_run_details
where jobid = (
  select jobid from cron.job
  where jobname = 'nac_refresh_menu_events_daily_rollup'
)
order by start_time desc
limit 10;
```

### 2. Manual operator refresh (emergencies)

Use **Supabase SQL Editor** (postgres role) or a **server-side** script with the **service role** key:

```sql
select public.refresh_menu_events_daily_rollup(45);
```

Returns the number of rollup rows inserted (bigint).

Use after large backfills, before an executive review, or if 7D/Month show the partial-mode note about stale rollup.

### 3. Not allowed

| Method | Why |
|--------|-----|
| React / `REACT_APP_SUPABASE_ANON_KEY` | Public anon JWT |
| Staff login in Analytics UI | `authenticated` — **revoked** by security hardening |
| Exposing `SUPABASE_SERVICE_ROLE_KEY` in Netlify | Full database bypass |

## Edge Function alternative (optional)

If pg_cron is unavailable on your plan, you can add a Supabase Edge Function that:

1. Reads `SUPABASE_SERVICE_ROLE_KEY` from **Edge secrets only**.
2. Calls `refresh_menu_events_daily_rollup(45)` via RPC.
3. Is invoked only by a shared admin secret header or Supabase Auth custom claim — **not** from the public menu app.

The repo does not ship this function; pg_cron is the default path.

## Operational checklist

- [ ] `pg_cron` extension enabled
- [ ] Job `nac_refresh_menu_events_daily_rollup` active (`cron.job`)
- [ ] Last `cron.job_run_details` run succeeded
- [ ] `select count(*) from menu_events_daily_rollup` > 0 for recent `day_key`
- [ ] Dashboard **7D** / **This Month** show non-zero sessions when `menu_events` has data
- [ ] Staff **cannot** run `select refresh_menu_events_daily_rollup(1)` while signed in (permission denied)

## Guest menu inserts (not rollup)

If Restaurant Intelligence shows **0** after security hardening, run [menu_events_insert_restore.sql](../supabase/menu_events_insert_restore.sql) and deploy the frontend fix (`returning: 'minimal'` + anon tracking client). See [menu_events_insert_restore.sql](../supabase/menu_events_insert_restore.sql).

## Related files

- [session_analytics_rollup.sql](../supabase/session_analytics_rollup.sql) — table + function definition
- [security_hardening_2026_05_23.sql](../supabase/security_hardening_2026_05_23.sql) — service_role-only execute
- [menu_events_insert_restore.sql](../supabase/menu_events_insert_restore.sql) — restore anon INSERT after hardening
- [SECURITY_AUDIT.md](../SECURITY_AUDIT.md) — full security context
