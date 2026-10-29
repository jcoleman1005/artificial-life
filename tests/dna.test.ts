import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { World, type WorldState } from '../src/sim/world';
import { createConfig } from '../src/sim/config';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, brainScore } from '../src/sim/brain';
import { MEMORY_WEIGHT_COUNT } from '../src/sim/memory';
import { carrionYield, metabolismCost, moveEnergyCost, plantYield } from '../src/sim/traits';
import { PRNG } from '../src/sim/prng';
import {
  ABSENT_DEFAULTS,
  GENE_WORDS,
  GeneClass,
  TraitId,
  decodeOrganismDNA,
  encodeOrganismDNA,
  geneClassOf,
  geneCount,
  geneDose,
  geneIndexOf,
  geneKey,
  genomeStats,
  mutateGenomeVariation,
  mutateOnce,
  phenotypeOf,
  pointMutationRate,
  type MutationKind,
  upgradeGenome,
  type Phenotype,
} from '../src/sim/dna';
import type { Organism } from '../src/sim/types';

const SMALL = { gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22, maxFoodPatches: 36 };
const config = createConfig();

/** A genome of the given (key, dose) genes. */
function genomeOf(genes: readonly [number, number][]): Uint32Array {
  const view = new DataView(new ArrayBuffer(8));
  const dna = new Uint32Array(genes.length * GENE_WORDS);
  genes.forEach(([key, dose], g) => {
    view.setFloat64(0, dose, true);
    dna.set([key, view.getUint32(0, true), view.getUint32(4, true)], g * GENE_WORDS);
  });
  return dna;
}

/** The genome without the genes `drop` picks. */
function without(dna: Uint32Array, drop: (key: number) => boolean): Uint32Array {
  const kept: [number, number][] = [];
  for (let g = 0; g < geneCount(dna); g++) {
    const key = dna[g * GENE_WORDS];
    if (!drop(key)) kept.push([key, geneDose(dna, g * GENE_WORDS)]);
  }
  return genomeOf(kept);
}

const tagGene = (deg: number): [number, number] => [geneKey(GeneClass.trait, TraitId.tag), deg];

function allNumbers(p: Phenotype): number[] {
  return [
    p.tag, p.carryCapacity, p.dispersal, p.memorySpan, p.carnivory,
    p.abilities.diagonal, p.abilities.squeeze, p.abilities.leap,
    ...p.memoryWeights, ...p.brain.skip, ...p.brain.hidden, ...p.brain.hiddenBias, ...p.brain.out, p.brain.outBias,
  ];
}

let legacySample: Organism[] | null = null;
/** Evolved legacy organisms (DNA off): varied traits, mutated brains. */
function legacyOrganisms(): Organism[] {
  if (!legacySample) {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-legacy', dnaEnabled: false });
    for (let t = 0; t < 200; t++) world.step();
    legacySample = Array.from(world.organisms.values());
  }
  expect(legacySample.length).toBeGreaterThan(10);
  return legacySample;
}

/** JSON with object keys sorted, so key order (which differs between the two birth paths) doesn't count. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Uint32Array)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v
  );
const hash = (state: unknown) => createHash('sha256').update(canonical(state)).digest('hex');

/** A hash of the state with genomes and the DNA switch left out, for comparing DNA-on and DNA-off worlds. */
function withoutDna(state: WorldState): string {
  // The trend history is left out, as World.stateHash does: it only records the past, and its genome statistics exist only with DNA.
  const { history: _history, ...rest } = state;
  return hash({
    ...rest,
    config: { ...state.config, dnaEnabled: null },
    organisms: state.organisms.map(({ genome: _genome, ...o }) => o),
    eggs: (state.eggs ?? []).map(({ child: { genome: _genome, ...child }, ...egg }) => ({ ...egg, child })),
  });
}

