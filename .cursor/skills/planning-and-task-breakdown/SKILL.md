---
name: planning-and-task-breakdown
description: Plans a NAC change before coding. Use for substantial milestones, multi-file work, or when the user asks to plan, spec, or break down a task.
---

# Planning and task breakdown

Provenance: adapted from addyosmani/agent-skills `planning-and-task-breakdown`. NAC rules win.

1. Restate the outcome and non-goals.
2. Inspect existing schema and services (do not assume columns).
3. List affected files and the smallest safe change.
4. Name skills to load (`nac-production-truth`, RBAC, reports, menu schema, etc.).
5. Name focused tests to run — not the full suite yet.
6. State deploy impact: local-only vs one production deploy.

Do not create a second implementation plan mid-task unless evidence invalidates this one. Do not expand into Menu/Reports/Reviews unless required.
