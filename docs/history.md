# History and plans

Detail moved out of `docs/STATUS.md`: the full feature inventory, the hosting plan and unscheduled ideas.

## What exists (detailed)

- 60×60 grid world (the old 30×30 world is a preset) with obstacles, food patches, lean/plenty seasons (800-tick cycle, last 40% lean), and immigration (1 founder every 25 ticks; off by default since 2026-10-26, Settings → World → Spontaneous generation).
- Food grows only in 4 fertile regions (radius 8), spread over the world and never cut off by the edge (since 2026-10-25; before that they could clump, e.g. seed 42 had all four in the west half). **Every finding below predates this layout change**; rerun before relying on exact numbers. By default their seasons are staggered by a quarter cycle each, so a lean season sweeps from region to region.
- Movement abilities (from `feature/mobility`), each an inherited body trait: diagonal steps (1.4× cost), squeezing past a non-family organism that stays put (2× cost), and leaping over a neighbour (2.5× cost). By default each founder gets one ability or none (`founderAbilities: 'one'`), abilities flip at birth with `abilityMutationRate` (0.02), and each held ability costs `abilityUpkeep` (0.03) per tick, so selection can show which pays. Without an ability, movement is classic 4-way. Moves sense whether the target is occupied (`avoidOccupied` dial, brain `moveOccupied`).
- Organisms: energy, inherited tag (tribe colour), inherited carry capacity (with upkeep), food carrying and giving (need-aware, graded by tag similarity), parental care, childhood parent-following, family pass-through, and signals (a SIGNAL action others within 8 cells sense the next tick; meaning left to evolution).
- Two inherited controllers, switchable live in the app. **The brain is the default**; the dials are the readable reference.
  - **Dials**: 20 interpretable weights, including `restDrive` (resting used to be fixed at 0). Food first is an evolvable head start (`eatPriority`, `hungerUrgency`), not a fixed rule. Under the brain, the inspector's dial weights and the dial trend charts start collapsed and are labelled inactive.
  - **Brain**: a tiny neural network (33 action features → 6 hidden → score, plus direct connections starting as a dial-like head start).
