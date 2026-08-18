# Decisions that require Raffi

Keep this file empty of routine notes. Only unresolved ASK_RAFFI items.

## Open (autonomous loop v1)

- **GitHub Control Room issue:** `gh` is not logged in on this worker, so the issue could not be created from here. Create it from the body in `ai-control/CONTROL_ROOM_ISSUE.md` (or `gh auth login` then `gh issue create`). Put the number into `STATE.json` → `controlRoomIssue`.

- **CURSOR_API_KEY (optional):** Not stored in git. Only needed if GitHub Actions should spawn Cursor CLI. Laptop-off **model** work can use `@cursor` on the Control Room issue instead.

- Individual Cursor Models **percentage cannot be read via official public API/CLI**. Glance the dashboard near the 88–90% cutoff.
