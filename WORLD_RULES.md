# World Change Rules (shared by every prompt in WORLD_PROMPTS.md)

Each prompt says "Follow WORLD_RULES.md" instead of repeating this.

## Process
1. One change per session, committed in order to `claude/new-session-9qwa4f` with a `world:` commit prefix. Use per-change branches only if push access to them is added. DNA Stage 1 is on `main` (`dnaEnabled`, on by default; `docs/specs/dna.md`). Build world changes on top of it, and merge `main` in again if more DNA work lands there.
2. Read `AGENTS.md` and `docs/STATUS.md` instead of re-exploring the repo; read a feature's entry in `docs/decisions.md` before changing it.
3. First reply: a short plan only (files touched, new state, risks, anything ambiguous). Then implement.
4. When done: run `npm run verify` and the test budget (below), commit, and **stop for review**. No experiment unless asked. Keep chat output short; never print long logs, only summary tables.

## Hard rules
- **On by default, with a switch.** New world features start on (per `docs/decisions.md`, "No target outcome"), with a switch kept for comparison. Flags are top-level in `src/sim/config.ts` with a feature prefix (e.g. `overgrazingEnabled`, `overgrazingDamagePerBite`), not nested under `config.world`.
- **Switch-off identity.** Record `npm run fingerprint` before the change. After it, `npm run fingerprint -- --set <feature>Enabled=false` must print exactly the pre-change output. Extend `scripts/fingerprint.ts` to hash the feature's new world state whenever the switch is on. Record the new default fingerprint in `docs/STATUS.md` at each merge.
- **Ship-on gate (only when the full experiment is asked for).** When it is run, the 8-seed experiment (immigration off, switch off as the first variant) must pass the gate `npm run experiment` prints: median per-seed ratio of switch-on to switch-off at least 0.8 for `avgPop` and 0.7 for `leanLow`, and no seed at `finalPop` 0 whose switch-off run survived. A world feature may lower carrying capacity; the gate catches collapse, not cost (lean lows vary more, so their bound is looser). If it fails, ship it with the switch off and say so in `docs/findings.md`.
- **Deterministic.** Seeded PRNG only, fixed iteration order, no `Math.random()` or `Date.now()` in the sim. New state goes into `exportState()` / `fromState()` (restores bit-identically). Bump `WorldState.version` and add a migration for old snapshots, or say plainly that old snapshots won't load. (An optional field that older saves lack and that defaults sensibly is also a migration; `carrion` and `plantCounters` use this.)
- **Nothing behavioural is hardcoded.** Change the world, bodies or senses; never add a rule that rewards or tells organisms what to do. No new sensor inputs or actions unless the prompt says so. If a sensor or action is needed, make its id **append-only** (never renumber existing ones; `BRAIN_INPUTS` is append-only) and report it.
- **Tests:** only the test budget below. Never assert that a behaviour must emerge. Log any tuned constant in `docs/findings.md` with the reason.
- **Performance:** target under 5% tick-time change at 500 organisms (test budget item 6).
- **UI:** if the change adds a spatial field, add an overlay layer for it that reads on a ~390px phone screen. Any visual effect is render-only and must not touch sim state.

## Test budget (the default for every change)
Every change gets only these checks; the whole set should run in about a minute:
1. With the switch off, `npm run fingerprint -- --set <feature>Enabled=false` equals the recorded baseline in `docs/STATUS.md`.
2. The same seed twice gives the same fingerprint.
3. A smoke run: 1 to 2 seeds for about 1,000 ticks with the feature on, asserting only no NaN or Infinity, no negative energy or food, no out-of-bounds or overlapping organisms, and no crash. Never assert survival or behaviour.
4. A snapshot round trip (`exportState()` / `fromState()`), if the change adds state.
5. One small hand-built mechanism test.
6. One tick-time measurement at 500 organisms, switch on vs off.

Do not run long experiments or add test files beyond these unless asked.

## Experiments (optional: only when asked)
- **Quick look** (when asked for one): 2 seeds x 3k ticks (`--seeds 1-2 --ticks 3000`). Report the population curve and a one-line summary; no `docs/findings.md` entry.
- **Full experiment** (when asked for one): use `npm run experiment` (headless, paired by seed): **8 seeds x 10k ticks** (`--seeds 1-8 --ticks 10000`, the defaults) unless the prompt says otherwise, against the current build: `dnaEnabled` at its default and the Stage 1b DNA toggles (`dnaContinuousAbilities`, `dnaSplitDiets`) off, so the change's own effect is isolated.
- The main comparison is the feature's switch on vs off (`--compare <feature>Enabled=false,true`). Every prompt also lists a **matched control arm** that removes the mechanism but keeps something else equal (total food lost, total area, etc.). That arm matters most, since it separates the mechanism from a plain change in food or mortality.
- Output: the `.txt` summary (and `--json` if needed) in `docs/experiments/`, with the exact command and git commit.
- `docs/findings.md` (full experiments only): arm table, two sentences on what it shows, deviations. Report null results plainly.

## Standard diagnostics (add once, reuse; skip any that already exist)
Append to the metrics row, per interval:
- `blockedMoveFrac`: blocked moves / attempted moves.
- `timeInPatch`: mean ticks an organism stays within 2 cells of the same spot before moving more than 5 cells.
- `departureFoodLevel`: food on the cell an organism leaves after staying 10 or more ticks, as a fraction of the cell's maximum.
- `occupancyGini`: Gini coefficient of organism counts per cell.
- `scoutFraction`: share of organisms more than 8 cells from their birth cell.
- Population, lean-season lows, mean energy (existing).
