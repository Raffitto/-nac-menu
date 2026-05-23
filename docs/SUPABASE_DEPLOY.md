# Supabase CLI — deploy SQL from Cursor

Apply database changes from this repo with the [Supabase CLI](https://supabase.com/docs/guides/cli), instead of copy-pasting into the SQL Editor.

## Security model

| Secret / key | Where it belongs | Never in |
|--------------|------------------|----------|
| `REACT_APP_SUPABASE_ANON_KEY` | Netlify / `.env.local` | — (public JWT; RLS enforces access) |
| `REACT_APP_SUPABASE_URL` | Netlify / `.env.local` | — |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard secrets, Edge Functions only | React, `REACT_APP_*`, git |
| Database password | CLI keychain / `SUPABASE_DB_PASSWORD` in private CI | git, frontend |
| `SUPABASE_ACCESS_TOKEN` | OS keychain after `supabase login` | git |

The React app uses **anon + Auth session only**. See [SECURITY_AUDIT.md](../SECURITY_AUDIT.md).

---

## 1. Install Supabase CLI (Mac)

CLI is **not** installed in this environment until you run:

```bash
brew install supabase/tap/supabase
```

Verify:

```bash
supabase --version
```

Alternatives: [official install docs](https://supabase.com/docs/guides/cli/getting-started) (`npm i -g supabase` works but Homebrew is preferred on macOS).

---

## 2. Log in (one-time per machine)

```bash
supabase login
```

Opens the browser; stores an access token in your OS credential store — **not** in the repo.

---

## 3. Link this repo to the live project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project.
2. Copy **Project ID** (also called **project ref**):  
   `https://supabase.com/dashboard/project/<PROJECT_REF>`  
   or Settings → General → Reference ID.
3. From the repo root:

```bash
cd /path/to/nac-menu
supabase link --project-ref <PROJECT_REF>
```

When prompted, enter the **database password** (Dashboard → Settings → Database). The CLI saves it locally; it is never written to git.

Link state lives under `supabase/.temp/` (gitignored). Safe to commit: `supabase/config.toml`, `supabase/migrations/*.sql`.

---

## 4. Baseline (existing production DB)

This project already has schema/functions from manual runs of files in `supabase/*.sql`. Before the first `db push`, align migration history so the CLI does not re-apply old work.

**Option A — recommended after link**

1. Pull remote schema into a baseline migration (review the generated file before committing):

   ```bash
   supabase db pull
   ```

2. Commit the new file under `supabase/migrations/`.

**Option B — mark legacy scripts as already applied**

If production already matches known scripts and you only want **new** migrations tracked:

```bash
# Example: mark one migration version as applied (use real timestamp from filename)
supabase migration repair --status applied 20260523120000
```

Use `supabase migration list` to see local vs remote history.

Do **not** commit database passwords or access tokens while baselining.

---

## 5. Day-to-day workflow (new SQL)

1. Create a migration:

   ```bash
   supabase migration new describe_your_change
   ```

2. Edit `supabase/migrations/<timestamp>_describe_your_change.sql`  
   (idempotent `create or replace function …` is fine for RPC updates.)

3. Apply to **linked** production:

   ```bash
   supabase db push
   ```

   This runs only migrations that are not yet on the remote database. Review the CLI diff/prompt before confirming.

4. Commit the migration file to git (SQL only, no secrets).

### npm shortcuts (from repo root)

```bash
npm run supabase:migration:new -- describe_your_change
npm run supabase:push
```

### When **not** to use `db push`

- Destructive changes (drops, renames) — test on a branch database or staging first.
- Large one-off data seeds (`menu_seed.sql`) — use SQL Editor or a controlled script; keep seeds out of routine migrations unless intentional.

### Escape hatch (single file, no migration record)

Prefer migrations. If you must run one file once:

```bash
supabase db execute --file supabase/branch_identity_normalize.sql --linked
```

`--linked` runs against the project from `supabase link`, not local Docker.

---

## 6. Optional: local Supabase stack

Not required for pushing to hosted DB. For local Postgres + Studio:

```bash
supabase start
supabase stop
```

Uses Docker. Frontend still points at hosted URL via `.env.local` unless you switch URLs to `http://127.0.0.1:54321`.

---

## 7. CI (future)

For GitHub Actions, use repository secrets:

- `SUPABASE_ACCESS_TOKEN` (personal access token or CI token)
- `SUPABASE_DB_PASSWORD` or link via `supabase link` in CI with project ref

```bash
supabase link --project-ref "$SUPABASE_PROJECT_REF" --password "$SUPABASE_DB_PASSWORD"
supabase db push
```

Never set `SUPABASE_SERVICE_ROLE_KEY` in the React build job.

---

## 8. Repo layout

| Path | Purpose |
|------|---------|
| `supabase/config.toml` | CLI config (ports, Postgres version) |
| `supabase/migrations/` | **Versioned** schema changes (`db push`) |
| `supabase/*.sql` (root) | Legacy manual scripts — reference / one-offs |
| `supabase/.temp/` | Link metadata (gitignored) |
| `.env.example` | Template for frontend env vars only |

---

## 9. Checklist

- [ ] `brew install supabase/tap/supabase`
- [ ] `supabase login`
- [ ] `supabase link --project-ref <PROJECT_REF>`
- [ ] Baseline: `supabase db pull` **or** `migration repair` for existing DB
- [ ] New change: `supabase migration new …` → edit SQL → `supabase db push`
- [ ] Confirm Netlify still has only `REACT_APP_SUPABASE_*` (no service role)

Related: [ROLLUP_REFRESH.md](./ROLLUP_REFRESH.md), [DEPLOY.md](../DEPLOY.md).
