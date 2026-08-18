# NAC Engineering WhatsApp Control Bridge (proof)

Bounded adapter for Raffi ↔ GitHub `ai-control/*` via WhatsApp. **Not production Ask NAC transport.**

## Architecture

```
WhatsApp ↔ whatsapp-web.js (future) ↔ this adapter ↔ GitHub issue #2 / ai-control/*
```

The bridge does **not** edit production code or data directly.

## Controller allowlist

Set via environment at runtime (not committed):

```bash
export NAC_COMMS_CONTROLLER_E164="+966555024241"
```

Only allowlisted controllers may produce GitHub artifacts. Unknown numbers are ignored.

## Session credentials

WhatsApp Web session directories (`LocalAuth`) must live outside the repo. Never commit session JSON, tokens, or QR artifacts.

## OSS recommendation

See `ossEvaluation.json` — **whatsapp-web.js 1.34.7** (Apache-2.0).

## Laptop-off

See `hostingVerdict.js` — persistent WhatsApp requires always-on host; founder-free mode has no $0 24/7 option today.
