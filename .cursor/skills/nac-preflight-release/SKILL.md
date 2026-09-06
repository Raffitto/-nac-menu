---
name: nac-preflight-release
description: Pre-flight checklist before any NAC production deploy. Use when the user asks to deploy, push main, or ship a runtime milestone.
---

# NAC pre-flight release

Before any production deploy, reason through each surface. If the change does not touch an area, use targeted regression — do not reimplement the world.

| Surface | Check |
|---|---|
| AUTH | Session, password recovery, no leaked tokens |
| RBAC | Fady Khobar, Super Admin diagnostics, branch clamp |
| OVERVIEW | First useful paint, no routine live `get_bi_dashboard` |
| ASK NAC | Coverage, comparisons, no invented numbers |
| REVIEWS | Snapshot/QR metrics, not Places zeros |
| REPORTS | Cash Up, Drive reviews, Foodics creator/grouped, August Complete |
| MENU | Catalogue schema contract, editor `desc_*` path |
| FOOD BIBLE | Uploads/links unchanged unless requested |
| DATABASE | Migrations reviewed; no assumed columns |
| NETLIFY | This is the one allowed deploy for the milestone |

Run `npm run verify:release` locally. Do not push intermediate commits.
