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
| `vault-drive-sync/branch_authorization.test.ts` | F15: branch/role authorization for `register_folder`, `sync_ingest`, `retry_file`, `process_run`, `discover_folders`; branch access without `can_upload` (mutation gap) |
| `vault-drive-sync/review_tracking_owner.test.ts` | F15-c: Drive connect (`authorize`/`callback`) needs ingestion authority; nightly `scheduled_ingest` and `ingest_review_tracking` only use Khobar-authorized owners; no foreign-branch host reuse; F15-b nightly owner filter |
| `_shared/*.test.ts` | Pure helpers (`internalAuth` + constant-time source guard, `vaultDriveAuthorization`, `vaultDriveOwnerAuthorization`) |

Identities are table-driven (`fixtures.ts`): authority comes only from fake `ask_nac_staff`,
`ask_nac_roles`, `ask_nac_user_branch_access` and `menu_staff_scope` rows, evaluated by
`stubs/sqlHelpers.ts` (emulates the repo's SQL helpers, `ask_nac_vault_can_upload` as widened in
20260608210000) on user paths and by the real `vaultDriveOwnerAuthorization.ts` on service paths.
`stubs/vaultReviewTrackingDriveDiscovery.ts` wraps the REAL discovery module (`?real` import).
