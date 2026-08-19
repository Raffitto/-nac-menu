# LAST_HANDOFF

- task ID: **NAC-FOODICS-0002**
- result: **PASS** (repo-side wiring). Cloud did **not** execute LaunchAgent on Raffi's Mac.

## Summary

Wired the scheduled local command to `runAuthenticatedFoodicsBridge`. Added a deterministic LaunchAgent install/update path, a read-only status command, and stable proof artifacts that record invocation source (`scheduler` / `manual` / `catch-up`) plus launchd trigger (`calendar` / `run-at-load` / `cli`). Catch-up, current-day exclusion, and idempotent integrity reruns are preserved. Official export/email was not reopened.

## Scheduler entrypoint before / after

| | Value |
|---|---|
| Label | `com.nac.foodics-bridge.nightly` (unchanged) |
| Schedule | 01:30 Asia/Riyadh + `RunAtLoad` (login/next-online catch-up) |
| **Before** | Out-of-repo laptop `foodics-bridge` nightly job. Exact `ProgramArguments` were **not in git**. |
| **After** | `node --experimental-strip-types <repo>/scripts/foodics-bridge/run-nightly.mjs --invoked-by=launchd --branch=khobar` |

## Files changed

```
scripts/foodics-bridge/constants.mjs
scripts/foodics-bridge/launchdWiring.mjs
scripts/foodics-bridge/filesystemStore.mjs
scripts/foodics-bridge/localSource.mjs
scripts/foodics-bridge/engineBridge.mjs
scripts/foodics-bridge/run-nightly.mjs
scripts/foodics-bridge/install-launchagent.mjs
scripts/foodics-bridge/status.mjs
src/intelligence/askNac/shared/launchdWiring.test.js
src/intelligence/askNac/shared/foodicsBridge.test.js
src/intelligence/askNac/shared/aiControlProtocol.test.js
supabase/functions/_shared/companyIntelligence/commerce/acquisitionEngine.ts
ai-control/LAST_HANDOFF.md
ai-control/STATE.json
ai-control/CURRENT_STATUS.md
```

## Install / update mechanism

```bash
node scripts/foodics-bridge/install-launchagent.mjs
```

Validates the entrypoint, creates `0700` log/proof directories, writes `~/Library/LaunchAgents/com.nac.foodics-bridge.nightly.plist` (backup on change), and on macOS bootstraps the agent. Repeat install is a no-op when the plist is unchanged. Proof files are never deleted. Does not require hand-editing plists. Secrets are not written into the plist; `.env.local` / session files stay outside git.

## Status / diagnostic mechanism

```bash
node scripts/foodics-bridge/status.mjs
```

Reports: agent loaded state **only if locally observable**, configured schedule, last run/proof if present, watermark, next missing completed date, runtime readiness. Missing session/plist/launchctl is `null` + reason — not fabricated.

## Proof artifact path and fields

Stable root: `~/Library/Application Support/nac/foodics-bridge/` (override `NAC_FOODICS_STATE_ROOT`)

| Path | Role |
|---|---|
| `proof/last.json` | latest inspectable run |
| `proof/runs/{runId}.json` | per-run record |
| `proof/dates/{branch}/{YYYY-MM-DD}.json` | per-date record |
| `proof/by-invocation/{scheduler\|manual\|catch-up}/{runId}.json` | invocation index |
| `watermark.json` | contiguous published-through |
| `logs/foodics-bridge.std{out,err}.log` | LaunchAgent logs |

Fields include: `schema=nac-foodics-bridge-proof-v1`, `runId`, `invocationSource`, `launchdTrigger`, Riyadh start/end, business date, `authenticated_read`, listing/detail/item counts, SHA-256 checksums, canonical counts, previous/new watermark, destination, version, idempotency, final state, qualified, official-export nulls.

## Catch-up / idempotency

- Monday-off oldest-first remains proven at **code** level (`2026-08-16` then `2026-08-17` when published-through is `2026-08-15` and as-of is Tuesday 01:30).
- `RunAtLoad` lets a missed 01:30 catch up when the Mac is next online.
- Current Riyadh date stays excluded.
- Already-published newest safe date is an integrity `IDEMPOTENT_NOOP`, not a second publication/proof increment.

This is **not** a claim that launchd fired on the Mac.

## Focused tests / build

| Pattern | Result |
|---|---|
| `foodicsBridge` | **9 passed** |
| `launchdWiring` (includes schedulerCatchup + proofEvidence) | **9 passed** |
| `aiControlProtocol` | **3 passed** |
| **Focused gate** | **21 passed**, 0 failed |
| `CI=true npm run build` | **PASS** |

Full-repo `npm test --watchAll=false` was not repeated (task: focused suites only, then one build gate). Jest `@jest-environment node` is required in this cloud image because native `canvas` cannot build (missing pixman).

## Deploys

none — Netlify untouched; no main merge; no Edge deploy; no paid services; migrations **none**.

## Physical Mac action remaining

**Yes — one command**, from the repo checkout on Raffi's Mac (this cloud worker cannot load launchd there):

```bash
node scripts/foodics-bridge/install-launchagent.mjs
```

Then optionally `node scripts/foodics-bridge/status.mjs`. The existing Foodics session/profile under `/Users/raffiazarian/Desktop/nac-menu-release/foodics-bridge` is reused (`.env.local` / session files); nothing is committed.

## Cost / deploy discipline

| Item | Value |
|---|---|
| Paid API calls | **0** |
| On-demand Cursor | **not used** |
| Netlify | untouched |
| Main merge | none |
| Migrations | **none** |
| Edge deploys | **0** |

## Branch / commit

- control-plane branch: `release/ask-nac-fabric-founding-day`
- worker branch: `cursor/nac-foodics-0002-f40a`
- worker SHA: `f454c15fa7de76632a3666ba57ffb45c3b94a282`
- PR: https://github.com/Raffitto/-nac-menu/pull/3

## Highest-leverage next recommendation

1. Raffi reviews this handoff (`awaiting_review`) and merges the worker PR into `release/ask-nac-fabric-founding-day` if accepted.
2. On the Mac, run `node scripts/foodics-bridge/install-launchagent.mjs` once.
3. After the next unattended completed Riyadh date, inspect `proof/last.json` — that is the first new qualified-proof candidate. Do not backfill Aug 14/15 as qualified.
4. Do not reopen official export/email.
