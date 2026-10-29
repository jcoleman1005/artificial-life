# Artificial Life Lab — Agent Instructions

## Goal
Build a persistent artificial-life simulation, developed on Fedora and primarily viewed on a Samsung Galaxy S21 browser. The first milestone (a playable, mobile-friendly 2D grid simulation) is done, and the always-on server exists (`docs/server.md`); see `docs/STATUS.md` for what's next. A standing goal is to see colour groups split into separate species (`docs/STATUS.md`, Goals); build conditions for it, never the outcome.

## Scope
Nothing is deferred. Any feature is fair game to suggest or build: predation, conflict between groups, sexual breeding and species, age, memory, lifetime learning, richer bodies, the always-on server, persistence, world branching, naturalistic rendering, and anything else. Suggest freely; agree larger changes with the user before building them, and record each decision under "Decisions already made". The agreed build order is the Roadmap in `docs/STATUS.md`.

## Decisions already made (index)
One line each; the full text is in `docs/decisions.md` (find it with `grep -n "^- <Name>" docs/decisions.md`). **Before changing a feature, read its entry there.** Record new decisions in `docs/decisions.md` and add one index line here.
- No target outcome: throw features together and watch; new features are on by default, switches stay for comparison (2026-10-25).
- Visual-first world with inspection, statistics and experiment controls; grid terrain, obstacles, abstract organisms.
- Food patches: random spawn, finite stock, regrowth to a capacity, replenished by new spawns.
- Windfalls (`windfallsEnabled`): transient unseen-by-most food clusters anywhere; no PRNG draws when off.
- Plants (`plantsEnabled`; `docs/specs/plants.md`): evolving 7-trait plants live in food patches; fixed rules, seed rain replaces spawning.
- Overgrazing (`overgrazingEnabled`): per-cell health, bites damage it, rested cells recover, regrowth scales with it; matched-random control (2026-10-26).
- World: 60×60 default (30×30 preset); food only in `foodRegionCount` fertile discs.
- Seasons: `seasonLength` cycle with a lean stretch; `staggeredSeasons` shifts each region.
- Energy is the only need; limited local senses; signals are the one longer-range sense; no global map.
- Legal actions: move, leap, eat, pick up, reproduce (clone), mate (brain only), give, signal, eat carrion, attack (brain only); explore is a tendency, not an action.
- Movement costs only when successful; diagonals cost `diagonalMoveCost` and can't cut wall corners.
- `targetOccupied` move input; `avoidOccupied` dial and `moveOccupied` brain input learn avoidance.
- Movement abilities (diagonal, squeeze, leap): inherited, per-switch, `founderAbilities`, `abilityMutationRate`, `abilityUpkeep`.
- Squeezing past: trade places with a non-family organism that stays put.
- Leaping: jump over an adjacent organism; `leapEagerness` dial and `isLeap` input.
- Family pass-through: parents and children trade places; mover pays; seeded tie-break.
- Energy bounded by 0 and max; zero means death.
- Energy only comes from eating food; organisms share food, never energy.
- Reproduction by cloning (REPRODUCE); offspring inherit weights with mutation.
- Mating (`sexEnabled`, on; brain only): MATE needs mutual consent the same tick; genes come whole from one parent or the other, then mutate as for clones.
- Mating rule (2026-10-27; refactored to continuous fecundity and sequential viable allocation): both at own threshold and cost; carrier's continuous clutch partitions viable children sequentially with sub-viable remainder dissipated as metabolic heat, eliminating the catastrophic cliff; no eggs.
- Clutch gene (`clutchGeneEnabled`, on; trait 46): continuous fecundity partition slider ($f \in [1.0, 6.0]$), founders 1, steps smoothly by `clutchStep` 0.2; matings only.
- Hybrid incompatibility (`hybridIncompatibilityEnabled`, on; `docs/specs/speciation.md`, 2026-10-28): per-child inviability rising with genome distance between mating parents (hue excluded); preference stays on the hue input; control arm `hybridControlInviability`.
- Tier 1 physical & energetic basic genes (2026-10-27; size, sensingRadius, metabolicRate, digestiveEfficiency, energyReserveCap with fat drag; traits 47–49 in lifehistory.ts, switches on by default).
- Size physics (2026-10-28): fixed allometric exponents; energy cap is `maxEnergyOf` everywhere; corpse energy scales with size.
- Tempo (2026-10-28, decided, not built): sub-step clock from metabolic rate and size, capped at 2 actions per tick, `tempoEnabled` switch; combat deferred until tempo and health are settled.
- Wound load (2026-10-28, decided, not built): injury is one scalar per body (upkeep, impairment, energy-paid healing, size-scaled lethal ceiling); no hit-point pool.
- Footprint space rule (2026-10-28, decided, not built): one body per cell; derived footprint radius draws large bodies overlapping and drives crowding pressure; squeeze and leap are size-gated.
- Energy ledger (2026-10-29, built; `src/sim/ledger.ts`): observer that checks energy in minus out equals the change in the animals' stored energy; a drift fails a test; every new gene must balance.
- Thermal physics (2026-10-29, built; `thermalUpkeepFactor`, `thermalPhysicsEnabled`): cold and heat both cost, scaled by size^(∓1/3), fat and metabolic rate; no thermal gene; switch off is the old cold-only rule bit-identically.
- Line of sight (2026-10-28, decided, conditional on a perf budget, not built): walls and bodies block sight inside the sensing window; `lineOfSightEnabled` switch; weather coupling is held.
- Growth (2026-10-29, decided, not built): born small, grow toward the genetic size by spending energy; `growthEnabled` switch; senescence deferred.
- Physics build order (2026-10-29, revised): ledger, thermal, terrain and wear built; next a signal layer (decision awaiting approval), then one brain upgrade with the terrain and signal inputs; then footprint, growth, wound load, combat, line of sight, tempo; optimisation and baseline runs (the user's) gate any re-ranking.
- Secondary goals are pressures, not needs (2026-10-29): energy stays the only need; cold, wounds, exposure and crowding are costs on energy, never separate needs or meters.
- Limits (2026-10-29): we have built ingredients, not packs, families or settlements, and nothing measured shows them; an active dig or build action needs new brain inputs and is not yet possible.
- Scent layer (2026-10-29, decided, not built; `docs/specs/scent-layer.md`): per-cell intensity plus depositor signature, passive deposit (free of energy), half-life about 35 ticks, wind drift, `scentEnabled`; inert until the sensing inputs arrive in the brain upgrade.
- Physics contract (2026-10-29; `docs/specs/physics.md`): quantities, laws and a gene-fit test every new gene must pass; weather coupling, food physics, terrain, signal layer and senescence are open hook points.
- Terrain fields (2026-10-29, built; `src/sim/terrain.ts`, `terrainEnabled`): per-cell roughness (move cost × √size) and cover (shelters temperature, rain and wind) from seeded noise independent of food regions; switch off is bit-identical; the brain inputs now wait for the signal layer's and go in one upgrade with them (changed from batching with wound load); wetness and dynamic terrain later.
- Terrain wear (2026-10-29, built; `terrainWearEnabled`): trampling smooths roughness and strips cover (× √size), grazing strips cover, worn ground recovers toward the original; applied after all actions; no new action. Active dig/build later.
- Meat digestion (`carnivoreGeneEnabled`, on; trait 50, 2026-10-27): 0..1 multiplier on energy from carrion and eggs; meat eaters eat eggs via EAT_CARRION; founders 0.5.
- Eggs (`eggsEnabled`, on; trait 44): continuous `eggAllocation` (0..1); upfront envelope synthesis with `shell` degradation buffer, and seasonal diapause break.
- Dispersal (`dispersalEnabled`): inherited distance, children born up to that far, `dispersalCost` per step.
- Carrion (`carrionEnabled`): bodies rot after `carrionLifetime`; eating one's newborn must return less than making it (tested).
- Diet (`carnivory`): inherited; trades plant yield for carrion share.
- Predation (`predationEnabled`, brain only): ATTACK adjacent organism; bites resolve after moves; kill leaves carrion, no energy.
- Evolvable bodies so far: abilities, dispersal, carry capacity, memory span, diet.
- Life-history genes (six switches, each the lock for its control arm; `src/sim/lifehistory.ts`): reproduction threshold, investment per child, fat reserve, torpor depth, eggs, base metabolic rate (and the clutch gene, below); all off reproduces the old world bit-identically.
- Tribes are never assigned: inherited hue tag; graded kinship similarity (`kinSimilarity`, `strangerSimilarity`).
- Giving food is need-aware (neighbour below half energy), delivered after all actions; `sharingEnabled` switch.
- Childhood (`childhoodTicks`): children sense a food-carrying parent; `followFoodParent`.
- Parental care: `careForChildren` starts positive, evolves; `forageDrive` near-neutral start.
- Signals: `signalCost`, sensed next tick, no built-in meaning; `signalsEnabled` switch; compare against signals-off before claiming meaning.
- Immigration (`immigrationEnabled`, **off by default**): spontaneous generation of random founders; saves from before load with it off.
- Offspring are born adjacent with the parent's tag; compare tribe claims against a sharing-off control.
- Hybrid controller: hard constraints define legal actions; a weighted policy chooses.
- Food first as evolvable head starts (`eatPriority`, `hungerUrgency`); prefer head starts over fixed priorities.
- Two controllers: brain (default; 52 inputs → 6 hidden → score, append-only `BRAIN_INPUTS`, `upgradeBrain`) and dials (readable reference; they only drift under the brain).
- Memory (`memoryEnabled`, brain only): named memories plus 3 free registers; span is an inherited costed trait.
- Discrete ticks; simultaneous decisions from one pre-tick snapshot; seeded random tie-breaks.
- Seeded PRNG only in simulation code; never `Math.random()`.
- Metrics stay separate: survival, reproductive success, behavioural diversity.
- Simulation is independent of rendering; runs in a `SimulationHost` (Worker or server) behind `src/sim/protocol.ts`.
- Observers (`WorldEventDetector`, `ActivityMaps`) never change the world; the feed shows world events only.
- Overlays, one at a time: Family, Senses & signals, Trails, Crowding, Deaths, Feeding.
- Genome trends (2026-10-27): Trends tab has genome sections, trait histograms and colour modes Metabolism / Breeding; inspector shows gene dosage; all display only.
- DNA (`dnaEnabled`, on; `docs/specs/dna.md`): genome-decoded body and brain (not dials); Stage 1 bit-identical to legacy; 1b toggles `dnaContinuousAbilities`, `dnaSplitDiets` off.
- DNA mating: genomes cross by key (each key's copies from one parent; a hidden unit travels whole), then the clone mutation path, capped at `dnaMaxGenes`; dials mix per dial (2026-10-26).
- DNA Stage 2 (`dnaVariationEnabled`, off until its gate is finished): Poisson point mutations, gene insertion/deletion/duplication, `dnaUpkeepPerGene`; see `docs/specs/dna.md`.
- DNA Stage 3 (`dnaGrowableBrain`, off until its gate is reviewed): genome compiled to a sparse brain circuit, up to `dnaMaxInternal` hidden units, flipped keys land only on new units (else silent), pruning, `dnaUpkeepPerConnection` (2026-10-27).
- Snapshots: `exportState()` / `fromState()` restore bit-identically; `SavedWorld` format; browser auto-save, branch points, files.
- Experiments can start from a saved world (`--from saved.json`).
- Gene registry (`src/sim/genes.ts`): table-driven plant-trait genes (ranges, founders, mutation, clamping, budgets, locking); organism genomes live in `dna.ts`.
- `World.stateHash()`: hash of the snapshot minus trend history; equal hashes continue identically.
- Always-on server (`server/`): one shared `SimulationHost`, SSE out, POST in, saves to `data/world.json`; not safe public unless `--watch-only`.
- UI/UX Audit & Ergonomic Refactor: Typography tokens, 44×44px touch targets for mobile (Galaxy S21), WCAG AA dark contrast, responsive summary pills (2026-10-27).
- Genome Lineage Map (`lineage.ts`, `lineage-view.ts`): Pedigree DAG in Inspector, crossover attribution, mutations, observer-only with deterministic `stateHash()` (2026-10-27).
- Egg Selection & Inspection: Direct egg selection, floating card, incubation/shell metrics, unborn traits and pedigree in Inspector (2026-10-27).
- Weather systems (`weatherEnabled`, on; `docs/specs/weather.md`): multi-front dynamic temperature, moisture, and wind; abiotic costs, plant drift, and downwind signal propagation (2026-10-27).
- Nutrient cycle (`nutrientCycleEnabled`, on; 2026-10-27): Replaces clockwork calendar seasons with endogenous soil-plant-unit nutrient dynamics; switch off reproduces legacy clock seasons bit-identically.
- Emergent migration (2026-10-27): Soil depletion and animal metabolic excretion drive migration endogenously; no artificial wandering region coordinates.
- Plant defense & detox coevolution (`plantDefenseEnabled`, `detoxGeneEnabled`, on; `docs/specs/red_queen.md`, 2026-10-27): Plant defense trait vs. herbivore detox (trait 51); yield discount, acute malaise damage, and `lastBiteYield` brain sensory feedback; switch off reproduces baseline bit-identically.
- Organism adaptation card & 2.5D leaping hop: Clear biological badges (diet %, metabolism, child care, brain nodes, abilities) and canvas-replica preview blob replace dot chips; true 2.5D airborne hop with terrain drop shadow (parabolic trajectory guide removed) (2026-10-28).
- Responsive landscape desktop layout: Canvas on top adapting to landscape; collapsable horizontal multi-column stats dashboard below with chevron toggle, expanding canvas to 100% available screen real estate when collapsed on computer screens (> 500px height); mobile landscape side-panel preserved (2026-10-28).
- Species detection (`speciesEnabled`, observer only; `docs/specs/species.md`): genome-distance clusters with stable ids, speciation/extinction events, Species colour mode (2026-10-28).
- Live brain viewer (observer only; `docs/specs/brain-viewer.md`): `inspectBrain` / `BrainTrace`, proven not to change `stateHash()` (2026-10-28).
- Growth and ageing (`growthEnabled`, `ageingEnabled`, on; `docs/specs/growth.md`): hatch small, grow while fed, maturity gate on REPRODUCE/MATE, senescence and old-age death; brain input `maturity` (2026-10-28).
- Growth duration gene (`growthGeneEnabled`, on; trait 55): inherited time to adulthood; faster growth costs more heat in total (2026-10-28).
- Inherited hatch maturity (`hatchMaturityGeneEnabled`, on with growth; trait 56; `docs/specs/hatch-maturity.md`): newborn maturity as a gene, paid through the child's minimum viable energy (2026-10-28).
- Ecological seasons, weather patterns, and versioning system: 4 ecological seasons and weather patterns replace binary plenty/lean; SemVer v0.2.0 ("Biosphere") displayed in UI (2026-10-28).
- Predator–prey arms race & chemical defense (`predationDefenseEnabled`, `toughnessGeneEnabled`, `toxicityGeneEnabled`, on; traits 52 & 53, 2026-10-28): Prey armor blunts bites, adds move drag, mass upkeep, and slows contested agility; chemical toxicity inflicts acute malaise on attackers/scavengers; metabolic death pulse propagates downwind; zero scripted behavior.
- Weather hues & storm cloud parallax: Weather front palettes harmonized with ecological seasons; high-altitude cloud billows with 3D camera parallax, wind drift, terrain overcast shadows, and rain streaks (2026-10-28).
- Stealth & death pulse dampening (`stealthGeneEnabled`, on; trait 54, 2026-10-28): Ambush bonus, mass upkeep, and dampens/negates violent death pulses emitted by prey or silenced by attackers; zero scripted behavior.

## Working notes
- Read `docs/STATUS.md` (short) at the start of a session and update it at the end: current state, next steps. Open `docs/findings.md` (experiment results) and `docs/decisions.md` only when the task touches them.
- World changes (prompts in `WORLD_PROMPTS.md`) follow `WORLD_RULES.md`.
- Use `npm run experiment` for comparisons instead of writing one-off scripts, and `npm run fingerprint` to prove an engine optimization changes no outcome.
- Experiment results: read the `.txt` summary in `docs/experiments/`, not the `.json`.

## Engineering rules
- TypeScript strict mode.
- Avoid unnecessary dependencies and services.
- Keep the stack small: add a database, authentication, cloud inference or a backend only when a feature needs it, and say why.
- Tests verify mechanisms and invariants (physics, inheritance, determinism, conservation, that a path to a behaviour is physically possible); never assert that an evolved behaviour appears. When a test disables a feature to isolate a mechanism, say so in the test; `tests/defaults.test.ts` keeps the default config pinned. (2026-10-26)
- Don't tune parameters (head starts, costs, rates) to make a behaviour emerge without logging the parameter, old and new values and why in the Parameter log in `docs/findings.md`; `tests/defaults.test.ts` pins the logged head starts.
- Emergence is measured by controlled experiments (matched seeds, on/off arms, chance baselines) and reported plainly in `docs/findings.md`, null results included.
- Write deterministic tests for energy accounting, action legality, conflict resolution, reproduction, inheritance, mutation, and seeded repeatability.
- Record observable inputs, action scores, decisions, and energy changes.
- Do not claim organisms learned during life unless lifetime learning is implemented.
- Do not hardcode desired emergent behaviors.
- Keep mobile touch targets comfortable and contrast readable.
- After meaningful changes run `npm run verify` (check, tests, build; prints one line per step, or the tail of the failing step).

The first milestone's build order and acceptance criteria (all met; keep them true) are in `docs/decisions.md`.
