# NAC OS Environment & Deployment Strategy

**Status:** Architecture only — no projects created, no deployments, no migrations applied.  
**Audience:** Primary developer, future contributors, deployment operators.  
**Last reviewed:** 2026-06-21

---

## Executive summary

NAC OS today runs on a **single production stack** (Supabase `zeyhvjuraqnlbdycgrme` + Netlify admin/public sites). That was sufficient while Ask NAC was simpler; it is now **insufficient** as migrations, Edge complexity, NIL reasoning, External Context, and WhatsApp approach production maturity.

**Minimum viable target:** add **one staging Supabase project** and **one staging Netlify admin site**. Keep local dev, reuse existing verifiers via environment switching, and gate production deploys behind staging verification.

**Estimated incremental cost:** **$0–25 USD/month** (free-tier staging is viable initially; Pro recommended once vault data volume grows).

**Biggest current risk:** **Edge functions and migrations ship directly to production** with only read-only HTTP verifiers run *after* deploy — no rehearsal environment, no rollback drill.

**Fastest path to staging readiness:** create staging Supabase → apply migration history → deploy `ask-nac` → point parameterized verifiers at staging → add staging Netlify admin site.

---

## Part 1 — Current state

### 1.1 Environment topology (today)

```
┌─────────────────────────────────────────────────────────────────┐
│                     PRODUCTION ONLY                             │
├─────────────────────────────────────────────────────────────────┤
│  Developer laptop                                               │
│    npm start / npm test / supabase functions deploy (manual)    │
│         │                                                       │
│         ▼                                                       │
│  Supabase (zeyhvjuraqnlbdycgrme)                                │
│    • Postgres + RLS (3 branches: khobar, riyadh, jeddah)        │
│    • Auth (magic link, RBAC via ask_nac_staff matrix)           │
│    • Storage (vault uploads, menu assets)                       │
│    • Edge Functions: ask-nac (v45+), vault-drive-sync           │
│         ▲                                                       │
│         │ REACT_APP_SUPABASE_*                                  │
│  Netlify                                                        │
│    • nacmenu.netlify.app — public guest menu (PLATFORM_MODE ∅)  │
│    • nac-os.netlify.app / nacos — admin NAC OS (MODE=admin)     │
│    • Branch review sites (optional)                             │
│         │                                                       │
│         ▼                                                       │
│  Ask NAC (web UI → Edge ask-nac → vault / NIL / knowledge)      │
│  Data Vault (upload, Drive sync, structured facts, cash-up)     │
└─────────────────────────────────────────────────────────────────┘

Staging: does not exist.
Local Supabase Docker: optional, documented but not part of daily workflow.
```

### 1.2 Component inventory

| Component | Production location | Notes |
|-----------|---------------------|-------|
| **Database** | Supabase Postgres | Versioned migrations in `supabase/migrations/`; `supabase db push` targets linked prod |
| **RLS / Auth** | Supabase | Branch isolation via `branch_id`, vault RBAC helpers, JWT roles |
| **Storage** | Supabase buckets | Vault documents, ingestion artifacts |
| **Edge — ask-nac** | Supabase Functions | Primary intelligence ingress; bundles `_shared/*` orchestrator, NIL, vault tools, external context retrieval |
| **Edge — vault-drive-sync** | Supabase Functions | Google Drive scheduled ingest; separate deploy lifecycle |
| **Netlify — public** | nacmenu | Guest menu PWA; anon tracking |
| **Netlify — admin** | nac-os / nacos | `REACT_APP_PLATFORM_MODE=admin`; Ask NAC UI, dashboards, vault panel |
| **Ask NAC** | Edge + React | Web chat; production-only HTTP verifiers in `tmp-vault-verify/` |
| **Data Vault** | DB + Storage + Edge | Cash-up workbooks, document search, Drive sync |
| **Secrets** | Supabase Edge secrets, Netlify env, local `.env.local` | OpenAI, Google OAuth, `ASK_NAC_CASHUP_TRACE`, service role never in frontend |

### 1.3 Current deploy practices

