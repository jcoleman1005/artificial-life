# Status

Where the project stands, what the experiments found, and what's next.
Read this and `AGENTS.md` at the start of a session; update this at the end. Detail lives in `docs/findings.md` (experiment results, engine), `docs/history.md` (feature inventory, hosting plan, future ideas) and `docs/decisions.md` (design decisions).

_Last updated: 2026-10-28 (Species detection; live brain viewer; growth, ageing and evolvable growth duration; Responsive landscape desktop layout with top landscape canvas & bottom multi-column stats dashboard; Organism adaptation card with quantitative evolutionary trait badges; 2.5D ballistic leaping trajectory & terrain drop shadow overhaul; World canvas plant defense spines; downwind-deflected signal waves; 3-stage carrion decomposition; acute toxin malaise distress spasm glyphs; Inspector microclimate, scavenging, kin pull, and detox senses; Biosphere nutrient and atmospheric weather dashboard metric cards; Settings panel feature alignment; Nutrients; Weather; Genome Lineage Map; Egg inspection; DNA growable brain)._

## Branches

- `main`: everything to date, including the larger world, food regions, signals, the redesigned UI, mobility (diagonals, squeezing, leaping) and the brain as default. Start new work from here.
- Old branches were merged and trimmed into `main` on 2026-10-27. Each session works on its own branch off `main`; merge it once checked on the phone.

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

A 60×60 seeded grid world with obstacles, regions of evolving plants, staggered lean/plenty seasons, windfalls, carrion, and organisms that carry an inherited tag, body traits (abilities, dispersal, carry capacity, memory span, diet) and two inherited controllers (the brain is the default; the dials are the readable reference). They eat, share, signal, remember, reproduce by cloning and, with the brain, mate (by mutual consent) and hunt. The simulation runs in a Web Worker or on the always-on server (`server/`); the phone UI has overlays, a world-events feed, trends, an inspector with an interactive Genome Lineage Map, saved worlds and branch points. Full inventory: `docs/history.md`.

## Species, brain viewer, growth (built 2026-10-28)

- **Species detection** (observer; `src/sim/species.ts`, `docs/specs/species.md`): genome-distance clusters, stable ids, events, Species colour mode, Stats list, Trends chart. `speciesThreshold` 0.15 gave 13-53 short-lived ids in 2-3k ticks on seed 2; 0.2-0.25 gave 4-8. Decide the default.
- **Live brain viewer** (observer; `src/sim/brain-trace.ts`, `src/ui/brain-view.ts`): Brain section in the Inspector. Neither it nor the species UI has been checked on the S21 / a 390px screen.
- **Growth and ageing** (`growthEnabled`, `ageingEnabled`, on; `src/sim/growth.ts`, `docs/specs/growth.md`) with the `growthDuration` gene (trait 52). Brain input `maturity` is index 56 (57 inputs). Both switches off: fingerprint equals the pre-change one (`large dials d78a433f62a2b403 · large brain e753aec72830d61b`). Defaults on: `large dials 7cd20dc39ba2533a (pop 700, births 2423) · large brain 17a3d1f6dafd71ed (pop 692, births 2497)`. Quick look (2 seeds x 3000 ticks): fixed 100 = 1.20x, gene on = 1.06x of growth off; no extinctions. The 8-seed gate has NOT been run. The gene stayed at ~100 over 3000 ticks (null at that length). Ageing (4000/8000) is inert: lifespans are 65-250 ticks; rescale after a long-run age histogram.
- **Hatch maturity** (`hatchMaturityGeneEnabled`, on; trait 53; `docs/specs/hatch-maturity.md`): fingerprint gene off equals the growth-merge default (`large dials 7cd20dc39ba2533a · large brain 17a3d1f6dafd71ed`); gene on (default): `large dials 1c9aba7e0db68a51 (pop 636, births 2580) · large brain d2b0c5bbf7328c63 (pop 575, births 2483)`. Quick look 2 seeds x 3000 ticks: avgPop 1.03x of gene off; mean evolved value 0.35 -> 0.38 (small). Not done: 500-organism tick-time measurement, 8-seed gate. Open: the new clone viability floor (the only newly blocked action).
- **Next**: 8-seed growth gate, long run for `growthDuration` drift (server), threshold decision for species, phone check.

