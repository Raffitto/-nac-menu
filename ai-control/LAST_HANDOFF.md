# LAST_HANDOFF

- task ID: **NAC-COMMS-0001**
- result: **PASS_WITH_HOSTING_BLOCKER**
- WhatsApp control bridge: **PASS_WITH_HOSTING_BLOCKER**

## Recommended OSS

| Field | Value |
|---|---|
| Candidate | **whatsapp-web.js** |
| Package / version | `whatsapp-web.js@1.34.7` |
| License | Apache-2.0 (commercial self-host OK) |
| Alternative evaluated | `@wppconnect/server@2.10.0` (Apache-2.0) — REFERENCE ONLY |

**Why whatsapp-web.js over wppconnect-server:** Single-controller engineering bridge needs one WhatsApp Web session, allowlist gate, and GitHub adapter — not a multi-session REST server. Lower implementation footprint; `LocalAuth` session persistence; same send/receive/media capabilities.

## Capabilities proven (adapter layer)

| Capability | Status |
|---|---|
| Send (outbound formatting) | PASS — daily handoff summary + blocker/decision request payloads |
| Receive (inbound normalization) | PASS — QUESTION, STATUS_REQUEST, CHANGE_REQUEST, APPROVAL, REJECTION, ATTACHMENT |
| Text | PASS |
| Media / attachment metadata | PASS — filename, mimetype, byteLength; local paths excluded from GitHub artifacts |
| Session persistence | DOCUMENTED — `LocalAuth` dir outside repo (not wired live in this proof) |
| Reconnect | DOCUMENTED — library reloads persisted session on process restart |
| Controller allowlist | PASS — only configured E.164 allowlist; unknown rejected deterministically |
| GitHub control-plane integration | PASS — `buildGitHubControlArtifact` routes AUTO → artifact, ASK_RAFFI → pending decision, unknown → ignore; references `PERMISSIONS.md` |

## Laptop-off 24/7 zero-cost verdict

**FREE SOFTWARE PROVEN; LAPTOP-OFF 24/7 HOSTING BLOCKED IN FOUNDER-FREE MODE**

| Runtime | Persistent WhatsApp? | $0 recurring? | Notes |
|---|---|---|---|
| GitHub Actions | No | Yes | Event-driven; cannot hold Chromium 24/7 |
| Cursor Cloud Agents | No | Yes | Engineering worker only (`@cursor` on issue #2) |
| Supabase Edge | No | Yes | Wrong runtime for Puppeteer/WhatsApp Web |
| Raffi laptop (local Node) | Yes (when on) | Yes | Proof path for send/receive |
| Future VPS / always-on hardware | Yes | Not $0 without purchase | Cheapest future path if Raffi approves |

**Free persistent host found for WhatsApp bridge:** **none** at $0 with laptop off.

## Security boundaries

- Unknown numbers: no GitHub task changes, no private engineering state leaked
- `approve` / `reject` / `change`: ASK_RAFFI — recorded, not auto-executed
- No session credentials, tokens, or QR material in git
- Controller phone redacted in artifacts (`+966…41` pattern)
- Allowlist via runtime env `NAC_COMMS_CONTROLLER_E164` (not committed)

## Custom code added

```
ai-control/comms/
  allowlist.js, constants.js, phone.js, normalizer.js, outbound.js
  githubIntegration.js, hostingVerdict.js, ossEvaluation.json
  index.js, README.md
src/intelligence/askNac/shared/whatsappBridge.test.js
```

Also updated: `aiControlProtocol.test.js`, `ossReferenceRegistry.ts`, `docs/architecture/oss-reference-registry.md`

## Tests

`whatsappBridge|aiControlProtocol` — **18 passed**

## Cost / deploy

| Item | Value |
|---|---|
| Recurring cost | **0** |
| Paid API calls | **0** |
| Deploys | **none** |
| Netlify | untouched |
| Migrations | none |

## Branch / commit

- branch: `release/ask-nac-fabric-founding-day`
- base HEAD at task start: `a46f83cef85b8ba1a768b5a6370dab02b90e8fa2`
- handoff commit SHA: `42ada7e64f917c962a38a282b771c816eb45e380` (feature)
- control plane HEAD: `a038fee9bd3b95e9bf32a6b1148bc74365cd78cc`
- GitHub Control Room issue: **#2**

## Next recommendation

1. Raffi reviews this handoff (`awaiting_review`).
2. For live WhatsApp proof: run thin `whatsapp-web.js` host locally with `NAC_COMMS_CONTROLLER_E164` and session dir outside repo.
3. For laptop-off **engineering** (not WhatsApp): continue `@cursor` on issue #2.
4. For laptop-off **WhatsApp 24/7**: record decision in `RAFFI_DECISIONS.md` — existing always-on hardware vs minimal VPS spend.
5. Do **not** start the next product milestone until supervisor issues new `NEXT_TASK.md` taskId.
