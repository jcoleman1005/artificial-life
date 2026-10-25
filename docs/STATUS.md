# Status

Where the project stands, what the experiments found, and what's next.
Read this and `AGENTS.md` at the start of a session; update this at the end.

_Last updated: 2026-10-25._

## Branches

- `main`: everything to date (layout fix, trend charts, tribes, sharing, seasons, traits, brains, engine speed-up). Start new work from here.
- `fix/mobile-layout`, `feature/trend-charts`, `feature/tribes`, `feature/slower-speeds`, `tools/proxmox-scout`: older branches, fully merged into `main`; safe to delete.
- `claude/agents-status-docs-idfhjh`: larger world, food regions, staggered seasons, signals, zoom (this session). Merge once checked on the phone.
- Each session works on its own branch off `main`; merge it once checked on the phone.

## Running it

| Task | Command |
|---|---|
| Phone/desktop app (Fedora, view at `http://<ip>:5173`) | `npm run dev` |
| Checks after any change | `npm run check && npm test && npm run build` |
| Compare variants across seeds (headless) | `npm run experiment -- --compare key=a,b [--set k=v] [--seeds 1-8] [--ticks 10000]` |
| Prove an engine change alters no outcome | `npm run fingerprint` before and after; output must match |
| Engine speed | `npm run perf` |
| Check a Proxmox host's capacity (read-only) | `git show origin/main:scripts/proxmox-scout.sh \| ssh root@HOST 'bash -s'` |

`--compare` and `--set` take any `SimulationConfig` key (see `src/sim/config.ts`), e.g. `controller=dials,brain`, `sharingEnabled=false,true`, `seasonLength=0,800`.

## What exists

- 60×60 grid world (the old 30×30 world is a preset) with obstacles, food patches, lean/plenty seasons (800-tick cycle, last 40% lean), and immigration (1 founder every 25 ticks).
- Food grows only in 4 fertile regions (radius 8). By default their seasons are staggered by a quarter cycle each, so a lean season sweeps from region to region.
- Organisms: energy, inherited tag (tribe colour), inherited carry capacity (with upkeep), food carrying and giving (need-aware, graded by tag similarity), parental care, childhood parent-following, family pass-through, and signals (a SIGNAL action others within 8 cells sense the next tick; meaning left to evolution).
- Two inherited controllers, switchable live in the app:
  - **Dials**: 17 interpretable weights. Food first is an evolvable head start (`eatPriority`, `hungerUrgency`), not a fixed rule.
  - **Brain**: a tiny neural network (30 action features → 6 hidden → score, plus direct connections starting as a dial-like head start).
- UI: zoom 1–4× (follows the selected organism; drag to pan), World / Food / Signals toggles, speeds from ¼× (1.5 ticks/s) to 10×; organisms glide smoothly between cells (drawing only); action glyphs and a legend, an inspector with per-input score breakdowns, trend charts (population, tribes and sharing, body traits, brains, weights) with lean seasons shaded, and CSV export.
- 83 deterministic tests.

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
| Does a 60×60 world relieve crowding? | **No.** With twice the food, population averages ~400 and 65–70% of actions are still blocked moves. Organisms pile up at food regardless of world size; crowding is set by food per patch, not space. |
| Food in regions (seasons in step) vs food anywhere | **Lean lows double** (126 vs 62, higher in 8/8 seeds); average population unchanged. Organisms spend 86% of their time inside regions; the largest look-alike group roughly doubles (219 vs 113). |
| **Staggered region seasons** | **Lean lows rise ~2.5×** (333 vs 135, 8/8), and the population barely swings. More moves between regions (259 vs 203 per 1,000 ticks, 6/8): a modest sign of migration, not yet a clear one. |
| **Signals (dials and brain)** | **No meaning has evolved in 10,000 ticks.** About 4% (dials) / 2.5% (brain) of actions are signals, but organisms on food signal *less* than average (0.9% vs 3.9%), and moves with a signal in range head toward it 46–48% of the time (chance). The signal weights stay near zero. Signals cost a little: brain lean lows 369 vs 380 (lower in 8/8). Under the brain, signalling mostly replaces resting. Treat signals as an open experiment, not a result. |

## Engine

- About 16–18 µs per organism per tick. Default 60×60 world: dials 6.5 ms/tick, brain 7.5 ms/tick (peak ~490 organisms, ~10 ms). The 30×30 preset is about half that.
- Memory: about 5 MB for the world at 30×30, about 14 MB at 60×60. A persistent server needs about 512 MB RAM and 1 core.
- The simulation still runs on the page's main thread, and the canvas now redraws every frame while running (for smooth movement); 10× can fall behind during booms.