## Responsive Landscape Desktop Layout (built 2026-10-28)

Stacked landscape desktop presentation with collapsable dashboard on computer screens (`src/style.css`, `src/main.ts`, `src/ui/sheet.ts`):
- **Full-Screen Canvas Real Estate**:
  - *Collapsed State*: When collapsed, the bottom dashboard shrinks to an ultra-compact ~44px header bar. The world canvas expands to fill 100% of the available vertical screen real estate (`100dvh - 44px`), dynamically recalculating cell size and centering.
  - *Expanded State*: Expands to `~42vh`, with the world canvas dynamically scaling to `58vh` to provide a clear view without being covered.
  - *Interactive Collapse Controls*: Toggled smoothly by a dedicated collapse chevron button (`▾` / `▴`), by clicking the peek bar, or by clicking active tab buttons. Preference is persisted in `localStorage`.
- **Horizontal Stats Dashboard**:
  - *Header Bar*: Peek population badge, season state pill, group hue strip, settings trigger, tab navigation, and collapse toggle arranged in a single sleek bar.
  - *Metrics Section*: Multi-column responsive grid (`repeat(auto-fit, minmax(130px, 1fr))`) stretching across the screen.
  - *Side-by-Side 3-Column Lower Dashboard*: Recent Events feed, Colour Groups list, and Symbol Legend placed into three parallel columns (`.stats-columns`).
  - *Expanded Trends & Inspector*: Trends charts and Genome Lineage Map automatically utilize the wide horizontal landscape width.
- **Mobile Landscape Phone Preservation**: Viewports with `max-height: 500px` (e.g. Samsung Galaxy S21 in landscape) retain the side-panel layout, ensuring mobile touch ergonomics and vertical visibility remain intact.

## Organism Adaptation Card & 2.5D Ballistic Leap Overhaul (built 2026-10-28)

Enhanced organism floating card and 2.5D leap physics rendering (`src/ui/organism-card.ts`, `src/style.css`, `src/render/renderer.ts`, tests `tests/organism-card.test.ts`):
- **Evolutionary Trait Badges**: Replaced static dots (`diet`, `burn`, `breeding`) with category color-coded micro-pills with icons and quantitative values:
  - *Diet*: `🌱 [X]% Herbivore`, `🥩 [X]% Carnivore`, or `🌾 [X]% Omnivore`.
  - *Burn*: `⚡ [X.XX]× Burn` color-mapped to metabolic pace (cool cyan to hot orange).
  - *Reproduction*: `🥚 Clutch [X.X]` or `🐣 Invest [X]%`.
  - *Dynamic Standout Traits*: Prioritized badges sorted by divergence from baseline: `🦘 Leaper`, `〰️ Squeezer`, `↗️ Diagonal`, `🛡️ Detox [X]%`, `👁️ Vision [R]`, `🦣 Heavy / 🐁 Dwarf`, `🔋 Fat Cap`, `🦴 Scavenge`, `🍃 Gut`, and `🧠 +[N] Neural`.
  - *Status Line*: Displays lineage depth, age, and activity (`Gen 14 · Age 320 · Grazing · carrying 2`).
  - *Egg Badges*: Direct inspection shows `[🥚 Egg]`, `[🛡️ Shell X.XX]`, `[📏 Size X.X×]`, and `[⚡ Energy X]`.
- **2.5D Ballistic Leap Trajectory & Drop Shadow**:
  - *Airborne Lift*: Organism body elevates vertically (screen $-Y$) along a true parabolic arc $Z(u) = 4 H_{\max} u (1-u)$ over the intervening cell.
  - *Terrain Drop Shadow*: An elliptical ground shadow tracks on the terrain floor at $(gx, gy)$ directly beneath the airborne unit, scaling and softening with altitude.
  - *Stationary Trajectory Guide*: Ground track and trajectory arc are anchored to fixed origin and target grid cells with a landing arrowhead, eliminating drifting, wobbling, and sideways bowing distortion.
