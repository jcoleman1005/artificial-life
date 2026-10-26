# Status

Where the project stands, what the experiments found, and what's next.
Read this and `AGENTS.md` at the start of a session; update this at the end. Detail lives in `docs/findings.md` (experiment results, engine), `docs/history.md` (feature inventory, hosting plan, future ideas) and `docs/decisions.md` (design decisions).

_Last updated: 2026-10-26._

## Branches

- `main`: everything to date, including the larger world, food regions, signals, the redesigned UI, mobility (diagonals, squeezing, leaping) and the brain as default. Start new work from here.
- Old branches were merged and deleted on 2026-10-25. Each session works on its own branch off `main`; merge it once checked on the phone.
- Each session works on its own branch off `main`; merge it once checked on the phone.

## Running it

| Task | Command |
|---|---|
| Phone/desktop app (Fedora, view at `http://<ip>:5173`) | `npm run dev` |
| Checks after any change | `npm run verify` |
| Compare variants across seeds (headless) | `npm run experiment -- --compare key=a,b [--set k=v] [--seeds 1-8] [--ticks 10000] [--from saved.json]` |
| Prove an engine change alters no outcome | `npm run fingerprint` before and after; output must match |
| Always-on server (one shared world, saved to `./data`; see `docs/server.md`) | `npm run server` |
| Engine speed | `npm run perf` |
| Check a Proxmox host's capacity (read-only) | `git show origin/main:scripts/proxmox-scout.sh \| ssh root@HOST 'bash -s'` |

`--from` starts every run from a saved world (a file saved from the app), reseeded per seed, so variants are compared from the same evolved state. `--compare` and `--set` take any `SimulationConfig` key (see `src/sim/config.ts`), e.g. `controller=dials,brain`, `sharingEnabled=false,true`, `seasonLength=0,800`.

## What exists (summary)

A 60×60 seeded grid world with obstacles, regions of evolving plants, staggered lean/plenty seasons, windfalls, carrion, and organisms that carry an inherited tag, body traits (abilities, dispersal, carry capacity, memory span, diet) and two inherited controllers (the brain is the default; the dials are the readable reference). They eat, share, signal, remember, reproduce asexually and, with the brain, hunt. The simulation runs in a Web Worker or on the always-on server (`server/`); the phone UI has overlays, a world-events feed, trends, an inspector, saved worlds and branch points. Full inventory: `docs/history.md`.

## In progress: DNA (2026-10-26)

Stage 1 of genome-encoded organisms is signed off and on by default (`dnaEnabled`; spec `docs/specs/dna.md`, code `src/sim/dna.ts`): body and brain (not the dials) are decoded from a genome, bit-identical to a legacy world. Stage 1b is built as two toggles, off by default, with gates in `docs/experiments/dna-1b*.txt` (continuous abilities: met; split diets: plant eaters met, meat eaters not yet seen in 3,000 ticks). Both await the user's review of their gates; meanwhile Stage 2 was built on top (below).

**Stage 2 (variation operators) built 2026-10-26, merged with the switch off** (`dnaVariationEnabled`, off by default; also a "Genome changes" toggle and Genome card in the app): Poisson-sampled point mutations, insertion, deletion, duplication, `dnaUpkeepPerGene`. Gate so far: census of 7,500 mutations ≈ 90% neutral, ~0 lethal (the 120-tick test is weak at detecting lethality; `docs/experiments/dna-stage2-census.txt`); tick cost +1.8% per organism-tick. Not yet done: the two experiment arms (point-only vs full operators; with vs without upkeep; genome-length boundedness and duplicate divergence), then decide the default and record a new fingerprint. Run: `npm run experiment -- --compare dnaInsertionRate+dnaDeletionRate+dnaDuplicationRate=0,0.001 --set dnaVariationEnabled=true --seeds 2-7 --ticks 5000` and `--compare dnaUpkeepPerGene=0,0.00005`. (Seeds 1 and 8 are left out because they go extinct early; see below.)

Urgent: 5 of 8 default worlds go extinct (4 in an early lean season, seed 1 by tick ~800), with or without DNA (`docs/findings.md`). Gates now report `extinct` and average traits over survivors.

## Latest findings (details and all other results in `docs/findings.md`)

- Squeezing past other organisms is what solved crowding (blocked moves 49.5% → 5.1%).
- Signals have not evolved any meaning, even over 50,000 ticks, and windfalls did not give them a job.
- Staggered region seasons raised lean-season lows about 2.5×.
- Carrion/predation: scavenging pays at once, hunting takes off in some worlds in waves. Plants vs classic food: same population, faster turnover.
- Findings predate the 2026-10-25 region layout; rerun before relying on exact numbers.

## Goals (things we'd love to see emerge)

Not targets to hardcode: conditions to build so they *can* happen, then watch.

