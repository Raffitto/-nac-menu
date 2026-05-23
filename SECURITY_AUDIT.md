# NAC Hospitality OS — Security Audit

**Audit date:** 2026-05-23  
**Scope:** Frontend (`src/`), Supabase SQL (`supabase/`), Netlify deploy config  
**Method:** Static review of client Supabase usage, env exposure, RLS/RPC definitions in repo SQL (production DB may differ if migrations were applied out of order).

---

## Executive summary

| Item | Assessment |
|------|------------|
| **Overall risk level** | **Medium** (acceptable for a staff-gated SPA + public menu/review inserts, with gaps to close) |
| **Service role in frontend** | **Not found** in source, build artifacts searched, or Netlify config |
| **Anon key exposure** | **Expected** — `REACT_APP_SUPABASE_URL` + `REACT_APP_SUPABASE_ANON_KEY` are public by design |
| **Critical gap** | `menu_events_daily_rollup` has **no RLS/revoke** in repo SQL; may be readable if broad grants exist |
| **High gap** | Several BI RPCs missing `REVOKE … FROM PUBLIC` (only `GRANT TO authenticated`) |
| **Public competition data** | `/leaderboard` queries `review_events` **without auth** — fails closed if RLS is correct, but is a footgun |
| **Staff directory** | `review_portal_staff` is **anon-readable** (active rows) — required for review QR, exposes names/roles |

---

## 1. Service role key

| Check | Result |
|-------|--------|
| `service_role` in `src/` | **None** |
| `.env` / `.env.local` in repo | **None committed** (correct) |
| `netlify.toml` | Only `NODE_VERSION` / `NPM_FLAGS` — **no Supabase secrets** |
| Build output | Only anon URL/key variable names embedded; **no service JWT** |
| SQL | `grant all on review_events to service_role` — **server-side only**, normal |

**Verdict:** Frontend uses **anon + Supabase Auth session** only. Keep `SUPABASE_SERVICE_ROLE_KEY` in Supabase dashboard / CI secrets only, never `REACT_APP_*`.

---

## 2. Public anon role — intended capabilities

### Should allow (current design)

| Table | Anon | Notes |
|-------|------|--------|
| `menu_events` | **INSERT** | Guest menu tracking (`src/lib/analytics.js`) |
| `review_events` | **INSERT** | Review QR funnel (`src/lib/reviewAnalytics.js`) |
| `review_session_links` | **INSERT** | Session attribution |
| Menu CMS tables | **SELECT** active/visible rows | Public menu (`menu_editor_rls_fix.sql`, `menu_schema.sql`) |
| `review_portal_staff` | **SELECT** `active = true` | Review portal staff picker |
| `google_review_snapshots` | **SELECT** | Public rating strip (aggregate marketing data) |

### Must not allow (target state)

| Table | Anon must NOT |
|-------|----------------|
| `menu_events` | SELECT / UPDATE / DELETE |
| `review_events` | SELECT / UPDATE / DELETE |
| `foodics_*` / `menu_item_name_map` | Any access |
| `daily_branch_snapshots` | Any access |
| `menu_events_daily_rollup` | Any direct access |
| Raw waiter/sales lines | Any access |

**Repo policies (when applied):**

- `analytics_dashboard_setup.sql`: `menu_events` — insert `anon, authenticated`; select **`authenticated` only**.
- `review_events_rls_fix.sql`: insert `anon, authenticated`; select **`authenticated` only**.
- `foodics_import_schema.sql`: **`revoke all from anon`** on Foodics tables; authenticated-only policies.

**Gap:** No `ALTER TABLE menu_events ENABLE ROW LEVEL SECURITY` in repo — assumes table was created with RLS in Supabase. **Verify in dashboard** that RLS is ON; without it, grants alone are insufficient.

**Gap:** `menu_events` has **no `REVOKE SELECT FROM anon`** statement — rely on RLS. Add explicit revoke for defense in depth.

