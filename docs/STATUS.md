# Status

Where the project stands, what the experiments found, and what's next.
Read this and `AGENTS.md` at the start of a session; update this at the end.

_Last updated: 2026-10-25._

## Branches

- `main`: everything to date (layout fix, trend charts, tribes, sharing, seasons, traits, brains, engine speed-up). Start new work from here.
- `fix/mobile-layout`, `feature/trend-charts`, `feature/tribes`, `feature/slower-speeds`: older branches, fully merged into `main`; safe to delete.
- Each session works on its own branch off `main`; merge it once checked on the phone.

## Running it

| Task | Command |
|---|---|
| Phone/desktop app (Fedora, view at `http://<ip>:5173`) | `npm run dev` |
| Checks after any change | `npm run check && npm test && npm run build` |
| Compare variants across seeds (headless) | `npm run experiment -- --compare key=a,b [--set k=v] [--seeds 1-8] [--ticks 10000]` |
| Prove an engine change alters no outcome | `npm run fingerprint` before and after; output must match |
| Engine speed | `npm run perf` |

`--compare` and `--set` take any `SimulationConfig` key (see `src/sim/config.ts`), e.g. `controller=dials,brain`, `sharingEnabled=false,true`, `seasonLength=0,800`.

## What exists

- 30×30 grid world with obstacles, food patches, lean/plenty seasons (800-tick cycle, last 40% lean), and immigration (1 founder every 25 ticks).
- Organisms: energy, inherited tag (tribe colour), inherited carry capacity (with upkeep), food carrying and giving (need-aware, graded by tag similarity), parental care, childhood parent-following, family pass-through.
- Two inherited controllers, switchable live in the app:
  - **Dials**: 14 interpretable weights. Food first is an evolvable head start (`eatPriority`, `hungerUrgency`), not a fixed rule.
  - **Brain**: a tiny neural network (25 action features → 6 hidden → score, plus direct connections starting as a dial-like head start).
- UI: speeds from ¼× (1.5 ticks/s) to 10×; organisms glide smoothly between cells (drawing only); action glyphs and a legend, an inspector with per-input score breakdowns, trend charts (population, tribes and sharing, body traits, brains, weights) with lean seasons shaded, and CSV export.
- 72 deterministic tests.

## Findings so far (8 seeds × 10,000 ticks unless noted)

| Question | Result |
|---|---|
| Do tribes form from sharing? | **No.** Look-alike clusters come from family structure (children born adjacent with the parent's tag); clustering is the same with sharing off. |
| Energy sharing (×1.5) | Organisms exploited it by passing energy back and forth (32–39% returned within 5 ticks). Replaced by pure transfer, then by food sharing. |
| Pure-transfer or need-aware energy sharing | No effect on population or in-group bias. |
| Food sharing | Gifts almost entirely parent → own child. No in-group bias evolves. A weak hint (6/8 seeds) that it raises lean-season lows. |
| Does storing food pay? (evolvable carry capacity) | **No.** Lean seasons push capacity *down* (2.0 → 1.5). Upkeep outweighs storage while forage drive stays low. |
| Parents trapping children | Well-fed parents sat on food while starving children pushed against them. Two-way family pass-through fixed it, but produced sharper boom-bust cycles (peaks ~350, lean lows ~20–50). |
| **Dials vs brain** | **Brain populations survive lean seasons ~2× better** (lean low 79 vs 40, higher in 8/8 seeds). All 8 brain runs independently evolved "rest more, move less" (rest connection +0.5, move −0.4). Dials cannot express this: resting is fixed at 0. The hidden layer has not been recruited yet. |
| Crowding | 55–71% of all actions are moves blocked by other organisms; the 30×30 world is badly overcrowded. |

## Engine

- About 16 µs per organism per tick (dials 3.6 ms/tick, brain 4.0 ms/tick on seed 42). A 60×60 world peaks around 1,500 organisms at about 20 ms/tick.
- Memory: about 5 MB for the world at 30×30, about 14 MB at 60×60. A persistent server needs about 512 MB RAM and 1 core.
- The simulation still runs on the page's main thread, and the canvas now redraws every frame while running (for smooth movement); 10× can fall behind during booms.

## Next steps (suggested order)

1. Move the simulation into a Web Worker so the UI stays smooth at 10×.
2. Larger world (e.g. 60×60) to relieve crowding and give room for territories and migration.
3. Long brain runs (100k+ ticks) to see whether the hidden layer starts doing work. Needs the server.
4. Snapshots and resume, then an always-on Node server on Proxmox that the phone connects to.
5. More openings for emergence: signals between organisms, food regions, conflict between groups (deferred in `AGENTS.md`).

## Known issues

- Boom-bust cycles are sharp. `leanSlowdown` (8) is the main knob if they prove too harsh.
- The inspector's dial weights are shown but inactive under the brain controller (it's labelled).