- **Zero Simulation Physics Drift**: Visual and UI presentation layer only; deterministic invariants preserved.

## World Canvas Visual Enhancements (built 2026-10-28)

High-fidelity canvas visual enhancements and secondary dashboard expansions (`src/render/renderer.ts`, `src/ui/inspector.ts`, `src/ui/metrics-view.ts`):
- **Plant Chemical Defense Spines**: Radiates defensive thorn needles from leaf axils at LOD 1+ (`cellSize >= 5.5`) scaling with `plant.genome.defense`.
- **Parabolic Leaping Arc & Drop Shadow**: Leaping over an adjacent organism draws a 2-cell ballistic quadratic trajectory curve with an intermediate cell ground shadow ellipse, visually lifting the leaper above intermediate terrain.
- **Downwind Signal Lobes**: Skews expanding signal diamond ripples along local atmospheric wind vectors ($(w_x, w_y)$), visually showing `weatherSignalDrift`.
- **Carrion Decomposition Stages**: 3 distinct visual degradation states (fresh crimson carcass with pink fleshy core, rotting brown-red puddle with exposed bone, and weathered bleached bone fragments).
- **Acute Toxin Malaise Spasm Glyph**: Grazing toxic plants without adequate detox ($T_{\text{eff}} > 0.3$) triggers a vibrating amber-magenta jagged distress ring surrounding the organism.
- **Inspector & Dashboards**: Added Detoxification gene pill, local micro-climate, kin pull vector, and scavenging senses in the Inspector; added Biosphere Nutrients, Atmospheric Weather, Plant Ecology, and Tribe formation metric cards in the Stats panel.
- **Zero Calculation Impact**: Pure read-only projections of pre-tick snapshots; zero extra PRNG draws; bit-identical determinism preserved.

## Genome Lineage Map (built 2026-10-27)

Interactive pedigree DAG in the Inspector (`src/sim/lineage.ts`, `src/ui/lineage-view.ts`, tests `tests/lineage.test.ts`). Displays multi-generational descent trees tracing living organisms back to founding pioneers. Analyzes sexual mating crossovers (calculating parent vs mate contribution shares and specific inherited traits) and clonal mutation diffs (body size, diet, movement abilities, dispersal, and life-history genes). Prunes extinct lineages periodically to bound memory (< 200 KB) and runs strictly as an observer with zero effect on simulation physics, PRNG streams, or `stateHash()` determinism.

## Life-history genes (built and merged 2026-10-26)

Six inherited traits, each with its own switch (the lock for a control arm): reproduction threshold, investment per child, fat reserve, torpor depth, eggs, base metabolic rate (a seventh, clutch size for matings, came with the mating rule on 2026-10-27). Details in `docs/decisions.md` ("Life-history genes"); code `src/sim/lifehistory.ts`; tests `tests/lifehistory.test.ts`. All on by default. Gate results in `docs/findings.md`: all six together pass; threshold, fat and metabolism each fail alone on a one-seed extinction. Genome trend charts built 2026-10-27 (Trends tab: life history, morphology, niche, neural topology, population histograms; colour modes Metabolism and Breeding; inspector gene dosage; `docs/decisions.md` "Genome trends"). Next: watch long runs for whether the genes drift, and re-gate those three alone with eggs on.

## Tier 1 basic physical genes (built 2026-10-27)

