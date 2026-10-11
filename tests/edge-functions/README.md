# Edge Function tests (offline)

Behavioural tests that load the **real** Supabase Edge Function handlers with every external
dependency replaced by in-repo stubs (`stubs/`): supabase-js (in-memory tables, per-token identity,
RPC permissions), Drive ingestion, review-tracking discovery and Google OAuth. They run with
`--deny-net`, need nothing outside this repository, and never touch Supabase, Google or Netlify.
All keys are random dummy values generated at test time.

Run (Deno 2.x), from the repo root:

```sh
deno test --no-check --deny-net --allow-env --allow-read \
  --import-map=tests/edge-functions/import_map.json tests/edge-functions/
```

or `npm run test:edge`.

| File | Covers |
|---|---|
| `vault-drive-sync/internal_auth.test.ts` | F14: forged / wrong-key service_role JWTs rejected; exact service key + scheduled secret accepted; nightly `scheduled_ingest` path |
| `vault-drive-sync/branch_authorization.test.ts` | F15: branch/role authorization for `register_folder`, `sync_ingest`, `retry_file`, `process_run`, `discover_folders` |
| `_shared/*.test.ts` | Pure helpers (`internalAuth`, `vaultDriveAuthorization`) |
