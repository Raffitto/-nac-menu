# LAST_HANDOFF

- task ID: **NAC-FOODICS-0002**
- result: **PARTIAL**

## Summary

Repo-side Mac bridge wiring is complete: the 01:30 LaunchAgent now targets `runAuthenticatedFoodicsBridge` through `scripts/foodics-bridge/run.mjs`, with deterministic install/status scripts, stable local proof paths, oldest-first catch-up at login/next-online (`RunAtLoad`), and idempotent published-day handling preserved from `NAC-FOODICS-0001`. Cloud worker did not install or execute the LaunchAgent on Raffi's Mac and could not produce a live qualified production proof.

## Scheduler entrypoint

| | Command |
|---|---|
| **Before** | Legacy operator package at `~/Desktop/nac-menu-release/foodics-bridge/` under label `com.nac.foodics-bridge.nightly`. Exact `ProgramArguments` were not versioned in-repo; presumed legacy console scrape path, **not** `runAuthenticatedFoodicsBridge`. |
| **After** | `node <repo>/scripts/foodics-bridge/run.mjs` (optional `--source scheduler|manual|catch-up`). LaunchAgent `StartCalendarInterval` **01:30** with `RunAtLoad: true` for missed-day catch-up when the Mac returns online. |

## Files changed

```
supabase/functions/_shared/companyIntelligence/commerce/localBridgeRuntime.ts
supabase/functions/_shared/companyIntelligence/commerce/foodicsConsoleSource.ts
supabase/functions/_shared/companyIntelligence/commerce/localAcquisitionStore.ts
supabase/functions/_shared/companyIntelligence/commerce/index.ts
scripts/foodics-bridge/lib.mjs
scripts/foodics-bridge/run.mjs
scripts/foodics-bridge/install-launchagent.mjs
scripts/foodics-bridge/status.mjs
src/intelligence/askNac/shared/launchdWiring.test.js
ai-control/LAST_HANDOFF.md
ai-control/STATE.json
ai-control/CURRENT_STATUS.md
```

## Install / update mechanism

`node scripts/foodics-bridge/install-launchagent.mjs`

- Validates repo root and node path
- Creates `~/Library/Application Support/NAC/foodics-bridge/{logs,proofs}` (or `FOODICS_BRIDGE_DATA_DIR`)
- Writes `~/Library/LaunchAgents/com.nac.foodics-bridge.nightly.plist`
- Bootstraps/reloads LaunchAgent on macOS only
- Prints installed command + schedule JSON (repeatable / non-destructive)

## Status / diagnostic mechanism

`node scripts/foodics-bridge/status.mjs`

Read-only JSON report: LaunchAgent loaded state (when `launchctl` available), configured 01:30 schedule, installed command, `publishedThrough`/watermark from local `state.json`, next missing completed date, last run/proof when present, session/env readiness. Does not fabricate unavailable fields.

## Proof artifact path and fields

**Base:** `~/Library/Application Support/NAC/foodics-bridge/proofs/<branch>/<businessDate>/<runId>.json`

**Fields:** `schema`, `artifactPath`, `branchId`, `invocationSource` (`scheduler` \| `manual` \| `catch-up`), `trigger` (`scheduler` \| `manual` \| `catch-up` \| `login-catch-up`), `command`, `repoRoot`, nested `evidence` (run ID, Riyadh timestamps, listing/detail counts, checksums, watermark, idempotency, final state, qualified flag).

Supporting files: `state.json`, `last-run.json`, `evidence/<runId>.json`, `logs/nightly.{stdout,stderr}.log`.

## Focused tests / build

| Pattern | Result |
|---|---|
| `foodicsBridge` | **9 passed** |
| `launchdWiring` | **9 passed** |
| `aiControlProtocol` | **3 passed** |
| **Focused gate** | **21 passed**, 0 failed |
| `CI=true npm run build` | **PASS** |

## Monday-off catch-up

**Proven at code level: yes.** `runAuthenticatedFoodicsBridge` + local entrypoint retain oldest-first multi-day catch-up (`launchdWiring` + existing `foodicsBridge` tests).

## Physical Mac action remaining

**Yes — one command on Raffi's Mac after pulling this branch:**

```bash
cd /path/to/nac-menu && node scripts/foodics-bridge/install-launchagent.mjs
```

Prerequisites (not committed): `scripts/foodics-bridge/.env.local` or legacy `~/Desktop/nac-menu-release/foodics-bridge/.env.local` with Supabase service role + Foodics session cookie/token.

Optional verification: `node scripts/foodics-bridge/status.mjs`

## Cost / deploy discipline

| Item | Value |
|---|---|
| Paid API calls | **0** |
| On-demand Cursor | **not used** |
| Netlify | untouched |
| Main merge | none |
| Migrations | **none** |
| Edge deploys | **0** |
| Production proofs incremented | **0** (no live Foodics session on cloud worker) |

## Branch / commit

- branch: `release/ask-nac-fabric-founding-day`
- commit SHA: `ee11169603a228a13eda78501e0b40aa1f48ea7c`

## Highest-leverage next step

After operator runs `install-launchagent.mjs` on the Mac, let the next unattended completed Riyadh date acquire and inspect the proof JSON under `proofs/khobar/<date>/`. That is the first candidate for a new qualified machine proof. Do not reopen official export/email work.
