# Spec: plants as their own species

_Status: Phase 1 built 2026-10-25 behind `plantsEnabled` (off by default until measured). Drafted the same day. Roadmap item 10 ("Evolving plants") in `docs/STATUS.md`. Where the build differs from the draft below, see "As built"._

## As built (Phase 1)

Code: `src/sim/plants.ts` (rules, genome, metrics), wired into `World` (`src/sim/world.ts`). A plant lives inside a food patch (`FoodPatch.plant`), and the patch's `stock` is always `floor(biomass)`, so organism senses, eating, picking up and the full-meal rule are unchanged.

Decisions on the open questions: built now (ahead of roadmap items 8–9, at the user's request); **no defence** in this version; **no ageing** (plants die only of grazing, shade, poor soil or lean seasons).

Rules that differ from the draft, found by calibration runs (plants alone, then with organisms):

- **Growth scales with size.** `vigour = size / (size + 1)` with `size = biomass + roots`, so seedlings grow slowly and seed size matters. Without it a seedling grew as fast as an adult, and tiny-seeded ruderals (growth rate 0.85, seed size at the minimum) covered the whole world with ~2,000 plants holding almost no edible food.
- **Upkeep:** `(plantUpkeep × size + growthCostFactor × growthRate × vigour) × (1 − 0.8 × dormancy)`. The second term is the cost of growth machinery, paid whatever the light. With the draft's `size × (1 + k × growthRate)` fast growth was always better. Now fast growth pays only where `light × soil × (1 − shadeStrength × shade)` exceeds `growthCostFactor` (0.1): it wins in rich, open, plentiful ground and loses in shade, on the margins and in lean seasons, so no single growth rate is favoured everywhere.
- **Upkeep comes out of biomass and roots in proportion.** Taking it from edible biomass first left plants with roots and nothing to eat.
- **Seeding:** once `size ≥ seedThreshold × maxBiomass`, `seedAllocation` (0.5) of growth goes to the seed budget, and any growth past `maxBiomass` goes there too. Seeds land uniformly in the square of side `2 × round(dispersal) + 1` around the parent.
- **Dormancy** is graded: in a lean season a plant with `leanDormancy = d` loses a fraction `d` of its growth, moves `0.05 × d` of its edible biomass into roots each tick, and saves `0.8 × d` of its upkeep. It shows as dormant (greyed) when `d ≥ 0.5`.
- **Death:** a plant dies when biomass plus roots fall below 0.05. The cause is `grazed` if it was eaten in the last 2 ticks, else `lean` in a lean season, else `shaded` if it had a neighbour, else `starved`.
- **Seasons per cell:** each cell follows the season of its nearest fertile region (margins included).
- **Seed rain** picks a random cell and keeps it with probability equal to its fertility (up to 20 tries per seed).
- **Founders:** the `initialFoodPatches` founder plants are placed where classic patches would be (inside regions), starting with `foodPatchInitialStock` biomass. Windfalls still work alongside plants.
- **Saved worlds:** plants save inside the food patches, plus `plantCounters`; old saves load unchanged, so the format version stays 1 (per `AGENTS.md`: bump only for changes old saves cannot be read under).
- **Not built yet:** plant events in the feed (extinction in a region, a strategy taking over).

Calibrated defaults (`src/sim/config.ts`): `plantUpkeep` 0.01, `growthCostFactor` 0.1, `shadeStrength` 0.5, `marginFertility` 0.2, `seedAllocation` 0.5, `plantMutationRate` 0.2, `plantMutationStdDev` 0.08 (of each trait's range), seed rain 3 seeds every 50 ticks. Trait ranges and founder ranges are in `PLANT_TRAITS`.

Food stops being a fixed resource and becomes a population of plants: individuals with an inherited genome that grow, get eaten, set seed and die. Plants make no decisions. They follow fixed physical rules, and only their life-history numbers evolve, so whatever keeps a plant lineage alive spreads. Nothing about which strategy should win is hardcoded.

## Today's food model (what this replaces)

- Food patches appear at random valid cells (inside fertile regions on the default 60×60 world), up to `maxFoodPatches` (72).
- Each patch regrows `foodRegenAmount` (1) unit every `foodRegenInterval` (4) ticks up to `foodPatchCapacity` (8). One unit gives `foodEnergyYield` (25) energy.
- Lean seasons slow regrowth `leanSlowdown` (8) times and stop new patches; with `staggeredSeasons` each region has its own season.
- Patches never die, even when eaten bare.

The classic model stays as the control: `plantsEnabled: false` keeps it exactly as it is.

## 1. Life cycle

| Stage | Rule |
|---|---|
| **Seed** | Lands on a random cell within the parent's dispersal radius (seeded PRNG). It germinates only on a cell with soil fertility above 0, no plant and no obstacle; otherwise it is lost. A seedling starts with `seedSize` biomass. |
| **Growth** | Each tick: `growthRate × soil(cell) × light(season) × (1 − shadeStrength × shade)`, where `shade` is the fraction of the 8 neighbouring cells holding a plant. Growth stops at `maxBiomass`. |
| **Upkeep** | Each tick: `plantUpkeep × (biomass + roots) × (1 + growthCostFactor × growthRate)`. Big or fast plants pay more. |
| **Being eaten** | Eating takes 1 unit of edible biomass, as today. Organisms sense `floor(biomass)` units, so their senses and the full-meal rule are unchanged. |
| **Reproduction** | Once biomass reaches `seedThreshold × maxBiomass`, a share of each tick's growth goes into a seed budget; each time the budget reaches `seedSize` a seed is released. |
| **Death** | Edible biomass and roots both reach 0 (grazed out, shaded out, or starved through a lean season). Death cause is recorded. |

Order within a tick: plants update after all organism actions resolve (where food regrowth happens now), in a fixed order (grid index), so the simulation stays deterministic.

**Soil:** fertility comes from the existing food regions: high inside a region, low but non-zero outside (`marginFertility`), so hardy plants can colonise the margins. With `foodRegionCount` 0 fertility is uniform.

**Seasons:** a lean season lowers `light` (by `leanSlowdown`) per region, as it slows regrowth today. Random patch spawning is removed: seeds replace it.

**Seed rain:** every `seedRainInterval` ticks, `seedRainCount` seeds with random genomes land on random fertile cells (the plant equivalent of immigration), so plants cannot go permanently extinct and new strategies keep arriving.

## 2. Genome

Each trait is a number inherited from the parent and mutated at birth (probability `plantMutationRate`, Gaussian step `plantMutationStdDev`, clamped to its range). Founders and seed rain draw from wide ranges centred on values that roughly reproduce today's food supply.

| Trait | Benefit | Cost |
|---|---|---|
| `growthRate` | Fast regrowth after grazing | Higher upkeep |
| `maxBiomass` | Bigger seed budget, more food stored | Upkeep grows with size; a richer target for grazers |
| `seedSize` | Seedlings survive shade and early grazing | Fewer seeds from the same budget |
| `seedThreshold` | Grows large before seeding | Reproduces late; may die first |
| `dispersal` | Escapes crowding and shade; reaches empty regions | Far seeds often land on infertile ground or obstacles |
| `rootShare` | Fraction of growth stored as an inedible root reserve; the plant regrows from roots after being eaten bare or through a lean season | Less edible biomass, slower visible growth, roots also pay upkeep |
| `leanDormancy` | In lean seasons, moves biomass into roots and cuts upkeep sharply | Grazers find little there; no growth or seeding while dormant |

The trade-offs map onto the classic plant strategies: ruderal (fast, small, many seeds, wide dispersal), competitor (big, shading, late seeding) and stress-tolerator (roots, dormancy, slow). Any of them can win in a given world; none is favoured by a rule.

## 3. Interaction with organisms

- Eating, picking up, carrying and giving food stay as they are; a unit of food is a unit of plant.
- Organisms can still stand on plant cells.
- Overgrazing now matters: a plant stripped to 0 with no roots dies. Prudent grazing (leaving plants alive) or deeper roots may evolve; neither is hardcoded.
- Later options: trampling seedlings; organisms sensing plant colour (needed before defence makes sense).

## 4. Display and measurement

- **Renderer:** plant size shows biomass; hue comes from strategy (mainly `rootShare` and `growthRate`), so strategies are visible as colours; seedlings are small dots; dormant plants are greyed. Rendering stays separate from the simulation.
- **Inspector:** tapping a plant shows its genome, edible biomass and roots, age, seeds released, and its family line.
- **Trend charts:** a Plants section: plant count, edible biomass vs roots, trait means and spread, plant deaths by cause (grazed, shaded, lean).
- **CSV and `npm run experiment`:** the same metrics, so runs compare directly with the classic model.
- **Snapshots:** plants become part of `World.exportState()`; bump the saved-world version.
- **Events feed:** plant extinction in a region, a strategy taking over a region.

## 5. Experiments (8 seeds each, against a control)

1. **Plants vs classic food:** organism population, lean-season lows, extinctions.
2. **Plants alone (no organisms) vs grazed plants:** which traits grazing selects, separated from seasons.
3. **Seasons on vs off:** whether roots and dormancy evolve only under lean times.

Follow the roadmap rules: one new loop at a time, compare against the frozen baseline preset, and check the performance budget with `npm run perf` (target ~500 organisms on the S21).

## 6. Risks

- **Collapse:** overgrazing can wipe out plants and then organisms. Safety nets: roots, low-fertility margins, seed rain. Expect a few tuning runs.
- **Performance:** a 60×60 world may hold a few thousand plants. The per-plant update is cheap (growth plus an 8-neighbour shade count over the existing grids); confirm with `npm run perf`.
- **Balance:** founder ranges must roughly match today's food supply, or every organism result shifts at once. Calibrate with plants-only runs first.

## 7. Tests (deterministic)

- Growth, upkeep and the biomass cap follow the formulas; shade reduces growth.
- Being eaten removes exactly one unit; a plant at 0 biomass and 0 roots dies, and one with roots regrows.
- Seeds land within the dispersal radius, never on obstacles, infertile cells or existing plants.
- Inheritance and mutation stay within trait ranges.
- Dormancy moves biomass to roots in lean seasons only.
- Snapshot round-trip continues bit-identically with plants on.
- Long run: no negative biomass, no two plants on one cell, same result for the same seed.

## 8. Phases and effort

- **Phase 1** (about 1–2 sessions): life cycle, shade, seeds, seed rain, the 7 traits, rendering, inspector, charts, tests, and experiments 1–3.
- **Phase 2** (about 1–2 sessions, after Phase 1 is stable): defence (toxicity or thorns costing the eater energy, paid for with slower growth) together with an organism sense for plant colour; a seed bank (dormant seeds in the soil); seeds carried in food and dropped elsewhere (dispersal by animals, a route to mutualism).

## Open decisions

1. **Timing:** build plants now, ahead of roadmap items 5–9, or in roadmap order?
2. **Defence:** in the first version, or after Phase 1 is stable (recommended)?
3. **Ageing:** should plants die of old age, or only from starvation, shade and grazing?

When building: record the chosen rules under "Decisions already made" in `AGENTS.md` (food patches are replaced when `plantsEnabled` is on) and update `docs/STATUS.md`.