Five foundational physical and energetic architecture genes (`size`, `sensingRadius`, `metabolicRate`, `digestiveEfficiency`, and `energyReserveCap` with fat drag; traits 47–49 in `src/sim/lifehistory.ts`, tests `tests/tier1_genes.test.ts`). Each is a direct morphological or physiological slider with thermodynamic and kinetic costs (never scripted behaviors), decoded once at birth into flat arrays, with safe zero-dose fallback reproducing legacy behavior. All on by default (`sizeGeneEnabled`, `sensingGeneEnabled`, `digestiveGeneEnabled`).
- `size`: scales $E_{\max} = 100 \times \text{size}$, basal metabolism $\propto \text{size}^{0.75}$ (Kleiber's law), movement cost linearly with mass, and visual radius in renderer ($r \propto \sqrt{\text{size}}$).
- `sensingRadius`: restricts perceptual Chebyshev window ($1 \dots 6$ cells); charges continuous sensory area upkeep ($\text{sensingUpkeepPerCell} \times \text{radius}^2$).
- `metabolicRate`: scales base metabolism; higher rate buys weighted priority in cell movement and reproduction conflicts; low rate amplifies torpor rest efficiency.
- `digestiveEfficiency`: scales plant and carrion food extraction yield ($0.5 \dots 1.5\times$); charges continuous gut organ upkeep per tick.
- `energyReserveCap`: fat storage decoupled from structural body size; loaded fat applies dynamic kinetic drag to movement costs ($\text{drag} = 1 + \text{dragCoeff} \times \frac{\text{fat}}{\text{fatCapacity} + E_{\max}}$).

**Meat digestion gene (2026-10-27):** `carnivoreEfficiency` (trait 50, `carnivoreGeneEnabled`, on) scales energy from carrion bites and eggs; meat eaters can now eat eggs (counted in `eggsEatenTotal`). Founders 0.5 halve early carrion meals (switch off = old world). Not yet measured: run `--compare carnivoreGeneEnabled=false,true` and check egg predation against eggs-off.

## Weather systems (built 2026-10-27)

Dynamic multi-front atmospheric simulation with 3 integrated dimensions (`weatherEnabled`, on by default; spec `docs/specs/weather.md`, code `src/sim/weather.ts`, tests `tests/weather.test.ts`):
- **Front dynamics**: spawns moving circular weather fronts (cold fronts and heat waves) characterized by position, velocity, radius, and intensity. Fronts smoothly move across the terrain, depositing rain that elevates local soil moisture while dry ambient air continuously evaporates moisture.
- **Abiotic constraints (no scripted behaviors)**:
  - Cold fronts drop local temperature below 0, increasing basal metabolic upkeep (`weatherChillCoeff * deltaTemp`).
  - Rain moistens the ground, accelerating carrion rot and introducing mud friction that scales movement energy expenditure (`weatherMudCoeff * moisture`).
  - Soil moisture scales plant growth vigour, with droughts slowing regrowth and wet spells fostering lush vegetation.
  - Wind vectors impart kinetic coupling on organism locomotion: moving aligned with the wind reduces energy expenditure, while moving against it adds resistance (`weatherWindCoupling * (v_move · v_wind)`).
  - Wind vector drift deflects plant seed dispersal downwind.
  - Directional acoustic/chemical signals propagate downwind, extending perceptual sensing range for downwind listeners and shortening it upwind.
- **Sensors & Brain**: local temperature, rain intensity, and move-wind directional alignment are sensed and appended to `BRAIN_INPUTS` (`weatherTemp`, `weatherRain`, `moveWindAlignment`).
- **Rendering**: added `weather` overlay visualizing temperature gradients (blue chill to warm orange) and wind streamline indicators.
- **Fingerprint & bit-identity**:
  - Switch off (`--set weatherEnabled=false`): matches baseline fingerprint bit-identically (`large dials: f8b636a2088d6381 pop 588 births 3443 · large brain: a8e50b331bc9b2f2 pop 665 births 3816`).
  - Switch on (`weatherEnabled: true`, default): `large dials: 3ff6bca3cc5fdc6f pop 637 births 4678 · large brain: 99714e1c2c0624ed pop 595 births 4256`.

## Nutrient cycle (built 2026-10-27)

Reworks "lean" and "plenty" from an artificial clockwork calendar (`seasonLength`, `leanFraction`) into an endogenous biogeochemical nutrient cycle (`nutrientCycleEnabled`, on by default; tests `tests/nutrient_cycle.test.ts`):
- **Closed/semi-open nutrient cycle**:
  - **Soil**: Flat `Float32Array` in `SoilField` holding dynamic nutrient reserves per cell ($N_{\text{soil}} \in [0, 3.0]$). Zero-allocation 4-neighbor spatial diffusion (`nutrientDiffusionRate: 0.01`) and semi-open mineral equilibrium recovery towards baseline fertility (`rRegen: 0.01`).
  - **Plants**: Draw nutrients during biomass/root growth (`nutrientPlantUptake: 0.2`). Dying plants and shed maintenance return organic nutrients back to the soil (`nutrientPlantDecomp: 0.8`).
  - **Units**: Grazing absorbs nutrients; ongoing basal metabolism, locomotion, waking, and actions deposit excreted metabolic waste underfoot (`nutrientExcretion: 0.005`), forming fertile game trails. Rotting carrion decomposes into the soil (`nutrientCarrionDecomp: 0.01`).
- **Emergent Lean and Plenty**:
  - A cell is in a **Lean** state when its local soil nutrients drop below `nutrientLeanThreshold` (0.4). Depletion triggers 8× plant growth slowdown (`lightLean`) and plant dormancy (`leanDormancy >= 0.5` retreats biomass into roots).
  - Regional seasons in the UI and detector reflect mean soil nutrient depletion in each fertile region.
  - Switch off (`--set nutrientCycleEnabled=false`): reproduces legacy clockwork season behavior 100% bit-identically.
- **UI & Metrics**:
  - Nutrients heatmap overlay layer visualizing soil fertility/enrichment gradients.
  - Real-time biosphere nutrient accounting: total soil stock, plant biomass stock, organism metabolic stock, carrion stock, and regional means.
- **Fingerprint & bit-identity**:
  - Switch off (`--set nutrientCycleEnabled=false`): matches baseline fingerprint bit-identically (`large dials: 3d37afc4c5e61b7a pop 231 births 2447 · large brain: 1bc7e138d3355fc6 pop 472 births 3711`).
  - Switch on (`nutrientCycleEnabled: true`, default): `large dials: d580611f56565751 pop 840 births 4200 · large brain: 4bcd86eed3ba7d21 pop 855 births 3739`.

## Red Queen: Trophic chemical coevolution (built 2026-10-27)

Antagonistic coevolution between plant chemical defense and herbivore detoxification (`plantDefenseEnabled`, `detoxGeneEnabled`, on by default; spec `docs/specs/red_queen.md`, tests `tests/red_queen.test.ts`):
- **Plant Defense (`defense` trait)**: Evolving chemical and structural defense ($D \in [0, 1]$). Defended plants pay continuous biomass synthesis upkeep (`plantDefenseCostFactor: 0.5`).
- **Herbivore Detox (`detox` gene, Trait 51)**: Evolving metabolic enzymatic clearance ($X \in [0, 1]$). Herbivores pay continuous enzymatic liver maintenance (`detoxUpkeepRate: 0.03 * detox * size`).
- **Grazing & Acute Malaise**: Effective toxicity $T_{\text{eff}} = \max(0, D - X)$. Unneutralized toxins reduce edible yield (`defenseYieldPenalty: 0.75`), and acute toxicity ($T_{\text{eff}} > 0.3$) inflicts direct gut tissue damage (`toxinMalaiseCost * (T_{\text{eff}} - 0.3)`).
- **Sensory Discrimination**: Append-only brain input `lastBiteYield` ($[0, 1]$) gives brains sensory feedback on bite nutritional efficiency.
- **Fingerprint & bit-identity**:
  - Switch off (`--set plantDefenseEnabled=false --set detoxGeneEnabled=false`): matches baseline fingerprint bit-identically (`large dials: d580611f56565751 pop 840 births 4200 · large brain: 4bcd86eed3ba7d21 pop 855 births 3739`).
  - Switch on (defaults): `large dials: d78a433f62a2b403 pop 648 births 3472 · large brain: e753aec72830d61b pop 643 births 2833`.

## In progress: DNA (2026-10-26)

Stage 1 of genome-encoded organisms is signed off and on by default (`dnaEnabled`; spec `docs/specs/dna.md`, code `src/sim/dna.ts`): body and brain (not the dials) are decoded from a genome, bit-identical to a legacy world. Stage 1b is built as two toggles, off by default, with gates in `docs/experiments/dna-1b*.txt` (continuous abilities: met; split diets: plant eaters met, meat eaters not yet seen in 3,000 ticks). Both await the user's review of their gates; meanwhile Stage 2 was built on top (below).

**Mating with genomes (2026-10-26):** a child of mating gets its genome by crossing its parents' genomes by key (each key's copies, or a whole hidden brain unit, from one parent), then the clone's mutation path, capped at `dnaMaxGenes` (`docs/specs/dna.md`, Sexual reproduction). Not yet measured: the branch's mating experiment ran before DNA.

