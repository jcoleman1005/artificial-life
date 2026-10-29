# Spec: the physics contract (base levers for genes)

_Status: Agreed draft 2026-10-29. Follows [`WORLD_RULES.md`](../WORLD_RULES.md) and [`AGENTS.md`](../../AGENTS.md). Decisions behind it are in [`docs/decisions.md`](../decisions.md); implementation order is in [`docs/STATUS.md`](../STATUS.md) ("Physics build order")._

## Purpose

Gene ideas need something to hook into. This document names the small set of **quantities** the world is made of and the **laws** that connect them, so a new gene is described as a lever on those quantities, not as a special rule. Complex behaviour (hunting, hiding, nesting, migration, defence) should come from a few general levers combined, the way a Bibite's traits all act on energy, mass, health and speed. Nothing here names a target outcome; it names what genes are allowed to push on.

Each line below is marked **Built** (in the engine today), **Decided** (agreed, not built) or **Open** (a hook point that still needs a decision).

## 1. The quantities

| Quantity | What it is | Where it lives | Status |
|---|---|---|---|
| **Energy** | The only need and the only currency. Comes only from eating; bounded by 0 and a size-scaled cap; zero is death. | `organism.energy`, fat, carried food, eggs, carrion, plants | Built |
| **Size** | One body-scale number (founder = 1) that stands in for mass. Sets cap, costs, corpse energy and, later, footprint and wound ceiling. | `organism.size` (`sizeGeneEnabled`) | Built |
| **Wound** | Accumulated damage as a single scalar: raises upkeep, impairs movement, heals only by spending energy, kills above a size-scaled ceiling. | new optional field | Decided |
| **Time** | How often a body acts. Today every body acts once per tick. Tempo derives it from metabolic rate and size, capped at 2 per tick. | tick loop | Decided |
| **Space** | One body per cell. A derived footprint radius (about √size) draws large bodies overlapping and drives crowding pressure; size gates squeeze and leap. Per-cell terrain fields (roughness, cover) vary the ground. | grid, renderer, terrain fields | Footprint Decided; terrain fields Built (2026-10-29) |
| **Heat** | Local temperature from season and weather fronts. Cold and heat both cost upkeep, scaled by body shape (size^(∓1/3)), fat and metabolic rate. | `weather.ts`, `thermalUpkeepFactor` | Built (2026-10-29) |
| **Matter** | Soil nutrients cycling between plants, animals, carrion and soil. Not energy, but energy-bearing things return to it. | `nutrientCycle`, `depositNutrients` | Built |
| **Information** | What a body can sense and remember: sensing radius, signals, memory span, brain inputs. Costs upkeep; limited to local senses plus signals. | `sensors.ts`, `brain.ts` | Built (line of sight Decided) |

A body also has **Age** (tracked, does nothing yet) and, with growth, a current size below its genetic target. Senescence is deferred.

## 2. The laws

Constants are today's values in `src/sim/config.ts`. A law is a scaling rule, not a per-gene constant: genes change the *inputs* to a law, never the law.

