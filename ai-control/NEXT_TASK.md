---
taskId: NAC-CTRL-0001
permission: AUTO
complexity: SMALL
deterministic: true
testBudget: aiControlProtocol|externalRealityEngine
deploy: none
onDemandAllowed: false
mergeToMain: false
---

# NAC-CTRL-0001 — Prove the GitHub control protocol

## Objective

Prove a full supervisor → worker cycle with a tiny non-production change: control-protocol validation metadata plus a focused test.

## Context

External Reality Engine v1 is committed at `d0d345f3320e77981b4b1a956317bbf2393d7597`. This task is infrastructure only.

## Allowed scope

- `ai-control/*`
- `scripts/ai-control-worker.mjs`
- `src/intelligence/askNac/shared/aiControlProtocol.test.js`
- `supabase/functions/_shared/companyIntelligence/externalReality/ossReferenceRegistry.ts` (metadata only)

## Forbidden scope

- production deploys, Netlify, Ask NAC Edge
- main merge
- secrets, auth, migrations, paid APIs
- OpenClaw retry
- restaurant feature work

## Acceptance criteria

- STATE.json validates against protocolVersion 1
- OSS registry still records OpenClaw REJECTED and Open-Meteo USE
- `CONTROL_PROTOCOL_META.validated === true`
- focused tests pass
- LAST_HANDOFF.md written
- STATE status `awaiting_review`
- push working branch only

## Test budget

`CI=true npx react-scripts test --watchAll=false --testPathPattern='aiControlProtocol|externalRealityEngine'`

## Deployment permission

none

## Cost constraints

- permission AUTO
- no on-demand Cursor models
- no paid APIs
- do not start a LARGE milestone
