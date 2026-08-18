---
taskId: NAC-COMMERCE-0001
permission: AUTO
complexity: HIGH
deterministic: false
testBudget: tableMix|commerce|fabric|rbac
deploy: none
onDemandAllowed: false
mergeToMain: false
issuedAt: 2026-08-18T23:26:00+03:00
---

# NAC-COMMERCE-0001 — Canonical Table-Mix Intelligence End-to-End

## Objective

Deliver one substantial management-intelligence milestone: make Ask NAC answer table/session mix questions from the canonical Foodics commerce data for arbitrary supported periods and branch scopes, deterministically and with evidence.

This is not a dashboard/UI task and not a Foodics replacement migration. Use the canonical commerce foundation already present.

## Business semantics to preserve

The agreed table archetypes are:

- `dessert-only`: desserts, no food, no beverage/coffee requirement beyond current canonical semantics
- `dessert+coffee`: desserts + coffee/drinks, **no food**
- `dessert-focused`: `dessert-only + dessert+coffee`; absolutely no food-containing session belongs here
- `food-only`
- `food+beverage`
- `full-service`: food + dessert (with/without beverage as canonical rules define)
- `food-containing`: `food-only + food+beverage + full-service`
- `coffee-only` / beverage-only where supported
- `unclassified` must remain explicit, never silently reassigned

Key management metric: **dessert conversion within food-containing sessions = full-service / food-containing**.

Do not hardcode July/August totals. The engine must compute from canonical sessions/items for the requested period.

## Required capability

For a supported branch + period, produce a deterministic table-mix result containing at minimum:

- completed dine-in session count
- covers when available
- revenue when available
- count/share by archetype
- dessert-focused share
- food-containing share
- dessert-at-all share if derivable without ambiguity
- dessert conversion within food-containing sessions
- average check by archetype where revenue exists
- explicit unclassified count/share
- data/join coverage diagnostics

Support management questions such as:

- “What % of our tables were dessert tables in July?”
- “Dessert-focused vs food-containing tables this month”
- “What was dessert conversion on food tables?”
- “Compare dessert table mix this month vs last month”
- branch-scoped variants subject to existing RBAC

## Architecture constraints

1. Reuse existing canonical order/item/table-session data and semantic product/category mapping.
2. Search the OSS registry first, but do not introduce a framework for NAC-specific restaurant semantics.
3. Keep Cash Up canonical for headline sales. Commerce revenue is evidence for table/session analysis only and must not silently override Cash Up.
4. Route through existing Ask NAC Fabric/orchestration/capability patterns; no unrestricted SQL/raw DB agent access.
5. Preserve RBAC and branch scope.
6. Preserve existing temporal/follow-up behavior; period-only follow-ups should work if the existing conversation framework supports them.
7. No fabricated values when coverage is incomplete. Surface coverage/unclassified diagnostics.
8. Avoid phrase-specific routing. Recognize the semantic intent generically.

## Implementation strategy

First inspect existing commerce canonical/session/archetype code and tests. Reuse or consolidate what exists rather than creating parallel logic.

Prefer a single deterministic capability/aggregator with a stable typed contract that can serve both Ask NAC and future dashboards.

If current archetype logic exists only in scripts/tests, promote it into the appropriate shared intelligence layer.

Add evidence metadata sufficient to explain source period, branch, session coverage, mapped/unmapped rows/products where available.

## Comparison behavior

For explicit compare intent, compute both periods independently using the same semantics and return deltas in percentage points for shares/conversion plus absolute deltas where useful.

Do not infer comparison from a plain single-period question.

## Acceptance probes

Use repository fixtures/canonical data where available. At minimum prove deterministic behavior for:

1. single-period dessert-focused share
2. food-containing share
3. dessert conversion within food-containing
4. archetype counts sum correctly including unclassified
5. comparison delta semantics
6. RBAC branch isolation
7. missing/incomplete mapping or join coverage is disclosed, not fabricated
8. Cash Up authority is not changed
9. existing commercial/Fabric behavior remains green in focused regression tests

If live canonical July/Aug data is safely available in existing fixtures/artifacts, verify against known shape but do not encode totals as expected constants unless they are fixture-specific.

## Scope discipline

Do not:

- deploy Edge
- deploy Netlify
- merge main
- run broad full-repo tests repeatedly
- change production data
- add paid services/APIs
- use on-demand Cursor spend
- rebuild the agent framework
- touch WhatsApp hosting
- redesign UI

Use focused tests first. One build at the end only if relevant.

## Budget guardrail

Individual Cursor usage percentage is not officially observable. Do not claim precision. Work conservatively; if there is evidence the session is approaching the established ~88–89% soft-stop intent, stop cleanly with a partial handoff rather than spilling to on-demand.

## Final handoff

Write `ai-control/LAST_HANDOFF.md`, update `STATE.json` and `CURRENT_STATUS.md`, commit/push the working branch, then stop in `awaiting_review`.

Report:

- PASS / PARTIAL / BLOCKED
- architecture/capability added or reused
- exact files changed
- supported question families
- deterministic archetype semantics
- comparison semantics
- coverage/evidence behavior
- RBAC proof
- Cash Up authority proof
- focused tests and counts
- build result if run
- paid calls: 0
- deploys: none
- Netlify untouched
- branch/commit SHA
- highest-leverage next recommendation
