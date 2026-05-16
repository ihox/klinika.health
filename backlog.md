# Backlog

Deferred follow-ups captured during in-flight work. Items here are not
in-progress; they're parked until someone picks them up. Keep entries
brief — file paths, effort estimate, priority, and a pointer to the
original work that surfaced the need.

---

## design(prototype): remove cancelled status from design-reference/prototype/

- **Files:** receptionist.html, doctor.html, overview.html, styles.css, tokens/*
- **Scope:** remove all cancelled UI references + `--status-cancelled-*` tokens
- **Effort:** ~45–60 min Claude Design pass
- **Priority:** medium (prototype is reference, not deployed code)
- **Reference:** commit 1492868 removed these from the app, prototype still carries them

## docs: revise lifecycle docs to reflect 5-state model

- Any ADR or status-lifecycle doc referencing the old 6-state set (with cancelled) should be updated
- The canonical states are now: scheduled / arrived / in_progress / completed / no_show
- **Effort:** ~30 min
- **Priority:** low (internal docs, no user impact)
