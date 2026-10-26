# World Change Rules (shared by every prompt in WORLD_PROMPTS.md)

Save this in the repo root. Each prompt says "Follow WORLD_RULES.md" instead of repeating this.

## Process
1. Work on its own branch: `world/<change-name>`. Do not touch the DNA branch.
2. If `CLAUDE.md` or `ARCHITECTURE.md` exist, read them instead of re-exploring the repo.
3. First reply: a short plan only (files touched, new state, risks, anything ambiguous). Then implement.
4. When done: run tests, run the experiment, write `RESULTS.md` for it, commit, and **stop for review**. Keep chat output short; never print long logs, only summary tables.

## Hard rules
- **Flag, default off.** New config under `config.world.<name>`. Missing means off. With it off, golden `stateHash`es must be unchanged (run the determinism tests).
- **Deterministic.** Seeded RNG only, fixed iteration order, no `Math.random()` or `Date.now()` in the sim. New state goes into snapshots and `stateHash`; bump the snapshot version and add a migration for old snapshots (or say plainly that old snapshots won't load).
- **Nothing behavioural is hardcoded.** Change the world, bodies or senses; never add a rule that rewards or tells organisms what to do. No new sensor inputs or actions unless the prompt says so. If a sensor or action is needed, make its id **append-only** (never renumber existing ones) and report it.
- **Tests check mechanisms, not outcomes:** flag-off identity, determinism, conservation, invariants. Never assert that a behaviour must emerge. Any tuned constant must be logged in `RESULTS.md` with the reason.
- **Performance:** report the tick-time change at 500 organisms. Target under 5%.
- **UI:** if the change adds a spatial field, add an overlay layer for it that reads on a ~390px phone screen. Any visual effect is render-only and must not touch sim state.

## Experiments
- Headless runner JSON in `experiments/`, **8 seeds x 10k ticks** unless the prompt says otherwise, same seeds across arms, **DNA operators off** (Stage 1 build) so the change's own effect is isolated.
- Every prompt lists a **matched control arm** that removes the mechanism but keeps something else equal (total food lost, total area, etc.). That arm matters most, since it separates the mechanism from a plain change in food or mortality.
- Output: per-arm CSVs, `summary.csv` (mean, sd, 95% CI across seeds), exact config, git commit.
- `RESULTS.md`: arm table, two sentences on what it shows, deviations. Report null results plainly.

## Standard diagnostics (add once, reuse; skip any that already exist)
Append to the metrics row, per interval:
- `blockedMoveFrac`: blocked moves / attempted moves.
- `timeInPatch`: mean ticks an organism stays within 2 cells of the same spot before moving more than 5 cells.
- `departureFoodLevel`: food on the cell an organism leaves after staying 10 or more ticks, as a fraction of the cell's maximum.
- `occupancyGini`: Gini coefficient of organism counts per cell.
- `scoutFraction`: share of organisms more than 8 cells from their birth cell.
- Population, lean-season lows, mean energy (existing).
