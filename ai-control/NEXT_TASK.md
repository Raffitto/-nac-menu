---
taskId: NAC-COMMS-0001
permission: AUTO
complexity: MEDIUM
deterministic: false
testBudget: whatsappBridge|aiControlProtocol
deploy: none
onDemandAllowed: false
mergeToMain: false
issuedAt: 2026-08-18T23:05:00+03:00
---

# NAC-COMMS-0001 — Free WhatsApp Engineering Control Bridge Proof

## Objective

Prove a free/self-hosted WhatsApp bridge that can make Raffi's WhatsApp the human control room for NAC engineering without introducing a paid recurring dependency.

This is NOT a production rollout yet. It is a bounded proof and architecture decision.

## Context

- Autonomous control plane is live on `release/ask-nac-fabric-founding-day`.
- GitHub Control Room issue is #2.
- Raffi wants to receive daily engineering updates, ask questions, send screenshots/files, and issue change requests from WhatsApp.
- Current daily ChatGPT handoff remains in ChatGPT until a WhatsApp path is proven.
- Founder mode: recurring paid services are not allowed.
- Candidate OSS already identified: `wwebjs/whatsapp-web.js`, `wppconnect-team/wppconnect-server`, `wppconnect-team/wa-js`.
- Do NOT use Twilio, paid Meta Business API providers, paid VPS, or another paid SaaS.

## Core questions to answer quickly

1. Which candidate is the lowest-maintenance fit for NAC?
2. Is the software license acceptable for long-term self-hosted/commercial NAC use?
3. Can it send and receive text + image/file attachments?
4. Can one allowlisted WhatsApp number act as the only controller?
5. Can it survive reconnect/restart with persisted session credentials safely?
6. Can it integrate cleanly with GitHub `ai-control/*` / issue #2?
7. Can it operate while Raffi's laptop is OFF with ZERO recurring hosting cost using infrastructure already available to us?
8. If true always-online zero-cost hosting is impossible, prove that constraint and identify the closest safe free architecture instead of buying anything.

## OSS-first evaluation

Evaluate in this order:

1. `wppconnect-team/wppconnect-server`
2. `wwebjs/whatsapp-web.js`
3. lower-level alternatives only if the first two fail materially

For each serious candidate verify from official repo/package metadata:

- license
- current maintenance/activity
- self-hostability
- no mandatory hosted subscription
- send/receive text
- media/download support
- auth/session persistence
- reconnect behavior
- security implications
- implementation footprint

Do not spend hours comparing every WhatsApp library on GitHub.

## Preferred architecture

If feasible:

WhatsApp
↔ self-hosted bridge
↔ tiny NAC comms adapter
↔ GitHub Control Room / `ai-control/*`
↔ supervisor / Cursor worker

The WhatsApp bridge must NOT directly edit production code or data.

Inbound messages should become structured control events such as:

- QUESTION
- STATUS_REQUEST
- CHANGE_REQUEST
- APPROVAL
- REJECTION
- ATTACHMENT

The control plane decides what happens next.

## Controller security

Only Raffi's allowlisted controller number may issue engineering commands:

`+966555024241`

Do NOT commit the number into logs unnecessarily; config may contain it if needed for the proof, but prefer normalized allowlist config with minimal exposure.

Unknown numbers:
- must not trigger GitHub task changes
- must not receive private NAC engineering state
- should be ignored/rejected deterministically

No secrets committed.

## Proof scope

Build the smallest local adapter/prototype needed to prove:

### Outbound
Generate/send-equivalent payload for:
- daily handoff summary
- blocker/decision request

### Inbound
Normalize:
- text question
- `approve` / `reject`
- change request
- screenshot/image metadata or downloaded attachment reference

### GitHub integration
Demonstrate that an authorized normalized inbound command can safely create/update a NON-PRODUCTION control artifact or issue comment through the existing control protocol.

Do not let WhatsApp messages directly bypass `PERMISSIONS.md`.

## Laptop-off requirement

This is critical.

Research/evaluate only zero-recurring-cost runtime options that are genuinely usable for a persistent WhatsApp Web session.

Check whether any already-available free infrastructure in our current stack can safely run the required persistent process.

Do NOT pretend GitHub Actions can maintain a permanent WhatsApp Web session if it cannot.

Do NOT provision anything paid.

If a persistent WhatsApp Web session fundamentally requires an always-on host and we currently have no genuinely free persistent host, verdict should explicitly say:

`FREE SOFTWARE PROVEN; LAPTOP-OFF 24/7 HOSTING BLOCKED IN FOUNDER-FREE MODE`

and recommend the cheapest future option without purchasing it.

## Visibility improvement

While touching the control protocol, add only a SMALL human-readable status view if cheap:

`ai-control/CURRENT_STATUS.md`

It should show:
- IDLE / WORKING / BLOCKED / WAITING FOR RAFFI / STOPPED_BUDGET
- active task ID/title
- started/updated timestamp
- current stage
- latest commit
- tests/status
- next expected action

Keep `STATE.json` as source of truth.

Do not build a UI.

## Do not do

- no production deploy
- no Edge deploy
- no Netlify
- no main merge
- no paid Meta/Twilio/API
- no paid VPS
- no new agent framework
- no OpenClaw retry
- no restaurant product feature work
- no broad repo tests
- no storing WhatsApp session credentials in git
- no sending real NAC data to unknown numbers

## Tests

Focused only.

Cover at minimum:
- controller allowlist
- unknown sender rejection
- inbound event normalization
- permission gate preserved
- outbound daily-summary formatting
- attachment metadata handling
- no secret/session material in persisted repo output
- control protocol still valid

## Acceptance criteria

Return PASS only if you can prove the software integration is technically viable and free/self-hosted.

A blocked zero-cost 24/7 host does NOT mean the library proof fails; distinguish:

- bridge software suitability
- local send/receive feasibility
- laptop-off hosting feasibility

## Final handoff

Write `ai-control/LAST_HANDOFF.md`, update `STATE.json`, and report:

- **WhatsApp control bridge: PASS / PASS_WITH_HOSTING_BLOCKER / REJECT**
- recommended OSS candidate + exact version/commit
- license
- why chosen over alternatives
- send capability
- receive capability
- text/media support
- session persistence/reconnect behavior
- controller-number allowlist behavior
- GitHub control-plane integration proof
- laptop-off 24/7 zero-cost verdict
- any free runtime actually found
- custom code/files added
- focused tests
- security boundaries
- recurring cost: must remain 0 for this proof
- paid calls: 0
- deploys: none
- Netlify untouched
- next recommendation

Then STOP in `awaiting_review`.

Do not start the next product milestone automatically.