describe('DNA (Stage 1: behaviour-neutral)', () => {
  it('decode(encode(organism)) gives back every trait exactly: tag, body, abilities, register and brain weights', () => {
    for (const o of legacyOrganisms()) {
      const decoded = decodeOrganismDNA(encodeOrganismDNA(phenotypeOf(o)), config);
      expect(decoded.tag).toBe(o.tag);
      expect(decoded.carryCapacity).toBe(o.carryCapacity);
      expect(decoded.dispersal).toBe(o.dispersal);
      expect(decoded.memorySpan).toBe(o.memorySpan);
      expect(decoded.carnivory).toBe(o.carnivory);
      expect(decoded.abilities).toEqual(o.abilities);
      expect(decoded.memoryWeights).toEqual(o.memoryWeights);
      expect(decoded.brain).toEqual(o.brain);
    }
  }, 30_000);

  it('an organism decoded from DNA pays exactly the legacy upkeep (abilities, carry, memory)', () => {
    for (const o of legacyOrganisms()) {
      const decoded: Organism = { ...o, ...decodeOrganismDNA(encodeOrganismDNA(phenotypeOf(o)), config) };
      expect(metabolismCost(decoded, config)).toBe(metabolismCost(o, config));
    }
  });

  it('dispersal: distance d is dose d − 1, so dose 0 (or no gene) means adjacent birth', () => {
    const key = geneKey(GeneClass.trait, TraitId.dispersal);
    expect(decodeOrganismDNA(genomeOf([[key, 0]]), config).dispersal).toBe(1);
    expect(decodeOrganismDNA(genomeOf([]), config).dispersal).toBe(1);
    expect(decodeOrganismDNA(genomeOf([[key, 3]]), config).dispersal).toBe(4);
    expect(decodeOrganismDNA(genomeOf([[key, 99]]), config).dispersal).toBe(config.maxDispersal);
    expect(decodeOrganismDNA(genomeOf([[key, -5]]), config).dispersal).toBe(1);
  });

  it('abilities decode as 0 or 1: dose 1 gives the ability, dose 0 the baseline', () => {
    const key = geneKey(GeneClass.trait, TraitId.leap);
    expect(decodeOrganismDNA(genomeOf([[key, 1]]), config).abilities).toEqual({ diagonal: 0, squeeze: 0, leap: 1 });
    expect(decodeOrganismDNA(genomeOf([[key, 0]]), config).abilities).toEqual({ diagonal: 0, squeeze: 0, leap: 0 });
  });

  it('a missing trait gene falls back to its absent default; nothing throws or turns NaN', () => {
    const o = legacyOrganisms()[0];
    const dna = encodeOrganismDNA(phenotypeOf(o));
    const full = decodeOrganismDNA(dna, config);
    const traits: [number, (p: Phenotype) => number, number][] = [
      [TraitId.tag, (p) => p.tag, ABSENT_DEFAULTS.tag],
      [TraitId.carryCapacity, (p) => p.carryCapacity, ABSENT_DEFAULTS.carryCapacity],
      [TraitId.dispersal, (p) => p.dispersal, ABSENT_DEFAULTS.dispersal],
      [TraitId.memorySpan, (p) => p.memorySpan, ABSENT_DEFAULTS.memorySpan],
      [TraitId.carnivory, (p) => p.carnivory, ABSENT_DEFAULTS.carnivory],
      [TraitId.diagonal, (p) => p.abilities.diagonal, 0],
      [TraitId.squeeze, (p) => p.abilities.squeeze, 0],
      [TraitId.leap, (p) => p.abilities.leap, 0],
      ...Array.from({ length: MEMORY_WEIGHT_COUNT }, (_, i): [number, (p: Phenotype) => number, number] => [
        TraitId.memoryWeight0 + i,
        (p) => p.memoryWeights[i],
        0,
      ]),
    ];
    for (const [id, read, absent] of traits) {
      const decoded = decodeOrganismDNA(without(dna, (k) => geneClassOf(k) === GeneClass.trait && geneIndexOf(k) === id), config);
      expect(read(decoded)).toBe(absent);
      expect(allNumbers(decoded).every(Number.isFinite)).toBe(true);
      // Everything else is untouched.
      expect(allNumbers(decoded).filter((v, i) => v !== allNumbers(full)[i]).length).toBeLessThanOrEqual(1);
    }

    // Each brain weight gene, one at a time: that weight becomes 0.
    for (let g = 0; g < geneCount(dna); g++) {
      const key = dna[g * GENE_WORDS];
      if (geneClassOf(key) === GeneClass.trait) continue;
      const decoded = decodeOrganismDNA(without(dna, (k) => k === key), config);
      const { brain } = decoded;
      const index = geneIndexOf(key);
      const weight =
        geneClassOf(key) === GeneClass.brainSkip ? brain.skip[index]
        : geneClassOf(key) === GeneClass.brainHidden ? brain.hidden[(index >>> 8) * BRAIN_INPUT_COUNT + (index & 0xff)]
        : geneClassOf(key) === GeneClass.brainHiddenBias ? brain.hiddenBias[index]
        : geneClassOf(key) === GeneClass.brainOut ? brain.out[index]
        : brain.outBias;
      expect(weight).toBe(0);
      expect(allNumbers(decoded).every(Number.isFinite)).toBe(true);
    }

    // An empty genome, and one with non-finite doses, decode cleanly to the defaults.
    const empty = decodeOrganismDNA(new Uint32Array(0), config);
    const { herbivory: _herbivory, ...defaults } = ABSENT_DEFAULTS; // herbivory exists only with split diets
    expect(empty).toMatchObject({ ...defaults, memoryWeights: new Array(MEMORY_WEIGHT_COUNT).fill(0) });
    expect(empty.brain.skip).toHaveLength(BRAIN_INPUT_COUNT);
    expect(empty.brain.hidden).toHaveLength(BRAIN_HIDDEN * BRAIN_INPUT_COUNT);
    const junk = decodeOrganismDNA(genomeOf([[geneKey(GeneClass.trait, TraitId.carnivory), NaN], tagGene(Infinity), [geneKey(9 as GeneClass, 1), 5]]), config);
    expect(allNumbers(junk).every(Number.isFinite)).toBe(true);
  });

  it('several tag genes decode to their circular mean: 10° and 350° give 0°, exact antipodes give 0° not NaN', () => {
    expect(decodeOrganismDNA(genomeOf([tagGene(10), tagGene(350)]), config).tag).toBe(0);
    expect(decodeOrganismDNA(genomeOf([tagGene(90), tagGene(270)]), config).tag).toBe(0);
    expect(decodeOrganismDNA(genomeOf([tagGene(0), tagGene(180)]), config).tag).toBe(0);
    expect(decodeOrganismDNA(genomeOf([tagGene(200), tagGene(200)]), config).tag).toBe(200);
    expect(decodeOrganismDNA(genomeOf([tagGene(80), tagGene(100)]), config).tag).toBe(90);
    expect(decodeOrganismDNA(genomeOf([tagGene(123.45)]), config).tag).toBe(123.45);
  });

  it('a decoded brain scores 1,000 random input vectors exactly as the legacy brain', () => {
    const prng = new PRNG('dna-scores');
    const organisms = legacyOrganisms();
    for (let k = 0; k < 1000; k++) {
      const o = organisms[k % organisms.length];
      const decoded = decodeOrganismDNA(encodeOrganismDNA(phenotypeOf(o)), config);
      const x = BRAIN_INPUTS.map(() => prng.nextFloat(-1, 1));
      const legacy = brainScore(o.brain, x).score;
      expect(Math.abs(brainScore(decoded.brain, x).score - legacy)).toBeLessThan(1e-5);
    }
  });

  it.each(['brain', 'dials'] as const)('a world with DNA on runs bit-identically to one with it off (%s)', (controller) => {
    const legacy = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-gate', controller, dnaEnabled: false });
    const dna = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-gate', controller, dnaEnabled: true });
    for (let t = 1; t <= 200; t++) {
      legacy.step();
      dna.step();
      if (t % 100 === 0) expect(withoutDna(dna.exportState())).toBe(withoutDna(legacy.exportState()));
    }
    expect(dna.birthsTotal).toBeGreaterThan(20);
    // Every organism is what its own genome decodes to.
    for (const o of dna.organisms.values()) {
      expect(o.genome).toBeInstanceOf(Uint32Array);
      expect(decodeOrganismDNA(o.genome!, dna.config)).toEqual(phenotypeOf(o));
    }
  }, 30_000);

  it('two DNA runs from one seed give identical state hashes', () => {
    const runs = [0, 1].map(() => {
      const w = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-hash', dnaEnabled: true });
      for (let t = 0; t < 150; t++) w.step();
      return hash(w.exportState());
    });
    expect(runs[0]).toBe(runs[1]);
  }, 30_000);

  it('a DNA world saved through JSON continues exactly, genomes included', () => {
    const original = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-snap', dnaEnabled: true });
    for (let t = 0; t < 100; t++) original.step();
    const restored = World.fromState(JSON.parse(JSON.stringify(original.exportState())) as WorldState);
    for (let t = 0; t < 100; t++) {
      original.step();
      restored.step();
    }
    expect(hash(restored.exportState())).toBe(hash(original.exportState()));
    expect(Array.from(restored.organisms.values())[0].genome).toBeInstanceOf(Uint32Array);
  }, 30_000);

  it('switching DNA on mid-run encodes parents at their next birth and changes nothing', () => {
    // The hybrid cost needs genomes, so it is off here: this test isolates DNA's own Stage 1 neutrality.
    const legacy = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-switch', dnaEnabled: false, hybridIncompatibilityEnabled: false });
    for (let t = 0; t < 60; t++) legacy.step();
    const dna = World.fromState({ ...legacy.exportState(), config: { ...legacy.config, dnaEnabled: true } });
    for (let t = 0; t < 140; t++) {
      legacy.step();
      dna.step();
    }
    expect(withoutDna(dna.exportState())).toBe(withoutDna(legacy.exportState()));
  }, 30_000);
});

