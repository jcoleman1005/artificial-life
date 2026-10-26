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
- World: 60×60 default (30×30 preset); food only in `foodRegionCount` fertile discs.
- Seasons: `seasonLength` cycle with a lean stretch; `staggeredSeasons` shifts each region.
- Energy is the only need; limited local senses; signals are the one longer-range sense; no global map.
- Legal actions: move, leap, eat, pick up, reproduce, give, signal, eat carrion, attack (brain only); explore is a tendency, not an action.
- Movement costs only when successful; diagonals cost `diagonalMoveCost` and can't cut wall corners.
- `targetOccupied` move input; `avoidOccupied` dial and `moveOccupied` brain input learn avoidance.
- Movement abilities (diagonal, squeeze, leap): inherited, per-switch, `founderAbilities`, `abilityMutationRate`, `abilityUpkeep`.
- Squeezing past: trade places with a non-family organism that stays put.
- Leaping: jump over an adjacent organism; `leapEagerness` dial and `isLeap` input.
- Family pass-through: parents and children trade places; mover pays; seeded tie-break.
- Energy bounded by 0 and max; zero means death.
- Energy only comes from eating food; organisms share food, never energy.
- Reproduction is asexual; offspring inherit weights with mutation.
- Dispersal (`dispersalEnabled`): inherited distance, children born up to that far, `dispersalCost` per step.
- Carrion (`carrionEnabled`): bodies rot after `carrionLifetime`; eating one's newborn must return less than making it (tested).
- Diet (`carnivory`): inherited; trades plant yield for carrion share.
- Predation (`predationEnabled`, brain only): ATTACK adjacent organism; bites resolve after moves; kill leaves carrion, no energy.
- Evolvable bodies so far: abilities, dispersal, carry capacity, memory span, diet.
- Tribes are never assigned: inherited hue tag; graded kinship similarity (`kinSimilarity`, `strangerSimilarity`).
- Giving food is need-aware (neighbour below half energy), delivered after all actions; `sharingEnabled` switch.
- Childhood (`childhoodTicks`): children sense a food-carrying parent; `followFoodParent`.
- Parental care: `careForChildren` starts positive, evolves; `forageDrive` near-neutral start.
- Signals: `signalCost`, sensed next tick, no built-in meaning; `signalsEnabled` switch; compare against signals-off before claiming meaning.
- Immigration (`immigrationEnabled`, **off by default**): spontaneous generation of random founders; saves from before load with it off.
- Offspring are born adjacent with the parent's tag; compare tribe claims against a sharing-off control.
- Hybrid controller: hard constraints define legal actions; a weighted policy chooses.
- Food first as evolvable head starts (`eatPriority`, `hungerUrgency`); prefer head starts over fixed priorities.
- Two controllers: brain (default; 47 inputs → 6 hidden → score, append-only `BRAIN_INPUTS`, `upgradeBrain`) and dials (readable reference; they only drift under the brain).
- Memory (`memoryEnabled`, brain only): named memories plus 3 free registers; span is an inherited costed trait.
- Discrete ticks; simultaneous decisions from one pre-tick snapshot; seeded random tie-breaks.
- Seeded PRNG only in simulation code; never `Math.random()`.
- Metrics stay separate: survival, reproductive success, behavioural diversity.
- Simulation is independent of rendering; runs in a `SimulationHost` (Worker or server) behind `src/sim/protocol.ts`.
- Observers (`WorldEventDetector`, `ActivityMaps`) never change the world; the feed shows world events only.
- Overlays, one at a time: Family, Senses & signals, Trails, Crowding, Deaths, Feeding.
- DNA (`dnaEnabled`, off until signed off; `docs/specs/dna.md`): genome-decoded body and brain; Stage 1 bit-identical to legacy.
- DNA Stage 2 (`dnaVariationEnabled`, off until its gate is finished): Poisson point mutations, gene insertion/deletion/duplication, `dnaUpkeepPerGene`; see `docs/specs/dna.md`.
- Snapshots: `exportState()` / `fromState()` restore bit-identically; `SavedWorld` format; browser auto-save, branch points, files.
- Experiments can start from a saved world (`--from saved.json`).
- Always-on server (`server/`): one shared `SimulationHost`, SSE out, POST in, saves to `data/world.json`; not safe public unless `--watch-only`.

## Working notes
- Read `docs/STATUS.md` (short) at the start of a session and update it at the end: current state, next steps. Open `docs/findings.md` (experiment results) and `docs/decisions.md` only when the task touches them.
- World changes (prompts in `WORLD_PROMPTS.md`) follow `WORLD_RULES.md`.
- Use `npm run experiment` for comparisons instead of writing one-off scripts, and `npm run fingerprint` to prove an engine optimization changes no outcome.
- Experiment results: read the `.txt` summary in `docs/experiments/`, not the `.json`.

## Engineering rules
- TypeScript strict mode.
- Avoid unnecessary dependencies and services.
- Keep the stack small: add a database, authentication, cloud inference or a backend only when a feature needs it, and say why.
- Write deterministic tests for energy accounting, action legality, conflict resolution, reproduction, inheritance, mutation, and seeded repeatability.
- Record observable inputs, action scores, decisions, and energy changes.
- Do not claim organisms learned during life unless lifetime learning is implemented.
- Do not hardcode desired emergent behaviors.
- Keep mobile touch targets comfortable and contrast readable.
- After meaningful changes run `npm run verify` (check, tests, build; prints one line per step, or the tail of the failing step).

The first milestone's build order and acceptance criteria (all met; keep them true) are in `docs/decisions.md`.
