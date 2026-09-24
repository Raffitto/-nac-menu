# NAC OS systemic performance — baseline load profile (pre-fix)

Captured from production architecture + code instrumentation paths on lineage `main` @ PR #12 (`f827a3c`), before active-only shell unmount.

## Architecture-derived amplification (one full nav cycle)

Sequence: Overview → Intelligence → Reviews → Reports → Menu → Food Bible → Branches → Overview

| REQUEST/RPC | CALLER PAGE | ACTIVE/HIDDEN | COUNT (est.) | LATENCY class | RESULT | TABLE/DEPENDENCY |
|---|---|---|---|---|---|---|
| `get_bi_dashboard_from_rollup` / unified truth | Overview | stays mounted after leave | 1+ on filter change while hidden | usually <2s; can stale | success/stale | `menu_events_daily_rollup` |
| `get_session_analytics_from_rollup` | Overview (unified) | same | 1+ | <2s | success | rollup |
| `get_review_events_summary` | Overview enrichment | same | 1+ | can approach 8s | timeout→partial | `review_events` |
| `get_session_analytics_feed` | Overview enrichment | same | 1+ | can approach 8s | timeout→[] **fake empty** | `menu_events` |
| `get_live_activity` poll 5s | Overview | **continues while hidden** | dozens over cycle | usually fast | success or silent fail→**0** | live RPC |
| `get_bi_dashboard_from_rollup` | Intelligence (MenuBi provider) | **refetches on filter while hidden** | 1+ per filter | <2s | success | rollup |
| review intelligence RPCs | Reviews | stays mounted | 1+ | can 57014 | timeout | `review_events` |
| LiveActivityFeed poll 8s + realtime | Reviews (if Live tab) | **continues while hidden** | continuous | varies | inserts wake feed | `menu_events` / `review_events` |
| ExportCenter refresh | Reports | stays mounted | 1+ | varies | success | cash-up / foodics files |
| MenuManager init fan-out | Menu | stays mounted | many one-shots | varies | success | `menu_items` etc. |
| Food Bible overview | Food Bible | stays mounted | 1+ | varies | success | inventory / recipes |
| `get_branch_comparison_from_rollup` + review summary | Branches | stays mounted | 1+ | <2s / can timeout | catch→**empty zeros** | rollup / reviews |
| Ask NAC verified metrics (Edge) | Intelligence Ask | on question | 1–2 | **raw Today `get_bi_dashboard` risk** | 57014 | `menu_events` |

### Amplification summary (pre-fix)

- **Visited views remain mounted** (`useKeepAliveNav` + `hidden` panes).
- **Shared PlatformFilters** re-wake every mounted hub.
- **Pollers** (`get_live_activity` 5s, Reviews Live 8s) continue after leave.
- **One complete cycle** easily produces **tens of analytics RPCs**, with **duplicates** across Overview + Intelligence BI providers and **DB-heavy** feed/review paths that hit the **8s** timeout (57014).
- Individual RPC unit tests can pass while the app fails under navigation concurrency.

This baseline is the architectural before-profile. Signed-in HAR capture requires `SUPABASE_STAFF_EMAIL` / `SUPABASE_STAFF_PASSWORD` (requested).
