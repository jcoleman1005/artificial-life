# DNA: genome-encoded organisms

Stage 1 (built and signed off 2026-10-26): a behaviour-neutral genome, on by default. Stage 1b (built 2026-10-26): two independent toggles, off by default, awaiting review of their gates. Stage 2 (built 2026-10-26): variation operators, off by default pending its gate. Stage 3 (built 2026-10-27): growable brain, off by default pending review of its gate.

## Stage 1 as built (`dnaEnabled`, on by default)

Code: `src/sim/dna.ts`; tests: `tests/dna.test.ts`.

### What is in the genome

| Trait | Gene(s) | Absent-gene value | Decoding |
| --- | --- | --- | --- |
| `tag` | trait 0 | 0° | one gene: its angle exactly; several: circular mean `atan2(Σ sin, Σ cos) mod 360` (rounded to 2 decimals like tags); a zero-length mean vector (exact antipodes) gives 0° |
| `carryCapacity` | trait 1 | 0 | `clamp(round(Σ dose), 0, maxCarryCapacity)` |
| `dispersal` | trait 2 | 1 | `1 + clamp(round(Σ dose), 0, maxDispersal − 1)`; distance d is encoded as dose d − 1 |
| `memorySpan` | trait 3 | 0 | `clamp(round(Σ dose), 0, maxMemorySpan)` |
| `carnivory` | trait 4 | 0 | `clamp(Σ dose, 0, 1)` |
| `abilities.diagonal / squeeze / leap` | traits 5, 6, 7 | 0 | binary: `clamp(round(Σ dose), 0, 1)`; dose 1 gives the ability |
| register weights (`memoryWeights`, 30) | traits 10–39 | 0 | Σ dose |
| brain weights (skip 52, hidden 6 × 52, hidden bias 6, out 6, out bias 1) | brain gene classes 1–5 | 0 (no connection) | Σ dose |

Trait 8 is herbivory (split diets only); 9 is reserved. Traits 40–46 are the life-history genes (reproduction threshold, investment, fat capacity, torpor depth, egg rate, metabolic rate, clutch size; `docs/decisions.md`, `src/sim/lifehistory.ts`): present in a genome only while their switch is on, decoded to their starting value if a switch is on and the gene is missing, and clamped to their bounds. Not in the genome: the policy dials (decided 2026-10-26: they stay outside, inherited directly, so DNA covers the brain controller and the body), and what an organism remembers (`food`, `signal`, `home`, register values): that is lifetime working memory, and a newborn starts with `newMemory(birthX, birthY)`.

### Format

A genome is a `Uint32Array` of genes, three words each: `[key, low, high]`. `key = (geneClass << 16) | index`; `low`/`high` are the little-endian words of the dose's float64, so every value round-trips exactly. Brain hidden genes index `(unit << 8) | input`, so appending brain inputs keeps every gene's meaning. Unknown gene classes are silent; non-finite doses count as 0. A single gene decodes to exactly its dose (even −0), so a present gene at dose 0 gives exactly the baseline: no leak.

### Rules

- `decodeOrganismDNA(dna, config)` is pure: it reads only the genome and the config's bounds.
- Founders: drawn as before, encoded, and the organism is what the genome decodes to.
- Birth: the parent's genome (encoded on the spot if it has none, e.g. DNA switched on mid-run) is copied gene by gene with that trait's legacy operator (tag drift N(0, 8) with probability 0.2, ±1 trait steps, carnivory drift, ability flips, brain/register weight mutation), in genome order, which is the legacy birth code's PRNG draw order. The child is decoded from the result. Costs (movement, `abilityUpkeep`, carry and memory upkeep) are unchanged and read the decoded phenotype.
- Saves store genomes as plain number arrays; old genomes gain head-start direct-connection genes for brain inputs added since (`upgradeGenome`).

### Gate

- Tests: trait-by-trait `decode(encode(o))` equality; legacy upkeep; absence robustness (each trait gene and each brain weight gene deleted in turn, empty genome, junk doses); circular tag mean (10°+350° → 0°, 90°+270° → 0°); 1,000 random input vectors score identically; a DNA world and a legacy world from one seed stay **bit-identical** (both controllers, and with DNA switched on mid-run); two DNA runs give identical state hashes; a DNA world restored through JSON continues exactly.
- Experiment: `npm run experiment -- --compare dnaEnabled=false,true --seeds 1-8 --ticks 10000` (`docs/experiments/dna-stage1-gate.txt`): every metric identical in all 8 seeds (Δ 0).
- Cost: ~25 µs extra per birth (genome mutate + decode, vs the legacy brain and register mutation), about 0.03 ms per tick at ~1 birth per tick. `npm run perf` has a `brain + DNA` row.

