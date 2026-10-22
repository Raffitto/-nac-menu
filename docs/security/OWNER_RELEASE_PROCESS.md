# NAC owner-controlled release process

## Authority
- Raffitto is the sole business owner and final approver of production changes.
- No approval or action from Alex is required.
- The assistant can inspect, prepare patches, run read-only checks, and propose pull requests. It cannot substitute for an independent GitHub review required by branch protection.
- No production database migration or deployment without the owner's explicit authorization for that change.

## Before merge
1. Record purpose, affected systems, rollback, and risk in the PR.
2. Run CI and focused regression tests; review actual code and database permissions.
3. Obtain any independent approval required by the existing GitHub branch protection from a trusted maintainer chosen by the owner. A bot's comment is not a GitHub approving review.
4. If no independent reviewer is available, the owner must explicitly choose a GitHub-supported governance change through repository Settings; do not silently disable review protection or attempt to bypass it.
5. Merge only after requirements are satisfied. Deploy in a deliberate release window and verify production.

## Current security queue (2026-10-22)
- PR #49: historical inventory counter exposure; current production read-only checks show RLS enabled, no anon table SELECT/UPDATE, no anon function EXECUTE, and function role guards. Do not apply old proposed migration.
- PR #70: proposed anonymous SELECT revocation on menu_item_visibility_stats, NOT APPLIED. Confirm no public menu feature relies on the view before approving.
- Other Security Advisor findings: separately triage security-definer view/function execution and mutable search paths; no mass changes without tests.

## Repository governance to confirm in GitHub Settings
- Inspect the active branch-protection rule for main (the GitHub App cannot read that admin-only endpoint).
- Keep mandatory CI and disallow force pushes/deletions.
- Determine whether review requirement is truly necessary for this sole-owner repository; if kept, appoint an independent trusted reviewer. Do not rely on Alex.
- Record the owner's chosen approach before changing repository settings.
