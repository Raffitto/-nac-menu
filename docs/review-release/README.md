# NAC Reviews visit conversion release — OWNER APPROVAL REQUIRED

No merge, deployment, hosted SQL, migration repair, event deletion or print release is authorized by this document.

## Measurement contract

- A qualifying QR visit has a `qr_scan`, a nonblank review session ID (or, only when absent, a namespaced menu session ID), a branch, an employee identity (blank stays unattributed), and a timestamp in the selected period.
- Group by branch, normalized employee name and namespaced session ID. Count each group once. A session identifier measures a visit/session, never a unique human.
- Convert a qualifying visit once when a matching Google redirect occurs at or after its first qualifying scan, inside the same period. Repeated clicks remain raw events. Do not infer identity by timestamp proximity.
- A redirect whose scan is outside the selected period is unmatched for that period. It does not enter either side of its visit-conversion ratio.
- Rate = converted qualifying visits / qualifying visits, rounded to a whole percentage. Zero denominator or scans without usable tracking produce N/A. Invalid ratios are rejected, never clipped.
- Preserve `qr_scans`, `google_redirects`, `staff.scans` and `staff.google` in the SQL response as raw compatibility fields. New explicit `qr_visits`, `converted_visits`, raw diagnostics and coverage fields drive the review UI, coaching, comparisons and exports. UI adapters retain established property names for compatibility but populate those properties with visit counts.
- Exclude only explicit `metadata.self_test` true (boolean or string). A legitimate employee named TEST remains included.
- All complete reads include every row. Standard periods use server aggregation; custom exports page through the RLS-protected event table. A branch-filtered comparison omits branches that were not queried.
- A fresh loaded portal document gets a fresh visit ID; all its events share that ID. Failed scan deliveries can retry, successful scan duplicates remain suppressed. `self_test=1` explicitly marks release acceptance activity.

## Verified baseline

Main: `d712f195ee37da97cad946baf81512e461f5bd17` (protected). PRs 77/79/80 merged; draft PR 81 originally based here, head `ab06c32d2a1dc61282e15f5694c2191b641f211c`.

| Site | Published deployment | Published commit / state |
| --- | --- | --- |
| nac-os | 6ae4791aca496a3578c330f6 | d712f195ee37da97cad946baf81512e461f5bd17 |
| nacmenu | 6ae31f9d328387ce104341f3 | 6255e67d159478c0940317e33d058bd4c74e145b |
| nacriyadh | 6ad9de28c3bb6e983e3b9aa4 | Stopped builds; preserve |
| nac-jeddah | 6ad9de2898a38cbe8024131f | Stopped builds; preserve |
| nac-khobar-reviews | 6ad9de28ff9f203629b5a8f3 | Stopped builds; preserve |

Atik's Laysen October records are two DIFFERENT sessions, one redirect in each, only one with a recorded scan. This is not evidence of duplicate logging or a repeated click. Cohort conversion is 1/1 = 100%, with one unmatched redirect. Eusuf has 36 qualifying visits, 14 matching converted visits, 17 raw redirects, 76 interactions: 39%, with three unmatched redirects. No historical session matching is invented.

## Database gate and rollback

Migration drift remains **19 local-only / 18 hosted-only**. Do not run `supabase db push`, migration repair, resets, or automated migration deployment.

`proposed-summary.sql` replaces only the existing `public.get_review_events_summary(text,integer)` function. It keeps its existing SECURITY DEFINER/search_path and calls the existing `nac_reviews_allowed_branches()` before aggregation. It changes no table, row, employee identity, branch ID, policy, grant or function signature. The existing table SELECT policy remains `branch_id = any(nac_reviews_allowed_branches())` for authenticated users.

Exact captured function rollback: `rollback-summary.sql`. Captured ACL: `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. No PUBLIC/anon execute grant. CREATE OR REPLACE preserves that ACL; verify before and after. If the live definition or grants differ from this baseline, stop and re-review.

The function update is needed because the present aggregate discards the scan-to-redirect session relationship. Deriving it from the existing raw counts cannot establish converted visits. Server aggregation also avoids replacing the fixed >3,000-row reporting path with large browser scans.

Isolated Postgres/PGlite replay used all 5,266 rows in the fixed October snapshot (including explicitly marked synthetic records before filtering). It verified SQL/client equality, same-period conversion, repeated clicks, duplicate scan records, missing IDs, zero visits, branch separation, authenticated branch denial, anon execute denial, unchanged grants and exact rollback results. Production SQL has NOT been changed.

## Controlled owner-approved sequence

1. Confirm the final reviewed head and all five protected CI checks. Keep PR title and squash commit marked `[skip netlify]`.
2. Obtain explicit owner approval for the function replacement, protected merge, NAC OS deployment and canonical nacmenu deployment. Do not deploy sibling sites or restart their builds.
3. Recheck the live function/ACL and published baselines. Apply only the reviewed function replacement, in a transaction; verify results and permission boundaries. Preserve rollback SQL.
4. Merge through protected GitHub controls. Verify that no unintended Netlify build starts. Build/deploy only nac-os and nacmenu from that published commit using each site's own environment/configuration. Verify commit and deployment IDs.
5. Validate all 15 employee links live, editing, English/Arabic suggestions, correct Google Place IDs, Khobar/Jeddah regressions, identical filter totals and exports, branch authorization, and unchanged historical row counts. Acceptance events must be explicitly marked synthetic; never post Google reviews.
6. After successful digital acceptance, obtain separate owner print approval. Copy the byte-verified held candidate as `NAC_15_EMPLOYEE_QR_CARDS_READY_TO_PRINT.pdf`; do not alter the original master.
7. Owner prints/scans one physical sample and confirms duplex orientation/alignment/readability before the full batch. Digital decoding does not substitute for that physical acceptance.

Application rollback is a protected revert and controlled redeployment; it does not restore an older Netlify deployment. Database rollback restores only the exact prior function; records remain intact.
