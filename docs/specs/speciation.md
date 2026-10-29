# Spec: Reproductive Isolation from Genome Distance (Hybrid Incompatibility)

_Status: phase 0 and phase 1 BUILT (2026-10-28) after the user chose: hue input only, per-child cost, default on (recorded in `docs/decisions.md`, Hybrid incompatibility). Not built yet: the Trends histogram, inspector distance and cluster colour mode (§8), and the experiment (§5). Follows [`WORLD_RULES.md`](../../WORLD_RULES.md) and [`AGENTS.md`](../../AGENTS.md). Serves the standing goal "colour groups becoming separate species" (`docs/STATUS.md`, Goals, step 3: "weaker or infertile offspring from parents too far apart genetically")._

## 1. Summary

Today the hue tag is a neutral inherited label, and mating ignores how different two parents are. The brain can already prefer similar hue (`mateAlike`, an existing input), but preferring it costs and gains nothing, because a cross between distant lineages is as good as a cross within one. So nothing makes choosiness pay.

This spec adds the one missing condition: **crosses between genomes that have drifted far apart produce less viable children.** It does not tell anyone whom to mate with, and it does not link hue to anything. If organisms evolve to prefer partners who share a visible signal, and if lineages diverge, reproductive isolation can then emerge. If not, that is a result.

This mirrors how nature works. Isolation is a by-product of divergence (Dobzhansky–Muller incompatibilities: genes that work in their own background fail together in a mix). Mate preference then evolves to avoid the cost (reinforcement). No one assigns species.

## 2. Mechanism

### 2.1 Genome distance (observable, deterministic, no PRNG)

`genomeDistance(a, b) -> [0, 1]` over two organisms' genomes (`dnaEnabled` only; with DNA off the feature is a no-op).

- Walk the union of gene keys of both genomes in sorted key order.
- For each key present in both: `min(1, |doseA − doseB| / scale(key))`.
  - Trait genes: `scale` is the trait's range from the gene registry or `dna.ts` (so a size gene and a dispersal gene count equally).
  - Brain connection genes: `scale = genomeDistanceBrainScale` (a fixed weight scale, default 1.0).
- A key present in only one genome (Stage 2 insertions/deletions) counts 1.
- **Excluded:** the tag gene (`TraitId.tag`). Hue must stay a neutral marker; if it fed the distance, hue would directly define compatibility and the experiment would be circular.
- The distance is the mean over the walked keys. Cost is O(genes) per mating, not per tick.

With the growable brain (Stage 3) a hidden unit counts as one gene, as in crossover: compare per unit, scale 1 per unit that differs materially.

### 2.2 Incompatibility

```
incompat = clamp((d − hybridTolerance) / (hybridFull − hybridTolerance), 0, 1)
inviableChance = hybridMaxInviability × incompat
```

Applied to each child of a mating clutch at birth, after the clutch is partitioned (see `mate()` in `world.ts`):

- Draw one seeded PRNG number per child **only when `incompat > 0`** (so a world with no divergent crosses draws nothing extra, and the switch off draws nothing at all).
- An inviable child never exists. Its share of the pool is dissipated as metabolic heat and added to `matingEnergyLostTotal`, exactly like the existing sub-viable remainder. Energy stays conserved: the pool is paid out or lost as heat, nothing appears or vanishes.
- Parents still pay their full share and tax. A failed cross is a real cost, which is what makes choosiness pay.

Cloning and egg paths are unaffected (one parent: distance 0).

### 2.3 Preference: what changes and what does not

- **No genome-distance sensor.** Organisms cannot read each other's genomes; that would hand them the answer. Preference must act on observable signals.
- Existing signals already available: `mateAlike` (hue similarity), `mateFamily`, `mateReady`.
- **Optional phase 2 (needs your decision):** one append-only input, `matePhenotypeAlike`, the similarity of two visible body traits (size, diet, detox, appearance), so preference can follow a correlate of genome distance that is not hue. Hue only correlates with genome distance through shared descent; a body-trait signal correlates through ecology. Not building it first, so phase 1 measures what the existing hue input can do alone.
- Brain inputs are append-only (`BRAIN_INPUTS`); adding one needs `upgradeBrain` handling and a bump to the input count pinned in `tests/defaults.test.ts`.

