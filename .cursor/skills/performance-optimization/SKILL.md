---
name: performance-optimization
description: Profiles and reduces NAC latency without changing business math. Use when Overview, Ask NAC, Menu, or RPCs are slow, or the user asks for performance work.
---

# Performance optimization

Provenance: adapted from addyosmani/agent-skills `performance-optimization`.

Measure first (existing `__NAC_OVERVIEW_PERF__`, `__NAC_ASKNAC_COVERAGE__`, RPC timings). Prefer one aggregate query. Do not add a delayed copy of the same 8s call. Do not change Cash Up math while speeding queries. Pair with `nac-performance-budget`.