| Change type | Typical flow today | Documented in |
|-------------|-------------------|---------------|
| React / dashboard | Push to `main` → Netlify auto-build | `netlify.toml`, `docs/NACOS_DEPLOYMENT.md` |
| SQL migration | `supabase migration new` → `supabase db push` (linked prod) | `docs/SUPABASE_DEPLOY.md` |
| Edge `ask-nac` | `supabase functions deploy ask-nac --project-ref zeyhvjuraqnlbdycgrme` | Ad hoc; recent deploy v45 |
| Edge `vault-drive-sync` | Separate manual deploy | Ad hoc |
| Verification | Post-deploy Node scripts against **production** Edge | `tmp-vault-verify/*.mjs` |
| Unit/integration tests | `npm test -- --watchAll=false`, `CI=true npm run build` | Workspace rules |

### 1.4 Risks of single-environment development

| Risk | Impact | Example from recent work |
|------|--------|---------------------------|
| **Migration testing on production** | RLS breakage, lock contention, irreversible DDL | External context + WhatsApp foundation migration not yet applied to prod; would have been first apply on live |
| **Edge deploy directly to production** | Bad routing, NIL regression, cash-up parser failure affects Khobar/Riyadh/Jeddah staff immediately | ask-nac v45 deployed with executive brief parity + trace gating — verified only after prod deploy |
| **Production-only verification** | Verifiers confirm prod works but do not prevent bad deploy | `nil-why-prod-verify.mjs` / `cash-up-flexible-period-prod-verify.mjs` hit live data |
| **No rollback rehearsal** | Supabase Edge versioning helps, but team has not practiced redeploy-previous-version under pressure | Emergency rollback = git checkout + redeploy, untested |
| **Secret / env drift** | Staging absent so dev `.env.local` mirrors prod project ref | Easy to accidentally `db push` or deploy to prod while intending local experiment |
| **WhatsApp + webhook future** | Inbound provider traffic on prod first = security and RBAC incident risk | Webhook not built yet; architecture doc exists |
| **CK1 verifier mutates prod** | Upload/ingestion probes against configured project | `ck1-prod-verify.mjs` explicitly warns about test uploads |

### 1.5 What works well (preserve)

- Sanitized verifiers with env-based auth (no hardcoded secrets).
- Edge trace gating (`ASK_NAC_CASHUP_TRACE=true` only for developer diagnostics).
- Branch isolation enforced in SQL + Edge vault tools.
- Separate public vs admin Netlify sites (`REACT_APP_PLATFORM_MODE`).
- Versioned migrations in git.

---

## Part 2 — Target topology

### 2.1 Recommended environments

```
Developer Local
      │
      │  npm test, npm run build, optional supabase start (Docker)
      │
      ▼
   Staging  ◄── required next step
      │
      │  migrations rehearsed, Edge deployed, verifiers green
      │
      ▼
 Production  ◄── existing zeyhvjuraqnlbdycgrme
```

**Three tiers is enough.** Do not add QA, UAT, or per-branch Supabase projects at this stage.

### 2.2 Staging vs production mapping

| Layer | Staging (new) | Production (existing) |
|-------|---------------|------------------------|
| **Supabase project** | New project ref (e.g. `nac-os-staging`) | `zeyhvjuraqnlbdycgrme` |
| **Postgres** | Same migration history; **subset or anonymized** vault data | Full branch data |
| **Auth users** | Developer + 1–2 test staff emails per branch role | Real staff |
| **Storage** | Separate buckets; no prod PII unless explicitly copied | Production uploads |
| **Edge Functions** | `ask-nac`, later `vault-drive-sync`, later `whatsapp-webhook` | Same function set |
| **Edge secrets** | Staging OpenAI key (lower budget), staging Google OAuth app | Production secrets |
| **Netlify admin** | `nac-os-staging.netlify.app` (suggested name) | `nac-os.netlify.app` |
| **Netlify public** | Optional; low priority | `nacmenu.netlify.app` unchanged |
| **DNS / WhatsApp** | Meta/Twilio sandbox → staging webhook URL | Production webhook when ready |

### 2.3 Design decisions

#### One staging Supabase project — **yes, sufficient**

