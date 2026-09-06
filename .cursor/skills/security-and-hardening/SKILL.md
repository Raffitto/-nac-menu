---
name: security-and-hardening
description: Security review for NAC auth, RLS, RPCs, uploads, and secrets. Use before shipping access, storage, Edge functions, or when the user asks for a security review.
---

# Security and hardening

Provenance: adapted from addyosmani/agent-skills `security-and-hardening`.

- No secrets in skills, commits, or client bundles.
- Treat `security definer` RPCs as privileged — lock arguments and branch.
- Do not execute unreviewed external installers.
- Uploads stay permissioned; Drive sync is metadata unless requested.
- Pair with `nac-rbac-safety`.