| Law | Rule | Status |
|---|---|---|
| Upkeep | `tickMetabolismCost × size^0.75 × metabolicRate` plus sensing `0.003 × r²`, digestion, meat machinery, detox (× size^0.75), carry, fat, memory, abilities, diet, genome length | Built (`metabolismCost`) |
| Move cost | `moveCost × size × (1 + 0.5 × fat/capacity)` × diagonal 1.4, squeeze 2, leap 2.5; mud `1 + 0.25 × rain`; wind multiplier 0.5 to 1 | Built (`moveEnergyCost`, `step`) |
| Energy cap | `maxEnergy × size`; reproduction threshold ∝ size; starting energy ∝ size | Built (`maxEnergyOf`, fixed 2026-10-28) |
| Fat | Surplus food stored at 0.75 efficiency; released below 0.4 of cap at 3 per tick; upkeep 0.004 per unit; drag on movement | Built |
| Thermal | Upkeep × cold `1 + 0.4·max(0,−T)·size^(−1/3)·(1 − 0.5·fatRatio)/rate`, or heat `1 + 0.4·max(0,T−0.1)·size^(1/3)·(1 + 0.5·fatRatio)·rate`; T = season ±0.1 plus fronts; a founder body pays the old cold cost | Built (2026-10-29, `thermalUpkeepFactor`) |
| Food yield | `25 × (1 − 0.6 × carnivory) × digestive efficiency`, cut by plant defence unless detox covers it; malaise `8 × (unneutralised − 0.3)` | Built |
| Corpse | Carrion = `10 × size + 0.7 × energy held`; a meal is `taken × carnivory × digestion × meat efficiency`, bite cap 30; eating a newborn must return less than making it | Built (size scaling 2026-10-28) |
| Terrain | Entering a cell costs `× (1 + 1.0 × roughness × √size)`; cover scales temperature felt, and rain and wind exposure, by `1 − 0.6 × cover`. Wear: each crossing removes 0.5% of roughness and 0.3% of cover (× √size), each plant bite 0.4% of cover; worn cells recover toward the original at 0.2% of the gap per tick | Built (2026-10-29, `src/sim/terrain.ts`) |
| Fertility | Plant growth, germination and seed rain read a live per-cell fertility. A bite removes 0.0012, a move in 0.0003 × √size; every 10 ticks it closes 0.2% a tick of the gap to the soil's nutrient level and gains 0.1% a tick of the gap to 1.0 where weather moisture is above baseline; kept within [0.2, 1.0] | Built (2026-10-29, on by default pending its gate; `SoilField` in `src/sim/plants.ts`) |
| Birth | Child energy = `floor(energy × investment)`; plus tax 5 and egg extra `3 × eggAllocation`; cooldown `12 / metabolicRate` | Built |
| Matter return | 0.5% of spent energy to soil; corpses and plants return a share on decay | Built |
| Kill chance | Attacker's energy share × `(0.2 + 0.8 × carnivory)` | Built; to be replaced by the combat function |
| Combat | One resolution function over a combatant record (force from mass and energy, damage into wound); no combat-specific genes | Decided (outline) |
| Growth | Born small, grow while fed (growth-duration gene, hatch maturity), maturity gates breeding, senescence and old-age death | Built (on `main`, `docs/specs/growth.md`) |
| Sight | Walls and bodies block what lies behind them inside the sensing window | Decided (conditional on phone budget) |
| Conservation | Energy in minus energy out equals the change in the energy the animals hold (organisms, fat, eggs, carrion), checked by a runtime ledger; plants are outside the system and food enters at the mouth | Built (2026-10-29, `src/sim/ledger.ts`) |

## 3. The gene-fit test

Before adding a gene, answer four questions. If any answer is "it needs a rule of its own," the physics is missing a lever; add the lever first (section 5), not the gene.

1. **Which quantity does it change?** (energy, size, wound, time, space, heat, matter, information)
2. **What does it buy?** Expressed through an existing law: a different input to upkeep, move cost, yield, wound, cap or sensing.
3. **What does it cost?** A cost through a law, never free: upkeep, size, drag, or a trade against another gene. If a gene is better in every case, the cost is wrong.
4. **Where does it enter the ledger?** Every unit of energy it moves across the system boundary must be added to the matching flow in `src/sim/ledger.ts`; a gene that leaves the residual non-zero fails `tests/ledger.test.ts`.

Worked examples (illustrations of the test, not plans):

| Idea | Quantity | Buys | Costs | Missing lever? |
|---|---|---|---|---|
| Thick hide | Wound, size | Higher wound ceiling, less damage per bite | Extra size (cap, upkeep, move cost) | None once wound load exists |
| Strong jaw | Wound (dealt), energy | Larger force in combat; bigger bites | Upkeep ∝ size^0.75 and a food-handling cost | Bite size (Open: food physics) |
| Long legs | Time | More actions per tick | More upkeep, higher move cost | None once tempo exists |
| Cold tolerance | Heat | Lower cold upkeep | Fat or size (insulation vs surface-area-to-volume) | None once thermal physics exists |
| Burrowing | Space, heat, information | Hidden from sight, shelter from weather | Move cost, energy to dig | Terrain cover (Decided) |
| Camouflage | Information | Reduces how far a hunter sees | Upkeep | Line of sight (Decided) |
| Gliding or flight | Space, time | Crosses roughness and obstacles, long dispersal | Large upkeep ∝ size | A rule for ignoring roughness (extends terrain fields) |
| Venom | Wound (dealt) | Damage over time | Energy to make it, detox race | Wound over time (part of wound load) |
| Pheromone trail | Information, matter | Persistent signal in cells | Energy per deposit | A persistent signal layer (Open) |

