# Permanent NAC engineering decisions

These bind autonomous workers. Do not relitigate inside a routine task.

## Founder-free infrastructure

- Raffi is personally funding NAC. No recurring paid SaaS unless `RAFFI_DECISIONS.md` records explicit approval.
- No on-demand Cursor / Other Models spillover.
- Prefer cached, self-hosted, or free APIs. Class-3 paid sources are blocked in founder-free mode.

## OSS-first

- Search `docs/architecture/oss-reference-registry.md` before custom-building generic infrastructure.
- Custom-build for NAC-specific canonical graph, semantics, authority, RBAC, temporal history, and evidence — not for another agent framework.
- Bounded search only. Do not framework-shop.

## Ask NAC / Fabric

- Cash Up is canonical for headline sales. Foodics/commerce is not a silent override.
- No unrestricted raw database access for agents. Allowlisted tools/capabilities only.
- RBAC and branch scope stay in NAC, not in a generic supervisor.
- `reasoningSupervisor.ts`, universal fabric, orchestration spine, and semantic commerce engine stay. OpenClaw was **REJECTED** as a replacement supervisor (MIT, 2026.7.1-2 / `0790d9f`).

## Deploy discipline

- No autonomous merge to `main`.
- No Netlify deploy unless NEXT_TASK explicitly grants AUTO_WITH_GUARDRAILS.
- No Ask NAC Edge deploy unless NEXT_TASK explicitly grants it.
- Minimal redeploys. Do not deploy to “increment a version.”

## Autonomous loop

- One active task at a time.
- Never force-push.
- If HEAD changed unexpectedly: stop and report.
- Individual Cursor usage % is **not** officially exposed via public CLI/API — do not fake it. Conservative stop ~88–89% estimated; hard intent 90%. Baseline at loop start: 69%.
