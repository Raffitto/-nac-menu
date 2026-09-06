---
name: nac-production-truth
description: Enforces NAC live-data and temporal coverage truth. Use when answering Ask NAC questions, writing sales/covers/metrics prose, handling null vs zero, coverage contracts, or unavailable/stale sources.
---

# NAC production truth

0 means verified zero.

Never coerce these into zero:

- null
- failed
- unavailable
- partial
- stale

Temporal answers must distinguish:

- requested period
- available period
- latest completed date
- missing dates
- source coverage

Reuse `CoverageContract` / `src/intelligence/askNac/coverage/temporalCoverage.js`. Do not invent a second coverage system. Do not invent Foodics or sales numbers. Foodics is not live-integrated unless the code clearly shows otherwise.

If data is missing, say it is missing. Cite source, branch, period, and freshness when available.
