# Species detection (observer-only)

Status: spec, 2026-10-28. Roadmap: Goals step 4 ("recognising species"). Observer: never changes the world, PRNG streams or `stateHash()` (follow the `lineage.ts` pattern).

## Goal
Replace "fixed 30° hue buckets" as the meaning of a group with **species**: clusters of organisms close in genome, with stable ids and names that persist across ticks, plus feed events when species appear, split or die out. Builds conditions for the standing goal (colour groups splitting into species); it must never feed back into the sim.

## Distance
`src/sim/species.ts` exports `genomeDistance(a, b, config): number` in [0, 1].
- With `dnaEnabled` (default): normalised distance over the organism's decoded traits/genes (body: size, diet, sensing, metabolism, digestive, detox, clutch, dispersal, abilities; life-history genes; brain weight vector by cosine/RMS distance, capped so brain noise cannot dominate: brain share of the total ≤ `speciesBrainWeight`, default 0.3). Hue tag is included as one low-weight term (`speciesTagWeight`, 0.1), because it is the visible marker.
- Without DNA: same terms from the legacy fields. Pure function, no PRNG, no allocation in the hot loop (typed arrays).
- Document each term's normaliser in the file header.

## Clustering (stable ids)
Run every `speciesInterval` (50) ticks on the host side from a pre-tick snapshot of living organisms.
1. Each existing species keeps a **representative** (the medoid of its last members; stored, not recomputed from scratch, so ids don't flicker).
2. Assign each organism to the nearest representative if distance ≤ `speciesThreshold` (0.15), else to an unassigned pool.
3. Cluster the pool greedily (seeded order by organism id, no PRNG): a pool cluster with ≥ `speciesMinSize` (5) members that stays distinct for `speciesPersistTicks` (200) becomes a new species. If its nearest parent species is known, record `parentSpeciesId` (speciation = a split), else it is an immigrant/founder species.
4. A species with 0 members for `speciesExtinctTicks` (100) is extinct; keep its record (id, name, born tick, extinct tick, peak count, parent).
5. Medoids update with hysteresis (move only if the new medoid is ≥ 0.02 closer) to avoid id churn.
Names: reuse `src/ui/names.ts` style, deterministic from the species id.

## Output
- `SpeciesSnapshot` in `src/sim/protocol.ts` (append-only fields): species list (id, name, parent, count, mean hue, colour, born, extinct?), per-organism `speciesId` for the draw loop, and a count-history series (bounded ring, e.g. 600 samples) for a stacked chart.
- Events through `WorldEventDetector` (`src/sim/events.ts`): `speciation` ("New species X split from Y"), `species-extinct`. World events only, per AGENTS.md.
- Persist: optional field in `SavedWorld` (older saves lack it and rebuild; excluded from `stateHash()`, like lineage).

## UI
- Colour mode "Species" in the existing colour-mode control; Colour Groups list gains a Species list (name, count, swatch, parent) behind a toggle; tapping a species highlights its members.
- Trends: stacked species-population chart; mobile-first (390px, 44px touch targets, WCAG AA).
- Inspector: show the selected organism's species and its distance to the species representative.
- Settings: `speciesEnabled` (observer on/off, default on), thresholds under an "Advanced" fold.

## Config (flat keys, `speciesXxx` prefix)
`speciesEnabled`, `speciesInterval`, `speciesThreshold`, `speciesMinSize`, `speciesPersistTicks`, `speciesExtinctTicks`, `speciesBrainWeight`, `speciesTagWeight`. These are display/observer parameters: changing them cannot change any fingerprint.

## Tests (mechanism only, never "speciation emerges")
- Distance: identity 0, symmetry, range [0,1], brain cap respected.
- Two hand-built far-apart populations → two species; ids stable across repeated runs and across a tick of no change.
- Determinism: same seed twice → identical species history; fingerprint with `speciesEnabled` true vs false identical (observer).
- Snapshot round trip keeps ids.
- Perf: observer cost per run at 500 organisms; budget < 1 ms amortised per tick.
