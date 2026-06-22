# Operational Dashboard Integrity Audit — 23 June 2026

## Scope

Traced Operational Dashboard metrics from `OperationalDashboard.jsx` through hooks, enrichment, integrity layers, and Supabase RPCs.

Primary loader chain:

`useOperationalDashboard` → `useMenuBiDashboard` → `fetchUnifiedOperationalTruth` → `fetchUnifiedOperationalAnalytics` + `fetchReviewEventsSummary` → `mergeReviewIntoOperationalPayload` → `applyOperationalIntegrityToPayload`

---

## Metric Audit Table

| Metric | Source table / RPC | Query path | Aggregation | Issue found | Fix applied | Remaining risk | Confidence |
|--------|-------------------|------------|-------------|-------------|-------------|----------------|------------|
| Menu QR Scans | `menu_events` · `qr_session_start` | `get_bi_dashboard` (24h) / `get_bi_dashboard_from_rollup` (7D/MTD) + session master merge | Distinct sessions | Same value across Today/7D/MTD possible when traffic is genuinely flat or rollup sparse | Stale UI on period switch cleared | Low-traffic branches may still show identical small counts across ranges — verify against raw `menu_events` | High |
| Sessions | Same as Menu QR | `resolveCanonicalMenuSessions` | Canonical session model | Intentionally equals Menu QR | None needed | Users may confuse menu sessions with POS guest count | High |
| Review QR Scans | `review_events` | `get_review_events_summary` | Event count | Partial fallback (today-only) not surfaced on 7D/MTD | Surface `_partial` note in dashboard | Review RPC timeout still degrades to today-only data | Medium |
| Google Redirects | `review_events` · `google_redirects` | `operationalDashboardEnrich.reviewCountsFromSummary` | Event count | **Values swapped with review_page_opens** — caused impossible funnel % (e.g. 2295 redirects vs 12 menu QR → 100%) | **Fixed mapping** | Staff attribution still requires employee fields on events | High |
| Review page opens | `review_events` · `review_page_opens` | Same enrich path | Event count | Was labeled "Google review page open" with wrong value | **Fixed mapping + label** | Label semantics still differ from Google Redirects — now explicit | High |
| Category Opens | BI funnel `category_opens` | `get_bi_dashboard[_from_rollup]` | Session-scoped | Rollup uses daily sum approximation | Existing monotonic clamp + hybrid MTD merge | Rollup distinct-session approximation on 7D/MTD | Medium |
| Item Opens | BI funnel `item_opens` | Same | Session-scoped | None | None | Same rollup approximation risk | Medium |
| Add-on Interactions | BI funnel `addon_clicks` vs `by_event_type` | Funnel + event counts | Mixed session vs raw events | **Engagement widget used event counts while funnel used sessions** → 0 vs 16 contradiction | **Use `funnel.addon_clicks` first** | Top add-on pairs table still event-based (by design) | High |
| Funnel step % | Client `operationalMetricsIntegrity.mapStageMetrics` | Post-merge | Step / menu-QR denominators | Impossible 100% from swapped review values | Fixed upstream mapping | Review step 1 still uses menu QR denominator (documented) | High |
| Review conversion % | `review_kpis.review_conversion_pct` from RPC | `get_review_events_summary` | `google_redirects / review qr_scans` | Was displayed against wrong executive card values | Fixed card values | RPC timeout partial not in conversion % | Medium |
| Active Guests | `menu_events` live window | `get_live_activity()` | Last 5 min distinct sessions | **Ignores branch and period filters** | Not changed (live-only by design) | Network-wide count shown regardless of branch filter | Low |
| Recent Activity | `menu_events` rollup/live | `get_session_analytics_feed(p_hours)` | Period + branch filtered | Loads after menu BI — secondary loading phase | Enrichment cleared on period change | Feed may lag menu cards briefly | Medium |
| Today / 7D / MTD | `PlatformFiltersContext` → `p_hours` 24/168/999 | `nac_filter_since` business-day windows | Range-specific RPC routing | **Stale prior-period metrics visible during fetch** | **Clear `data` on range key change** | MTD hybrid merge complexity remains | High |
| Scan chart | `by_hour_qr` | `resolveScanChartBuckets` | QR events only | Empty on rollup without QR buckets | Existing empty-state message | Chart may be empty on 7D/MTD | Medium |
| Language % | `lang_behavior.sessions` | Session language resolver | First session language | None | None | Fallback to `by_language` if lang_behavior empty | High |

---

## Root Causes (Priority)

1. **Review funnel value swap** — `review_redirect` stored `review_page_opens` while UI labeled it "Google Redirects". Produced mathematically impossible conversion rates.
2. **Add-on denominator mismatch** — engagement section divided raw `by_event_type` clicks by session-based `funnel.item_opens`.
3. **Stale dashboard state** — `useMenuBiDashboard` kept prior `data` while `loading=true` on period switch.
4. **Silent review partial fallback** — `fetchReviewEventsSummary` returns today-only on timeout without surfacing on ops dashboard.

---

## Files changed (dashboard)

- `src/lib/operationalDashboardEnrich.js` — correct Google Redirects / review page open mapping
- `src/lib/operationalDashboardEnrich.test.js`
- `src/lib/operationalMetricsIntegrity.js` — review funnel label
- `src/dashboard/hooks/useMenuBiDashboard.js` — clear data on range change
- `src/dashboard/hooks/useOperationalDashboard.js` — clear enrichment; surface review partial
- `src/dashboard/views/OperationalDashboard.jsx` — add-on consistency; partial note; loading skeleton
- `src/dashboard/components/FunnelChart.jsx` — review stage label

---

## Remaining risks

- Active Guests remains network-wide live count (not branch/period scoped).
- 7D/MTD menu QR uses rollup daily sums — may diverge slightly from true global distinct sessions.
- Review metrics on wide ranges may still fall back to today-only server-side on RPC timeout.
- Low absolute traffic (e.g. 12 menu QR) can legitimately match across Today/7D/MTD on quiet days — distinguish from bugs via `window.__NAC_DASHBOARD_AUDIT__`.

---

## Verification

- `src/lib/operationalDashboardEnrich.test.js`
- `src/lib/operationalMetricsIntegrity.test.js`
- `tmp-vault-verify/trust-integrity-verify.mjs` (dashboard funnel mapping check)
