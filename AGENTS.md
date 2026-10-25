# Artificial Life Lab — Agent Instructions

## Goal
Build a persistent artificial-life simulation, developed on Fedora and primarily viewed on a Samsung Galaxy S21 browser. The first milestone (a playable, mobile-friendly 2D grid simulation) is done; the always-on server is planned (see `docs/STATUS.md`).

## Scope
Nothing is deferred. Any feature is fair game to suggest or build: predation, conflict between groups, sexual breeding and species, age, memory, lifetime learning, richer bodies, the always-on server, persistence, world branching, naturalistic rendering, and anything else. Suggest freely; agree larger changes with the user before building them, and record each decision under "Decisions already made". The agreed build order is the Roadmap in `docs/STATUS.md`.

## Decisions already made
- Visual-first world, with expandable organism inspection, statistics, and experiment controls.
- Grid-based abstract terrain, obstacles, and distinctive abstract organisms.
- Food patches spawn at random valid locations, have finite stock, regenerate up to a capacity, and can be replenished by new patch spawns.
- Windfalls (`windfallsEnabled`, off until measured): every `windfallInterval` ticks a cluster of up to `windfallPatches` ordinary-looking patches holding `windfallUnits` in total lands around a random free cell anywhere, whatever the season. They never regrow, rot after `windfallLifetime` ticks, and don't count against `maxFoodPatches`. Most organisms can't see one, which gives signals something to say. With the switch off they draw nothing from the PRNG.
- World: 60×60 by default (the original 30×30 world is a preset). Food grows only inside `foodRegionCount` fertile discs of radius `foodRegionRadius`, placed at random at the start of a run (0 regions = food anywhere).
- Seasons: a fixed cycle of `seasonLength` ticks ends with a lean stretch (`leanFraction` of the cycle) in which food regrows `leanSlowdown` times slower and no new patches spawn. `seasonLength` 0 turns seasons off. With `staggeredSeasons` (the default), each region runs the same cycle shifted by an even fraction, so lean times sweep from region to region and there is no world-wide season.
- Organisms have energy as their only initial need. Age and reproductive timing come later.
- Limited-radius local senses: own energy, nearby food, nearby obstacles, and nearby organisms (including whether their tag looks like one's own), and whether an adjacent organism is hungry (below half energy). Signals are the one longer-range sense: the nearest organism that signalled last tick within `signalRadius`, and how alike it looks. No global map knowledge.
- Legal actions: move one cell (orthogonally, or diagonally with the diagonal ability), leap two cells (with the leap ability), eat (from the current cell, otherwise a carried unit), pick up a food unit to carry (up to the organism's own carry capacity), reproduce, give one carried food unit to an orthogonally adjacent organism, or signal. Explore is a behavioral tendency that influences movement scores, not a separate physical action.
- Movement costs energy only when successful. Invalid moves do not gain benefits. Diagonal moves cost `diagonalMoveCost` × `moveCost`, and cannot cut a corner where both side cells are walls or obstacles.
- Moves know whether their target cell holds a non-family organism (`targetOccupied`). The evolvable `avoidOccupied` dial (head start 1–2) and the brain's `moveOccupied` input (head start −2.25) learn how much to avoid that; it is not a hard rule.
- Movement abilities: diagonal moves, squeezing and leaping are inherited per organism (`abilities`), and only work in worlds where their switch (`diagonalMoves`, `squeezeEnabled`, `leapEnabled`) is on. Leaping is off by default (2026-10-25): on the default world it was selected against and slightly lowered the population; the ability and its switch remain for experiments. With `founderAbilities` 'one' (default), each founder gets exactly one enabled ability or none, with equal chances, so lineages start specialised and selection can show which pays; 'all' gives every founder every enabled ability. Each ability flips at birth with probability `abilityMutationRate`, and each one held costs `abilityUpkeep` energy per tick.
- Squeezing past (squeeze ability): moving into a non-family organism's cell trades places with it, if it stays put that tick, at `squeezeCostMultiplier` × the move's cost. It uses the same rules as family pass-through, so two organisms walking into each other trade places.
- Leaping (leap ability): an organism can jump orthogonally over an adjacent organism into the free cell beyond, at `leapCostMultiplier` × `moveCost`. The `leapEagerness` dial and the brain's `isLeap` input decide when to use it. Leaps resolve like moves to the landing cell.
- Parents and their children can pass through each other: moving into a cell held by one's own child or parent trades places with it, if that organism stays put that tick. Only the mover pays the move cost; the mover's cell stays reserved so cells never double up, and the trade happens after all actions. Two family members moving into each other make one trade (both pay). If several organisms try to pass through the same one, a seeded random pick lets one through. Moving into any other organism's cell is blocked.
- Energy is bounded by zero and a maximum capacity. At zero, an organism dies.
- Energy only ever comes from eating food. Organisms never transfer energy to each other: they share food, which the recipient eats. (Energy transfer let a family recycle energy among themselves without finding food.)
- Reproduction is asexual. It transfers energy so parent and offspring remain viable. Offspring inherit policy weights with occasional mutations.
- Dispersal (`dispersalEnabled`): each organism inherits a dispersal distance (founders 1–3 steps; a child shifts by ±1 with probability `traitMutationRate`, between 1 and `maxDispersal`). A child is born in a random free cell up to that many steps from the parent (uniform over free cells in reach; cells taken after this tick's moves, other parents' birth cells and earlier newborns are excluded), and the parent pays `dispersalCost` per step beyond the first, so it only reaches as far as it can afford. The chosen adjacent cell is always a candidate. With the switch off, or distance 1, children are born in the chosen adjacent cell as before.
- Evolvable bodies so far: the movement abilities (above), dispersal distance and carry capacity; other physical abilities are fixed for now. Carry capacity is an inherited body trait (founders 1–3 units; a child shifts by ±1 with probability `traitMutationRate`, bounded by 0 and `maxCarryCapacity`). Each unit costs `carryUpkeep` energy per tick, so capacity only spreads if storing food pays for its upkeep.
- Tribes are never assigned. Each organism carries a visible, inherited tag (a hue) that mutates slowly at birth. Kinship is graded: similarity runs from 1 (same hue) to 0 (opposite hue). The sharing weight applied to a neighbour is `shareWithKin` at or above `kinSimilarity` (0.75), `shareWithStrangers` at or below `strangerSimilarity` (0.25), and a linear blend in between. Only those cut-offs are fixed; both weights, and kin affinity (graded movement toward similar and away from dissimilar organisms), evolve from neutral, identical starting ranges.
- Giving food is need-aware: it is only offered to an adjacent organism below half energy, and its score scales with that neighbour's hunger times the evolved weight for how alike it looks (or `careForChildren` for one's own child). It competes with eating the same food oneself, so a hungry parent can give away its last unit if its care outweighs its hunger. Gifts are delivered (and eaten) after all actions so decisions stay simultaneous. `sharingEnabled` is an experiment switch; compare runs with it on and off.
- Childhood: for `childhoodTicks` after birth (default 800, one plenty-to-lean cycle), a child senses its parent (`parentWithFood`) whenever the parent is carrying food. The evolved `followFoodParent` weight (head start 0.5–1.5) pulls it toward that parent. The parent still decides whether to give (via `careForChildren`); children cannot take food.
- Parental care: organisms recognise their own children. The `careForChildren` weight starts strongly positive (a deliberate starting bias) but evolves like any other weight. `forageDrive` (how keen an organism is to pick up and carry food) evolves from a near-neutral start.
- Signals: SIGNAL costs `signalCost`, takes the organism's turn, and is sensed by others the next tick (decisions stay simultaneous). Signals have no built-in meaning: when to signal (`signalOnFood`, `signalWhenHungry`) and how to respond (`followSignal`) start centred on zero and evolve; the brain's signal connections start at zero apart from a small cost. `signalsEnabled` is an experiment switch; any claim that signals mean something must be compared against a signals-off control.
- Immigration: every `immigrationInterval` ticks, `immigrationCount` founders with random tags and policies arrive in random free cells, so look-alike groups are not purely families.
- Offspring are born adjacent and inherit their parent's tag, so look-alike clusters form from family structure alone, even with sharing off. Claims about tribe formation must be compared against a sharing-off control, not read from cluster counts by themselves.
- Hybrid controller: hard constraints define legal actions; an interpretable weighted policy chooses among them.
- Food first, as evolvable head starts rather than fixed rules. Prefer head starts over fixed priorities: they set day-one behaviour but leave evolution free to keep, weaken, or reverse it.
  - Eating is possible when food is underfoot or carried and there is room for a full meal (energy <= max − `foodEnergyYield`). This is a physical rule.
  - `eatPriority` (head start 1.5–2): when eating is possible, every other action except feeding one's own hungry child is pushed down by `eatPriority × EAT_PRIORITY_SCALE`. The scale must exceed the largest movement score, or hungry organisms walk off food they could eat.
  - `hungerUrgency` (head start 1.5–2): when hungry (below half energy), moving toward known food adds `hungerUrgency × HUNGER_URGENCY_SCALE × alignment`, enough at the head start to outweigh other pulls and even an evolved aversion to food.
- Two inherited controllers; `controller` picks which one chooses actions ('dials' or 'brain'). Every organism carries and inherits both, so the switch works mid-run and runs can be compared on the same seed. **The brain is the default and the main controller**; the dials are kept as the interpretable reference and control group.
  - Dials: the interpretable weighted policy (one evolvable weight per tendency, including `restDrive` for resting). New behaviours go into the brain first; add a dial only when an experiment needs a readable baseline for that behaviour. Under the brain the dial weights still inherit and mutate but steer nothing, so they only drift; never read them as evidence of selection in brain runs.
  - Brain: a tiny neural network (39 action features → 6 tanh hidden units → score, plus direct "skip" connections). Founders' skip connections start as a dial-like head start, and the hidden layer starts small and random. Each weight mutates at birth with probability `brainMutationRate`. Legal-action rules, the full-meal rule and family pass-through still apply. The inspector lists each input's direct contribution plus the hidden layer's total.
- Memory (`memoryEnabled`, off until measured; brain only, the dials are the no-memory reference). Named memories: where food was last seen, where the last signal came from, and home (the birthplace), recalled as a direction with a freshness fading to 0 over the organism's memory span; food found gone is forgotten. Free registers: 3 numbers in [-1, 1] carried tick to tick, updated by inherited weights from the organism's senses and their own previous values; the brain reads them (through its hidden layer). Memory span is an inherited body trait (founders 0–10 ticks; a child shifts by `memorySpanStep` with probability `traitMutationRate`, up to `maxMemorySpan`) costing `memoryUpkeep` per tick of span; span 0 means no memory at all. Memory updates after all actions, from what was sensed at the start of the tick.
- Discrete ticks: every living organism decides once per tick.
- Simultaneous decisions: all organisms choose actions from the same pre-tick snapshot. Resolve conflicts with a seeded random tie-breaker.
- Use a dedicated seeded PRNG in simulation code; do not use Math.random() for simulation outcomes.
- Metrics remain separate: survival, reproductive success, and behavioral diversity.
- Keep simulation logic independent from Canvas rendering and UI. The simulation runs in a Web Worker (`SimulationHost`); the page talks to it only through the messages in `src/sim/protocol.ts`, and reads the world through `WorldView`/`OrganismView`.
- Observers watch the world after each tick and never change it (no randomness, no writes): `WorldEventDetector` (world events: region seasons turning, colour groups rising to 10+, dying out or taking the lead, population records in steps of 100, crashes below half the recent peak, extinction, generation milestones every 25) and `ActivityMaps` (fading heatmaps of blocked moves, deaths and meals). The feed shows world events only: one line under the peek strip and a list in the Stats tab.
- Overlays over the world, one at a time: Family, Senses & signals, Trails, Crowding, Deaths, Feeding.
- Snapshots: `World.exportState()` / `World.fromState()` save and restore a world exactly (settings, PRNG seed and state, counters, terrain, food, organisms in their original order, trend history); a restored world continues bit-identically. A `SavedWorld` (format `alife-world`, version 1) wraps it with the event feed. The browser keeps one auto-save (every 2 minutes while running, on pause, when hidden) and resumes it automatically on open, with a "Start fresh" option; branch points are saved worlds you can jump back to; files move worlds between devices. Saves from before a field existed load with its neutral default (e.g. dispersal 1); bump the version only for changes old saves cannot be read under.
- Experiments can start from a saved world (`npm run experiment -- --from saved.json`): every variant and seed continues the same evolved state, each seed with its own random stream, and counters are measured from that start.
- Planned: server-side persistence.

## Working notes
- Read `docs/STATUS.md` at the start of a session and update it at the end: current state, findings, next steps.
- Use `npm run experiment` for comparisons instead of writing one-off scripts, and `npm run fingerprint` to prove an engine optimization changes no outcome.

## Engineering rules
- TypeScript strict mode.
- Avoid unnecessary dependencies and services.
- Keep the stack small: add a database, authentication, cloud inference or a backend only when a feature needs it, and say why.
- Write deterministic tests for energy accounting, action legality, conflict resolution, reproduction, inheritance, mutation, and seeded repeatability.
- Record observable inputs, action scores, decisions, and energy changes.
- Do not claim organisms learned during life unless lifetime learning is implemented.
- Do not hardcode desired emergent behaviors.
- Keep mobile touch targets comfortable and contrast readable.
- After meaningful changes run: npm run check, npm test, npm run build.

## First milestone (done; kept for reference)
Implementation order used:
1. Responsive interface and Canvas grid.
2. Seeded PRNG and deterministic world initialization.
3. Sensing, policy scoring, legal movement.
4. Simultaneous decisions, conflict resolution, energy accounting.
5. Food depletion, regeneration, and spawning.
6. Reproduction, inheritance, mutation, lineage.
7. Pause, single-step, speed, reset/new seed, selection details, metrics.
8. Tests and build verification.

Acceptance criteria (all met; keep them true):
- npm run dev opens a playable world.
- Organisms move, sense local resources and obstacles, eat, spend energy, die, and reproduce.
- Offspring inherit and sometimes mutate policy weights.
- Conflicts are fair and reproducible with a saved seed.
- UI has pause/resume, step, speed, reset/new seed, population, food, births/deaths, and selected-organism details.
- No invalid energy values, illegal overlaps, or runtime errors during extended runs.
- npm run check, npm test, and npm run build pass.