---

## 3. Authenticated dashboard — BI / RPC reads

| Path | Auth gate | Data path |
|------|-----------|-----------|
| Menu Intelligence / Visual OS | `useMenuBiDashboard` → `getSession()` | `fetchBiDashboard` → RPCs |
| Restaurant Intelligence / Admin overview | `getSession()` | `fetchBiDashboard` / RPC |
| Session Analytics | Login form in `AnalyticsDashboard.jsx` | `fetchSessionAnalytics` → RPC |
| Foodics imports | `getSession()` in `FoodicsIntelligence.jsx` | Direct table CRUD (authenticated RLS) |
| Menu Manager | `MenuEditorAuth` | Direct CMS tables (authenticated) |

**RPCs** (`get_bi_dashboard`, `get_session_analytics`, `get_review_events_summary`, etc.):

- `SECURITY DEFINER` + `SET search_path = public` — **good** (all reviewed SQL files).
- `get_bi_dashboard` / `get_dashboard_aggregates` / `get_live_activity`: **`REVOKE FROM PUBLIC` + `GRANT TO authenticated`** — good.

**Gaps:**

- `intelligence_query_optimization.sql`: `get_bi_dashboard_from_rollup`, `get_branch_comparison_from_rollup`, `get_review_events_summary` — **`GRANT TO authenticated` only**, no explicit `REVOKE FROM PUBLIC`. Default Supabase often allows `PUBLIC` execute until revoked → **verify** and revoke.
- `refresh_menu_events_daily_rollup` granted to **`authenticated`** — any logged-in staff can trigger heavy refresh (DoS/cost). Prefer **service_role cron** or restricted DB role.

**Client fallback:** `menuEventsBiFallback.js` runs `SELECT` on `menu_events` — only works with **authenticated** JWT; anon correctly gets empty/errors.

---

## 4. SECURITY DEFINER RPCs — search_path & fields

| Function | `search_path` | Returns |
|----------|---------------|---------|
| `get_bi_dashboard` | `public` | Aggregates / top items (no raw PII beyond item names) |
| `get_bi_dashboard_from_rollup` | `public` | Aggregates only (item arrays empty by design) |
| `get_session_analytics*` | `public` | Aggregates + bounded feed via `get_session_analytics_feed` |
| `get_review_intelligence` | `public` | Staff aggregates |
| `get_review_events_summary` | `public` | Aggregates |
| `get_live_activity` | `public` | Recent rows (authenticated-only execute) |

**Risks:**

- Definer functions bypass RLS on underlying tables — acceptable if execute is **authenticated-only** and outputs are aggregated.
- `get_session_analytics_feed` returns recent event rows — ensure execute is not granted to `anon`.
- Staff names appear in review aggregates (operational need for dashboard).

---

## 5. Foodics / import tables

**Schema:** `foodics_import_schema.sql`, `foodics_name_mapping.sql`

- RLS: `for all to authenticated` only.
- `REVOKE ALL … FROM anon` on batches, sales items, name maps.

**Frontend:** `src/lib/foodicsApi.js` — all access via `supabase.from("foodics_*")` with staff session (no separate guard; fails under anon).

**Verdict:** **Correct by design** if migrations applied. Anon cannot read sales/waiter imports.

---

## 6. Staff / review competition exposure

| Surface | Exposure | Risk |
|---------|----------|------|
| Review QR / portal | Inserts `review_events` with `employee_name` | Intended |
| `review_portal_staff` anon SELECT | Active staff names, roles, `url_slug`, `qr_metadata` | **Low–medium** — needed for QR routing; scrapeable |
| `/leaderboard` (`LeaderboardView.jsx`) | **Direct `review_events` SELECT**, no login | **High if RLS misconfigured**; **fail-safe** if only authenticated SELECT |
| `LiveActivityFeed` | Direct `menu_events` + `review_events` SELECT | Requires auth session on admin routes |
| BI RPCs | Aggregated staff leaderboards | Authenticated only |

