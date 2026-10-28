# Growth and ageing (world change, roadmap item 11)

Status: spec, 2026-10-28. A world change: follow `WORLD_RULES.md` strictly (switches, switch-off identity, snapshots, test budget). Needs the user's agreement as a decision (record in `docs/decisions.md` at merge; the coordinator adds the AGENTS.md index line).

## Goal
Organisms hatch small, grow to their adult size over time, can only breed once mature, and decline with age. Gives juvenile vulnerability, a cost to being born early, generation turnover, and a reason for parental care. Nothing behavioural is hardcoded: only bodies and costs change.

## Mechanics (two switches)
`growthEnabled` (default on) and `ageingEnabled` (default on), independent, each the lock for its control arm. Both off = bit-identical to today (fingerprint in `docs/STATUS.md` is the baseline).

**Growth.** Add `maturity` in [0, 1] to Organism (state, snapshotted). Newborns/hatchlings start at `hatchMaturity` (0.35). `growthTicks` (600) to reach 1 if fed. Each tick growth adds `1/growthTicks` only while `energy ≥ growthEnergyFloor × maxEnergy` (growth stalls when starving, so it is food-limited), and costs `growthCostPerTick` extra energy (heat, counted in an energy ledger so conservation tests still hold). `bodyScale = hatchScale + (1 - hatchScale) × maturity` multiplies the *effective* size from the existing size gene: `maxEnergy`, basal metabolism (Kleiber exponent, already in code), movement cost, bite size/plant yield and carry capacity, visual radius (renderer only). Adult-size genes remain inherited; juveniles are weaker (smaller bite, smaller reserves) but cheaper to run.
- **Maturity gate:** REPRODUCE and MATE are illegal below `matureAt` (0.9). Illegal actions are masked like other hard constraints (`policy.ts`), not penalised.
- Interaction with `childhoodTicks` (parent-sensing window): leave it unchanged; document how growth overlaps it. Clone/mating/egg energy accounting stays as is; a hatchling's initial energy is clamped to its small `maxEnergy`, and any excess is dissipated and counted in the existing loss ledgers.
- Brain input: append-only `maturity` (0..1) to `BRAIN_INPUTS` with an `upgradeBrain` entry, zero head start and zero weight for founders; update `BASE_BRAIN_INPUT_COUNT` bookkeeping per existing convention and the `tests/defaults.test.ts` pins if needed. Report the append.

**Ageing.** After `senescenceAge` (4000 ticks) metabolism rises by `senescenceRate` per tick of extra age (multiplier `1 + senescenceRate × (age - senescenceAge)`), and above `maxAge` (8000) the organism dies of old age (death cause "old age", leaves carrion as normal). No random hazard draws needed (deterministic by age). Optional second step, only if cheap: an inherited `senescenceAge` gene with a trade-off (longer life costs upkeep) — propose in the report, don't build without agreement.

## Surfaces
- Inspector / organism card: maturity bar and "juvenile/adult/senescent" badge; age vs lifespan.
- Renderer: body radius uses `bodyScale`; render-only.
- Metrics: mean maturity, juvenile fraction, deaths by old age, mean lifespan (existing field), included in CSV and experiment output.
- Events feed: no per-individual events (world events only); optionally a population-level "old age deaths spike" if trivial.
- Settings: toggles for both under Genetics/Life history.

## Process (per WORLD_RULES.md)
1. Record `npm run fingerprint` before; after, `--set growthEnabled=false --set ageingEnabled=false` must match exactly. Extend `scripts/fingerprint.ts` to hash maturity when on. Record new default fingerprints in the agent's report (the coordinator writes STATUS.md).
2. Snapshots: `maturity` goes into `exportState()`/`fromState()`; optional field defaulting to 1 for old saves (so old worlds load as adults). Bump version if the repo convention requires it.
3. Test budget only: smoke run, round trip, one hand-built mechanism test (growth stall when starving; REPRODUCE masked when immature; energy conservation incl. growth heat; old-age death at `maxAge`), seeded repeatability, perf at 500 organisms (<5%).
4. Do NOT run the full 8-seed gate; run a quick look (2 seeds × 3000 ticks, growth on vs off) and report population curves. The default-on decision for ageing/growth is the user's after seeing it; if the quick look shows collapse, ship that switch default **off** and say so.
5. Log every tuned constant in the Parameter log of `docs/findings.md` and pin head starts in `tests/defaults.test.ts`.
