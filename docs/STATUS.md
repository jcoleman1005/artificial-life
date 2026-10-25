# Status

Where the project stands, what the experiments found, and what's next.
Read this and `AGENTS.md` at the start of a session; update this at the end.

_Last updated: 2026-10-25._

## Branches

- `main`: everything to date, including the larger world, food regions, signals, the redesigned UI, mobility (diagonals, squeezing, leaping) and the brain as default. Start new work from here.
- Old branches were merged and deleted on 2026-10-25. Each session works on its own branch off `main`; merge it once checked on the phone.
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
- Movement abilities (from `feature/mobility`), each an inherited body trait: diagonal steps (1.4× cost), squeezing past a non-family organism that stays put (2× cost), and leaping over a neighbour (2.5× cost). By default each founder gets one ability or none (`founderAbilities: 'one'`), abilities flip at birth with `abilityMutationRate` (0.02), and each held ability costs `abilityUpkeep` (0.03) per tick, so selection can show which pays. Without an ability, movement is classic 4-way. Moves sense whether the target is occupied (`avoidOccupied` dial, brain `moveOccupied`).
- Organisms: energy, inherited tag (tribe colour), inherited carry capacity (with upkeep), food carrying and giving (need-aware, graded by tag similarity), parental care, childhood parent-following, family pass-through, and signals (a SIGNAL action others within 8 cells sense the next tick; meaning left to evolution).
- Two inherited controllers, switchable live in the app. **The brain is the default**; the dials are the readable reference.
  - **Dials**: 20 interpretable weights, including `restDrive` (resting used to be fixed at 0). Food first is an evolvable head start (`eatPriority`, `hungerUrgency`), not a fixed rule. Under the brain, the inspector's dial weights and the dial trend charts start collapsed and are labelled inactive.
  - **Brain**: a tiny neural network (33 action features → 6 hidden → score, plus direct connections starting as a dial-like head start).
