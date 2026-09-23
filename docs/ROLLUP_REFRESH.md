# Menu events daily rollup — refresh path

After [security hardening](../supabase/security_hardening_2026_05_23.sql), **`refresh_menu_events_daily_rollup` is not callable with staff dashboard JWTs** (authenticated role). That is intentional: the function rewrites aggregated rows and must not be triggered from the browser.

## How dashboards still get data

| Range | Primary source | Freshness |
|--------|----------------|-----------|
| **Today** | `get_bi_dashboard_from_rollup` | Intraday job refreshes Riyadh today+yesterday every 15 minutes |
| **7D / Month** | `get_bi_dashboard_from_rollup` / `get_session_analytics_from_rollup` | Nightly 45-day rebuild + intraday Today slice |

Interactive NAC OS loads **must not** call raw `get_bi_dashboard` / scan `menu_events` (authenticated statement timeout = 8s). Stale rollup is shown as **stale**, never as a fabricated zero.

Session counts in the rollup are **distinct `session_id`s**, not raw event rows.

## Approved refresh methods

### 1. Intraday pg_cron (Today usefulness)

**Migration:** `supabase/migrations/20260924010000_intraday_menu_events_rollup_refresh.sql`

```sql
select public.refresh_menu_events_daily_rollup_intraday();
```

**Schedule:** every 15 minutes (`nac_refresh_menu_events_daily_rollup_intraday`). Rebuilds only the last two Riyadh calendar days so Today stays useful without a full 45-day rewrite on every tick.

### 2. Scheduled nightly pg_cron (7D / Month depth)

**File:** [supabase/rollup_refresh_cron.sql](../supabase/rollup_refresh_cron.sql)

1. Apply migrations in order:
   - `session_analytics_rollup.sql`
   - `security_hardening_2026_05_23.sql`
   - intraday migration above
2. In Supabase: **Database → Extensions → enable `pg_cron`** (Pro plan or higher).
3. Run `rollup_refresh_cron.sql` in the **SQL Editor** (if not already applied).

**Schedule:** every day at **03:15 Asia/Riyadh** (15 minutes after the NAC business-day boundary at 03:00).

```sql
select public.refresh_menu_events_daily_rollup(45);
```

Cron expression used: `15 0 * * *` (00:15 **UTC** = 03:15 Riyadh, UTC+3, no DST).

**Verify:**

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname in (
  'nac_refresh_menu_events_daily_rollup',
  'nac_refresh_menu_events_daily_rollup_intraday'
);
```

**Recent runs:**

```sql
select *
from cron.job_run_details
where jobid in (
  select jobid from cron.job
  where jobname like 'nac_refresh_menu_events_daily_rollup%'
)
order by start_time desc
limit 20;
```

### 3. Manual operator refresh (emergencies)

Use **Supabase SQL Editor** (postgres role) or a **server-side** script with the **service role** key:

```sql
select public.refresh_menu_events_daily_rollup_intraday();
-- or full window:
select public.refresh_menu_events_daily_rollup(45);
```

Returns the number of rollup rows inserted (bigint).

### 4. Not allowed

| Method | Why |
|--------|-----|
| React / `REACT_APP_SUPABASE_ANON_KEY` | Public anon JWT |
| Staff login in Analytics UI | `authenticated` — **revoked** by security hardening |
| Exposing `SUPABASE_SERVICE_ROLE_KEY` in Netlify | Full database bypass |
| Raising PostgreSQL `statement_timeout` | Masks the ledger-scan architecture bug |

## Related files

- [session_analytics_rollup.sql](../supabase/session_analytics_rollup.sql) — table + nightly refresh
- [20260924010000_intraday_menu_events_rollup_refresh.sql](../supabase/migrations/20260924010000_intraday_menu_events_rollup_refresh.sql) — intraday Today refresh
- [security_hardening_2026_05_23.sql](../supabase/security_hardening_2026_05_23.sql) — service_role-only execute
- [SECURITY_AUDIT.md](../SECURITY_AUDIT.md) — full security context
