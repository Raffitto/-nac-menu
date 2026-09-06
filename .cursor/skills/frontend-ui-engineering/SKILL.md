---
name: frontend-ui-engineering
description: React and dashboard UI quality for NAC admin surfaces. Use when changing layout, state, effects, routing, or user-visible Overview/Menu/Ask NAC UI.
---

# Frontend UI engineering

Provenance: adapted from addyosmani/agent-skills `frontend-ui-engineering`.

- Do not redesign dashboards unless requested.
- Verify behavior in the browser when UI changed, not just a screenshot.
- Check shared state across routes that read the same data.
- Hunt empty/error/partial states. Unavailable must not render as 0.
- Prefer existing CSS/components. Avoid new design systems.
- For mobile/admin polish, also load `nac-admin-ui-qa`.