- UI (redesigned 2026-10-25, "Pebbles" art, always dark):
  - World full-bleed. Organisms are glowing orbs in their tag hue (size = energy), food is berry clusters (count = stock), rocks are rounded blocks, fertile regions are soft glows (amber while lean). At full view organisms are plain dots; action glyphs fade in from about 2× zoom (white strokes; signals are rings in the organism's own hue). Zoom 1–6× (+/− buttons, mouse wheel), drag to pan when zoomed. Organisms glide between cells at constant speed while playing (each glide starts where the blob is drawn, timed by the measured gap between frames), and drawn positions follow true ones like a soft spring paced to the speed (Settings → Display → Motion: Fluid, the default, settles into a new cell over ~3 frame gaps, about half a second at 1×; Smooth trails by a fixed ~70 ms), so step-rest-step reads as continuous movement (2026-10-26, measured in Chromium: frame-to-frame jerkiness 0.27 → 0.07 at 1× and 0.81 → 0.28 at 10×; frames where a moving blob nearly stops 22–33% → 3%).
  - Floating playback pill: play/pause, step, slower « speed » faster (¼× ½× 1× 2× 5× 10×; keys [ and ] on desktop), tick.
  - Bottom sheet (portrait) peeks with population, season (or which regions are lean, by compass) and a colour-group strip; drag or tap up for Stats (status, metrics, colour groups, legend), Trends (charts, CSV) and Organism (inspector) tabs. Landscape phone / desktop: the sheet is an always-open right-hand panel.
  - Tap an organism (nearest within a finger's reach): zooms to 3×, follows it, and shows a card with its generated name, energy and what it is doing; tap the card for the inspector. Tap empty space to deselect.
  - Generated names (`src/ui/names.ts`): a given name from the organism id plus a family name shared by its lineage. Display only; simulation ids are unchanged.
  - Colour groups (`src/ui/groups.ts`): organisms bucketed into twelve 30° tag-hue groups ("groups", not species). Display only.
  - Settings sheet (gear in the peek strip): World (size, food layout, seasons), Behaviour (sharing, signals, controller), Display (colour by tag/family), Run (seed, Reset, New seed, status).
- World events feed (seasons per region, colour groups rising / dying out / taking the lead, population records and crashes, extinction, generation milestones): latest event under the peek strip, recent events in the Stats tab.
- Layers button over the world (one at a time): Family (lineage lit, others dimmed, lines to parent and children), Senses & signals (sight square, signal reach, signal ripples), Trails, and Crowding / Deaths / Feeding heatmaps (counted in the worker every tick, fading with a ~140-tick half-life).
- Saved worlds: exact snapshots (a restored world continues bit-identically, tested through JSON). Auto-save in the browser, resumed automatically on open ("Start fresh" to discard); branch points to jump back to (Settings → Saved worlds); save to / load from a file (~2 MB at ~400 organisms).
- **Evolving plants** (`plantsEnabled`, on by default; Settings → World → Plants: Evolving). Food becomes a population of plants with a 7-trait inherited genome (growth rate, maximum size, seed size, seeding threshold, seed dispersal, root share, lean dormancy). They grow by soil, light, shade and size, pay upkeep, store roots, go dormant in lean seasons, set seed, and die when grazed bare, shaded out or starved; seed rain replaces patch spawning. Drawn as leaf rosettes in their strategy's colour (greyed while dormant, dots as seedlings) with berries for edible units; tap a plant for its genome; a Plants section in Trends, CSV columns and experiment metrics. Spec and as-built rules: `docs/specs/plants.md`. Plant updates cost ~0.4 ms/tick for ~1,000 plants.
- **Always-on server** (`server/`, `docs/server.md`): one world for every viewer, running whether or not anyone watches; saved to `data/world.json` every 5 minutes, on shutdown and on play/pause/speed changes, with hourly gzip backups (48 kept, plus one before any reset or load); resumes as it was on restart. The page detects it and streams the world (Server-Sent Events, gzip, ~10 frames/s per viewer) instead of running a worker; served from anywhere else it runs its own world as before. Playback and settings changes from one viewer show on all; selection, tabs and overlays are per viewer. Options for port, speed cap, watch-only and more; a Termux:Boot script for the S21.
- **Carrion, diet and predation** (2026-10-25): every body leaves carrion (energy, rotting after 200 ticks; drawn as pale bones on a red stain). An inherited diet gene (carnivory 0–1, founders 0–0.2) trades plant energy for carrion energy. Brains can ATTACK an adjacent organism: kill odds from both energies and the attacker's diet, prey that moves away escapes, a kill leaves carrion (no energy changes hands). Which colours to hunt is left to evolve (`attackAlike` starts at 0). Shown in the app: Settings → Display → Colour by Diet (green plants to red meat), red slashes for attacks (zoomed in), Kills / Diet / Carrion in Stats, a "Diet & hunting" section in Trends (meat in the diet, kills per 100 ticks, share of kills of a different colour), and events for the first kill and colour groups turning to meat.
- 169 deterministic tests.

## Hosting plan

**Decision: host the always-on world on the old Galaxy S21 (a dedicated device, used for nothing else), with snapshots backed up to Proxmox.** The server exists (`docs/server.md`, which also has the step-by-step S21 setup); it is not yet running on the phone.

Proxmox scout results (host `pve`, 2026-10-25, `scripts/proxmox-scout.sh`):

| Resource | Proxmox `pve` | Needed |
|---|---|---|
| CPU | AMD GX-424CC, 4 low-power cores; single-core benchmark 964 ms vs 60 ms on the reference machine (~16× slower); 15-min load 1.28 per core (already busy: Immich, Home Assistant) | 1 core, part-time |
| RAM | 7.6 GB total, 2.4 GB available, 2.9 GB swap in use; 12.9 GB allocated to running guests (overcommitted) | ~512 MB |
| Disk | `local-lvm` thin pool ~24 GiB free (61% used); `JRC-Vault` dir storage ~1.6 TB free | ~4 GB |
| Templates | `debian-13-standard_13.1-2` already downloaded | — |
| Network | LAN `vmbr0` 192.168.40.0/24; Tailscale on the host (100.82.209.120) | — |

Why the S21: its CPU is estimated 10–16× faster than `pve`'s, and running there adds no load to the busy Proxmox host. Proxmox remains the fallback host and the backup target.

S21 setup (the commands are in `docs/server.md`):
- Termux and Termux:Boot from F-Droid (not the Play Store); battery optimisation off for both; `termux-wake-lock`; Wi-Fi on during sleep; automatic system updates off.
- Battery safety: Settings → Battery → Protect battery (charge limit 85%); keep it cool and out of a case; cap the tick rate; check occasionally for swelling.
- Tailscale on the phone for access from other devices.
- Snapshots saved locally and copied regularly to `JRC-Vault` on Proxmox over Tailscale.
- First, confirm the speed estimate: in Termux, `pkg install nodejs rsync`, copy the project from Fedora (excluding `node_modules`), `npm ci && npm run perf`.

If Proxmox ever hosts it instead: an unprivileged Debian 13 LXC on `local-lvm`, 1 core, `cpuunits` 50 (yields under load), 512 MB RAM / 256 MB swap, 4 GB disk, `vmbr0`, Tailscale inside, a 30×30 world at about 5 ticks/s. Note the default world is now 60×60 (~2× the work of the old default); the 30×30 preset still exists for a slow host.

## Future ideas (not scheduled)

**Use the domain `jcoleman.us`.** Nothing on the roadmap needs it yet.
- **Static hosting now:** since the Web Worker change the whole app runs in the browser, so `npm run build` output can be served from a subdomain (e.g. `alife.jcoleman.us`) on Cloudflare Pages, GitHub Pages or Netlify, redeployed on every push to `main`. No Fedora dev server needed to use it on the S21.
- **Installable app:** with HTTPS it can be added to the home screen as a PWA (full screen, no browser bar); a small service worker could make it work offline.
- **Always-on server later:** point the subdomain at the server through Cloudflare Tunnel (outbound only, no router ports; Cloudflare Access can add a login if DNS is on Cloudflare) or Tailscale Funnel.
- **Sharing:** a public link should be watch-only, with controls (reset, settings) behind a login.
- **Cautions:** never expose `npm run dev` publicly; keep tunnel tokens, API keys and DNS credentials out of the repo.
- **To decide first:** where the domain's DNS is managed (Cloudflare, the registrar, elsewhere).