- UI (redesigned 2026-10-25, "Pebbles" art, always dark):
  - World full-bleed. Organisms are glowing orbs in their tag hue (size = energy), food is berry clusters (count = stock), rocks are rounded blocks, fertile regions are soft glows (amber while lean). At full view organisms are plain dots; action glyphs fade in from about 2× zoom (white strokes; signals are rings in the organism's own hue). Zoom 1–6× (+/− buttons, mouse wheel), drag to pan when zoomed, organisms glide between cells.
  - Floating playback pill: play/pause, step, slower « speed » faster (¼× ½× 1× 2× 5× 10×; keys [ and ] on desktop), tick.
  - Bottom sheet (portrait) peeks with population, season (or which regions are lean, by compass) and a colour-group strip; drag or tap up for Stats (status, metrics, colour groups, legend), Trends (charts, CSV) and Organism (inspector) tabs. Landscape phone / desktop: the sheet is an always-open right-hand panel.
  - Tap an organism (nearest within a finger's reach): zooms to 3×, follows it, and shows a card with its generated name, energy and what it is doing; tap the card for the inspector. Tap empty space to deselect.
  - Generated names (`src/ui/names.ts`): a given name from the organism id plus a family name shared by its lineage. Display only; simulation ids are unchanged.
  - Colour groups (`src/ui/groups.ts`): organisms bucketed into twelve 30° tag-hue groups ("groups", not species). Display only.
  - Settings sheet (gear in the peek strip): World (size, food layout, seasons), Behaviour (sharing, signals, controller), Display (colour by tag/family), Run (seed, Reset, New seed, status).
- World events feed (seasons per region, colour groups rising / dying out / taking the lead, population records and crashes, extinction, generation milestones): latest event under the peek strip, recent events in the Stats tab.
- Layers button over the world (one at a time): Family (lineage lit, others dimmed, lines to parent and children), Senses & signals (sight square, signal reach, signal ripples), Trails, and Crowding / Deaths / Feeding heatmaps (counted in the worker every tick, fading with a ~140-tick half-life).
- Saved worlds: exact snapshots (a restored world continues bit-identically, tested through JSON). Auto-save in the browser, resumed automatically on open ("Start fresh" to discard); branch points to jump back to (Settings → Saved worlds); save to / load from a file (~2 MB at ~400 organisms).
- **Evolving plants** (`plantsEnabled`, off by default until measured; Settings → World → Plants: Evolving). Food becomes a population of plants with a 7-trait inherited genome (growth rate, maximum size, seed size, seeding threshold, seed dispersal, root share, lean dormancy). They grow by soil, light, shade and size, pay upkeep, store roots, go dormant in lean seasons, set seed, and die when grazed bare, shaded out or starved; seed rain replaces patch spawning. Drawn as leaf rosettes in their strategy's colour (greyed while dormant, dots as seedlings) with berries for edible units; tap a plant for its genome; a Plants section in Trends, CSV columns and experiment metrics. Spec and as-built rules: `docs/specs/plants.md`. Plant updates cost ~0.4 ms/tick for ~1,000 plants.
- 155 deterministic tests.

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
| **Mobility on vs off** (brain, 30×30, before regions; diagonals + squeeze + leap, all organisms) | **Trapping solved, at a cost.** Blocked moves 49% → 8%; average population 258 → 390 (8/8); lean low 77 → 100 (7/8). But resting rose 27% → 76%, births roughly halved, one look-alike group took over (largest 152 → 445), and carrying and gifts nearly vanished (carry capacity 1.43 → 0.29). Leaps were 0.06% of actions. |
| **Which movement ability wins?** (30×30, before regions; each founder gets one of diagonal, squeeze, leap or none, 25% each) | **Squeezing, in 8/8 seeds under both controllers** (89% of dials, 99% of brain organisms at 10,000 ticks). Diagonals stay at ~27% under dials but reach 82% under the brain (probably riding along with squeezer lineages; unchecked). Leaping falls to 4–7%, near what immigrants bring in; organisms with no ability die out. Not yet rerun on the 60×60 region world. |
| **Each ability on vs off on the merged world** (60×60, 4 staggered regions, brain, signals on; one switch off at a time, the others on; `docs/experiments/mobility-*.txt`) | **Squeezing is what matters.** Squeeze off → on: blocked moves 49.5% → 5.1%, average population 405 → 608 and lean low 340 → 524 (both 8/8); the ability spreads to 99% and resting rises 16% → 62%. Diagonals spread (69% vs 23% drift) but cost a little (avg pop 649 → 608, lower in 6/8). Leaping is selected against (8% vs 25% drift), used in 0.02% of actions, and costs a little too (627 → 608, lower in 7/8). |

## Engine

- About 16–18 µs per organism per tick. Default 60×60 world: dials 6.5 ms/tick, brain 7.5 ms/tick (peak ~490 organisms, ~10 ms). The 30×30 preset is about half that.
- Memory: about 5 MB for the world at 30×30, about 14 MB at 60×60. A persistent server needs about 512 MB RAM and 1 core.
- The simulation runs in a **Web Worker** (`src/sim/worker.ts` → `SimulationHost` in `src/sim/host.ts`), which owns the World and the tick timing. The page (`src/ui/simulation-client.ts`) only draws and handles input: each frame carries light organism records and food; metrics, history (only while Trends is open) and the selected organism's full record come at most 5× a second. Messages are defined in `src/sim/protocol.ts`. In desktop Chromium at 10× the page holds 60 fps with the worker at 60/60 ticks/s; if the worker can't keep up during a boom, ticks/s drops but drawing and touch stay smooth.
- The worker boundary is the same one the always-on server will use: swap the worker for a connection to the server and the page needs no other changes.

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

## Roadmap (agreed 2026-10-25; build in this order)

Rules: one new loop at a time, 8 seeds each against a control, before adding the next. Don't stack plants, pathogen and bite in one run. Compare every new loop against a frozen baseline preset (e.g. `baseline-2026-10`). Give each loop a performance budget checked with `npm run perf` (target ~500 organisms on the S21).

**Phase 0: finish what's in flight, then foundations**
1. Check the new UI on the S21 itself (touch drag of the sheet, safe areas, frame rate and ticks/s at 10× with ~400 orbs, now with the simulation in a Web Worker). Benchmark the engine there in Termux (`npm run perf`).
2. ~~Mobility check.~~ Done 2026-10-25: squeezing solves crowding on the merged world; diagonals and leaping cost slightly (see findings). Possible follow-up: turn leaping off by default.
3. ~~Event log and overlay layers.~~ Done 2026-10-25 (world events only; overlays one at a time).
4. ~~Snapshots and resume, then fork.~~ Done 2026-10-25: auto-save and resume, branch points, files. Not yet: `npm run experiment -- --from saved.json` (every variant run from the same evolved state); split-screen, if at all.

**Phase 1: cheap, high payoff**
5. Dispersal gene (changes the "born adjacent" rule; record it in `AGENTS.md`). Measure blocked-move share and kin clustering against dispersal off.
6. Windfalls: short-lived food bursts beyond sight, so signals have something to say. Test with signals on and off; track the brain's own signal connections.

**Phase 2: first new loops**
7. Memory registers. First check in a long run whether the hidden layer stays idle.
8. Typed food and carrion (`carrionEff` gene). Generalise abilities here, once there are two non-movement examples. Optionally move a simple bite (energy comparison) up to here if predation is wanted sooner.
9. Evolving pathogen (density-dependent mortality, visible waves).

**Phase 3: big coevolution (long runs; needs the server)**
10. Evolving plants (carrion becomes another food type). **Phase 1 built 2026-10-25, ahead of order at the user's request** (no defence, no ageing). Next: plant events in the feed, then Phase 2 (defence with an organism sense for plant colour, seed bank, seeds carried by organisms).
11. Growth and size, then bite.
12. Tending (pairs with plants; depends on kin clustering, which dispersal controls).

**Phase 4: slow burners on the always-on server**
13. The always-on Node.js server (runs the world, saves snapshots, serves the app), then the S21 setup above. Long brain runs (100k+ ticks).
14. Sexual reproduction and mate preference (visible species splitting by colour; name colour groups in a way that scales to it).
15. Pheromone trails, then individual recognition, then lifetime plasticity.

**Phase 5: polish for the phone**
16. "While you were away" digest (in the app; no push notifications).
17. Ethogram, live phylogeny tree, replay scrubber.

## Future ideas (not scheduled)

**Use the domain `jcoleman.us`.** Nothing on the roadmap needs it yet.
- **Static hosting now:** since the Web Worker change the whole app runs in the browser, so `npm run build` output can be served from a subdomain (e.g. `alife.jcoleman.us`) on Cloudflare Pages, GitHub Pages or Netlify, redeployed on every push to `main`. No Fedora dev server needed to use it on the S21.
- **Installable app:** with HTTPS it can be added to the home screen as a PWA (full screen, no browser bar); a small service worker could make it work offline.
- **Always-on server later:** point the subdomain at the server through Cloudflare Tunnel (outbound only, no router ports; Cloudflare Access can add a login if DNS is on Cloudflare) or Tailscale Funnel.
- **Sharing:** a public link should be watch-only, with controls (reset, settings) behind a login.
- **Cautions:** never expose `npm run dev` publicly; keep tunnel tokens, API keys and DNS credentials out of the repo.
- **To decide first:** where the domain's DNS is managed (Cloudflare, the registrar, elsewhere).

## Known issues

- UI: no pinch-to-zoom yet (use the +/− buttons or the mouse wheel). Colour groups are fixed 30° hue buckets, so one family drifting across a bucket edge shows as two groups. Several lean regions are shown as compass codes (e.g. "Lean: NW, SW") to fit the peek strip. In landscape on a phone the world at 1× is small (the side panel takes ~40% of the width).

- Boom-bust cycles are sharp. `leanSlowdown` (8) is the main knob if they prove too harsh.
- Plants on the merged world cost organisms more per tick than classic food (brain, this container: ~73 vs ~51 µs per organism), mostly in sensing denser crowds; the plant update itself is ~2% of the time. Check `npm run perf` on the S21.
- Fingerprints changed with the mobility merge and the new dial weight; record new ones (`npm run fingerprint`) before the next engine optimisation.
- Mobility has its own branch's experiments; none were rerun after merging with regions, signals and the brain default.
