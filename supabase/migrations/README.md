# Supabase migrations

**Automated production migration pushes are currently blocked.** A read-only
comparison on 2026-10-30 found 19 local-only and 18 hosted-only migration
versions. Reconcile the complete version history and verify the resulting
execution plan against the authoritative hosted schema before running any
automated `db push`. Do not mark migrations applied or replay them to make the
lists agree.

PR #79's reporting function was applied under hosted version
`20261030085529`; the identical committed SQL file has been renamed to that
version so it is not offered as a new pending change. Its SHA-256 is
`9414df786916cf130f79778b42ae1bf8d9ff3a381cdf22627bdffe1ca8eea2e4`.

**New database changes go here** as timestamped files. Once the history and
schema are reconciled and a migration is approved, apply with:

```bash
supabase db push
```

## Naming

Create a migration:

```bash
supabase migration new short_description
```

Example: `20260523120000_branch_identity_normalize.sql`

## Legacy SQL

One-off scripts in the parent `supabase/` folder (e.g. `menu_schema.sql`, `branch_identity_normalize.sql`) were applied manually before CLI linking. Do not re-run them on production unless you know they are idempotent. Prefer new files in this directory going forward.

See [docs/SUPABASE_DEPLOY.md](../../docs/SUPABASE_DEPLOY.md).
