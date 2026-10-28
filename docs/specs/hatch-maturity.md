# Inherited hatch maturity (follow-up to growth.md)

Status: built 2026-10-28 (option 1 only; see As built). Option 2 (development inside the egg over time, incubation duration as the gene) is deferred.

## Goal
Make the maturity a newborn or hatchling starts with an inherited trait, so lineages can trade many small, helpless young (altricial, low maturity, long growth) against few well-developed ones (precocial, high maturity, short growth). With `growthDuration` this spans the life-history strategies without any rule preferring one.

## Mechanics
- New gene `hatchMaturityGene` (trait id after `growthDuration`; follow clutch/detox/growthDuration patterns in lifehistory.ts, dna.ts, traits.ts, genes). Config: `hatchMaturityGeneEnabled` (default true), `hatchMaturityMin` 0.2, `hatchMaturityMax` 1.0, `hatchMaturityStep`, founder = current `hatchMaturity` (0.35). Gene off: every newborn uses config `hatchMaturity` (bit-identical to before).
- Applies equally to live births and egg hatchlings, for clones and matings (a child's value comes from its genome; mating crosses it like other life-history genes; mutation as usual).
- Trade-off through existing budgets, no new reward rule: a newborn's body scale and `maxEnergy` depend on its maturity, and the minimum viable energy to launch a child (`minViableChildEnergy`, investment pool, clutch partition, egg envelope) scales with the maturity it is born at. A more developed child costs more of the parent's pool, so fewer children per clutch. Document the exact form in the spec's As built.
- Maturity gate (`matureAt`) and growth stalls apply unchanged; a hatch maturity at or above `matureAt` means the child can breed at once (allowed; the cost above is the brake).
- Interaction with `growthDuration`: growth rate per tick stays 1 / duration of the full 0..1 range, so a precocial child finishes sooner. Document.

## Surfaces
Inspector/organism card badge ("Precocial"/"Altricial" when far from founder), Trends genome section histogram and mean, `docs/findings.md` Parameter log rows for any constants.

## Tests (mechanism only)
Inheritance (clone, mating), clamping, higher hatch maturity => larger newborn and larger launch cost (fewer children from the same pool), switch-off identity, snapshot round trip incl. old saves, determinism. Quick look only: 2 seeds x 3000 ticks, gene on vs off; report mean evolved value over time.

## As built (2026-10-28)

Option 1 only. Switch `hatchMaturityGeneEnabled` (default on, active only with `growthEnabled`; the lock for its control arm). Gene `hatchMaturity` is **trait 53** in the `LIFE_GENES` table (`lifehistory.ts`), after `growthDuration` (52); so it is inherited by clones (`inheritLife`), legacy mating (`recombine`) and DNA mating (`crossGenomes` by key), mutates one step with probability `traitMutationRate`, and is clamped like the other life-history genes. Config: `hatchMaturityMin` 0.2, `hatchMaturityMax` 1.0, `hatchMaturityStep` 0.05; founders carry the world's `hatchMaturity` (0.35), so the gene alone changes nothing at the start. Gene off: a newborn uses `hatchMaturity` and the old launch rules; a stray `hatchMaturity` on an organism is ignored (`hatchMaturityOf`).

**Newborn.** A child (live birth or egg hatchling) starts at its own genome's value. Body scale, `maxEnergyOf` and the energy clamp follow from it through the growth code as before (energy past the body's capacity is lost and counted in `growthEnergyLostTotal`). Growth rate per tick stays `1 / growthDuration` of the full 0..1 range, so a precocial child finishes sooner and heat per growing tick is unchanged; a hatch maturity at or above `matureAt` (0.9) breeds at once.

**Exact cost form.** Let `scale(h) = hatchScale + (1 - hatchScale) h` and `ratio(h) = scale(h) / scale(hatchMaturity)` (`launchRatioOf`: exactly 1 at the world's reference 0.35, so 0.2 gives 0.852, 0.5 gives 1.148, 1.0 gives 1.639; always 1 with the gene or growth off). The child's own `h` is used, so each child is conceived first (genes drawn) and priced afterwards (`conceive` / `bearChild` split of `makeChild`; same PRNG draws in the same order).
- **Mating (clutch partition).** Minimum viable energy of a child is `minViableChildEnergy x ratio(h)` (`minViableEnergyAt`). Children are admitted in order while the sum of their minima fits the pool (both parents' investment shares); if every child of the clutch fits, the pool is split in proportion to the minima (a more developed child gets a bigger share, nothing is minted); otherwise each admitted child gets exactly its minimum and the remainder is dissipated as heat (counted in `matingEnergyLostTotal`), as before. Fewer fit when each is more developed. The legacy gate (`floor(pool / minViableChildEnergy)`, equal split) is untouched when the gene is off.
- **Cloning (investment).** The investment `floor(energy x investment)` is unchanged, but it must be at least `minViableChildEnergy x ratio(h)` or REPRODUCE fails (`energy_too_low`, nothing paid). Before this, clones had no floor; it applies only with the gene on, and at the reference 0.35 the floor is the same 10 as for matings.
- **Eggs (envelope).** The shell synthesis cost is `round(eggExtraCost x eggAllocation x ratio(h))`, and the same viability floor applies to the hatchling's energy.
- The more developed child therefore costs more of the parent's pool (a higher floor and shell), fewer fit per clutch, and an altricial child costs less but is born small and slow to breed. No rule names a preferred hatch maturity.

**Surfaces.** Organism card badge "Precocial" (h >= founder + 0.25) / "Altricial" (h <= founder - 0.1); inspector "Born at" pill and a "Hatch maturity" gene dosage row; Trends: a "Hatch maturity" mean/spread panel (life-history section), a "Hatch maturity spread" 5-bin histogram (altricial..precocial) and a Hatch card; `LifeMetrics.hatchMaturity`; history CSV `hatchMaturity_*` and bin columns; experiment output `hatchMaturity` and `hatchMaturity.t<tick>`; fingerprint hashes it.

**Saves.** `WorldState.version` stays 1. A save whose config lacks `hatchMaturityGeneEnabled` loads with it **off** (continues bit-identically with the fixed hatch maturity); a save made with it on but whose organisms lack the field falls back to `hatchMaturity` (`lifeForConfig`).

**Fingerprints** (`npm run fingerprint`, seed 2, 1500 ticks). Head before this change: dials `7cd20dc39ba2533a`, brain `17a3d1f6dafd71ed`. With `--set hatchMaturityGeneEnabled=false`: identical. Defaults (gene on): dials `1c9aba7e0db68a51` (pop 636, births 2580), brain `d2b0c5bbf7328c63` (pop 575, births 2483).

**Tests.** `tests/hatch-maturity.test.ts` (range, clamp, genome round trip, clone and mating inheritance in legacy and DNA, body size, closed-form cost, fewer children from the same pool, clone floor, gene-off identity, 400-tick smoke, repeatability, snapshot round trip and old save) plus pins in `tests/defaults.test.ts`.