**Mating rule and clutch gene (2026-10-27; refactored to continuous fecundity and sequential allocation):** a mating needs both parents at their own threshold; each pays own energy × own investment plus the tax; the carrier's clutch gene (trait 46, `clutchGeneEnabled`, on, founders 1, 1–6, step 0.2) sets the continuous resource partition slider $f \in [1.0, 6.0]$ ($\lfloor f \rfloor$ full children plus remainder probability of a marginal child). Viable count is calculated sequentially: $\min(N_{\text{target}}, \lfloor \text{pool} / \text{minViableChildEnergy} \rfloor)$. If all target children are viable, each gets $\text{pool} / N_{\text{target}}$; if only partial children are viable, each gets $\text{minViableChildEnergy}$ and sub-viable remainder is dissipated as metabolic heat (`matingEnergyLostTotal`), eliminating the catastrophic cliff. Matings lay no eggs.

**Stage 2 (variation operators) built 2026-10-26, merged with the switch off** (`dnaVariationEnabled`, off by default; also a "Genome changes" toggle and Genome card in the app): Poisson-sampled point mutations, insertion, deletion, duplication, `dnaUpkeepPerGene`. Gate so far: census of 7,500 mutations ≈ 90% neutral, ~0 lethal (the 120-tick test is weak at detecting lethality; `docs/experiments/dna-stage2-census.txt`); tick cost +1.8% per organism-tick. Not yet done: the two experiment arms (point-only vs full operators; with vs without upkeep; genome-length boundedness and duplicate divergence), then decide the default and record a new fingerprint. Run: `npm run experiment -- --compare dnaInsertionRate+dnaDeletionRate+dnaDuplicationRate=0,0.001 --set dnaVariationEnabled=true --seeds 2-7 --ticks 5000` and `--compare dnaUpkeepPerGene=0,0.00005`. (Seeds 1 and 8 are left out because they go extinct early; see below.)

