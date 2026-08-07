# Inventory & Cost Control release gates

## Mandatory unresolved gate

- Authenticated non-super-admin branch-user RLS smoke test.

This must be completed with a safe real Khobar-only session before Netlify deployment, branch rollout, or wider NAC deployment. Do not weaken RLS, use production employee credentials without authorization, or manipulate the auth database directly to satisfy this gate.

This gate is **not** a blocker for ending a development checkpoint. It remains a release gate before Netlify / wider rollout of the inventory–cost-control chapter.

## Netlify / Edge Functions

- Do **not** deploy Netlify for the inventory / Food Bible / cost-control chapter until culinary data, recipe review, costs, trust, and operational workflow are substantially complete **and** the user explicitly approves deployment.
- Do not deploy Edge Functions unless explicitly necessary and approved.

## Phase C scope model

- Recipe definitions may be network/brand-like shared definitions or branch overrides.
- Historical recipe and product cost always requires an explicit authorized `branch_id`.
- Future definition resolution may follow branch override -> brand default -> company/group default.
- Physical stock, purchasing history, weighted-average cost, and recipe execution cost remain branch-specific.
- Phase C does not implement company/brand inheritance or persist calculated cost as canonical truth.

## Related checkpoint

See `docs/architecture/food-bible-cost-control-checkpoint-2026-08-07.md` for locked Food Bible / Foodics / brand / KSA decisions and the Chef Review backlog.