- RLS and branch isolation are **logical** (same DB, different `branch_id` rows), not separate databases per restaurant.
- Staging needs **representative** Khobar/Riyadh/Jeddah rows, not full prod clones.
- One project keeps cost and operational surface minimal.

#### Branch preview environments (Netlify deploy previews) — **optional, UI-only**

| Useful for | Not useful for |
|------------|----------------|
| Dashboard layout, React regressions | Ask NAC Edge behavior |
| Platform mode smoke test | RLS / migration validation |
| PDF export visual tweaks | Vault ingestion, Drive sync |

**Recommendation:** enable Netlify deploy previews for PRs when convenient (free tier). Do **not** rely on them for intelligence or database safety. Previews should point at **staging Supabase**, never production.

#### Separate staging Netlify admin site — **yes, recommended**

- Admin UI must talk to staging Supabase URL/anon key.
- Keeps staging sign-in, magic links, and RBAC separate from prod Auth.
- Cost: **$0** on Netlify free tier for a second site from the same repo.

#### Local Supabase Docker — **optional supplement**

- Good for migration authoring and RLS unit tests.
- Not a substitute for hosted staging (Edge Functions, real Auth, storage, and latency differ).
- Continue documenting in `docs/SUPABASE_DEPLOY.md`; do not require Docker for every change.

### 2.4 Environment variables strategy

| Variable class | Local | Staging | Production |
|----------------|-------|---------|------------|
| `REACT_APP_SUPABASE_URL` | `.env.local` | Netlify staging site | Netlify prod sites |
| `REACT_APP_SUPABASE_ANON_KEY` | `.env.local` | Netlify staging | Netlify prod |
| `REACT_APP_PLATFORM_MODE` | `admin` when testing NAC OS | `admin` | `admin` on nac-os only |
| `REACT_APP_RBAC_USERS` | Dev allowlist | Staging test users | Prod staff allowlist |
| `OPENAI_API_KEY` | Edge secret (staging project) | Edge secret | Edge secret |
| `GOOGLE_CLIENT_ID/SECRET` | Staging OAuth app | Staging OAuth app | Prod OAuth app |
| `ASK_NAC_CASHUP_TRACE` | `true` locally if debugging | `true` for staging diagnostics | **`false` default** |
| `SUPABASE_SERVICE_ROLE_KEY` | Never in React; CLI/Edge only | Edge only | Edge only |
| `SUPABASE_PROJECT_REF` | Verifier scripts | Staging ref | `zeyhvjuraqnlbdycgrme` |
| `ASK_NAC_VERIFY_*` | Verifier auth targeting | Staging email/redirect | Prod email/redirect |

**Convention to adopt:** `.env.staging.example` (committed template) + `.env.staging.local` (gitignored) for verifier and CLI targeting — without duplicating secrets in repo.

### 2.5 Cost estimate (self-funded)

| Item | Monthly incremental | Notes |
|------|---------------------|-------|
| Staging Supabase Free | **$0** | 500 MB DB, 2 projects/org limit; fine for early staging |
| Staging Supabase Pro | **~$25** | Recommended when vault storage + Edge log volume grow |
| Staging Netlify site | **$0** | Same repo, second site |
| OpenAI staging usage | **~$1–5** | Lower traffic; use separate API key with budget cap |
| WhatsApp sandbox | **$0** initially | Meta Cloud API free tier for dev numbers |
| **Total MVP** | **$0–30/mo** | One Pro project is the realistic steady state |

Avoid: duplicate production projects per branch, dedicated CI runners, enterprise secret managers, or third staging environment.

---

## Part 3 — Deployment flow

### 3.1 Standard pipeline (target)

```
Code change (feature branch)
        │
        ▼
npm test -- --watchAll=false
        │
        ▼
CI=true npm run build
        │
        ▼
┌─────────────────── STAGING ───────────────────┐
│  supabase db push        (staging link)       │
│  supabase functions deploy ask-nac            │
│  (optional) functions deploy vault-drive-sync │
│  Netlify deploy → staging admin site          │
└─────────────────── STAGING ───────────────────┘
        │
        ▼
Staging verifiers (all green)
        │
        ▼
┌─────────────────── PRODUCTION ────────────────┐
│  supabase db push        (prod link)          │
│  supabase functions deploy ask-nac            │
│  Netlify: merge to main (auto prod deploy)    │
└─────────────────── PRODUCTION ────────────────┘
        │
        ▼
Production verifiers (smoke subset)
        │
        ▼
Record deploy version + timestamp in changelog / commit tag
```