describe('DNA Stage 1b.1: continuous abilities (dnaContinuousAbilities)', () => {
  const on = createConfig({ dnaContinuousAbilities: true });
  const off = createConfig();
  const at = (e: number) => ({ diagonal: e, squeeze: e, leap: e });
  const step = { leap: false, diagonal: false, squeeze: false };

  it('move costs scale smoothly: diagonal 1.4 − 0.4e, squeeze 3 − e, leap 3.5 − e (× moveCost)', () => {
    for (const [e, diagonal, squeeze, leap] of [[1, 1, 2, 2.5], [0.5, 1.2, 2.5, 3], [0.1, 1.36, 2.9, 3.4]]) {
      expect(moveEnergyCost(at(e), { ...step, diagonal: true }, on)).toBeCloseTo(diagonal * on.moveCost, 12);
      expect(moveEnergyCost(at(e), { ...step, squeeze: true }, on)).toBeCloseTo(squeeze * on.moveCost, 12);
      expect(moveEnergyCost(at(e), { ...step, leap: true }, on)).toBeCloseTo(leap * on.moveCost, 12);
    }
    expect(moveEnergyCost(at(0.3), step, on)).toBe(on.moveCost);
    // No cliffs: a tiny change in efficiency is a tiny change in cost.
    for (let e = 0.01; e < 1; e += 0.01) {
      const jump = Math.abs(moveEnergyCost(at(e), { ...step, leap: true }, on) - moveEnergyCost(at(e - 0.01), { ...step, leap: true }, on));
      expect(jump).toBeLessThan(0.011 * on.moveCost);
    }
  });

  it('binary abilities keep the legacy costs, and the flag does nothing without DNA', () => {
    expect(moveEnergyCost(at(1), { ...step, diagonal: true }, off)).toBe(off.moveCost * off.diagonalMoveCost);
    expect(moveEnergyCost(at(1), { ...step, leap: true }, off)).toBe(off.moveCost * off.leapCostMultiplier);
    const noDna = createConfig({ dnaEnabled: false, dnaContinuousAbilities: true });
    expect(moveEnergyCost(at(1), { ...step, diagonal: true }, noDna)).toBe(off.moveCost * off.diagonalMoveCost);
  });

  it('decodes an ability gene as its efficiency in [0, 1], and upkeep scales with it', () => {
    const key = geneKey(GeneClass.trait, TraitId.squeeze);
    expect(decodeOrganismDNA(genomeOf([[key, 0.37]]), on).abilities.squeeze).toBe(0.37);
    expect(decodeOrganismDNA(genomeOf([[key, 0.37]]), off).abilities.squeeze).toBe(0);
    expect(decodeOrganismDNA(genomeOf([[key, 1.8]]), on).abilities.squeeze).toBe(1);
    const o = legacyOrganisms()[0];
    const base = metabolismCost({ ...o, abilities: at(0) }, on);
    expect(metabolismCost({ ...o, abilities: at(0.5) }, on) - base).toBeCloseTo(3 * 0.5 * on.abilityUpkeep, 12);
  });

  it('a world runs with efficiencies that mutate continuously, every organism decoding from its genome', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-continuous', dnaContinuousAbilities: true });
    for (let t = 0; t < 200; t++) world.step();
    const effs = [...world.organisms.values()].flatMap((o) => [o.abilities.diagonal, o.abilities.squeeze, o.abilities.leap]);
    expect(effs.every((e) => e >= 0 && e <= 1)).toBe(true);
    expect(effs.some((e) => e > 0 && e < 1)).toBe(true);
    for (const o of world.organisms.values()) expect(decodeOrganismDNA(o.genome!, world.config)).toEqual(phenotypeOf(o));
  }, 30_000);

  it('is ignored without DNA: the world is exactly the legacy one', () => {
    const legacy = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-cont-off', dnaEnabled: false });
    const flagged = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-cont-off', dnaEnabled: false, dnaContinuousAbilities: true });
    for (let t = 0; t < 100; t++) {
      legacy.step();
      flagged.step();
    }
    expect(withoutDna({ ...flagged.exportState(), config: legacy.config })).toBe(withoutDna(legacy.exportState()));
  }, 30_000);
});

