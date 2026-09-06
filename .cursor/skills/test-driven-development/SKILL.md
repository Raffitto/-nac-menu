---
name: test-driven-development
description: Focused TDD for NAC regressions. Use when adding tests first, locking a production defect, or the user asks for TDD.
---

# Test-driven development

Provenance: adapted from addyosmani/agent-skills `test-driven-development`.

- Write the failing focused test that names the defect.
- Implement the smallest change that passes it.
- Do not run the full Jest suite during red/green loops.
- Known baseline failures (official Cash Up PDF parser; NLU #78 / #85) are not new regressions unless their count or message changes.
- Prefer one range/path assertion over broad snapshot rewrites.
