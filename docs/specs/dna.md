# DNA: genome-encoded organisms

Stage 1 (built 2026-10-26): a behaviour-neutral genome. Stage 1b toggles are proposals, built only after the Stage 1 gate is signed off, each with its own gate.

## Stage 1 as built (`dnaEnabled`, off by default until the gate is signed off)

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

Traits 8–9 are reserved. Not in the genome: the policy dials (still inherited directly; open question whether to add them), and what an organism remembers (`food`, `signal`, `home`, register values): that is lifetime working memory, and a newborn starts with `newMemory(birthX, birthY)`.

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

## Stage 2 as built (`dnaVariationEnabled`, off by default pending its gate)

Code: `mutateGenomeVariation`, `mutateOnce`, `genomeStats` in `src/sim/dna.ts`; census `npm run census`. Point-mutation counts are Poisson over the genome (each gene keeps its legacy rate); a point mutation steps the dose or, with `dnaKeyFlipFraction`, flips a bit of the gene's index. Insertion adds a random gene at a random position, deletion removes one, duplication copies 1 to `dnaDuplicationMaxLength` genes elsewhere (`dnaDosageCompensation` halves doses to make it neutral; off). Every gene costs `dnaUpkeepPerGene` per tick; `dnaMaxGenes` caps length. Loading a save no longer re-adds deleted skip genes (`upgradeGenome` takes the saved input count). Gate status: see `docs/STATUS.md`.

## Sexual reproduction (decided 2026-10-26: cross genomes by key)

Mating (`sexEnabled`; see `docs/decisions.md`, Mating) makes a child from two parents. With DNA on, their genomes are crossed by key; code `crossGenomes` and `capGenome` in `src/sim/dna.ts`, used by `World.inheritBody`; tests in `tests/sex.test.ts` ("Mating with DNA").

- **Groups.** Every gene belongs to one inheritance group: its key, except that a hidden brain unit's genes (all its incoming weights, its bias and its output weight: brain classes 2, 3 and 4 with that unit number) form one group, as in the pre-DNA `crossBrains`.
- **Pick.** For each group present in either parent, one parent is picked at random (one seeded PRNG draw per group, in order of first appearance in the carrier's genome, then in the mate's). The child takes all of that parent's genes in the group: every copy of a duplicated key travels together, and if the picked parent lacks the key the child lacks it too. Genome length therefore varies naturally once Stage 2 has made genomes differ.
- **Layout.** The child follows the carrier's gene order (the carrier is the parent the child is born next to). A group picked from the carrier keeps its genes where the carrier has them; a key picked from the mate puts all the mate's copies where the carrier first has that key; keys only the mate has follow at the end in the mate's order. Two Stage 1 genomes share one layout, so the child has that layout with each gene's dose from one parent: with Stage 2 off this is the pre-DNA per-trait mixing (each trait, each direct connection and each register weight from one parent; each hidden unit whole).
- **Then mutation**, exactly the clone path: legacy per-gene mutation (`mutateGenome`), or the Stage 2 operators when `dnaVariationEnabled` (`mutateGenomeVariation`). The result is capped at `dnaMaxGenes` (genes past the cap are dropped from the end; crossing two long genomes can exceed it, mutation alone cannot), and the child is what the genome decodes to.
- **Parents without a genome** (DNA switched on mid-run, or split diets switched on) are encoded on the spot, as for clones.
- **Not in the genome:** the policy dials are mixed per dial (each dial whole from one parent), then mutate as for clones. PRNG order for a child of mating: dial picks, dial mutation, genome group picks, genome mutation.
- **DNA off:** the phenotype recombination (`recombine` in `src/sim/sex.ts`) is kept: each trait whole from one parent, a hidden unit as one gene, then legacy inheritance. Its picks are drawn in genome order, so with Stage 2 off a DNA world and a legacy world stay bit-identical with mating too (tested; fingerprint identical with `dnaEnabled=false`). With Stage 2 on, genomes differ in layout and the two no longer match, as for clones.

Brain inputs: mating appended five inputs (`isMate`, `mateFullness`, `mateAlike`, `mateFamily`, `mateReady`; 47 → 52). Hidden gene indices are `(unit << 8) | input`, so every older gene keeps its meaning; a genome or save without genes for the new inputs decodes them as no connection, and `upgradeGenome` adds head-start direct-connection genes for inputs past the save's input count (`upgradeBrain` does the same for saved brains).

## Stage 1b proposals (each its own toggle and gate, after sign-off)

### 1b.1 Continuous movement abilities (`dnaContinuousAbilities`)

- Each ability becomes an efficiency e ∈ [0, 1]; unlocked when e > 0.
- Upkeep `abilityUpkeep × e`.
- Costs: diagonal `moveCost × (1.4 − 0.4e)`, squeeze `moveCost × (3.0 − 1.0e)`, leap `moveCost × (3.5 − 1.0e)`.
- Gate: 8 seeds × 10k ticks; efficiencies drift under selection rather than collapsing to 0 or locking at 1, with no step-cliff transitions.

### 1b.2 Split diets (`dnaSplitDiets`)

- `carnivory` is replaced by two independent traits: `herbivoreEfficiency` e_h (founders 1.0; plant yield `foodEnergyYield × e_h`) and `carnivoreEfficiency` e_c (founders 0.0; carrion yield `carrionBite × e_c`, kill chance scales with e_c).
- Diet upkeep `upkeepRate × (e_h + e_c)`, so generalists pay more and specialists and scavengers can emerge without a fixed trade-off formula.
- Gate: founder plant eaters keep stable energy, and meat-eating lineages can emerge when carrion is abundant.

Note: the config keys are flat (`dnaEnabled` rather than `config.dna.enabled`) so `npm run experiment -- --compare` and `--set` can address them like every other setting.