## 4. Rules for adding or changing a lever

- Prefer one general law with many inputs over a rule per gene.
- Every lever gets its own `...Enabled` switch (the lock for a control arm), a Parameter-log entry for its constants, a ledger entry, a matched on/off experiment and a fingerprint noted in STATUS.
- A new brain input is the expensive kind of addition (each adds weights and per-organism work); batch inputs in a single `upgradeBrain`.
- Respect the phone budget: the S21 runs about 177 µs per organism-tick in Termux (2026-10-28, `docs/findings.md`). Levers that add per-organism work default off for the phone profile unless there is measured headroom.
- Never encode a desired behaviour; encode the physics that makes it possible.

## 5. Open hook points

Reopened 2026-10-29 as places gene ideas will need. Each lists what the lever would add and the decision required. None is built.

**5.1 Weather acting through the body** (was held)
- *Lever:* rain drag, headwind and wind drift scale with size and footprint instead of being flat; heat and cold act through shape, fat and metabolic rate (the thermal decision).
- *Unlocks:* gene ideas about mud tolerance, wind exposure, shelter seeking, coat or insulation, migration timing.
- *Decide:* whether the headwind penalty is uncapped (a cap is needed), and whether weather also changes perception (rain blurs sight).

**5.2 Food physics** (was left as is)
- *Lever:* bite size set by body mass (units or energy per action), carry capacity as a mass limit, optionally handling time for tough food (needs tempo).
- *Unlocks:* jaw, gut and gape genes; grazers vs browsers; large and small animals eating the same plant differently.
- *Decide:* bite scaling only, or handling time too; whether yield depends on bite size.

**5.3 Terrain fields** (Built 2026-10-29: roughness and cover; brain inputs, wetness and dynamic terrain still open)
- *Lever:* continuous per-cell fields instead of named types. Version 1 has **roughness** (raises the cost of entering a cell, scaled by footprint) and **cover** (shelter: cuts thermal swing and rain/wind exposure, partly blocks sight). Generated once from smooth seeded noise, independent of the food regions, static for the run. Today a cell is open or wall, and walls stay.
- *Unlocks:* habitat specialists, cover and ambush, burrowers, camouflage, cold shelter, and the habitat split that could push colour groups into separate species.
- *Wear (Built 2026-10-29):* bodies change the terrain passively. Trampling smooths roughness and strips cover, grazing strips cover, and worn ground recovers toward the original. An active dig or build action is a later step.
- *Still open:* a wetness field tied to the weather moisture baseline, world-driven change (rivers, fire), brain inputs for terrain, and which body-dependent costs besides footprint apply.

**5.4 Persistent signal layer (scent)** (Proposed 2026-10-29, awaiting approval: `docs/specs/scent-layer.md`)
- *Lever:* cells hold a decaying signal value (trails, scent marks) that bodies can deposit and sense, drifting with wind.
- *Unlocks:* pheromone trails, territory marking, alarm, recognition. This is roadmap item 15.
- *Decide:* number of channels, decay and diffusion rates, deposit cost, sensing cost.

**5.5 Senescence** (ageing and old-age death are built on `main`; the wound-ceiling link below waits for wound load)
- *Lever:* wound ceiling and healing fall with age.
- *Unlocks:* lifespan genes, parental investment trade-offs, generational turnover.
- *Decide:* after growth is built.

## 6. Build order

Implementation order is in `docs/STATUS.md` under "Physics build order". This contract is the reason for the order: levers first (ledger, then thermal, growth, footprint, wound, combat), then expensive perception and tempo, with the open hook points slotted in after the long baseline runs show which levers the existing genes already use.
