# Status

Where the project stands, what the experiments found, and what's next.
Read this and `AGENTS.md` at the start of a session; update this at the end.

_Last updated: 2026-10-25._

## Branches

- `main`: everything to date, including the larger world, food regions, signals, the redesigned UI, mobility (diagonals, squeezing, leaping) and the brain as default. Start new work from here.
- All other branches (`fix/mobile-layout`, `feature/trend-charts`, `feature/tribes`, `feature/slower-speeds`, `feature/mobility`, `tools/proxmox-scout`, `claude/agents-status-docs-idfhjh`, `claude/signal-experiments`) are fully merged into `main`; safe to delete.
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
- Movement (merged from `feature/mobility`): one orthogonal or diagonal step (diagonals cost 1.4×), squeezing past a non-family organism that stays put (2× cost), and leaping over a neighbour for organisms with the inherited `canLeap` trait (2.5× cost, small upkeep). Moves sense whether the target is occupied (`avoidOccupied` dial, brain `moveOccupied`).
- Organisms: energy, inherited tag (tribe colour), inherited carry capacity (with upkeep), food carrying and giving (need-aware, graded by tag similarity), parental care, childhood parent-following, family pass-through, and signals (a SIGNAL action others within 8 cells sense the next tick; meaning left to evolution).
- Two inherited controllers, switchable live in the app. **The brain is the default**; the dials are the readable reference.
  - **Dials**: 20 interpretable weights, including `restDrive` (resting used to be fixed at 0). Food first is an evolvable head start (`eatPriority`, `hungerUrgency`), not a fixed rule. Under the brain, the inspector's dial weights and the dial trend charts start collapsed and are labelled inactive.
  - **Brain**: a tiny neural network (33 action features → 6 hidden → score, plus direct connections starting as a dial-like head start).
- UI (redesigned 2026-10-25, "Pebbles" art, always dark):
  - World full-bleed. Organisms are glowing orbs in their tag hue (size = energy), food is berry clusters (count = stock), rocks are rounded blocks, fertile regions are soft glows (amber while lean). At full view organisms are plain dots; action glyphs fade in from about 2× zoom (white strokes; signals are rings in the organism's own hue). Zoom 1–6× (+/− buttons, mouse wheel), drag to pan when zoomed, organisms glide between cells.
  - Floating playback pill: play/pause, step, speed (tap cycles ¼× ½× 1× 2× 5× 10×), tick.
  - Bottom sheet (portrait) peeks with population, season (or which regions are lean, by compass) and a colour-group strip; drag or tap up for Stats (status, metrics, colour groups, legend), Trends (charts, CSV) and Organism (inspector) tabs. Landscape phone / desktop: the sheet is an always-open right-hand panel.
  - Tap an organism (nearest within a finger's reach): zooms to 3×, follows it, and shows a card with its generated name, energy and what it is doing; tap the card for the inspector. Tap empty space to deselect.
  - Generated names (`src/ui/names.ts`): a given name from the organism id plus a family name shared by its lineage. Display only; simulation ids are unchanged.
  - Colour groups (`src/ui/groups.ts`): organisms bucketed into twelve 30° tag-hue groups ("groups", not species). Display only.
  - Settings sheet (gear in the peek strip): World (size, food layout, seasons), Behaviour (sharing, signals, controller), Display (colour by tag/family), Run (seed, Reset, New seed, status).
- 103 deterministic tests.

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
| **Dials (with `restDrive`) vs brain**, 60×60 regions, before mobility | **The gap mostly closes.** Dials evolve resting too (`restDrive` +0.54; rest 10.5% of actions vs ~0.3% before), and the brain's lean-season edge falls from ~2× to ~4% (lean low 362 vs 348, still higher in 8/8; births +7%, 8/8). Most of the brain's earlier advantage was being able to rest. The hidden layer is still unused (strength ~0.3 for both, i.e. drift). |
| Crowding | 55–71% of all actions are moves blocked by other organisms; the 30×30 world is badly overcrowded. |
| Does a 60×60 world relieve crowding? | **No.** With twice the food, population averages ~400 and 65–70% of actions are still blocked moves. Organisms pile up at food regardless of world size; crowding is set by food per patch, not space. |
| Food in regions (seasons in step) vs food anywhere | **Lean lows double** (126 vs 62, higher in 8/8 seeds); average population unchanged. Organisms spend 86% of their time inside regions; the largest look-alike group roughly doubles (219 vs 113). |
| **Staggered region seasons** | **Lean lows rise ~2.5×** (333 vs 135, 8/8), and the population barely swings. More moves between regions (259 vs 203 per 1,000 ticks, 6/8): a modest sign of migration, not yet a clear one. |
| **Signals (dials and brain)** | **No meaning has evolved in 10,000 ticks.** About 4% (dials) / 2.5% (brain) of actions are signals, but organisms on food signal *less* than average (0.9% vs 3.9%), and moves with a signal in range head toward it 46–48% of the time (chance). The signal weights stay near zero. Signals cost a little: brain lean lows 369 vs 380 (lower in 8/8). Under the brain, signalling mostly replaces resting. Treat signals as an open experiment, not a result. |
| **Signals over 50,000 ticks** (`docs/experiments/signals-50k.md`) | **Still no communication.** Signallers now lean toward signalling on food (about 1.4× their usual rate, in 5/8 dials and 6/8 brain seeds, very variable), but receivers move toward signals at chance (49%) in every seed. Dial signal weights stay within neutral drift. Signals slightly lower the population (brain: 7/8 seeds). |

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

1. Move the simulation into a Web Worker so the UI stays smooth at 10× (the redesigned UI still runs the loop on the main thread). Check the new UI on the S21 itself (touch drag of the sheet, safe areas, frame rate at 10× with ~400 orbs).
2. Signals: give listeners a reason to respond (e.g. `sensingRadius` 2 so a signal reveals unseen food, or sparser, richer patches) and track the brain's own signal connections. Compare against `signalsEnabled=false` every time.
3. Measure what mobility changed (merged untested together with regions and signals): compare `diagonalMoves`, `squeezeEnabled`, `leapEnabled` on/off on the 60×60 region world, especially blocked-move share and lean lows.
4. Benchmark the engine on the S21 in Termux (`npm run perf`) to confirm it as the host.
5. Snapshots and resume, then the always-on Node.js server (runs the world, saves snapshots, serves the app), then the S21 setup above.
6. Long brain runs (100k+ ticks) to see whether the hidden layer starts doing work. Needs the server.
7. More openings for emergence: sexual breeding (planned; the UI should name colour groups in a way that scales to it), conflict between groups (deferred in `AGENTS.md`).

## Known issues

- UI: no pinch-to-zoom yet (use the +/− buttons or the mouse wheel). Colour groups are fixed 30° hue buckets, so one family drifting across a bucket edge shows as two groups. Several lean regions are shown as compass codes (e.g. "Lean: NW, SW") to fit the peek strip. In landscape on a phone the world at 1× is small (the side panel takes ~40% of the width).

- Boom-bust cycles are sharp. `leanSlowdown` (8) is the main knob if they prove too harsh.
- Fingerprints changed with the mobility merge and the new dial weight; record new ones (`npm run fingerprint`) before the next engine optimisation.
- Mobility has its own branch's experiments; none were rerun after merging with regions, signals and the brain default.