**`google_review_snapshots`:** anon read — branch ratings/counts only, not per-waiter.

---

## 7. Unauthenticated client behavior

| Component | Without session |
|-----------|-----------------|
| Public menu (`App.js`) | Inserts `menu_events` only |
| Review portal | Inserts `review_events`; reads `review_portal_staff` |
| Dashboard / Intelligence | Empty states / login prompts (`needsAuth`) |
| `fetchBiDashboard` RPC | PostgREST **401/permission denied** if execute revoked from anon |
| `menuEventsBiFallback` | Count/query returns **0 / error** — no silent leak |
| Foodics APIs | RLS denial |
| Leaderboard | Query likely **empty** (anon cannot SELECT `review_events`) |

**Verdict:** Generally **fails safe** when RLS + RPC grants match repo SQL. Weak spots: missing `REVOKE FROM PUBLIC` on RPCs, rollup table grants, legacy `GRANT SELECT ON ALL TABLES TO anon` from `menu_schema.sql` if ever run on production after adding sensitive tables.

---

## 8. RLS checklist (apply / verify in Supabase)

### `menu_events`

```sql
ALTER TABLE public.menu_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_events FROM anon;
GRANT INSERT ON public.menu_events TO anon;
GRANT SELECT, INSERT ON public.menu_events TO authenticated;
-- policies: anon/authenticated INSERT; authenticated SELECT only (see analytics_dashboard_setup.sql)
```

### `review_events`

```sql
-- review_events_rls_fix.sql: anon INSERT, authenticated SELECT
REVOKE SELECT ON public.review_events FROM anon;
```

### `review_session_links`

Anon insert, authenticated select (`unified_restaurant_intelligence.sql`) — OK.

### Foodics / import tables

Already: RLS + revoke anon (`foodics_import_schema.sql`). Re-run if unsure.

### `menu_events_daily_rollup` (**recommended — missing in repo**)

```sql
ALTER TABLE public.menu_events_daily_rollup ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.menu_events_daily_rollup FROM anon, authenticated;
-- No direct policies: only SECURITY DEFINER RPCs read this table
```

### Staff / waiter tables

- `review_portal_staff`: consider narrowing anon policy to columns needed by review portal, or serve via RPC `get_review_staff_for_branch(branch)` returning only `employee_name`, `url_slug`.
- No dedicated `waiters` table in repo — waiter metrics come from Foodics imports (authenticated).

### Rollup refresh

```sql
REVOKE EXECUTE ON FUNCTION public.refresh_menu_events_daily_rollup(int) FROM authenticated;
-- Run via pg_cron / Edge Function with service_role only
```

### BI RPCs (batch hardening)

```sql
REVOKE ALL ON FUNCTION public.get_bi_dashboard_from_rollup(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_branch_comparison_from_rollup(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_review_events_summary(text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_analytics_from_rollup(text, int, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_analytics_feed(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.refresh_menu_events_daily_rollup(int) FROM PUBLIC;
-- Then GRANT EXECUTE ... TO authenticated only where appropriate
```

### Optional: tighten anon inserts

```sql
-- Example: menu_events insert only for known event types
ALTER POLICY menu_events_insert_anon_authenticated ON public.menu_events
  WITH CHECK (
    event_type IN (
      'qr_session_start','category_open','item_open','item_impression',
      'item_impression_end','add_on_click','language_change','search_used',
      'search_submit','time_spent','page_view','section_open','menu_tab_open',
      'add_on_open','allergy_modal_open','menu_exit','external_link_click'
    )
  );
```

---

## 9. Exposed frontend keys (public env)

