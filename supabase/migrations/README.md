# Supabase migrations

**New database changes go here** as timestamped files, then apply with:

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