- **Colour groups becoming separate species** (2026-10-25). Today reproduction is asexual, so a colour group is just a big family and "species" has no meaning yet. Likely recipe, none of it built:
  1. Different ways to make a living: two food types with a digestion trade-off, so groups in different regions are pushed apart (overlaps roadmap item 8).
  2. Sexual reproduction: two adjacent organisms mate and the child mixes both parents' genes, colour included (roadmap item 14).
  3. Who mates with whom: an evolved preference for partners of similar colour, and/or weaker or infertile offspring from parents too far apart genetically. Mixed offspring that are bad at both foods would make choosy mating pay.
  4. Recognising species: group organisms by who can still interbreed (instead of fixed hue buckets), name them, colour by species, and log "a new species split off" events; later a family tree.

  Not guaranteed: groups may keep blending, and it may take very long runs (the always-on server). Keep asexual reproduction as a setting. The build order is not yet agreed; the roadmap below is unchanged.

## Roadmap (agreed 2026-10-25; build in this order)

There is no target outcome: new features go in on by default and the world is left to see what happens over time. Measuring a feature against a control is optional. Give each feature a performance budget checked with `npm run perf` (target ~500 organisms on the S21).

**Phase 0: finish what's in flight, then foundations**
1. Check the new UI on the S21 itself (touch drag of the sheet, safe areas, frame rate and ticks/s at 10× with ~400 orbs, now with the simulation in a Web Worker). Benchmark the engine there in Termux (`npm run perf`).
2. ~~Mobility check.~~ Done 2026-10-25: squeezing solves crowding on the merged world; diagonals and leaping cost slightly (see findings). Leaping stays on (all features are on by default).
3. ~~Event log and overlay layers.~~ Done 2026-10-25 (world events only; overlays one at a time).
4. ~~Snapshots and resume, then fork.~~ Done 2026-10-25: auto-save and resume, branch points, files, and `npm run experiment -- --from saved.json` (every variant run from the same evolved state). Split-screen skipped for now.

**Phase 1: cheap, high payoff**
5. ~~Dispersal gene.~~ Built and measured 2026-10-25 (see findings): a small benefit. On by default.
6. ~~Windfalls.~~ Built and measured 2026-10-25 (see findings): organisms find ~70% of windfall food without signals, so signals still have nothing to say. On by default. Possible follow-up: make windfalls harder to find (shorter-lived, landing outside fertile regions) and run 50,000 ticks.

**Phase 2: first new loops**
7. ~~Memory registers.~~ Built; on by default. Optional: First check in a long run whether the hidden layer stays idle.
8. ~~Carrion and a simple bite~~ (built 2026-10-25, with a diet gene in place of `carrionEff`). Still to do from this item: a second plant food type (step 1 of the species goal), and generalising abilities.
9. Evolving pathogen (density-dependent mortality, visible waves).

**Phase 3: big coevolution (long runs; needs the server)**
10. Evolving plants (carrion becomes another food type). **Phase 1 built 2026-10-25, ahead of order at the user's request** (no defence, no ageing). Next: plant events in the feed, then Phase 2 (defence with an organism sense for plant colour, seed bank, seeds carried by organisms).
11. Growth and size, then bite.
12. Tending (pairs with plants; depends on kin clustering, which dispersal controls).

**Phase 4: slow burners on the always-on server**
13. ~~The always-on Node.js server.~~ Built 2026-10-25 (moved ahead of Phases 2–3). Next: install it on the S21 (`docs/server.md`), then long brain runs (100k+ ticks).
14. Sexual reproduction and mate preference (visible species splitting by colour; name colour groups in a way that scales to it).
15. Pheromone trails, then individual recognition, then lifetime plasticity.

**Phase 5: polish for the phone**
16. "While you were away" digest (in the app; no push notifications).
17. Ethogram, live phylogeny tree, replay scrubber.

## Known issues

- UI: no pinch-to-zoom yet (use the +/− buttons or the mouse wheel). Colour groups are fixed 30° hue buckets, so one family drifting across a bucket edge shows as two groups. Several lean regions are shown as compass codes (e.g. "Lean: NW, SW") to fit the peek strip. In landscape on a phone the world at 1× is small (the side panel takes ~40% of the width).

- Boom-bust cycles are sharp. `leanSlowdown` (8) is the main knob if they prove too harsh.
- Plants on the merged world cost organisms more per tick than classic food (brain, this container: ~73 vs ~51 µs per organism), mostly in sensing denser crowds; the plant update itself is ~2% of the time. Check `npm run perf` on the S21.
- Fingerprint (2026-10-26; record a new one at each world-change merge): default 60×60 world, seed `'2'`, no immigration, both controllers alive at tick 1500 (dials 831, brain 390). Identical with `dnaEnabled=false`. The small 30×30 world was dropped: it dies out around tick 650–770 on almost every seed (its first lean season), as did seed `'fingerprint'` in both worlds:
  `large dials 733b447e0db60145 · large brain 2e83d96eddf011cb`
- `npm run verify` on a 4-core container: all tests pass but vitest may report one unhandled "Timeout calling onTaskUpdate" (the long plants and mobility runs block their workers ~40–60 s under load). Shorten those tests or run them in their own pool if it becomes a nuisance.
- The S21 check (roadmap item 1) is still to do on the phone itself.
