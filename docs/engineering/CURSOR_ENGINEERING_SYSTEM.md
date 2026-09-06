# NAC Cursor engineering system

Operational harness. NAC project rules override every external framework.

## Hierarchy

| Layer | Path | Load |
|---|---|---|
| Always-on policy | `.cursor/rules/*.mdc` | every session |
| On-demand workflows | `.cursor/skills/*/SKILL.md` | when the description matches |
| Human runbooks | `docs/engineering/` | read when needed |

Do not paste skill bodies into always-on rules.

## Always-on rules

- `nac-os.mdc` — production stability, live-data, RBAC, Company Knowledge, Ask NAC
- `nac-deploy-budget.mdc` — local first, one deploy max
- `nac-lifecycle.mdc` — understand → inspect → plan → implement → verify → one deploy

## Skills

See `.cursor/skills/PROVENANCE.md`. Seventeen skills. None of the ECC/MengTo/VoltAgent bulk libraries are installed.

## Local verification

```bash
npm run verify:focused -- path/to.test.js   # one or more files
npm run verify:nac                          # high-risk NAC subset
npm run verify:release                      # subset + CI=true npm run build
```

Do not use Netlify as a test runner. Full Jest only when test architecture or a broad runtime change requires it.

## One-deploy rule

1. Commit locally as needed.
2. Do not push until the milestone is coherent.
3. Push/`main` triggers Netlify on this repo — treat that as the production deploy.
4. Second deploy only for a real production break.

`scripts/netlify-ignore-non-runtime.mjs` can skip builds when only docs/skills/tests changed. It is **not** wired into `netlify.toml` yet (risky if wrong). Wire it only after a dedicated review.

## Emergency production exception

Site down, auth break, or data-loss risk: one coherent fix, focused tests, one push. Still no drip deploys.

## Update procedure

1. Clone candidates **outside** this repo (`~/Desktop/nac-agent-research` is fine).
2. Read installers. Do not run them against NAC.
3. Adapt a short SKILL.md (under ~80 lines). Record origin in `PROVENANCE.md`.
4. If a skill causes collisions or context bloat, delete its folder. NAC rules stay.

## Disable a skill

Delete `.cursor/skills/<name>/` or add `disable-model-invocation: true` to its frontmatter.

## Backlog

See [BACKLOG.md](BACKLOG.md).
