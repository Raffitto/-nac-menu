---
name: code-review-and-quality
description: Reviews NAC diffs for correctness, security, performance, and truth semantics. Use after implementation, before commit/push, or when the user asks for a code review.
---

# Code review and quality

Provenance: adapted from addyosmani/agent-skills `code-review-and-quality`. NAC rules win.

Review axes:

1. Correctness vs the requested change only
2. Truth semantics (null/unavailable ≠ 0)
3. RBAC / RLS / branch clamp
4. Schema safety (no assumed columns)
5. Performance (no new cold-path waterfalls)
6. Tests that would catch the last regression

Approve when the change improves health and stays in scope. Do not block on style preference. Do not require a Netlify deploy as review evidence.
