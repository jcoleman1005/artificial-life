# Implementation Plan

## Milestone 1: Local playable prototype
- Responsive mobile-first interface and Canvas grid.
- Deterministic seeded world generation.
- Organisms with energy, local senses, and weighted decision policies.
- Food patches with finite stock, regeneration, and random spawning.
- Simultaneous decisions from a pre-tick snapshot.
- Seeded conflict resolution for food and reproduction space.
- Energy accounting, asexual reproduction, inheritance, mutation, and lineages.
- Selection/inspection, population and event metrics, pause/step/speed/reset.

## Milestone 2: Reliability and observability
- Expand deterministic tests.
- Show policy weights, sensed inputs, action scores, selected action, energy delta, and lineage.
- Add versioned JSON snapshots after the simulation model is stable.

## Milestone 3: Persistent server
- Move simulation stepping to a small server-side process.
- Save world state and PRNG state.
- Browser becomes a client that inspects and controls the server simulation.
- Deploy to a dedicated Proxmox LXC without disturbing existing services.

## First milestone exclusions
No database, accounts, cloud inference, lifetime learning, evolving bodies, memory, predation, multi-species ecology, or elaborate graphics.