**Rule:** Nothing reaches production that has not passed **staging** migration + Edge + verifier gates — except documented hotfix path (Part 5.4).

### 3.2 Ask NAC deploy flow

| Step | Staging | Production |
|------|---------|------------|
| 1. Pre-check | `git status` clean; tests/build green | Same + staging verifiers green |
| 2. Deploy | `supabase functions deploy ask-nac --project-ref <STAGING_REF>` | `supabase functions deploy ask-nac --project-ref zeyhvjuraqnlbdycgrme` |
| 3. Record version | Note Supabase function VERSION from CLI/dashboard | Same (e.g. v45 → v46) |
| 4. Smoke | 2–3 manual questions or full verifier suite | Subset: latest cash up + one why query |
| 5. Full verify | `nil-why`, `cash-up-flexible-period`, `executive-brief` | Same scripts with prod env |
| 6. Trace check | Confirm `cashUpProductionTrace` absent unless `ASK_NAC_CASHUP_TRACE=true` | Same |

**Do not deploy** `vault-drive-sync` in the same change batch unless Drive ingest changed — independent failure domain.

### 3.3 Migration deploy flow

See Part 4. Migrations **always** land on staging first.

### 3.4 Netlify deploy flow

| Site | Trigger | Branch | Env |
|------|---------|--------|-----|
| **nacmenu** (public) | Auto on `main` | `main` | No `PLATFORM_MODE` or `public` |
| **nac-os** (admin prod) | Auto on `main` | `main` | `REACT_APP_PLATFORM_MODE=admin`, prod Supabase |
| **nac-os-staging** (admin staging) | Manual or `staging` branch | `staging` or manual deploy | `admin` + staging Supabase |

**Production Netlify should not be manually deployed** except hotfix — match existing operator preference.

**Supabase redirect URLs:** add staging admin URL to Auth redirect allowlist when staging site exists.

### 3.5 Verifier flow

```
┌─────────────────────────────────────────┐
│  Load env: SUPABASE_URL, ANON_KEY,      │
│  SUPABASE_PROJECT_REF, ASK_NAC_VERIFY_* │
└─────────────────────────────────────────┘
                    │
                    ▼
         Magic-link or ASK_NAC_ACCESS_TOKEN
                    │
                    ▼
         POST /functions/v1/ask-nac (read-only)
                    │
                    ▼
         Assert intent, sections, metrics, guards
                    │
                    ▼
         PASS / FAIL exit code
```

**Staging gate (required before prod Edge/migration):** full suite.  
**Production gate (after prod deploy):** smoke + one deep verifier matching the change (e.g. NIL change → `nil-why-prod-verify.mjs`).

Future npm scripts (recommended, not implemented):

```bash
npm run verify:staging   # all staging verifiers
npm run verify:prod:smoke  # 2-query smoke
npm run verify:prod:full   # full suite before major releases
```

---

## Part 4 — Migration flow

### 4.1 Safe database migration lifecycle

```
Create migration (supabase migration new)
        │
        ▼
Review SQL: idempotent where possible, RLS included, no destructive DDL without plan
        │
        ▼
npm test (RLS contract tests, e.g. externalContextFoundation.test.js, vaultPermissions.test.js)
        │
        ▼
Apply STAGING: supabase link --project-ref <STAGING> && supabase db push
        │
        ▼
JWT / RLS matrix checks (manual or scripted)
        │
        ▼
Staging Edge deploy (if functions depend on new schema)
        │
        ▼
Staging verifiers
        │
        ▼
Apply PRODUCTION: supabase link --project-ref zeyhvjuraqnlbdycgrme && supabase db push
        │
        ▼
Production verifiers
        │
        ▼
Commit migration file to git (already done before push, ideally)
```

### 4.2 JWT / RLS matrix (minimum)