## Hosting plan

**Decision: host the always-on world on the old Galaxy S21 (a dedicated device, used for nothing else), with snapshots backed up to Proxmox.** The server code does not exist yet; the plan is for whichever host runs the same Node.js service.

Proxmox scout results (host `pve`, 2026-10-25, `scripts/proxmox-scout.sh`):

| Resource | Proxmox `pve` | Needed |
|---|---|---|
| CPU | AMD GX-424CC, 4 low-power cores; single-core benchmark 964 ms vs 60 ms on the reference machine (~16× slower); 15-min load 1.28 per core (already busy: Immich, Home Assistant) | 1 core, part-time |
| RAM | 7.6 GB total, 2.4 GB available, 2.9 GB swap in use; 12.9 GB allocated to running guests (overcommitted) | ~512 MB |
| Disk | `local-lvm` thin pool ~24 GiB free (61% used); `JRC-Vault` dir storage ~1.6 TB free | ~4 GB |
| Templates | `debian-13-standard_13.1-2` already downloaded | — |
| Network | LAN `vmbr0` 192.168.40.0/24; Tailscale on the host (100.82.209.120) | — |

Why the S21: its CPU is estimated 10–16× faster than `pve`'s, and running there adds no load to the busy Proxmox host. Proxmox remains the fallback host and the backup target.

S21 setup (once the server exists):
- Termux and Termux:Boot from F-Droid (not the Play Store); battery optimisation off for both; `termux-wake-lock`; Wi-Fi on during sleep; automatic system updates off.
- Battery safety: Settings → Battery → Protect battery (charge limit 85%); keep it cool and out of a case; cap the tick rate; check occasionally for swelling.
- Tailscale on the phone for access from other devices.
- Snapshots saved locally and copied regularly to `JRC-Vault` on Proxmox over Tailscale.
- First, confirm the speed estimate: in Termux, `pkg install nodejs rsync`, copy the project from Fedora (excluding `node_modules`), `npm ci && npm run perf`.

If Proxmox ever hosts it instead: an unprivileged Debian 13 LXC on `local-lvm`, 1 core, `cpuunits` 50 (yields under load), 512 MB RAM / 256 MB swap, 4 GB disk, `vmbr0`, Tailscale inside, a 30×30 world at about 5 ticks/s. Note the default world is now 60×60 (~2× the work of the old default); the 30×30 preset still exists for a slow host.

## Next steps (suggested order)

1. UI redesign (see the UI plan below), together with moving the simulation into a Web Worker so the UI stays smooth at 10×.
2. Signals: longer runs (50k+ ticks) and/or a reason to signal (e.g. kin nearby on food) before concluding they can't evolve meaning. Compare against `signalsEnabled=false` every time.
3. Benchmark the engine on the S21 in Termux (`npm run perf`) to confirm it as the host.
4. Snapshots and resume, then the always-on Node.js server (runs the world, saves snapshots, serves the app), then the S21 setup above.
5. Long brain runs (100k+ ticks) to see whether the hidden layer starts doing work. Needs the server.
6. More openings for emergence: sexual breeding (planned; the UI should name colour groups in a way that scales to it), conflict between groups (deferred in `AGENTS.md`).

## UI plan (agreed 2026-10-25, not built yet)

Mostly for watching on the phone; experiments stay one tap away.

- **World full-bleed**, always dark. Playful, but the art direction is **"Pebbles"**: glowing soft orbs with a gradient, berry-cluster food, rounded rocks, regions as soft glows (amber when lean). At full 60×60 view organisms are simple dots; glyphs and detail fade in from 2× zoom. Keep the action glyphs, restyled to match (e.g. white strokes, soft rings for signals).
- **Floating playback pill** over the bottom of the world: play/pause, speed, step.
- **Always visible**: population, season (or which regions are lean), and a **colour strip** of the main colour groups by headcount. Don't call them "species" yet: use a neutral word ("groups") until breeding defines species.
- **Bottom sheet** that peeks with those numbers and drags up into tabs: Stats, Trends, Organism.
- **Tap an organism**: camera zooms in and follows it; a small card shows its name, energy and what it's doing; tap the card for the full inspector.
- **Generated names** (deterministic; a lineage shares a family name) instead of `org-1234`.
- **Experiment switches** (World, Food, Sharing, Signals, Controller, Seasons, Colour, seed) move into a settings sheet, grouped.
- **Landscape / desktop**: world on the left, the sheet becomes a right-hand side panel.

## Known issues

- Boom-bust cycles are sharp. `leanSlowdown` (8) is the main knob if they prove too harsh.
- The inspector's dial weights are shown but inactive under the brain controller (it's labelled).