describe('DNA Stage 1b.2: split diets (dnaSplitDiets)', () => {
  // Meat-digestion gene off here: the test pins the plain diet formulas.
  const on = createConfig({ dnaSplitDiets: true, carnivoreGeneEnabled: false });

  it('plant yield is foodEnergyYield × herbivory, carrion carrionBite × carnivory, upkeep dietUpkeep × (h + c)', () => {
    const o = { ...legacyOrganisms()[0], herbivory: 0.8, carnivory: 0.3 };
    expect(plantYield(o, on)).toBeCloseTo(on.foodEnergyYield * 0.8, 12);
    expect(carrionYield(o, on)).toBeCloseTo(on.carrionBite * 0.3, 12);
    const none = { ...o, herbivory: 0, carnivory: 0 };
    expect(metabolismCost(o, on) - metabolismCost(none, on)).toBeCloseTo(on.dietUpkeep * 1.1, 12);
    // A generalist pays for both; no trade-off formula.
    expect(plantYield({ ...o, carnivory: 1 }, on)).toBe(plantYield(o, on));
  });

  it('founders are full plant eaters with no taste for meat, both written in their genome; a missing herbivory gene means 0', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-split', dnaSplitDiets: true });
    for (const o of world.organisms.values()) {
      expect(o.herbivory).toBe(1);
      expect(o.carnivory).toBe(0);
      expect(decodeOrganismDNA(o.genome!, world.config)).toEqual(phenotypeOf(o));
      const noGene = without(o.genome!, (k) => geneClassOf(k) === GeneClass.trait && geneIndexOf(k) === TraitId.herbivory);
      expect(decodeOrganismDNA(noGene, world.config).herbivory).toBe(0);
    }
  });

  it('both efficiencies evolve independently in a running world', () => {
    // traitMutationRate 0.2 (default 0.1) so both traits mutate within 200 ticks on any PRNG stream:
    // at 0.1 whether a carnivory mutation survives depends on the seed's luck (it did not once mating joined).
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-split', dnaSplitDiets: true, traitMutationRate: 0.2 });
    for (let t = 0; t < 200; t++) world.step();
    const organisms = [...world.organisms.values()];
    expect(organisms.some((o) => o.herbivory !== 1)).toBe(true);
    expect(organisms.some((o) => o.carnivory > 0)).toBe(true);
    for (const o of organisms) {
      expect(o.herbivory).toBeGreaterThanOrEqual(0);
      expect(o.herbivory).toBeLessThanOrEqual(1);
      expect(decodeOrganismDNA(o.genome!, world.config)).toEqual(phenotypeOf(o));
    }
  }, 30_000);

  it('switched on mid-run, older organisms keep the plant yield their carnivory gave them, and pass it on as a gene', () => {
    const legacy = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 'dna-split-switch' });
    for (let t = 0; t < 60; t++) legacy.step();
    const config = { ...legacy.config, dnaSplitDiets: true };
    const old = [...legacy.organisms.values()][0];
    expect(plantYield(old, config)).toBeCloseTo(config.foodEnergyYield * (1 - config.dietTradeoff * old.carnivory), 12);
    // Eggs laid before the switch were made under the old config and hatch as they were, so they are left out.
    const laidBefore = new Set(legacy.eggs.keys());
    const world = World.fromState({ ...legacy.exportState(), config });
    for (let t = 0; t < 60; t++) world.step();
    const born = [...world.organisms.values()].filter((o) => o.lineage.birthTick > 60 && !laidBefore.has(o.id));
    expect(born.length).toBeGreaterThan(0);
    for (const o of born) expect(o.herbivory).toBeGreaterThan(0.5);
  }, 30_000);
});

