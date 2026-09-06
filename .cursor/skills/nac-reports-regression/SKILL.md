---
name: nac-reports-regression
description: Protects Reports and Staff Performance sources and formulas. Use when touching Export Center, Cash Up, review tracking, Foodics Sales by Creator, Drive ingest, or August eligibility.
---

# NAC reports regression

Do not redesign Reports unless explicitly requested.

Protect:

- Cash Up canonical Vault source
- Google Drive review tracking source
- Foodics Sales by Creator
- Foodics grouped product report
- zero-row batch integrity (empty is empty, not a fake complete file)
- Staff Performance formulas
- August historical eligibility rules

If a change is unrelated, do not edit these modules. After any related change, run `src/dashboard/exportCenter/reportsReadiness.test.js` and `augustVacationEligibility.test.js` locally. September readiness must stay fast; August must remain Complete when sources are present.
