# Artificial Life Lab — Agent Instructions

## Goal
Build a persistent artificial-life simulation, developed on Fedora and primarily viewed on a Samsung Galaxy S21 browser. First deliver a small playable prototype; later deploy a server-side simulation to Proxmox.

## First milestone
A playable, mobile-friendly 2D grid simulation. Do not implement the Proxmox server or always-on persistence yet.

## Decisions already made
- Visual-first world, with expandable organism inspection, statistics, and experiment controls.
- Grid-based abstract terrain, obstacles, and distinctive abstract organisms.
- Food patches spawn at random valid locations, have finite stock, regenerate up to a capacity, and can be replenished by new patch spawns.
- Organisms have energy as their only initial need. Age and reproductive timing come later.
- Limited-radius local senses: own energy, nearby food, nearby obstacles, and nearby organisms (including whether their tag looks like one's own), and whether an adjacent organism is hungry (below half energy). No global map knowledge.
- Legal actions: move one orthogonal cell, eat food in the current cell, reproduce, or share energy with an orthogonally adjacent organism. Explore is a behavioral tendency that influences movement scores, not a separate physical action.
- Movement costs energy only when successful. Invalid moves do not gain benefits.
- Energy is bounded by zero and a maximum capacity. At zero, an organism dies.
- Reproduction is asexual into an adjacent empty cell. It transfers energy so parent and offspring remain viable. Offspring inherit policy weights with occasional mutations.
- Fixed physical abilities during Phase 1; evolve decision policy first.
- Tribes are never assigned. Each organism carries a visible, inherited tag (a hue) that mutates slowly at birth. Kinship is graded: similarity runs from 1 (same hue) to 0 (opposite hue). The sharing weight applied to a neighbour is `shareWithKin` at or above `kinSimilarity` (0.75), `shareWithStrangers` at or below `strangerSimilarity` (0.25), and a linear blend in between. Only those cut-offs are fixed; both weights, and kin affinity (graded movement toward similar and away from dissimilar organisms), evolve from neutral, identical starting ranges.
- Sharing is need-aware: it is only offered to an adjacent organism below half energy, and its score scales with that neighbour's hunger times the evolved weight for how alike it looks (or `careForChildren` for one's own child). The donor pays `shareAmount`; the recipient gains `shareAmount × shareMultiplier`, capped at maximum energy. The default multiplier is 1.0 (pure transfer). Values above 1 create energy, and organisms exploit that by passing energy back and forth, so treat them as a separate experiment. Gifts are delivered after all actions so decisions stay simultaneous. `sharingEnabled` is an experiment switch; compare runs with it on and off.
- Parental care: organisms recognise their own children. A parent may feed an adjacent child below half energy down to `parentalMinEnergyAfter`, a lower floor than ordinary sharing. The `careForChildren` weight starts strongly positive (a deliberate starting bias) but evolves like any other weight.
- Immigration: every `immigrationInterval` ticks, `immigrationCount` founders with random tags and policies arrive in random free cells, so look-alike groups are not purely families.
- Offspring are born adjacent and inherit their parent's tag, so look-alike clusters form from family structure alone, even with sharing off. Claims about tribe formation must be compared against a sharing-off control, not read from cluster counts by themselves.
- Hybrid controller: hard constraints define legal actions; an interpretable weighted policy chooses among them.
- Start with a few evolvable weights. Consider a tiny neural network only after baseline experiments.
- Organisms have no memory in Phase 1.
- Discrete ticks: every living organism decides once per tick.
- Simultaneous decisions: all organisms choose actions from the same pre-tick snapshot. Resolve conflicts with a seeded random tie-breaker.
- Use a dedicated seeded PRNG in simulation code; do not use Math.random() for simulation outcomes.
- Metrics remain separate: survival, reproductive success, and behavioral diversity.
- Keep simulation logic independent from Canvas rendering and UI.
- Eventually support snapshots, resume, speed controls, and branching experiments. Server-side persistence is a later milestone.

## Engineering rules
- TypeScript strict mode.
- Avoid unnecessary dependencies and services.
- Do not add a database, authentication, cloud inference, or complex backend to the first milestone.
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

## Defer
Always-on server execution, restart persistence, world branching, evolving bodies, age, memory, predation, conflict or theft between tribes, multiple species, and elaborate naturalistic rendering.