For any migration touching vault, external context, or WhatsApp tables, validate **at least**:

| Persona | Branch | Expected |
|---------|--------|----------|
| Khobar branch manager | khobar | Read own branch vault + context; no Riyadh rows |
| Riyadh branch manager | riyadh | Same isolation |
| CEO / cross_branch role | all | Read all branches where policy allows |
| Staff (limited sensitivity) | own branch | Cannot read `confidential` competitor observations |
| Anon / unauthenticated | — | No vault or context reads |

**Existing test anchors:** `src/intelligence/externalContext/externalContextRlsContract.js`, `externalContextFoundation.test.js`, `vaultPermissions.test.js`, `vaultBulkImportRls.test.js`.

Hosted staging validates real Supabase Auth JWTs; local unit tests validate contract logic.

### 4.3 Rollback strategy

Supabase migrations are **forward-only** by default. Plan accordingly:

| Scenario | Strategy |
|----------|----------|
| **Migration not yet on prod** | Fix forward in new migration; re-apply on staging |
| **Migration on prod, non-destructive bug** | Ship corrective migration; redeploy Edge if needed |
| **Migration on prod, destructive error** | Restore from Supabase **Point-in-Time Recovery** (Pro plan); rehearse on staging first |
| **Edge regression without schema change** | Redeploy previous function version from known-good git commit |
| **Data seed mistake on staging** | Truncate staging tables or rebuild staging project — **never** experimental deletes on prod |

**Rollback rehearsal (quarterly):** on staging, deploy ask-nac vN, then redeploy vN-1 from git tag; confirm verifiers still pass.

### 4.4 Migrations — current gaps to close

- External context + WhatsApp foundation migration exists in repo but **not applied to production** — ideal **first staging rehearsal** before prod apply.
- Document "migration + Edge dependency" pairs (e.g. external context tables required before Edge retrieval returns rows).

---

## Part 5 — Edge function flow (ask-nac)

### 5.1 Deployment standards

1. **Single function per deploy** — `ask-nac` only unless shared `_shared` changes require coordinated deploy of another function.
2. **Version tracking** — record Supabase VERSION integer and UTC timestamp after each deploy (`supabase functions list`).
3. **Bundled shared code** — all `_shared/*` imports ship with the function; no separate package deploy.
4. **Secrets unchanged by default** — do not toggle `ASK_NAC_CASHUP_TRACE` on production unless debugging an incident.
5. **Read-only verification** — default verifiers must not mutate production vault data.

### 5.2 Pre-deploy checklist

- [ ] Working tree clean; on intended commit
- [ ] `npm test -- --watchAll=false` passed
- [ ] `CI=true npm run build` passed
- [ ] Staging deploy + staging verifiers passed (once staging exists)
- [ ] Migration applied to staging if schema-dependent
- [ ] Review diff for `_shared/askNacOrchestrator.ts`, vault tools, NIL, external context retrieval
- [ ] Confirm no debug flags enabled in production secrets

### 5.3 Post-deploy checklist

- [ ] Record VERSION + timestamp
- [ ] Run prod smoke: `show latest cash up`, one NIL why query
- [ ] Confirm no `cashUpProductionTrace` / `cashUpDebug` in HTTP body (default env)
- [ ] Check Edge logs for error spike (Supabase dashboard)
- [ ] If executive brief changed: spot-check "Electronic payments" wording

### 5.4 Emergency rollback

```
1. Identify last known-good git commit (e.g. 02c4dba)
2. git checkout <commit> -- supabase/functions/ask-nac supabase/functions/_shared/
3. supabase functions deploy ask-nac --project-ref zeyhvjuraqnlbdycgrme
4. Run prod smoke verifiers
5. Forward-fix on main; do not leave branch detached
```

**Time target:** &lt; 15 minutes for Edge-only rollback. Schema rollbacks are **not** quick — prefer forward migrations.

### 5.5 vault-drive-sync

Independent lifecycle. Deploy to staging first when changing Drive ingest. Production schedule uses `DRIVE_SCHEDULED_INGEST_SECRET` — staging should use a **different** secret and optionally disabled cron until needed.

---

## Part 6 — Verifier strategy

### 6.1 Inventory