| Variable | Exposure | Sensitivity |
|----------|----------|-------------|
| `REACT_APP_SUPABASE_URL` | Bundled | Public |
| `REACT_APP_SUPABASE_ANON_KEY` | Bundled | Public (JWT with anon role) |
| `REACT_APP_NAC_BRANCH_ID` | Bundled | Low |
| `REACT_APP_GOOGLE_API_KEY` | Bundled if set | **Restrict by HTTP referrer / IP in Google Cloud** |
| `REACT_APP_SHOW_BI_FALLBACK_BANNER` | Bundled | Low |
| `REACT_APP_MENU_DEBUG` | Bundled | Low |

**Netlify:** Set secrets in UI only; never commit. No service role in `[build.environment]`.

---

## 10. Public tables / routes (product surface)

| Route / surface | DB access |
|-----------------|-----------|
| `/` (menu) | CMS SELECT; `menu_events` INSERT |
| Review QR host | `review_events` INSERT; `review_portal_staff` SELECT |
| `/leaderboard` | Attempts `review_events` SELECT (should fail for anon) |
| Admin / Intelligence | Auth required for aggregates |

---

## 11. Logging / production hygiene

| Location | Issue |
|----------|--------|
| `reviewAnalytics.js` | Unconditional `console.log` on module load and every insert — **verbose in production** |
| `nacBoot.js` | Boot log always |
| `reviewPortalParams.js` | URL param logging |
| `supabase.js` | Gated to `development` ✓ |
| `devLog.js` / BI pipeline | Gated to `development` ✓ |

Recommend: gate review portal logs behind `NODE_ENV === 'development'` in a follow-up (no UX impact).

---

## 12. Remaining risks (prioritized)

1. **Rollup table without RLS** — potential leak of aggregated operational metrics to any role with table SELECT.
2. **RPC execute grants to PUBLIC** — anon might call definer functions if not revoked (depends on DB state).
3. **`refresh_menu_events_daily_rollup` callable by any authenticated user** — abuse / cost.
4. **`review_portal_staff` anon enumeration** — staff names/slugs scrapable (business acceptance).
5. **`/leaderboard` without auth** — safe only if RLS strict; otherwise full `review_events` leak.
6. **Anon insert `WITH CHECK (true)`** — spam/fake events possible; mitigate with rate limits (Supabase/Edge) or stricter checks.
7. **Legacy `menu_schema.sql` blanket `GRANT SELECT ON ALL TABLES TO anon`** — do not re-run on prod; audit live grants.
8. **Google API key in client** — restrict in Google Cloud Console.
9. **Authenticated staff share one broad RLS** (`using (true)`) — any compromised staff login sees all branches/events; consider branch-scoped policies if multi-tenant isolation is required.

---

## 13. Code ↔ policy alignment (quick reference)

| Client module | Tables / RPC | Expected role |
|---------------|--------------|---------------|
| `analytics.js` | `menu_events` INSERT | anon (guest menu) |
| `reviewAnalytics.js` | `review_events` INSERT | anon (review QR) |
| `intelligenceQueryApi.js` | BI RPCs | authenticated |
| `menuEventsBiFallback.js` | `menu_events` SELECT | authenticated |
| `foodicsApi.js` | `foodics_*` | authenticated |
| `menuApi.js` | CMS + storage | anon read / auth write |
| `LeaderboardView.jsx` | `review_events` SELECT | **Should be authenticated or RPC** |

---

## 14. Sign-off actions

- [ ] Confirm RLS enabled on `menu_events`, `review_events`, `menu_events_daily_rollup` in Supabase dashboard.
- [ ] Apply rollup RLS + revoke block (§8).
- [ ] Run RPC `REVOKE FROM PUBLIC` batch (§8).
- [ ] Confirm anon cannot `SELECT` from `menu_events` / `review_events` (SQL editor test as anon).
- [ ] Restrict Google Maps API key.
- [ ] Move `refresh_menu_events_daily_rollup` to scheduled service_role job.
- [ ] Decide policy for `/leaderboard` (public RPC aggregates vs staff-only).

---

*This document reflects the repository state at audit time. Re-run review after applying SQL hardening or adding new tables/RPCs.*
