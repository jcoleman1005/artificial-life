# Artificial Life Lab — Agent Instructions

## Goal
Build a persistent artificial-life simulation, developed on Fedora and primarily viewed on a Samsung Galaxy S21 browser. The playable prototype is done; next comes an always-on server-side world, hosted on a dedicated old Galaxy S21 with snapshots backed up to Proxmox. Feature work follows the Roadmap at the end of this file.

## First milestone (done)
A playable, mobile-friendly 2D grid simulation.

## Decisions already made
- Visual-first world, with expandable organism inspection, statistics, and experiment controls.
- Grid-based abstract terrain, obstacles, and distinctive abstract organisms.
- Food patches spawn at random valid locations, have finite stock, regenerate up to a capacity, and can be replenished by new patch spawns.
- Seasons: a fixed cycle of `seasonLength` ticks ends with a lean stretch (`leanFraction` of the cycle) in which food regrows `leanSlowdown` times slower and no new patches spawn. `seasonLength` 0 turns seasons off.
- Organisms have energy as their only need so far. Age and reproductive timing are on the Roadmap.
- Limited-radius local senses: own energy, nearby food, nearby obstacles, and nearby organisms (including whether their tag looks like one's own), and whether an adjacent organism is hungry (below half energy). No global map knowledge.
- Legal actions: move one cell (orthogonally, or diagonally with the diagonal ability), leap two cells (with the leap ability), eat (from the current cell, otherwise a carried unit), pick up a food unit to carry (up to the organism's own carry capacity), reproduce, or give one carried food unit to an orthogonally adjacent organism. Explore is a behavioral tendency that influences movement scores, not a separate physical action.
- Movement costs energy only when successful. Invalid moves do not gain benefits. Diagonal moves cost `diagonalMoveCost` × `moveCost`, and cannot cut a corner where both side cells are walls or obstacles.
- Moves know whether their target cell holds a non-family organism (`targetOccupied`). The evolvable `avoidOccupied` dial (head start 1–2) and the brain's `moveOccupied` input (head start −2.25) learn how much to avoid that; it is not a hard rule.
- Movement abilities: diagonal moves, squeezing and leaping are inherited per organism (`abilities`), and only work in worlds where their switch (`diagonalMoves`, `squeezeEnabled`, `leapEnabled`) is on. With `founderAbilities` 'one' (default), each founder gets exactly one enabled ability or none, with equal chances, so lineages start specialised and selection can show which pays; 'all' gives every founder every enabled ability. Each ability flips at birth with probability `abilityMutationRate`, and each one held costs `abilityUpkeep` energy per tick.
- Squeezing past (squeeze ability): moving into a non-family organism's cell trades places with it, if it stays put that tick, at `squeezeCostMultiplier` × the move's cost. It uses the same rules as family pass-through, so two organisms walking into each other trade places.
- Leaping (leap ability): an organism can jump orthogonally over an adjacent organism into the free cell beyond, at `leapCostMultiplier` × `moveCost`. The `leapEagerness` dial and the brain's `isLeap` input decide when to use it. Leaps resolve like moves to the landing cell.
- Parents and their children can pass through each other: moving into a cell held by one's own child or parent trades places with it, if that organism stays put that tick. Only the mover pays the move cost; the mover's cell stays reserved so cells never double up, and the trade happens after all actions. Two family members moving into each other make one trade (both pay). If several organisms try to pass through the same one, a seeded random pick lets one through. Moving into any other organism's cell is blocked.
- Energy is bounded by zero and a maximum capacity. At zero, an organism dies.
- Energy only ever comes from eating food. Organisms never transfer energy to each other: they share food, which the recipient eats. (Energy transfer let a family recycle energy among themselves without finding food.)
- Reproduction is asexual into an adjacent empty cell. It transfers energy so parent and offspring remain viable. Offspring inherit policy weights with occasional mutations.
- Physical abilities are fixed so far, with two deliberate exceptions, the movement abilities (above) and carry capacity. Carry capacity is an inherited body trait (founders 1–3 units; a child shifts by ±1 with probability `traitMutationRate`, bounded by 0 and `maxCarryCapacity`). Each unit costs `carryUpkeep` energy per tick, so capacity only spreads if storing food pays for its upkeep.
- Tribes are never assigned. Each organism carries a visible, inherited tag (a hue) that mutates slowly at birth. Kinship is graded: similarity runs from 1 (same hue) to 0 (opposite hue). The sharing weight applied to a neighbour is `shareWithKin` at or above `kinSimilarity` (0.75), `shareWithStrangers` at or below `strangerSimilarity` (0.25), and a linear blend in between. Only those cut-offs are fixed; both weights, and kin affinity (graded movement toward similar and away from dissimilar organisms), evolve from neutral, identical starting ranges.
- Giving food is need-aware: it is only offered to an adjacent organism below half energy, and its score scales with that neighbour's hunger times the evolved weight for how alike it looks (or `careForChildren` for one's own child). It competes with eating the same food oneself, so a hungry parent can give away its last unit if its care outweighs its hunger. Gifts are delivered (and eaten) after all actions so decisions stay simultaneous. `sharingEnabled` is an experiment switch; compare runs with it on and off.
- Childhood: for `childhoodTicks` after birth (default 800, one plenty-to-lean cycle), a child senses its parent (`parentWithFood`) whenever the parent is carrying food. The evolved `followFoodParent` weight (head start 0.5–1.5) pulls it toward that parent. The parent still decides whether to give (via `careForChildren`); children cannot take food.
- Parental care: organisms recognise their own children. The `careForChildren` weight starts strongly positive (a deliberate starting bias) but evolves like any other weight. `forageDrive` (how keen an organism is to pick up and carry food) evolves from a near-neutral start.
- Immigration: every `immigrationInterval` ticks, `immigrationCount` founders with random tags and policies arrive in random free cells, so look-alike groups are not purely families.
- Offspring are born adjacent and inherit their parent's tag, so look-alike clusters form from family structure alone, even with sharing off. Claims about tribe formation must be compared against a sharing-off control, not read from cluster counts by themselves.
- Hybrid controller: hard constraints define legal actions; an interpretable weighted policy chooses among them.
- Food first, as evolvable head starts rather than fixed rules. Prefer head starts over fixed priorities: they set day-one behaviour but leave evolution free to keep, weaken, or reverse it.
  - Eating is possible when food is underfoot or carried and there is room for a full meal (energy <= max − `foodEnergyYield`). This is a physical rule.
  - `eatPriority` (head start 1.5–2): when eating is possible, every other action except feeding one's own hungry child is pushed down by `eatPriority × EAT_PRIORITY_SCALE`. The scale must exceed the largest movement score, or hungry organisms walk off food they could eat.
  - `hungerUrgency` (head start 1.5–2): when hungry (below half energy), moving toward known food adds `hungerUrgency × HUNGER_URGENCY_SCALE × alignment`, enough at the head start to outweigh other pulls and even an evolved aversion to food.
- Two inherited controllers; `controller` picks which one chooses actions ('dials' or 'brain'). Every organism carries and inherits both, so the switch works mid-run and runs can be compared on the same seed.
  - Dials: the interpretable weighted policy (one evolvable weight per tendency).
  - Brain: a tiny neural network (28 action features → 6 tanh hidden units → score, plus direct "skip" connections). Founders' skip connections start as a dial-like head start, and the hidden layer starts small and random. Each weight mutates at birth with probability `brainMutationRate`. Legal-action rules, the full-meal rule and family pass-through still apply. The inspector lists each input's direct contribution plus the hidden layer's total.
- Organisms have no memory yet (see Roadmap): each tick's decision uses only that tick's senses.
- Discrete ticks: every living organism decides once per tick.
- Simultaneous decisions: all organisms choose actions from the same pre-tick snapshot. Resolve conflicts with a seeded random tie-breaker.
- Use a dedicated seeded PRNG in simulation code; do not use Math.random() for simulation outcomes.
- Metrics remain separate: survival, reproductive success, and behavioral diversity.
- Keep simulation logic independent from Canvas rendering and UI.

## Working notes
- Read `docs/STATUS.md` at the start of a session and update it at the end: current state, findings, next steps.
- Use `npm run experiment` for comparisons instead of writing one-off scripts, and `npm run fingerprint` to prove an engine optimization changes no outcome.

## Engineering rules
- TypeScript strict mode.
- Avoid unnecessary dependencies and services.
- Prefer files over services: no database, authentication or cloud inference unless a Roadmap item truly needs one; the server stays a single small Node.js process.
- Write deterministic tests for energy accounting, action legality, conflict resolution, reproduction, inheritance, mutation, and seeded repeatability.
- Record observable inputs, action scores, decisions, and energy changes.
- Do not claim organisms learned during life unless lifetime learning is implemented.
- Do not hardcode desired emergent behaviors.
- Keep mobile touch targets comfortable and contrast readable.
- After meaningful changes run: npm run check, npm test, npm run build.

## Suggested implementation order
1. Responsive interface and Canvas grid.
2. Seeded PRNG and deterministic world initialization.
3. Sensing, policy scoring, legal movement.
4. Simultaneous decisions, conflict resolution, energy accounting.
5. Food depletion, regeneration, and spawning.
6. Reproduction, inheritance, mutation, lineage.
7. Pause, single-step, speed, reset/new seed, selection details, metrics.
8. Tests and build verification.

## First milestone acceptance criteria
- npm run dev opens a playable world.
- Organisms move, sense local resources and obstacles, eat, spend energy, die, and reproduce.
- Offspring inherit and sometimes mutate policy weights.
- Conflicts are fair and reproducible with a saved seed.
- UI has pause/resume, step, speed, reset/new seed, population, food, births/deaths, and selected-organism details.
- No invalid energy values, illegal overlaps, or runtime errors during extended runs.
- npm run check, npm test, and npm run build pass.

## Roadmap
Nothing is off limits any more; this is the order of work, not a list of exclusions. Each item gets its own branch off `main`, and new abilities follow the same pattern as existing ones: evolvable head starts, inherited traits with upkeep where they are physical, and a switch so runs can compare with and without them.

1. **Snapshots and resume.** Save and restore a whole world (organisms, food, PRNG state, tick, metrics history) so a resumed run continues exactly as if never stopped. Test: run N ticks straight vs N/2, save, load, N/2 more; fingerprints must match.
2. **Always-on server.** A single Node.js process runs the world, saves snapshots on a timer and on shutdown, and serves the app, which then watches the live world instead of running its own. Hosted on the S21 (Termux), backed up to Proxmox; see `docs/STATUS.md`. Move the browser's own simulation into a Web Worker along the way.
3. **Age and reproductive timing.** Lifespans, a maturity age before breeding, and ageing effects, with the timing traits inherited and evolvable.
4. **Memory.** A recurrent brain state carried between ticks, and remembered places (e.g. recent food spots) whose slot count is an inherited trait with upkeep. Still no global map knowledge: only what the organism itself has sensed.
5. **Lifetime learning.** Organisms adjust their own brain from experience (e.g. energy gained after an action), with an evolvable learning rate that starts near zero. Learned changes are not inherited unless deliberately switched on. Keep the rule: do not claim learning unless it is implemented and measured against a learning-off control.
6. **Evolving bodies.** More inherited physical traits beyond carry capacity and the movement abilities, such as sensing radius, metabolism rate and maximum energy, each with a cost.
7. **Signals.** Organisms emit and sense simple signals whose meaning is free to evolve.
8. **Predation, conflict and theft.** Organisms may attack, take food from, or eat others, with energy costs and risks; tribes may compete. Never hardcode which groups fight.
9. **Multiple species.** Separate lineages that cannot interbreed or swap places, with different bodies and diets (e.g. plant-eaters and predators).
10. **World branching.** Fork a saved world into variants and compare how they diverge.
11. **Richer rendering.** More naturalistic visuals, still kept separate from the simulation and readable on a phone.