**Stage 3 (growable brain) built 2026-10-27, merged with the switch off** (`dnaGrowableBrain`, off; `dnaMaxInternal` 16; `dnaUpkeepPerConnection` 0.00005; spec `docs/specs/dna.md`, Stage 3; tests `tests/dna-brain-growable.test.ts`): brain genes compile into a sparse circuit with up to 16 hidden units; fingerprint unchanged; with Stage 2 off the switch is bit-identical. Revised the same day at the user's request: flipped keys reach only new units (else silent), and gates ignore choice-invariant units. Gate rerun at 15,000 ticks (`docs/experiments/dna-stage3-gate.txt`): **met in 1 of 8 seeds** (seed 6: removing acquired units cuts births and survival clearly, in situ and in arenas), with the opposite sign in seeds 4 and 8 and nothing in the rest; pooled null. Every organism carries acquired units by 15k ticks. Fingerprint unchanged (the switch is off). **Awaiting the user's sign-off before Stage 4** and a decision on the default. Ablation tool: `npm run ablation -- --seeds 1-8 --workers 4 [--level effective|units|all]`.

Urgent: 5 of 8 default worlds go extinct (4 in an early lean season, seed 1 by tick ~800), with or without DNA (`docs/findings.md`). Gates now report `extinct` and average traits over survivors.

## World changes (WORLD_RULES.md)

- **Overgrazing** built 2026-10-26 (`overgrazingEnabled`, **off**: it failed the ship-on gate, B avgPop 0.61 / leanLow 0.22 of off; see `docs/findings.md`). Switch off reproduces the default fingerprint exactly (switch-on values under Known issues, fingerprint); overlay `Cell health`; `npm run sweep:overgrazing`; `npm run experiment -- --arm name=k:v,k:v` for multi-key arms; standard diagnostics are in the experiment output. Its gate ran before the life-history genes (now on by default; e.g. fat lets organisms keep biting at full energy), so rerun it before deciding. Next: decide whether to try a softer setting or leave it off.

