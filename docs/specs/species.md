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

## As built (2026-10-28)

Code: `src/sim/species.ts` (distance, `SpeciesTracker`, names), host wiring in `src/sim/host.ts`, UI in `src/ui/species-view.ts` and `src/ui/species-settings.ts`, tests in `tests/species.test.ts`. Observer only: the tracker reads `world.organisms`, `world.tick` and `world.config`, draws no random numbers and writes nothing back. `npm run fingerprint` is unchanged (before and after both: `large dials f8b636a2088d6381`, `large brain a8e50b331bc9b2f2`), and a test checks that `stateHash()` and the PRNG state of a watched world equal an unwatched one.

**Note on the base.** Built on an older commit without lineage/weather/detox; merged by hand. Adding detox to the distance is one line in the `TERMS` table in `species.ts`.

### Distance (`genomeDistance(a, b, config)`, in [0, 1])
Computed on the organism's decoded fields, the same terms with or without DNA (with DNA on they are the genome's expressed traits). Three parts, each in [0, 1], weighted `1 - brain - tag`, `speciesTagWeight`, `speciesBrainWeight`:
- body: mean over 18 traits of |difference| / range (ranges from config; the term list and normalisers are in the file header). A trait either organism lacks (its gene switch is off) is skipped.
- tag: circular hue difference / 180.
- brain: RMS difference of the brain weight vector / 1, capped at 1 (policy weights / 2 under the dials controller). Because the part is capped, the brain can never add more than `speciesBrainWeight`.

The genome itself (the `Uint32Array`) is not compared; the expressed body and brain are. Features are written once per organism per run into one `Float32Array`, and pair distance is a typed-array loop.

### Clustering
As specified, with these details:
- Runs when `tick - lastRun >= speciesInterval` (and on the first call). Organisms are processed in id order (plain string order).
- Pool leftovers are grouped by leader clustering into candidates (16 kept between runs, largest first). A candidate keeps its first-seen tick across runs; at `speciesMinSize` members and `speciesPersistTicks` of age it becomes a species, and the nearest living species (by representative distance) is its `parentId`, with a `speciation` event.
- **Bootstrap:** with no living species at all (the start, a rebuilt save, after extinction), candidates are promoted at once as founders: no parent, no event.
- A species with no members for `speciesExtinctTicks` (measured from the last run that saw a member, so the granularity is `speciesInterval`) is extinct; its record stays (the 300 most recent extinct records are kept).
- Medoids: at most 24 candidates are tried against at most 48 evenly spaced members (a bounded approximation of the exact medoid); the stored representative moves only if the best candidate's mean distance is at least 0.02 lower.
- If the controller is switched mid-run the feature layout changes; living species are dropped (extinct records are kept) and rebuilt, with no event.
- Organisms born since the last run are placed for display by nearest representative within the threshold; the next run assigns them for real. Organisms in no species have id 0 (the map then falls back to the tag hue).

### Config (flat, all observer-only)
`speciesEnabled` true, `speciesInterval` 50, `speciesThreshold` 0.15, `speciesMinSize` 5, `speciesPersistTicks` 200, `speciesExtinctTicks` 100, `speciesBrainWeight` 0.3, `speciesTagWeight` 0.1. Settings has a Species section (on/off) with an Advanced fold for the numbers.

### Protocol (all optional, append-only)
- `FromWorker` frame: `speciesIds?: number[]`, parallel to `organisms`.
- `PanelData`: `species?: SpeciesSnapshot` (id, name, parentId, count, meanHue, hue, born, extinct, peak; `history` only while the viewer wants history, i.e. the Trends tab) and `selectedSpecies?: { speciesId, distance } | null`.
- `SavedWorld.species?: SpeciesState` (JSON-safe: representatives are arrays with `null` for a missing trait). Older saves lack it and species are rebuilt at load. It is not part of `WorldState`, so `stateHash()` is unaffected.
- Events: `speciation` (speciesId, name, parentId, parentName) and `speciesExtinct` (speciesId, name), recorded through the new `WorldEventDetector.record()`. Names are `Genus epithet` strings fixed by the id.

### UI
Colour mode "Species" (Settings > Display; hue is a golden-angle step of the id, the tag hue for organisms in no species); Stats tab "Species" fold with a tappable list (tap highlights members, dimming the rest; extinct species folded away); Trends tab stacked area chart of species counts (up to 600 runs, i.e. 30,000 ticks, oldest species at the bottom); the Organism tab shows the species and distance to its representative on a line above the inspector (inserted by `main.ts`, so `inspector.ts` is untouched). Rows are at least 44px high.

### Measurements
- Default seed-2 world, brain controller, one tracker per threshold on the same run (population 200 to 660). At 0.15: 3 species at tick 250 growing to 13 by tick 2000 (20 splits). At 0.20: 1 growing to 8 (8 splits). At 0.25: 1 growing to 4 (3 splits). At 0.30: at most 2 (1 split). At 0.35: 1. Pairwise distance medians at tick 1200: body 0.12, tag 0.38, brain 0.30 (before weighting). The spec default 0.15 was kept; much of the splitting is neutral drift of brain weights and hue. Raising the threshold toward 0.2 to 0.25 is the knob if the list is too busy. A separate 3,000-tick run at 0.15 had made 53 ids by the end, most of them short-lived small clusters.
- Cost: 7 ms median per run at 500 organisms (founder world), i.e. 0.14 ms per tick amortised over the 50-tick interval; about 0.33 ms per tick measured inside a live 3,000-tick run including the interval check. Budget was 1 ms.

### Tests (`tests/species.test.ts`)
Distance identity, symmetry, range, purity, brain cap, circular tag, missing trait, dials; two far populations give two species with stable ids across runs and across a fresh tracker; run cadence; persistence clock (split at exactly 200 ticks, with parent); minimum size; extinction timing and kept record; hysteresis; history ring; JSON round trip keeps ids; a save without species rebuilds; disabled does nothing; empty world; a watched world has the same `stateHash()` and PRNG state as an unwatched one; same seed gives identical species history; observer settings leave the world state (minus config) identical; host frames carry aligned `speciesIds`; host save/load round trip; cost under 1 ms per tick at 500 organisms.
