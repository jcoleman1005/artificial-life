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
- Limited-radius local senses: own energy, nearby food, and nearby obstacles. No global map knowledge.
- Legal actions: move one orthogonal cell, eat food in the current cell, or reproduce. Explore is a behavioral tendency that influences movement scores, not a separate physical action.
- Movement costs energy only when successful. Invalid moves do not gain benefits.
- Energy is bounded by zero and a maximum capacity. At zero, an organism dies.
- Reproduction is asexual into an adjacent empty cell. It transfers energy so parent and offspring remain viable. Offspring inherit policy weights with occasional mutations.
- Fixed physical abilities during Phase 1; evolve decision policy first.
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
Always-on server execution, restart persistence, world branching, evolving bodies, age, memory, predation, multiple species, and elaborate naturalistic rendering.