## Latest findings (details and all other results in `docs/findings.md`)

- Squeezing past other organisms is what solved crowding (blocked moves 49.5% → 5.1%).
- Signals have not evolved any meaning, even over 50,000 ticks, and windfalls did not give them a job.
- Staggered region seasons raised lean-season lows about 2.5×.
- Mating (2026-10-26, 6 seeds × 15k, before DNA, the life-history genes and the 2026-10-27 mating rule): used in every surviving world (0.1–24% of births), no colour choosiness, parent–child pairs 2–3× chance; population lower with sex on, cause unclear.
- Carrion/predation: scavenging pays at once, hunting takes off in some worlds in waves. Plants vs classic food: same population, faster turnover.
- Findings predate the 2026-10-25 region layout; rerun before relying on exact numbers.

## Goals (things we'd love to see emerge)

Not targets to hardcode: conditions to build so they *can* happen, then watch.

- **Colour groups becoming separate species** (2026-10-25). Likely recipe (step 2 built 2026-10-26, with the first half of step 3: who to mate with is left to evolve):
  1. Different ways to make a living: two food types with a digestion trade-off, so groups in different regions are pushed apart (overlaps roadmap item 8).
  2. ~~Sexual reproduction~~ (built 2026-10-26 as an option next to cloning; see `docs/decisions.md`, Mating): two adjacent organisms that ask each other make a child that mixes both parents' genes, colour included. Whether sex catches on is left to evolve.
  3. Who mates with whom: an evolved preference for partners of similar colour, and/or weaker or infertile offspring from parents too far apart genetically. Mixed offspring that are bad at both foods would make choosy mating pay.
  4. Recognising species: group organisms by who can still interbreed (instead of fixed hue buckets), name them, colour by species, and log "a new species split off" events; later a family tree.

  Not guaranteed: groups may keep blending, and it may take very long runs (the always-on server). Asexual reproduction stays, as the brain's other choice. Agreed next pieces: neutral marker genes, then hybrid cost from genetic distance, then species detection.

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
10. Evolving plants (carrion becomes another food type). **Phase 1 built 2026-10-25, ahead of order at the user's request** (no defence, no ageing). **Plan agreed 2026-10-26** (from the user's second plants spec; reshape the existing plants rather than rewrite them, keep whole food units, keep plants on by default):
    1. ~~`stateHash` and a small gene registry.~~ Done 2026-10-26 (`src/sim/genes.ts` for plant traits, separate from the organism DNA in `src/sim/dna.ts`; fingerprint unchanged).
    2. Stage 1 additions: shared gene budget, grazing that can kill with a `regrowth` gene, maximum age, locked-genes mode, per-region gene means and a plant diversity index; recalibrate against classic food.
    3. Stage 2: plant `defense`, organism `detox` (inherited, with upkeep), a last-bite-yield sense, then the coevolution probe (one tick's plants in another tick's world).
    4. Stage 3: plant `hue` and an organism `plantHue` sense (a possible route to colour groups splitting).
    Also still open: plant events in the feed; seed bank and seeds carried by organisms.
11. Growth and size, then bite.
12. Tending (pairs with plants; depends on kin clustering, which dispersal controls).

**Phase 4: slow burners on the always-on server**
13. ~~The always-on Node.js server.~~ Built 2026-10-25 (moved ahead of Phases 2–3). Next: install it on the S21 (`docs/server.md`), then long brain runs (100k+ ticks).
14. ~~Sexual reproduction and mate preference~~ (mating built 2026-10-26, ahead of order; partner preference is an evolvable brain input). Still to do: name colour groups in a way that scales to species.
15. Pheromone trails, then individual recognition, then lifetime plasticity.

**Phase 5: polish for the phone**
16. "While you were away" digest (in the app; no push notifications).
17. Ethogram, live phylogeny tree, replay scrubber.

