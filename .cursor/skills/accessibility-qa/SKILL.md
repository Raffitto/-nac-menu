---
name: accessibility-qa
description: Keyboard, labels, and contrast checks for NAC admin UI. Use when changing interactive controls, dialogs, tabs, or when the user asks for accessibility.
---

# Accessibility QA

Provenance: inspired by addyosmani/accessibility via VoltAgent catalogue. Not a WCAG certification skill.

- Every icon-only control needs an accessible name.
- Dialogs must be keyboard-dismissible and focus-trapped if already patterned that way.
- Do not rely on color alone for Complete / missing / stale.
- Unavailable data must be announced as unavailable, not "0".
