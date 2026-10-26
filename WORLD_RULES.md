# World Change Rules (shared by every prompt in WORLD_PROMPTS.md)

Each prompt says "Follow WORLD_RULES.md" instead of repeating this.

## Process
1. One change per session, committed in order to `claude/new-session-9qwa4f` with a `world:` commit prefix. Use per-change branches only if push access to them is added. DNA Stage 1 is on `main` (`dnaEnabled`, on by default; `docs/specs/dna.md`). Build world changes on top of it, and merge `main` in again if more DNA work lands there.
2. Read `AGENTS.md` and `docs/STATUS.md` instead of re-exploring the repo; read a feature's entry in `docs/decisions.md` before changing it.
3. First reply: a short plan only (files touched, new state, risks, anything ambiguous). Then implement.
4. When done: run `npm run verify`, run the experiment, record the findings in `docs/findings.md`, commit, and **stop for review**. Keep chat output short; never print long logs, only summary tables.

## Hard rules
- **On by default, with a switch.** New world features start on (per `docs/decisions.md`, "No target outcome"), with a switch kept for comparison. Flags are top-level in `src/sim/config.ts` with a feature prefix (e.g. `overgrazingEnabled`, `overgrazingDamagePerBite`), not nested under `config.world`.
- **Switch-off identity.** Record `npm run fingerprint` before the change. After it, `npm run fingerprint -- --set <feature>Enabled=false` must print exactly the pre-change output. Extend `scripts/fingerprint.ts` to hash the feature's new world state whenever the switch is on. Record the new default fingerprint in `docs/STATUS.md` at each merge.
- **Ship-on gate.** Before a feature ships on by default, its 8-seed experiment must show no extinctions and no collapse in population. If it fails, ship it with the switch off and say so in `docs/findings.md`.
- **Deterministic.** Seeded PRNG only, fixed iteration order, no `Math.random()` or `Date.now()` in the sim. New state goes into `exportState()` / `fromState()` (restores bit-identically). Bump `WorldState.version` and add a migration for old snapshots, or say plainly that old snapshots won't load. (An optional field that older saves lack and that defaults sensibly is also a migration; `carrion` and `plantCounters` use this.)
- **Nothing behavioural is hardcoded.** Change the world, bodies or senses; never add a rule that rewards or tells organisms what to do. No new sensor inputs or actions unless the prompt says so. If a sensor or action is needed, make its id **append-only** (never renumber existing ones; `BRAIN_INPUTS` is append-only) and report it.
- **Only critical tests, checking mechanisms, not outcomes:** switch-off identity, determinism, conservation, invariants. Nothing beyond those; keep them short (no long runs). Never assert that a behaviour must emerge. Log any tuned constant in `docs/findings.md` with the reason.
- **Performance:** report the tick-time change at 500 organisms (`npm run perf`). Target under 5%.
- **UI:** if the change adds a spatial field, add an overlay layer for it that reads on a ~390px phone screen. Any visual effect is render-only and must not touch sim state.

## Experiments
- Use `npm run experiment` (headless, paired by seed): **8 seeds x 10k ticks** (`--seeds 1-8 --ticks 10000`, the defaults) unless the prompt says otherwise, against the current build: `dnaEnabled` at its default and the Stage 1b DNA toggles (`dnaContinuousAbilities`, `dnaSplitDiets`) off, so the change's own effect is isolated.
- The main comparison is the feature's switch on vs off (`--compare <feature>Enabled=false,true`). Every prompt also lists a **matched control arm** that removes the mechanism but keeps something else equal (total food lost, total area, etc.). That arm matters most, since it separates the mechanism from a plain change in food or mortality.
- Output: the `.txt` summary (and `--json` if needed) in `docs/experiments/`, with the exact command and git commit.
- `docs/findings.md`: arm table, two sentences on what it shows, deviations. Report null results plainly.

## Standard diagnostics (add once, reuse; skip any that already exist)
Append to the metrics row, per interval:
- `blockedMoveFrac`: blocked moves / attempted moves.
- `timeInPatch`: mean ticks an organism stays within 2 cells of the same spot before moving more than 5 cells.
- `departureFoodLevel`: food on the cell an organism leaves after staying 10 or more ticks, as a fraction of the cell's maximum.
- `occupancyGini`: Gini coefficient of organism counts per cell.
- `scoutFraction`: share of organisms more than 8 cells from their birth cell.
- Population, lean-season lows, mean energy (existing).
