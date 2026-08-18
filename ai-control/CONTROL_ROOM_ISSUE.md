# Create this GitHub issue (gh was not authenticated on the worker)

Title: `NAC Autonomous Engineering Control Room`

Use branch `release/ask-nac-fabric-founding-day`.

Then set `ai-control/STATE.json` field `controlRoomIssue` to the issue number.

Body:

```
Long-lived audit trail for NAC autonomous engineering. Repo files remain source of truth.

Pointers:
- ai-control/STATE.json
- ai-control/NEXT_TASK.md
- ai-control/LAST_HANDOFF.md
- ai-control/DECISIONS.md
- ai-control/PERMISSIONS.md
- ai-control/PROTOCOL.md
- docs/architecture/oss-reference-registry.md
- ai-control/RAFFI_DECISIONS.md

Laptop-off:
1. New taskId in NEXT_TASK.md + push
2. Comment @cursor on this issue (Cursor Cloud Agent)
3. Or: gh workflow run "NAC AI Control Worker" --ref release/ask-nac-fabric-founding-day

SHAs:
- External Reality: d0d345f3320e77981b4b1a956317bbf2393d7597
- Control plane: aa702f23418652832226cf23f9aac031e53a829c
- Proof NAC-CTRL-0001: ea958bf36aa682b6434571d09a8c635a4c190825
```
