# Inherited hatch maturity (follow-up to growth.md)

Status: queued 2026-10-28, to build AFTER the growth/ageing port (with the `growthDuration` gene) merges. Option 1 only; option 2 (development inside the egg over time, incubation duration as the gene) is deferred.

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
