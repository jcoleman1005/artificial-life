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
| brain weights (skip 47, hidden 6 × 47, hidden bias 6, out 6, out bias 1) | brain gene classes 1–5 | 0 (no connection) | Σ dose |

Traits 8–9 are reserved. Traits 40–45 are the life-history genes (reproduction threshold, investment, fat capacity, torpor depth, egg rate, metabolic rate; `docs/decisions.md`, `src/sim/lifehistory.ts`): present in a genome only while their switch is on, decoded to their starting value if a switch is on and the gene is missing, and clamped to their bounds. Not in the genome: the policy dials (still inherited directly; open question whether to add them), and what an organism remembers (`food`, `signal`, `home`, register values): that is lifetime working memory, and a newborn starts with `newMemory(birthX, birthY)`.

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