## 3. Config

All new fields are top-level in `src/sim/config.ts` with the `hybrid` prefix, per `WORLD_RULES.md`.

| Field | Default | Meaning |
|---|---|---|
| `hybridIncompatibilityEnabled` | `true` (subject to the ship-on gate; see §6) | Master switch; needs `dnaEnabled`. Off: bit-identical to the current world. |
| `hybridTolerance` | `0.15` (from the diagnostic; Parameter log in `docs/findings.md`) | Distance below which crosses are fully compatible. |
| `hybridFull` | `0.35` (same) | Distance at which incompatibility is maximal. |
| `hybridMaxInviability` | `0.8` (not 1: leave rare hybrid escapes) | Chance a child of a maximally incompatible cross fails. |
| `genomeDistanceBrainScale` | `1.0` | Scale for brain weight genes. |
| `hybridControlInviability` | `0` | Matched-control arm: above 0, every cross loses children at this flat rate whatever the distance (`hybridMaxInviability` is then ignored). Set it from arm 2's measured loss rate. |

**Parameter log:** `hybridTolerance`, `hybridFull` and `hybridMaxInviability` are tuned constants. Per `AGENTS.md`, log old and new values and why in the Parameter log in `docs/findings.md`, and pin them in `tests/defaults.test.ts`. Setting tolerance from the baseline distribution (e.g. just above the median pairwise distance within one lineage) is a calibration, not a way to force the outcome. State this in the log.

## 4. Phase 0: diagnostic first (no behaviour change)

Before any cost exists, add observer-only metrics to the metrics row, computed on a sample (e.g. 200 random pairs plus every mating pair) at the existing sampling interval:

- Mean and median genome distance between random pairs, and between mating pairs.
- Distribution of pairwise distances (histogram, 20 bins). Species formation shows as this turning from one peak into two.
- Correlation between hue distance and genome distance across random pairs. With DNA mating and a neutral hue this should start near 0, and grows only if descent links them. This is the signal that hue can act as a marker at all.
- Count of "clusters": connected components of the graph linking organisms whose genome distance is below `hybridTolerance` (single-linkage). This is the "species detection" step in the STATUS recipe, and uses distance instead of fixed hue buckets.

Observers never change the world (existing rule); they must not touch the PRNG, and must not change `stateHash()`.

Run the diagnostic on the current build to set `hybridTolerance` and `hybridFull` from real distances, then record them.

## 5. Experiments

Per `WORLD_RULES.md` (8 seeds × 10k ticks, paired, immigration off, DNA Stage 1b toggles off). Arms:

1. `hybridIncompatibilityEnabled=false` (baseline; must equal the pre-change fingerprint).
2. `hybridIncompatibilityEnabled=true`.
3. `hybridIncompatibilityEnabled=true, hybridControlInviability=<arm 2's measured rate>`: the same overall rate of inviable children, but independent of distance. This separates "isolation by distance" from "mating just got more expensive". It matters most, per the rules.
4. Optional: arm 2 on a long run (e.g. 50k ticks, or the always-on server), since speciation, if it comes, is slow.

Report plainly, null results included, in `docs/findings.md`:
- Does choosiness evolve (the `mateAlike` weight in mating decisions, over time)?
- Does the matings-between-distant-lineages fraction fall versus the control?
- Does the pairwise-distance histogram become bimodal, or the cluster count rise and persist?
- Do hue and genome distance become correlated, and does hue track the clusters?
- Cost side: population, births, `matingEnergyLostTotal`.

Nothing here asserts that species appear. A flat result is a valid outcome.

## 6. Ship-on gate

New features are on by default (`docs/decisions.md`, "No target outcome") with a switch. The full experiment must pass the standard gate (`avgPop` ratio ≥ 0.8, `leanLow` ≥ 0.7, no new extinct seeds). If it fails, ship with the switch off and say so in `docs/findings.md`. Because the feature only bites on divergent crosses, a collapse would most likely come from a calibration that is too aggressive, which is why tolerance comes from the diagnostic.