Because Stage 1 is bit-identical, the gate is met by construction; switching it on by default only adds the genome's cost.

Note: in the default world many seeds go extinct in an early lean season whatever DNA does (5 of 8 by 10k ticks with DNA off; see `docs/findings.md`), so stage gates compare survivors and report `extinct`.

## Stage 1b as built (each its own toggle and gate; both need `dnaEnabled`, both off by default)

Gates: 8 seeds × 3,000 ticks against the DNA default (`npm run experiment -- --compare <toggle>=false,true --ticks 3000 --workers 4`). Trait means are over runs still alive at the end.

### 1b.1 Continuous movement abilities (`dnaContinuousAbilities`)

- Each ability is an efficiency e ∈ [0, 1] (the ability gene's dose, clamped, not rounded); held when e > 0.
- Upkeep `abilityUpkeep × e`.
- Costs (`moveEnergyCost` in `traits.ts`), written from the existing settings so the defaults give exactly the proposed numbers: diagonal `diagonalMoveCost − (diagonalMoveCost − 1)·e` (1.4 − 0.4e), squeeze `squeezeCostMultiplier + 1 − e` (3 − e) times the move's cost, leap `leapCostMultiplier + 1 − e` (3.5 − e), all × `moveCost`. At e = 1 squeeze and leap cost what they always did; a diagonal costs the same as an orthogonal step (1.0 instead of 1.4).
- Mutation: with probability `traitMutationRate` the efficiency drifts by N(0, `abilityMutationStdDev` = 0.1), clamped to [0, 1] (replaces the 0/1 flip). Founders start as before (one ability at 1, or none).
- Gate (`docs/experiments/dna-1b1-continuous-abilities.txt`): **met.** Efficiencies drift and settle mid-range rather than collapsing or locking: holders' mean efficiency diagonal 0.30, squeeze 0.54, leap 0.29; locked at 1: 4%, 25%, 0%. Abilities spread far wider than binary ones (held by 82% / 76% / 74% of organisms, vs 40% / 44% / 8% holding the binary ones), since a small efficiency is cheap to gain. Costs are linear in e, so there are no cliffs (tested). Side effects: lower populations (mean −25, lean low −62, each lower in 4/8 seeds) and the same number of extinct seeds (4/8).

### 1b.2 Split diets (`dnaSplitDiets`)

- Two independent efficiencies: `herbivory` e_h (new trait gene 8; founders 1.0; plant yield `foodEnergyYield × e_h`) and `carnivory`, which now means e_c (founders 0.0; carrion yield `carrionBite × e_c` and bite strength as before). No `dietTradeoff`.
- Diet upkeep `dietUpkeep × (e_h + e_c)` per tick (`dietUpkeep` 0.05: a founder pays a fifth of base metabolism).
- Both mutate like carnivory (Gaussian `carnivoryMutationStdDev` with probability `traitMutationRate`, clamped to [0, 1]). A missing herbivory gene decodes to 0; organisms from before the toggle keep the plant yield their carnivory gave them (`1 − dietTradeoff × carnivory`) and pass it on as a gene.
- Gate (`docs/experiments/dna-1b2-split-diets.txt`): **plant eaters met; meat eaters not yet seen.** Founder plant eaters keep stable energy (mean 45.9 vs 41.2; herbivory stays 0.96) and do better than under the trade-off: fewer extinct seeds (2/8 vs 4/8), mean population +80, lean low +51. Kills double (946 vs 458) but carrion eating falls; carnivory only reaches 0.10 on average, with almost no generalists or meat specialists in 3,000 ticks. Whether meat-eating lineages emerge when carrion is abundant needs longer runs (10k+, or the server).

## Stage 2 as built (`dnaVariationEnabled`, off by default pending its gate)

Code: `mutateGenomeVariation`, `mutateOnce`, `genomeStats` in `src/sim/dna.ts`; census `npm run census`. Point-mutation counts are Poisson over the genome (each gene keeps its legacy rate); a point mutation steps the dose or, with `dnaKeyFlipFraction`, flips a bit of the gene's index. Insertion adds a random gene at a random position, deletion removes one, duplication copies 1 to `dnaDuplicationMaxLength` genes elsewhere (`dnaDosageCompensation` halves doses to make it neutral; off). Every gene costs `dnaUpkeepPerGene` per tick; `dnaMaxGenes` caps length. Loading a save no longer re-adds deleted skip genes (`upgradeGenome` takes the saved input count). Gate status: see `docs/STATUS.md`.

## Stage 3 as built (`dnaGrowableBrain`, off by default; needs `dnaEnabled`)

Code: `compileCircuit`, `internalUnits`, `stripAcquiredTopology` in `src/sim/dna.ts`; `Circuit`, `scoreCircuit` in `src/sim/brain.ts`; tests `tests/dna-brain-growable.test.ts`; gate `docs/experiments/dna-stage3-gate.txt`. Genomes only change shape with Stage 2 on, so the switch does nothing useful without `dnaVariationEnabled`.

- **Topology.** Skip connections (input → score) plus one hidden layer of up to M = `dnaMaxInternal` units (clamped to 6–256; default 16). No hidden-to-hidden edges, so the graph is acyclic by construction and no new gene class is needed.
- **Addressing (revised 2026-10-27, user).** Brain genes keep their Stage 1 keys. Units 0–5 are the founders' own; any unit number u ≥ 6 (a hidden gene's `index >> 8`, a bias or out gene's whole index) maps to `6 + (u − 6) mod (M − 6)`, one of the new units (silent if M = 6). A skip index or hidden input ≥ 52, or an output-bias index other than 0, is silent. So every key is valid, canonical keys map to themselves, and a flipped key can land only on a new unit, never on a founder connection (the first gate showed such re-expressed keys acting as weight changes). Appending a brain input turns a silent key with that input index into a live one; accepted.
- **Compile at birth** (and on load) into flat typed arrays (CSR: per unit an offset into input-index and weight arrays; skip indices and weights; unit bias and out weight). Doses sum per slot in genome order like the dense decode.
- **Pruning.** Zero skip weights are dropped; a unit with no (or zero) output weight is dropped with its inputs; a unit with no inputs is a constant `out · tanh(bias)`, folded into the output bias if no live unit precedes it, else kept as a constant entry. Summation order is the dense brain's, so the score equals `brainScore` of the same weights (up to the sign of a zero, which rounding and JSON erase).
- **Evaluation.** `scoreCircuit` walks the arrays and allocates nothing. (The feature vector and the inspector's score breakdown around it still allocate per action, as on the dense path; changing that would break bit-identity with the dense brain.)
- **Growth.** With the switch on, insertion's key pool covers hidden units 0..M−1 (955 slots instead of 415); key flips, duplication and crossover also move genes onto new units. A new unit is evaluated once it has an output gene and at least one input gene. Crossover groups a hidden unit's genes by the mapped unit.
- **Upkeep.** Each live connection into a unit numbered ≥ 6 (in-edges plus the out edge) costs `dnaUpkeepPerConnection` (0.00005) per tick, on top of `dnaUpkeepPerGene` for every gene. Founders (6 units) pay nothing.
- **Acquired topology** (for ablation): `stripAcquiredTopology(dna, config, level)`. `'units'` removes every expressed gene on units ≥ 6, after which the circuit scores exactly as the dense brain; `'all'` also removes silent brain genes (no change in score, only per-gene upkeep); `'effective'` (the gate's default) removes only the genes of acquired units that can change a choice. A unit is choice-invariant if it is constant or reads only `ACTION_INVARIANT_INPUTS` (`bias`, `energy`, `carried`, `crowding`, `register0–2`; the same for every action in a decision, tested): it adds one offset to every option, so it cannot change the choice (except through the 3-decimal rounding of scores at a near-tie). `Circuit.effectiveAcquiredUnits` / `effectiveAcquiredConnections` count the others.
- **Saves.** Nothing new: the circuit is never saved and is recompiled from the genome on load. The dense `brain` is still kept (and is what `brainDrift`/`hiddenStrength` describe).
- **Neutrality.** Switch off: fingerprint unchanged. Switch on with Stage 2 off: founders have no acquired topology, so the world is bit-identical to the switch-off world (tested).
- **Gate (`docs/experiments/dna-stage3-gate.txt`; rerun 2026-10-27 at 15,000 ticks with the revised addressing and the `effective` ablation): met in 1 of 8 seeds, with the sign varying.** Every organism carries acquired units by 15k ticks (4.3 per organism, 70 acquired connections). Growable off died out in 3 seeds, growable on in none; in the 5 seeds alive in both, average population is not higher with it on (median ratio 0.93). Ablating the acquired units that can change a choice hurts seed 6 clearly (in situ births −53 vs sham, 10/10 replicates; arena births 67 vs 29), helps seeds 4 and 8, and does nothing measurable in the rest; pooled in situ measures are null. So acquired topology does real work in some lineages, but it is not adaptive in general. The first gate (5,000 ticks, old addressing: inconclusive, the one effect came from wrapped keys acting on founder weights) is summarised at the end of the gate file.
- **Metrics.** `npm run experiment` reports `topo.acquiredUnits`, `topo.acquiredConnections`, `topo.connections` and `topo.withAcquired%` over living organisms; `npm run perf` has a `brain + growable` row.

## Sexual reproduction (decided 2026-10-26: cross genomes by key)

Mating (`sexEnabled`; see `docs/decisions.md`, Mating) makes a child from two parents. With DNA on, their genomes are crossed by key; code `crossGenomes` and `capGenome` in `src/sim/dna.ts`, used by `World.inheritBody`; tests in `tests/sex.test.ts` ("Mating with DNA").

- **Groups.** Every gene belongs to one inheritance group: its key, except that a hidden brain unit's genes (all its incoming weights, its bias and its output weight: brain classes 2, 3 and 4 with that unit number) form one group, as in the pre-DNA `crossBrains`.
- **Pick.** For each group present in either parent, one parent is picked at random (one seeded PRNG draw per group, in order of first appearance in the carrier's genome, then in the mate's). The child takes all of that parent's genes in the group: every copy of a duplicated key travels together, and if the picked parent lacks the key the child lacks it too. Genome length therefore varies naturally once Stage 2 has made genomes differ.
- **Layout.** The child follows the carrier's gene order (the carrier is the parent the child is born next to). A group picked from the carrier keeps its genes where the carrier has them; a key picked from the mate puts all the mate's copies where the carrier first has that key; keys only the mate has follow at the end in the mate's order. Two Stage 1 genomes share one layout, so the child has that layout with each gene's dose from one parent: with Stage 2 off this is the pre-DNA per-trait mixing (each trait, each direct connection and each register weight from one parent; each hidden unit whole).
- **Then mutation**, exactly the clone path: legacy per-gene mutation (`mutateGenome`), or the Stage 2 operators when `dnaVariationEnabled` (`mutateGenomeVariation`). The result is capped at `dnaMaxGenes` (genes past the cap are dropped from the end; crossing two long genomes can exceed it, mutation alone cannot), and the child is what the genome decodes to.
- **Parents without a genome** (DNA switched on mid-run, or split diets switched on) are encoded on the spot, as for clones.
- **Not in the genome:** the policy dials are mixed per dial (each dial whole from one parent), then mutate as for clones. PRNG order for a child of mating: dial picks, dial mutation, genome group picks, genome mutation.
- **DNA off:** the phenotype recombination (`recombine` in `src/sim/sex.ts`) is kept: each trait whole from one parent, a hidden unit as one gene, then legacy inheritance. Its picks are drawn in genome order, so with Stage 2 off a DNA world and a legacy world stay bit-identical with mating too (tested; fingerprint identical with `dnaEnabled=false`). With Stage 2 on, genomes differ in layout and the two no longer match, as for clones.

Mating rule (2026-10-27; `docs/decisions.md`, Mating rule): a mating can make a clutch of several children (the carrier's clutch gene, trait 46). Each child is a separate crossover: its own dial picks, its own genome group picks, its own mutation and cap, so siblings differ. Life-history genes (traits 40–46) are trait genes like any other, so they cross by key too (tested).

Brain inputs: mating appended five inputs (`isMate`, `mateFullness`, `mateAlike`, `mateFamily`, `mateReady`; 47 → 52). Hidden gene indices are `(unit << 8) | input`, so every older gene keeps its meaning; a genome or save without genes for the new inputs decodes them as no connection, and `upgradeGenome` adds head-start direct-connection genes for inputs past the save's input count (`upgradeBrain` does the same for saved brains).

Note: the config keys are flat (`dnaEnabled` rather than `config.dna.enabled`) so `npm run experiment -- --compare` and `--set` can address them like every other setting.