describe('DNA Stage 2: variation operators (dnaVariationEnabled)', () => {
  const vc = createConfig({ dnaVariationEnabled: true });
  const founder = () => encodeOrganismDNA(phenotypeOf(legacyOrganisms()[0]));
  const kinds: MutationKind[] = ['step', 'keyFlip', 'insert', 'delete', 'duplicate'];

  it('draws Poisson counts: mean and variance both close to the mean', () => {
    const prng = new PRNG(7);
    for (const mean of [0.2, 3, 19, 76]) {
      const draws = Array.from({ length: 4000 }, () => prng.nextPoisson(mean));
      const m = draws.reduce((a, d) => a + d, 0) / draws.length;
      const v = draws.reduce((a, d) => a + (d - m) ** 2, 0) / draws.length;
      expect(Math.abs(m - mean)).toBeLessThan(0.1 * Math.max(1, mean));
      expect(Math.abs(v - mean)).toBeLessThan(0.2 * Math.max(1, mean));
    }
    expect(prng.nextPoisson(0)).toBe(0);
  });

  it('point mutations alone follow each gene’s own rate: the expected count is the sum of the rates', () => {
    const cfg = createConfig({ dnaVariationEnabled: true, dnaInsertionRate: 0, dnaDeletionRate: 0, dnaDuplicationRate: 0, dnaKeyFlipFraction: 0 });
    const parent = founder();
    let expected = 0;
    for (let g = 0; g < geneCount(parent); g++) expected += pointMutationRate(parent[g * GENE_WORDS], cfg);
    const prng = new PRNG(11);
    let changed = 0;
    const births = 400;
    for (let b = 0; b < births; b++) {
      const child = mutateGenomeVariation(parent, cfg, prng);
      expect(geneCount(child)).toBe(geneCount(parent));
      for (let w = 0; w < parent.length; w++) if (child[w] !== parent[w]) { changed++; w += 2 - (w % 3); }
    }
    expect(changed / births).toBeGreaterThan(0.85 * expected * 0.9); // some steps land on the same value after rounding or clamping
    expect(changed / births).toBeLessThan(1.1 * expected);
  });

  it('each operator changes the gene count as named, and never touches the parent', () => {
    const parent = founder();
    const copy = parent.slice();
    const n = geneCount(parent);
    const prng = new PRNG(3);
    for (let i = 0; i < 200; i++) {
      expect(geneCount(mutateOnce(parent, 'insert', vc, prng))).toBe(n + 1);
      expect(geneCount(mutateOnce(parent, 'delete', vc, prng))).toBe(n - 1);
      const dup = geneCount(mutateOnce(parent, 'duplicate', vc, prng)) - n;
      expect(dup).toBeGreaterThanOrEqual(1);
      expect(dup).toBeLessThanOrEqual(vc.dnaDuplicationMaxLength);
      expect(geneCount(mutateOnce(parent, 'step', vc, prng))).toBe(n);
      expect(geneCount(mutateOnce(parent, 'keyFlip', vc, prng))).toBe(n);
    }
    expect(parent).toEqual(copy);
  });

  it('a duplicated segment is an exact copy of genes already there, inserted elsewhere', () => {
    const parent = founder();
    const prng = new PRNG(5);
    for (let i = 0; i < 100; i++) {
      const child = mutateOnce(parent, 'duplicate', vc, prng);
      const words = (dna: Uint32Array) => Array.from({ length: geneCount(dna) }, (_, g) => Array.from(dna.subarray(g * GENE_WORDS, g * GENE_WORDS + GENE_WORDS)).join(','));
      const before = new Map<string, number>();
      for (const w of words(parent)) before.set(w, (before.get(w) ?? 0) + 1);
      const extra = new Map<string, number>();
      for (const w of words(child)) extra.set(w, (extra.get(w) ?? 0) + 1);
      for (const [w, c] of before) extra.set(w, (extra.get(w) ?? 0) - c);
      for (const [w, c] of extra) if (c !== 0) expect(before.has(w)).toBe(true); // every added gene already existed
    }
  });

  it('whatever the operators do, the genome decodes to a valid phenotype (no NaN, traits in range, empty genome included)', () => {
    const prng = new PRNG(13);
    let dna = founder();
    for (let i = 0; i < 3000; i++) {
      dna = mutateOnce(dna, kinds[i % kinds.length], vc, prng);
      if (geneCount(dna) < 5) dna = founder();
      if (i % 25 === 0) {
        const p = decodeOrganismDNA(dna, vc);
        expect(allNumbers(p).every(Number.isFinite)).toBe(true);
        expect(p.carryCapacity).toBeGreaterThanOrEqual(0);
        expect(p.carryCapacity).toBeLessThanOrEqual(vc.maxCarryCapacity);
        expect(p.tag).toBeGreaterThanOrEqual(0);
        expect(p.tag).toBeLessThan(360);
      }
    }
    expect(allNumbers(decodeOrganismDNA(new Uint32Array(0), vc)).every(Number.isFinite)).toBe(true);
  });

  it('insertions and duplications stop at dnaMaxGenes', () => {
    // The cap sits 20 genes above a founder's length (which grows when brain inputs are appended).
    const cap = geneCount(founder()) + 20;
    const cfg = createConfig({ dnaVariationEnabled: true, dnaMaxGenes: cap, dnaInsertionRate: 0.05, dnaDuplicationRate: 0.05, dnaDeletionRate: 0 });
    const prng = new PRNG(17);
    let dna = founder();
    for (let i = 0; i < 100; i++) dna = mutateGenomeVariation(dna, cfg, prng);
    expect(geneCount(dna)).toBeLessThanOrEqual(cap);
    expect(geneCount(dna)).toBeGreaterThan(cap - 10);
  });

  it('dosage compensation makes a duplication phenotype-neutral; without it a duplicated weight doubles', () => {
    const parent = founder();
    const key = geneKey(GeneClass.brainSkip, 0);
    const at = Array.from({ length: geneCount(parent) }, (_, g) => parent[g * GENE_WORDS]).indexOf(key);
    const dosed = (dna: Uint32Array) => decodeOrganismDNA(dna, vc).brain.skip[0];
    const one = { ...vc, dnaDuplicationMaxLength: 1 };
    // duplicate exactly gene `at`: search seeds until the operator picks it
    for (const compensate of [false, true]) {
      const cfg = { ...one, dnaDosageCompensation: compensate };
      let seen = 0;
      for (let s = 0; s < 4000 && seen < 3; s++) {
        const child = mutateOnce(parent, 'duplicate', cfg, new PRNG(s));
        if (geneCount(child) !== geneCount(parent) + 1) continue;
        const copies = Array.from({ length: geneCount(child) }, (_, g) => child[g * GENE_WORDS]).filter((k) => k === key).length;
        if (copies !== 2) continue;
        seen++;
        const w = dosed(parent);
        if (compensate) expect(dosed(child)).toBeCloseTo(w, 12);
        else expect(dosed(child)).toBeCloseTo(2 * w, 12);
      }
      expect(seen).toBeGreaterThan(0);
    }
    expect(at).toBeGreaterThanOrEqual(0);
  });

  it('every gene costs dnaUpkeepPerGene per tick, only when the stage is on', () => {
    const o = { ...legacyOrganisms()[0], genome: founder() } as Organism;
    const off = createConfig({ dnaVariationEnabled: false });
    const on = createConfig({ dnaVariationEnabled: true, dnaUpkeepPerGene: 0.001 });
    expect(metabolismCost(o, off)).toBe(metabolismCost({ ...o, genome: undefined }, off));
    expect(metabolismCost(o, on) - metabolismCost({ ...o, genome: undefined }, on)).toBeCloseTo(0.001 * geneCount(o.genome!), 12);
  });

  it('genomeStats counts lengths, types and diverged copies', () => {
    const cfg = createConfig({ dnaVariationEnabled: true });
    const k = geneKey(GeneClass.brainSkip, 3);
    const stats = genomeStats(
      [genomeOf([[k, 1], [k, 1], [geneKey(GeneClass.trait, 9), 5]]), genomeOf([[k, 1], [k, 1.3]])],
      cfg
    );
    expect(stats.meanLength).toBe(2.5);
    expect(stats.meanByType.brainSkip).toBe(2);
    expect(stats.meanByType.silent).toBe(0.5);
    expect(stats.multiCopySlots).toBe(1);
    expect(stats.identicalShare).toBe(0.5);
    expect(stats.meanSpread).toBeCloseTo(0.3 / cfg.brainMutationStdDev, 9);
  });

  it('a variation world is deterministic, genome lengths vary, and a saved one continues exactly', () => {
    const cfg = { ...SMALL, seed: 'dna-stage2', dnaVariationEnabled: true, dnaInsertionRate: 0.01, dnaDeletionRate: 0.01, dnaDuplicationRate: 0.01 };
    const run = () => {
      const w = new World(cfg);
      for (let t = 0; t < 250; t++) w.step();
      return w;
    };
    const a = run();
    const b = run();
    expect(hash(a.exportState())).toBe(hash(b.exportState()));
    const lengths = new Set(Array.from(a.organisms.values(), (o) => geneCount(o.genome!)));
    expect(lengths.size).toBeGreaterThan(1);
    const restored = World.fromState(JSON.parse(JSON.stringify(a.exportState())) as WorldState);
    for (let t = 0; t < 60; t++) { a.step(); restored.step(); }
    expect(hash(restored.exportState())).toBe(hash(a.exportState()));
  }, 60_000);

  it('with the structural rates at 0 and no key flips, genomes keep their length (the stage-off world is the Stage 1 one, tested above)', () => {
    const off = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 's2-off', dnaVariationEnabled: false });
    const flat = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  ...SMALL, seed: 's2-off', dnaVariationEnabled: true, dnaInsertionRate: 0, dnaDeletionRate: 0, dnaDuplicationRate: 0, dnaKeyFlipFraction: 0, dnaUpkeepPerGene: 0 });
    for (let t = 0; t < 150; t++) { off.step(); flat.step(); }
    const founderLength = geneCount(encodeOrganismDNA(phenotypeOf(Array.from(flat.organisms.values())[0])));
    for (const o of flat.organisms.values()) expect(geneCount(o.genome!)).toBe(founderLength);
  }, 60_000);

  it('loading a save does not bring back a skip gene that was deleted', () => {
    const parent = founder();
    const key = geneKey(GeneClass.brainSkip, 5);
    const trimmed = without(parent, (k) => k === key);
    const loaded = upgradeGenome(trimmed, BRAIN_INPUT_COUNT);
    expect(geneCount(loaded)).toBe(geneCount(trimmed));
    expect(geneCount(upgradeGenome(trimmed, BRAIN_INPUT_COUNT - 1))).toBe(geneCount(trimmed) + 1);
  });
});
