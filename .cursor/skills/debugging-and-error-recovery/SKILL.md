---
name: debugging-and-error-recovery
description: Systematic debugging for NAC defects using evidence first. Use when investigating bugs, failed tests, live wording errors, or unexpected latency.
---

# Debugging and error recovery

Provenance: adapted from addyosmani/agent-skills `debugging-and-error-recovery`.

1. Reproduce with the smallest local evidence (log, test, query, screenshot).
2. Form one hypothesis. Do not rewrite modules while guessing.
3. Trace the actual path (question → parser → executor → UI).
4. Fix the root cause. Keep sanitizers as defense-in-depth only.
5. Add a focused regression test for that path.
6. Do not deploy to collect evidence.
