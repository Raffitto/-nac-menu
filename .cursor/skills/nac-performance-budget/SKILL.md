---
name: nac-performance-budget
description: Avoids expensive NAC dashboard and Ask NAC load paths. Use when changing Overview, BI RPCs, Menu lists, Food Bible, Vault fetches, or React effects.
---

# NAC performance budget

Avoid:

- N+1
- SELECT *
- sequential waterfalls
- unstable React deps
- per-row expensive RLS helper calls
- external services on critical paths
- heavy enrichment before first useful paint

Overview first useful paint must not wait on `get_bi_dashboard`. Do not fire live BI on every cold load; Refresh may. Prefer one range aggregate over per-day RPC loops. Do not delay the same heavy query by a few seconds and call it fixed.