## 7. State, determinism, testing

- **No new per-organism state.** Distance is computed from the genomes at mating. New world state: a few counters (hybrid crosses attempted, children lost to incompatibility, energy lost), in `exportState()` / `fromState()` as optional fields that default to 0. Old saves load; bump `WorldState.version` only if the migration needs it.
- **Switch-off identity:** `npm run fingerprint -- --set hybridIncompatibilityEnabled=false` equals the recorded baseline. Extend `scripts/fingerprint.ts` to hash the counters when on.
- **Determinism:** seeded PRNG, fixed key order, no `Math.random()`. Same seed twice gives the same fingerprint.
- **Test budget** (`WORLD_RULES.md`):
  1. Switch-off fingerprint equals baseline.
  2. Same seed twice, same fingerprint.
  3. 1,000-tick smoke run, feature on: no NaN, no negative energy, no overlap, no crash.
  4. Snapshot round trip.
  5. Mechanism tests (small, hand-built): `genomeDistance` is 0 for identical genomes, symmetric, excludes the tag gene, and counts a one-sided key as 1; a mating of identical genomes draws no extra PRNG numbers and loses no energy; a mating of maximally distant genomes with `hybridMaxInviability = 1` yields no children and the whole pool is accounted in `matingEnergyLostTotal` (energy conserved). When a test disables a feature to isolate a mechanism, it says so.
  6. Tick-time at 500 organisms, switch on vs off (target under 5%).
- `tests/defaults.test.ts` pins the new defaults and the logged parameter values.

## 8. UI (render only)

- Trends: genome-distance histogram (random pairs vs mating pairs), cluster count, hybrid losses.
- Inspector: for a selected organism, show its genome distance to its mate or to the adjacent organism (display only).
- Colour mode "Cluster": colour by genome-distance cluster instead of hue. Display only; hue stays the inherited tag.
- Must read at ~390px on a phone, with 44×44 touch targets.

## 9. Risks

- **Hue may never correlate with genome distance** (it drifts independently except through descent). Then hue-based preference cannot pay, and phase 2 (`matePhenotypeAlike`) becomes the real test. That is a finding, not a failure.
- **Distance is dominated by brain weights** (hundreds of genes) and may swamp ecological traits. Mitigations: per-key scaling as above; if it still swamps, weight trait genes and brain genes as two separate means and average them (record the choice).
- **Calibration:** too low a tolerance means constant failed crosses and population loss; too high means no effect. Hence the diagnostic first.
- **Slow dynamics:** speciation may need runs longer than 10k ticks (the always-on server).
- **Performance:** O(genes) per mating; with `dnaMaxGenes` 1500 this is small next to a tick, to be confirmed by the tick-time check.
- **Asexual escape:** organisms can clone and avoid the cost altogether. That is the intended alternative and stays; compare the mating share across arms.

## 10. Decisions (answered 2026-10-28: 1 hue input only, 2 per child, 3 default on; 4 and 5 as drafted)

1. Phase 1 as drafted (cost plus diagnostic, hue input only), or build phase 2's `matePhenotypeAlike` input at the same time?
2. Inviability applied per child (as drafted), or as reduced clutch size (fecundity)? Per child matches Dobzhansky–Muller; clutch reduction folds into the existing continuous fecundity partition.
3. Default on (per the standing rule, gated) or off until the experiment is read?
4. Cluster detection by single-linkage on genome distance (as drafted), or something cheaper to compute every tick?
5. Branch/commit convention: `world:` prefix per `WORLD_RULES.md`.

## 11. Build order (once agreed)

1. Phase 0: `genomeDistance` plus observer metrics; run the baseline diagnostic; record the distribution in `docs/findings.md`.
2. Calibrate `hybridTolerance` / `hybridFull`; log in the Parameter log.
3. Phase 1: the incompatibility cost behind its switch, counters, tests, fingerprint.
4. Experiment (arms 1–3), findings, ship-on decision.
5. UI (Trends histogram, inspector distance, Cluster colour mode).
6. Optional phase 2: `matePhenotypeAlike`.
