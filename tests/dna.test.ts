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
  phenotypeOf,
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
    const world = new World({ ...SMALL, seed: 'dna-legacy', dnaEnabled: false });
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
  return hash({
    ...state,
    config: { ...state.config, dnaEnabled: null },
    organisms: state.organisms.map(({ genome: _genome, ...o }) => o),
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
    const legacy = new World({ ...SMALL, seed: 'dna-gate', controller, dnaEnabled: false });
    const dna = new World({ ...SMALL, seed: 'dna-gate', controller, dnaEnabled: true });
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
      const w = new World({ ...SMALL, seed: 'dna-hash', dnaEnabled: true });
      for (let t = 0; t < 150; t++) w.step();
      return hash(w.exportState());
    });
    expect(runs[0]).toBe(runs[1]);
  }, 30_000);

  it('a DNA world saved through JSON continues exactly, genomes included', () => {
    const original = new World({ ...SMALL, seed: 'dna-snap', dnaEnabled: true });
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
    const legacy = new World({ ...SMALL, seed: 'dna-switch', dnaEnabled: false });
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
    const world = new World({ ...SMALL, seed: 'dna-continuous', dnaContinuousAbilities: true });
    for (let t = 0; t < 200; t++) world.step();
    const effs = [...world.organisms.values()].flatMap((o) => [o.abilities.diagonal, o.abilities.squeeze, o.abilities.leap]);
    expect(effs.every((e) => e >= 0 && e <= 1)).toBe(true);
    expect(effs.some((e) => e > 0 && e < 1)).toBe(true);
    for (const o of world.organisms.values()) expect(decodeOrganismDNA(o.genome!, world.config)).toEqual(phenotypeOf(o));
  }, 30_000);

  it('is ignored without DNA: the world is exactly the legacy one', () => {
    const legacy = new World({ ...SMALL, seed: 'dna-cont-off', dnaEnabled: false });
    const flagged = new World({ ...SMALL, seed: 'dna-cont-off', dnaEnabled: false, dnaContinuousAbilities: true });
    for (let t = 0; t < 100; t++) {
      legacy.step();
      flagged.step();
    }
    expect(withoutDna({ ...flagged.exportState(), config: legacy.config })).toBe(withoutDna(legacy.exportState()));
  }, 30_000);
});

describe('DNA Stage 1b.2: split diets (dnaSplitDiets)', () => {
  const on = createConfig({ dnaSplitDiets: true });

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
    const world = new World({ ...SMALL, seed: 'dna-split', dnaSplitDiets: true });
    for (const o of world.organisms.values()) {
      expect(o.herbivory).toBe(1);
      expect(o.carnivory).toBe(0);
      expect(decodeOrganismDNA(o.genome!, world.config)).toEqual(phenotypeOf(o));
      const noGene = without(o.genome!, (k) => geneClassOf(k) === GeneClass.trait && geneIndexOf(k) === TraitId.herbivory);
      expect(decodeOrganismDNA(noGene, world.config).herbivory).toBe(0);
    }
  });

  it('both efficiencies evolve independently in a running world', () => {
    const world = new World({ ...SMALL, seed: 'dna-split', dnaSplitDiets: true });
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
    const legacy = new World({ ...SMALL, seed: 'dna-split-switch' });
    for (let t = 0; t < 60; t++) legacy.step();
    const config = { ...legacy.config, dnaSplitDiets: true };
    const old = [...legacy.organisms.values()][0];
    expect(plantYield(old, config)).toBeCloseTo(config.foodEnergyYield * (1 - config.dietTradeoff * old.carnivory), 12);
    const world = World.fromState({ ...legacy.exportState(), config });
    for (let t = 0; t < 60; t++) world.step();
    const born = [...world.organisms.values()].filter((o) => o.lineage.birthTick > 60);
    expect(born.length).toBeGreaterThan(0);
    for (const o of born) expect(o.herbivory).toBeGreaterThan(0.5);
  }, 30_000);
});