| Script | Purpose | Mutates data? | Target today |
|--------|---------|---------------|--------------|
| `nil-why-prod-verify.mjs` | NIL why structure, external context guard, forbidden narration markers | No | Production |
| `cash-up-flexible-period-prod-verify.mjs` | Flexible periods, comparisons, delivery mix (8 queries) | No | Production |
| `cash-up-period-prod-verify.mjs` | Phase C1/C2 period analytics (8 queries) | No | Production |
| `executive-brief-prod-verify.mjs` | Executive brief shape, export payload, optional Netlify bundle check | No | Production |
| `ck1-prod-verify.mjs` | Company Knowledge upload + ingestion probe | **Yes** (uploads) | Production — **staging only** after staging exists |
| `doc-search-prod-investigate.mjs` | Admin vs scoped FTS visibility comparison | No | Diagnostic |
| `render-asknac-executive-pdf.mjs` | Local PDF render / visual regression | No | Diagnostic |
| `render-pdf-table-contrast-compare.mjs` | PDF contrast before/after | No | Diagnostic |

Generated bundles under `tmp-vault-verify/` (gitignored) support PDF/export checks — not deploy gates.

### 6.2 Classification

| Class | Scripts | When to run |
|-------|---------|-------------|
| **Production verifier** | `nil-why`, `cash-up-flexible-period`, `cash-up-period`, `executive-brief` | After prod deploy; smoke subset minimum |
| **Staging verifier** | Same scripts with staging `SUPABASE_*` env | **Before** prod deploy — blocking gate |
| **Diagnostic script** | `doc-search-prod-investigate`, PDF render/compare | Investigation only; never blocking |
| **Staging-only mutating** | `ck1-prod-verify` | Staging only; rename to `ck1-verify.mjs` when parameterized |

### 6.3 Recommended organization (future)

```
scripts/
  verify/
    lib/
      auth.mjs          # shared magic-link / token helper
      config.mjs        # SUPABASE_URL, PROJECT_REF from env
    ask-nac/
      nil-why.mjs
      cash-up-flexible-period.mjs
      cash-up-period.mjs
      executive-brief.mjs
    vault/
      ck1.mjs           # staging-only default
    diagnostic/
      doc-search-investigate.mjs
```

**Near-term (low effort):** keep `tmp-vault-verify/` paths; add `TARGET_ENV=staging|production` documentation; never hardcode project refs or emails (already sanitized).

**Auth standard:** prefer `ASK_NAC_ACCESS_TOKEN` in CI; magic-link via `ASK_NAC_VERIFY_EMAIL` + `ASK_NAC_VERIFY_REDIRECT` for local operator runs.

### 6.4 Verifier coverage gaps

| Area | Covered? | Action |
|------|----------|--------|
| Ask NAC cash-up / NIL | Yes | Maintain |
| Executive brief / PDF export | Partial | Run `executive-brief` on staging before brief changes |
| External context with rows | No (prod tables empty) | Add staging fixture rows + verifier after migration applied to staging |
| vault-drive-sync | No HTTP verifier | Add staging cron smoke or manual checklist |
| WhatsApp webhook | N/A | Add `whatsapp-webhook-staging-verify.mjs` when built |
| Trace gating | Manual | Add explicit assert to cash-up verifier: `cashUpProductionTrace` absent |

---

## Part 7 — WhatsApp future deployment path

**Not implemented.** Architecture foundation: `docs/architecture/whatsapp-ask-nac-architecture.md`.

### 7.1 Components to deploy (future)

| Component | Type | Staging first? |
|-----------|------|----------------|
| `whatsapp_users` / `whatsapp_message_logs` tables | Migration | **Yes** — apply on staging with foundation migration |
| `whatsapp-webhook` Edge function | New function | **Yes** — sandbox provider → staging URL |
| Provider credentials (Meta/Twilio) | Edge secrets | Separate staging app / sandbox |
| RBAC resolution | In webhook via existing vault helpers | Test all branch personas on staging |
| `whatsapp_message_logs` inserts | Service role from webhook | Verify RLS: admin read only |
| Outbound message formatting | `whatsappResponseFormatter.js` | No debug/trace in default responses |

