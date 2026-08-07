# Inventory & Cost Control release gates

## Mandatory unresolved gate

- Authenticated non-super-admin branch-user RLS smoke test.

This must be completed with a safe real Khobar-only session before Netlify deployment, branch rollout, or wider NAC deployment. Do not weaken RLS, use production employee credentials without authorization, or manipulate the auth database directly to satisfy this gate.

## Phase C scope model

- Recipe definitions may be network/brand-like shared definitions or branch overrides.
- Historical recipe and product cost always requires an explicit authorized `branch_id`.
- Future definition resolution may follow branch override -> brand default -> company/group default.
- Physical stock, purchasing history, weighted-average cost, and recipe execution cost remain branch-specific.
- Phase C does not implement company/brand inheritance or persist calculated cost as canonical truth.
