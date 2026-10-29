# Handoff: the dynamic fertility gate (8 seeds x 10,000 ticks, run on your machine)

Dynamic fertility ships **on by default** (your choice, 2026-10-29), so this run is the gate that decides whether it stays on. Nothing here has been run for 8 x 10k; the only checks so far are unit tests, the off-switch fingerprint, and a 3-seed x 2,000-tick probe (see `docs/findings.md`).

## Commands

Primary comparison (about 8 runs per arm, 3 workers):
```
npm run experiment -- --compare fertilityDynamicEnabled=false,true --seeds 1-8 --ticks 10000 --workers 3 --json docs/experiments/fertility.json | tee docs/experiments/fertility.txt
```

If the gate fails or the mechanism is unclear (five arms: off, full, no moisture, no wear, graze wear only):
```
npm run experiment -- --arm off=fertilityDynamicEnabled:false --arm full=fertilityDynamicEnabled:true --arm noMoisture=fertilityDynamicEnabled:true,fertilityMoistureRate:0 --arm noWear=fertilityDynamicEnabled:true,fertilityGrazeWear:0,fertilityTrampleWear:0 --arm grazeOnly=fertilityDynamicEnabled:true,fertilityTrampleWear:0 --seeds 1-8 --ticks 10000 --workers 3 --json docs/experiments/fertility-arms.json | tee docs/experiments/fertility-arms.txt
```

Paste back the `.txt` summary (read the `.txt`, not the `.json`).

## The gate

Median per-seed `avgPop` ratio (on / off) >= 0.8, `leanLow` ratio >= 0.8 (the script's own gate line uses 0.7 for `leanLow`; use 0.8 here), and no new extinctions. If it fails, flip `fertilityDynamicEnabled` to `false` in `src/sim/config.ts` and `tests/defaults.test.ts`, and record why.

## What to read first (the metrics run in both arms, so on and off compare)

- `avgPop`, `finalPop`, `leanLow`: did it cost the animals?
- `plantsOutsideDisc%`, `plantBiomassOutsideDisc%`: how much of the crop grows outside the four original discs.
- `fertilityCentroidShift`, `plantCentroidShift`: how far (in cells) the fertile ground and the crop have moved since the start. The off arm should read about 0 for fertility (the map is fixed).
- `zoneOverlap%`: how much of the original rich ground (fertility >= 0.6) is still rich (100 means nothing changed).
- `meanFertInsideDiscs`, `meanFertOutsideDiscs` and the `@25/50/75/100%` series: the trend.
- `onFertile%` next to `inRegion%`: do the animals stay on rich ground, and is it the same as the original discs?
- `discWorn%` (disc cells now below 0.8) and `marginRaised%` (margin cells now more than 0.05 above the floor): how much the field has changed in each direction.

## How to read it

- Population within the gate and a centroid shift of a few cells or more: zones moved without a crash.
- Population within the gate but shifts near zero and `zoneOverlap%` near 100: too gentle to matter.
- Population drop with a large `discWorn%`: wear is too strong; look at the `grazeOnly` and `noWear` arms.
- Be careful of one thing: the seeds swing a lot (ratios of 0.3 to 2.5 in the overgrazing sweep), so a drop in one or two seeds is not a result.

## What the probe already says (3 seeds x 2,000 ticks, not a gate)

Bites are rare (0.007 to 0.017 per disc cell per tick on average), so disc fertility only fell from 1.0 to about 0.93; margin cells rose (up to 0.75 to 0.83 in places; 185 to 1,100 cells above 0.25); the fertility centroid moved 0.6 to 2.6 cells. The wear constants may be too gentle to matter; they were not changed.
