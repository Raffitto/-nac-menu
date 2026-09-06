---
name: supabase-postgres-safety
description: Safe Supabase/Postgres changes for NAC. Use when writing migrations, RPCs, RLS, indexes, or EXPLAIN-level query work.
---

# Supabase / Postgres safety

Provenance: VoltAgent catalogue pointed at supabase/postgres-best-practices. Adapted for NAC; official skill body was not blindly copied (remote path 404 at audit time).

- Inspect live/migration schema before SELECT lists.
- Prefer indexes and date predicates over table scans of `menu_events` / facts.
- Do not rewrite `get_bi_dashboard` as a risky one-night change.
- `security definer` must not bypass branch isolation.
- No production data auto-fixes. Migrations are explicit and reviewed.
- Skip `EXPLAIN ANALYZE` on production unless the user authorizes a safe read-only session.