## Known issues

- UI: no pinch-to-zoom yet (use the +/− buttons or the mouse wheel). Colour groups are fixed 30° hue buckets, so one family drifting across a bucket edge shows as two groups. Several lean regions are shown as compass codes (e.g. "Lean: NW, SW") to fit the peek strip. In landscape on a phone the world at 1× is small (the side panel takes ~40% of the width).

- Boom-bust cycles are sharp. `leanSlowdown` (8) is the main knob if they prove too harsh.
- Plants on the merged world cost organisms more per tick than classic food (brain, this container: ~73 vs ~51 µs per organism), mostly in sensing denser crowds; the plant update itself is ~2% of the time. Check `npm run perf` on the S21.
- Torpor rework (2026-10-27, branch `claude/gifted-einstein-g1s4q4`): no coma; REST discounts upkeep by depth, acting after a REST pays the wake fee. Default fingerprint is now `large dials 4bea032e1d870c9e · large brain 0f412f7bb4910340` (pop 738 / 508, births 4513 / 5569); the values below predate it (torpor switch off still matches them). Rerun the torpor gate (`--compare torporEnabled=false,true`) before trusting the old result.
- Fingerprint (2026-10-27, mating with the clutch rule merged onto main 22568b4; record a new one at each world-change merge): default 60×60 world, seed `'2'`, no immigration, both controllers alive at tick 1500. Default (life-history genes, clutch gene and mating on; identical with `dnaEnabled=false`):
  `large dials 3fa33dea90586dc6 · large brain 9936b113220393eb` (pop 520 / 490, births 2614 / 3358)
  - `--set clutchGeneEnabled=false`: `large dials a675c39e63a44fae · large brain 0e608eeb54d8c786`. The dials never mate, so the clutch gene's only effect on them is its mutation roll at every birth: without it they match main plus the five brain inputs (below). The brain differs because matings still happen under the new rule.
  - `--set sexEnabled=false`: `large dials 3fa33dea90586dc6 · large brain 43d84c0b93c90c98`. The clutch gene is still carried and mutated (one roll per birth) though nothing reads it.
  - `--set sexEnabled=false --set clutchGeneEnabled=false`: `large dials a675c39e63a44fae · large brain e0598e82ea0aa1a5`, exactly main 22568b4 with five zero-valued brain inputs appended. So everything from main's baseline below to this line comes from the five appended inputs (their extra PRNG draws: 30 more hidden weights per founder brain, 35 more per-gene mutation rolls per birth), and nothing else.
  - Main 22568b4 before mating (life-history genes on; the hash also covers their state): `large dials 7b57d1d02fc2951e · large brain 542f52ae3400dbe6` (pop 570 / 503). With all six life-history switches off, main reproduces the older `large dials 733b447e0db60145 · large brain 2e83d96eddf011cb`.
  - Overgrazing ships off. Its switch-on values (`large dials 265280e9ef82d016 · large brain 912f5781fb244660`, pop 400 / 289) were measured on main before mating merged; recheck them.
  The small 30×30 world was dropped: it dies out around tick 650–770 on almost every seed (its first lean season), as did seed `'fingerprint'` in both worlds.
- `npm run verify` on a 4-core container: Vitest now runs with `fileParallelism: false` in `vitest.config.ts` to prevent worker thread IPC starvation and `Timeout calling "onTaskUpdate"`. Long-running simulation tests yield to the event loop and have generous timeouts (60–180s) to run reliably under load.
- UI toggles aligned (2026-10-28): Web app Settings panel exposes toggles for Weather (`weatherEnabled`), Nutrients (`nutrientCycleEnabled`), and Overgrazing (`overgrazingEnabled`) under World & Climate; Predation (`predationEnabled`), Mating (`sexEnabled`), and Carrion (`carrionEnabled`) under Behaviour; and Growable brain (`dnaGrowableBrain`), Continuous abilities (`dnaContinuousAbilities`), and Split diets (`dnaSplitDiets`) under Genetics & DNA.
- The S21 check (roadmap item 1) is still to do on the phone itself.
