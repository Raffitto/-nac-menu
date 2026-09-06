---
name: nac-rbac-safety
description: Protects NAC branch isolation, Fady Khobar scope, Super Admin-only diagnostics, and RLS. Use when changing auth, filters, RPCs, Data Health, settings, or any query that can read another branch.
---

# NAC RBAC safety

Protect:

- Fady Khobar scope
- NAC aggregate behavior (`branch=null` is not three serial branch fetches, and must not leak unauthorized branches)
- branch clamping in UI and API
- Super Admin-only diagnostics (Data Health, system cards)
- RLS and `branch_id`

No UI-only security assumptions. A hidden button is not authorization.

Before shipping access changes:

1. Identify who can call the query (anon / authenticated / service role / security definer).
2. Confirm `branch_id` or equivalent is enforced in SQL/RLS, not only in React state.
3. Confirm Fady cannot see Super Admin diagnostics or other-branch rows.
4. Confirm Super Admin aggregate still uses one authorized path.
