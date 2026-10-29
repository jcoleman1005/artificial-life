# Coordination: species, brain viewer, growth (2026-10-28)

Three agents, each in its own git worktree branch off the same commit. Specs: `species.md`, `brain-viewer.md`, `growth.md`.

Ownership (to avoid merge conflicts):
- Agents must NOT edit `AGENTS.md`, `docs/STATUS.md`, `docs/decisions.md`. The coordinator updates them at merge from each agent's report.
- Shared files, edit minimally and append-only: `src/sim/protocol.ts`, `src/sim/config.ts`, `src/sim/types.ts`, `src/ui/inspector.ts`, `src/main.ts`, `src/style.css`, `scripts/fingerprint.ts`. Add new code in new files; touch shared files only for wiring, in small localized hunks.
- Species + brain viewer are observers: `npm run fingerprint` must be unchanged. Growth is the only agent allowed to change fingerprints (switches-off identity required).
- Each agent adds an "As built" section to its own spec file, commits on its worktree branch with a clear message (no push), runs `npm run verify`, and reports: files touched, config keys, protocol additions, any append-only brain inputs, test results, open questions.

Merge order (coordinator): brain-viewer → species → growth. Growth last because it changes the sim and fingerprints; rerun tests after each merge.
