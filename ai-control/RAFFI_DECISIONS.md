# Decisions that require Raffi

Keep this file empty of routine notes. Only unresolved ASK_RAFFI items.

## Open (autonomous loop v1)

- **CURSOR_API_KEY (optional):** Not stored in git. If Raffi wants GitHub Actions to spawn Cursor CLI/cloud agents without commenting `@cursor`, add a repository secret named `CURSOR_API_KEY`. Until then, laptop-off execution uses **Cursor Cloud Agents via `@cursor` on the Control Room issue** (no extra subscription) or `workflow_dispatch` of the deterministic worker.

- Individual Cursor Models **percentage cannot be read via official public API/CLI**. Raffi should glance at the dashboard near the 88–90% cutoff.
