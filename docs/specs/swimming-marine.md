# Spec: swimming and marine plants (step 2 of the world-building order)

_Status: **Built 2026-10-29** on branch `claude/elevation-and-water`; `swimGeneEnabled` and `marineEnabled` on by default. The user ordered the build ("1,2,5,3,4"); the form below is my choice within that order, with round values chosen before any run (Parameter log). Say if you want another form._

## Swimming

- **Gene `swim`** (trait 57, life-history table, 0..1, step 0.05). Founders start at 0: nobody can swim, so it has to arise by mutation. Only exists with elevation on (no deep water otherwise); off or elevation off, the organism carries no field and the world is bit-identical.
- **Deep water:** stays an obstacle for everyone, and the snapshot carries a shared `deepGrid`. A body with `swim >= swimDeepThreshold` (0.5) treats deep cells as open for moves, births and dispersal (`World.canEnter`, `policy.getLegalActions`). A child born in deep water that did not inherit enough swimming is stuck there (it can still move to any open cell it can reach) and starves if surrounded: drowning is not scripted, only a consequence.
- **Costs (all through the energy ledger):**
  - upkeep `swimUpkeepRate (0.02) x swim x sizeFactor` per tick, carried on land too;
  - moving into dry land costs `1 + swimLandDrag (0.5) x swim`;
  - moving into deep water costs `1 + swimDeepDrag (1) x (1 - swim)`;
  - wading drag in shallow water is multiplied by `1 - swim`, so partial swimming already pays in the shallows, giving a gradient from wading to swimming.
- Water chill and slope laws are unchanged. Swimmers still see deep water as a wall until the brain upgrade (step 3).

## Marine plants

- With `marineEnabled`, water cells have soil fertility `marineFertility (0.5) x (1 - (1 - marineDeepLight (0.25)) x depth)`: richest in the shallows, a quarter of that at the deepest. Plants there are ordinary plants with the same genome and rules (growth, shade, seeds, nutrients, dormancy); no new trait.
- A seed takes root only in its parent's medium (`SoilField.marine`), so land and marine plants do not mix. Seed rain (random founders) lands on any fertile cell, water included, and is accepted in proportion to fertility, so the sea takes a share of the rain and land gets a little less.
- Marine food can be eaten by anyone standing in its cell: waders in the shallows, swimmers in deep water. Windfalls, initial patches and immigrants are still placed on land only.

## Not built / limits

- A swimming niche is not shown to arise; this is the ingredient. A mutant has to find marine food while paying upkeep, with only the wading gradient and the shore as a pull.
- Swimmers do not sense elevation or water (step 3).
- Dynamic water (tides, floods) is step 5: deep cells are fixed, so the swimming boundary does not yet move.

## Tests

`tests/swimming.test.ts`: gene present only with deep water, threshold, legal moves into deep water for swimmers only, upkeep, land/deep/wade laws, marine fertility by depth and with the switch off, plants appear in water, energy ledger balances, switches.