### 7.2 Deployment sequence (when implemented)

```
1. Apply WhatsApp DDL on staging (same migration as external context foundation)
2. Seed staging whatsapp_users (test E.164 numbers)
3. Deploy whatsapp-webhook to staging
4. Configure provider sandbox → staging function URL
5. Run allowlist + RBAC tests (unknown phone denied, branch manager scoped)
6. Run Ask NAC parity tests via WhatsApp (cash-up, why query)
7. Verify whatsapp_message_logs rows + no PII leakage in logs
8. Production: migration → deploy webhook → provider prod number → smoke test with 1 admin phone
```

### 7.3 WhatsApp-specific risks

- **Webhook auth** — signature verification mandatory before any prod traffic.
- **Parallel RBAC** — must not bypass `ask_nac_vault_branch_allowed`; WhatsApp allowlist is necessary but not sufficient.
- **Production phone numbers** — only after staging sandbox passes; keep provider sandbox on staging indefinitely for regression.

---

## Part 8 — Recommendation

### 8.1 Minimum viable environment strategy

For NAC OS today — self-funded, one primary developer, three branches, limited budget:

| Priority | Action | Effort |
|----------|--------|--------|
| **P0** | Create **one staging Supabase project** | ~1 hour |
| **P0** | Apply full migration history to staging (`db push` or pull baseline from prod schema) | ~1–2 hours |
| **P0** | Deploy `ask-nac` to staging; copy Edge secrets (staging OpenAI key) | ~30 min |
| **P0** | Parameterize verifiers via env; run full suite against staging before prod deploys | ~2 hours doc + habit |
| **P1** | Add **staging Netlify admin site** pointing at staging Supabase | ~1 hour |
| **P1** | Add `.env.staging.example`; document `supabase link` switching | ~30 min |
| **P1** | Rehearse external context migration on staging before prod apply | ~2 hours |
| **P2** | `npm run verify:staging` / `verify:prod:smoke` scripts | ~1 hour |
| **P2** | Move CK1 verifier to staging-only default | ~30 min |
| **P3** | GitHub Actions: test + build on PR (no auto deploy) | ~half day |
| **Defer** | Second staging project, per-PR Supabase branches, prod-like data clone | — |

### 8.2 What should be built next?

**Build staging Supabase + staging ask-nac deploy + verifier gate habit.**

That single step removes the highest-risk pattern (prod-first Edge and migration testing) for the lowest monthly cost. Staging Netlify admin site is second — needed before UI-heavy releases, less urgent for Edge-only intelligence changes if verifiers cover HTTP behavior.

WhatsApp and External Context prod rollout should **not** proceed until:

1. Foundation migration applied and verified on **staging**.
2. External context verifier passes with fixture rows on staging.
3. WhatsApp webhook passes sandbox tests on staging.

### 8.3 Summary answers

| Question | Answer |
|----------|--------|
| **Architecture recommendation** | Local → **Staging** → Production; one staging Supabase + one staging admin Netlify site |
| **Estimated monthly cost impact** | **$0–25** (free tier viable; ~$25 with Supabase Pro staging) |
| **Biggest current deployment risk** | **Production-only Edge deploys and migration applies** with post-hoc verification |
| **Fastest path to staging readiness** | New Supabase project → `db push` migrations → deploy ask-nac → run existing verifiers with staging env vars |

---

## Related documents

| Document | Topic |
|----------|-------|
| [SUPABASE_DEPLOY.md](../SUPABASE_DEPLOY.md) | CLI link, migrations, db push |
| [NACOS_DEPLOYMENT.md](../NACOS_DEPLOYMENT.md) | Netlify public vs admin |
| [whatsapp-ask-nac-architecture.md](./whatsapp-ask-nac-architecture.md) | WhatsApp foundation |
| [external-context-intelligence.md](./external-context-intelligence.md) | External context schema + RLS |
| [ask-nac-consolidation-roadmap.md](./ask-nac-consolidation-roadmap.md) | Product surfaces vs engines |

---

## Document history

| Date | Change |
|------|--------|
| 2026-06-21 | Initial environment strategy (architecture only) |
