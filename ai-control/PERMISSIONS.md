# Permission classes for autonomous NAC work

## AUTO (default for NEXT_TASK unless stated otherwise)

- inspect repo/code
- research free OSS (bounded)
- modify scoped working-branch files
- write tests
- run focused tests
- relevant linters only
- update docs/control files
- commit and push the working branch
- read-only verification
- local benchmarks
- update GitHub Control Room issue comments

## AUTO_WITH_GUARDRAILS

Only if NEXT_TASK.md frontmatter grants it:

- deploy an already-approved Ask NAC Edge milestone
- non-destructive production smoke tests
- known idempotent ingestion/recovery
- non-destructive development resources

## ASK_RAFFI (stop; write RAFFI_DECISIONS.md)

- merge to main
- destructive DB / data deletion
- risky production migration
- auth/account/secrets changes
- new paid service/API/subscription
- on-demand Cursor spend
- new commercial license dependency
- material product/business decision
- irreversible architecture migration
- production actions that affect restaurant operations

Silence is not approval.
