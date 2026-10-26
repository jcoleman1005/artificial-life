import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, crossBrains, type Brain, type BrainInput } from '../src/sim/brain';
import { isParentOf } from '../src/sim/family';
import { createConfig } from '../src/sim/config';
import {
  GENE_WORDS,
  GeneClass,
  TraitId,
  capGenome,
  crossGenomes,
  decodeOrganismDNA,
  encodeOrganismDNA,
  geneCount,
  geneDose,
  geneKey,
  phenotypeOf,
} from '../src/sim/dna';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

const NEUTRAL: PolicyWeights = {
  foodAttraction: 0,
  obstacleAvoidance: 0,
  crowdingAvoidance: 0,
  exploreTendency: 0,
  eatDrive: 0,
  reproduceDrive: 0,
  kinAffinity: 0,
  shareWithKin: 0,
  shareWithStrangers: 0,
  careForChildren: 0,
  forageDrive: 0,
  eatPriority: 0,
  hungerUrgency: 0,
  followFoodParent: 0,
  signalOnFood: 0,
  signalWhenHungry: 0,
  followSignal: 0,
  restDrive: 0,
  avoidOccupied: 0,
  leapEagerness: 0,
};

/** A brain that only does what its listed direct connections say (no hidden layer). */
function brainWith(weights: Partial<Record<BrainInput, number>>): Brain {
  return {
    skip: BRAIN_INPUTS.map((name) => weights[name] ?? 0),
    hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(0),
    hiddenBias: new Array<number>(BRAIN_HIDDEN).fill(0),
    out: new Array<number>(BRAIN_HIDDEN).fill(0),
    outBias: 0,
  };
}

const RESTER = brainWith({ isRest: 100 });

function makeOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 50,
    policy: { ...NEUTRAL },
    tag: 0,
    carryCapacity: 0,
    dispersal: 1,
    memorySpan: 0,
    carnivory: 0,
    kills: 0,
    memoryWeights: [],
    memory: { food: null, signal: null, home: { x, y }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: RESTER,
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 100,
    offspringCount: 0,
    foodEatenCount: 0,
    carriedFood: 0,
    foodGiven: 0,
    foodReceived: 0,
    signalTick: -1,
    recentHistory: [],
    ...overrides,
  };
}

/**
 * An empty world where nothing costs energy unless a test says so: metabolism,
 * memory, windfalls and signals are off to isolate one mechanism. The defaults
 * are unchanged (tests/defaults.test.ts).
 */
function quietWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 'sex',
    gridWidth: 12,
    gridHeight: 12,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    immigrationInterval: 0,
    seasonLength: 0,
    foodRegionCount: 0,
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    abilityUpkeep: 0,
    memoryEnabled: false,
    windfallsEnabled: false,
    signalsEnabled: false,
    reproductionThreshold: 1000,
    foodRegenInterval: 9999,
    foodSpawnInterval: 9999,
    controller: 'brain',
    ...overrides,
  });
}

function addAll(world: World, ...orgs: Organism[]) {
  for (const o of orgs) world.organisms.set(o.id, o);
}

const offered = (o: Organism) => o.recentHistory[0].scores.map((s) => s.action.type);

const ASKER = brainWith({ isMate: 100 });
const NO_MUTATION: Partial<SimulationConfig> = {
  mutationRate: 0,
  brainMutationRate: 0,
  tagMutationRate: 0,
  traitMutationRate: 0,
  abilityMutationRate: 0,
};

describe('Mating', () => {
  it('is offered toward adjacent organisms, to brains with enough energy to reproduce', () => {
    const world = quietWorld({ reproductionThreshold: 40 });
    const a = makeOrganism('a', 5, 5, { energy: 50 });
    const b = makeOrganism('b', 6, 5, { energy: 30 });
    addAll(world, a, b);
    world.step();
    expect(offered(a)).toContain('MATE_EAST');
    expect(offered(a).filter((t) => t.startsWith('MATE_'))).toHaveLength(1);
    expect(offered(b).some((t) => t.startsWith('MATE_'))).toBe(false); // below the threshold
    const ask = a.recentHistory[0].scores.find((s) => s.action.type === 'MATE_EAST')!.action;
    expect(ask.mateId).toBe('b');
    expect(ask.mateReady).toBe(false);
  });

  it('is never offered to the dials, or with sex switched off', () => {
    for (const overrides of [{ controller: 'dials' as const }, { sexEnabled: false }]) {
      const world = quietWorld({ reproductionThreshold: 40, ...overrides });
      const a = makeOrganism('a', 5, 5, { energy: 50 });
      const b = makeOrganism('b', 6, 5, { energy: 50 });
      addAll(world, a, b);
      world.step();
      expect(offered(a).some((t) => t.startsWith('MATE_'))).toBe(false);
    }
  });

  it('makes nothing and costs nothing when the partner does not ask back', () => {
    const world = quietWorld({ reproductionThreshold: 40 });
    const a = makeOrganism('a', 5, 5, { energy: 60, brain: ASKER });
    const b = makeOrganism('b', 6, 5, { energy: 60 }); // rests
    addAll(world, a, b);
    world.step();
    expect(world.organisms.size).toBe(2);
    expect(a.energy).toBe(60);
    expect(a.recentHistory[0].outcome).toBe('no_partner');
    expect(world.matingsTotal).toBe(0);
  });

  it('makes one child when both ask, each parent paying half a share plus the tax', () => {
    const world = quietWorld({ reproductionThreshold: 40, reproductionEnergyFraction: 0.5, reproductionMetabolismTax: 5 });
    const a = makeOrganism('a', 5, 5, { energy: 60, brain: ASKER, lineage: { id: 'lin-a', parentId: null, generation: 3, birthTick: 0 } });
    const b = makeOrganism('b', 6, 5, { energy: 80, brain: ASKER, tag: 180 });
    addAll(world, a, b);
    world.step();
    const children = Array.from(world.organisms.values()).filter((o) => o.id !== 'a' && o.id !== 'b');
    expect(children).toHaveLength(1);
    const child = children[0];
    // a pays floor(60 × 0.25) + 5 = 20, b pays floor(80 × 0.25) + 5 = 25; the child gets 15 + 20.
    expect(a.energy).toBe(40);
    expect(b.energy).toBe(55);
    expect(child.energy).toBe(35);
    expect(a.offspringCount).toBe(1);
    expect(b.offspringCount).toBe(1);
    expect(a.recentHistory[0].outcome).toBe('success');
    expect(a.recentHistory[0].energyDelta).toBe(-20);
    expect(world.birthsTotal).toBe(1);
    expect(world.matingsTotal).toBe(1);
    expect(world.matingsOfStrangersTotal).toBe(1); // opposite hues
    expect(world.matingsAlikeTotal).toBe(0);
    // Born next to one parent, in its lineage, with the other as second parent.
    const carrier = child.lineage.parentId === 'a' ? a : b;
    const other = carrier === a ? b : a;
    expect(child.lineage.mateId).toBe(other.id);
    expect(child.lineage.id).toBe(carrier.lineage.id);
    expect(child.lineage.generation).toBe(4);
    expect(Math.abs(child.x - carrier.x) + Math.abs(child.y - carrier.y)).toBe(1);
    expect(isParentOf(a, child) && isParentOf(b, child)).toBe(true);
  });

  it('fails without charging when a parent cannot afford its share', () => {
    const world = quietWorld({ reproductionThreshold: 5, reproductionEnergyFraction: 0.45, reproductionMetabolismTax: 5 });
    const a = makeOrganism('a', 5, 5, { energy: 6, brain: ASKER });
    const b = makeOrganism('b', 6, 5, { energy: 60, brain: ASKER });
    addAll(world, a, b);
    world.step();
    expect(world.organisms.size).toBe(2);
    expect(a.energy).toBe(6);
    expect(b.energy).toBe(60);
    expect(b.recentHistory[0].outcome).toBe('energy_too_low');
  });

  it('gives the child each gene whole from one parent or the other', () => {
    const prng = new PRNG(9);
    const brainA = brainWith({ isMate: 100 });
    const brainB: Brain = {
      skip: BRAIN_INPUTS.map(() => -1),
      hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(-2),
      hiddenBias: new Array<number>(BRAIN_HIDDEN).fill(-3),
      out: new Array<number>(BRAIN_HIDDEN).fill(-4),
      outBias: -5,
    };
    for (let i = 0; i < 20; i++) {
      const child = crossBrains(brainA, brainB, prng);
      child.skip.forEach((w, j) => expect([brainA.skip[j], brainB.skip[j]]).toContain(w));
      for (let h = 0; h < BRAIN_HIDDEN; h++) {
        const row = child.hidden.slice(h * BRAIN_INPUT_COUNT, (h + 1) * BRAIN_INPUT_COUNT);
        const fromB = child.hiddenBias[h] === -3;
        // A hidden unit moves as one: its inputs, bias and output all from the same parent.
        expect(row.every((w) => w === (fromB ? -2 : 0))).toBe(true);
        expect(child.out[h]).toBe(fromB ? -4 : 0);
      }
    }
  });

  it.each([true, false])('mixes body traits and tags from both parents (without mutation; dnaEnabled %s)', (dnaEnabled) => {
    const seen = { tag: new Set<number>(), carnivory: new Set<number>(), dispersal: new Set<number>() };
    for (let seed = 0; seed < 12; seed++) {
      const world = quietWorld({ seed, reproductionThreshold: 40, dnaEnabled, ...NO_MUTATION });
      const a = makeOrganism('a', 5, 5, { energy: 80, brain: ASKER, tag: 10, carnivory: 0.1, dispersal: 1 });
      const b = makeOrganism('b', 6, 5, { energy: 80, brain: ASKER, tag: 200, carnivory: 0.9, dispersal: 2 });
      addAll(world, a, b);
      world.step();
      const child = Array.from(world.organisms.values()).find((o) => o.id !== 'a' && o.id !== 'b')!;
      expect([10, 200]).toContain(child.tag);
      expect([0.1, 0.9]).toContain(child.carnivory);
      expect([1, 2]).toContain(child.dispersal);
      seen.tag.add(child.tag);
      seen.carnivory.add(child.carnivory);
      seen.dispersal.add(child.dispersal);
    }
    expect(seen.tag.size).toBe(2);
    expect(seen.carnivory.size).toBe(2);
    expect(seen.dispersal.size).toBe(2);
  });

  it('lets a child pass through its second parent too', () => {
    const world = quietWorld({ reproductionThreshold: 40 });
    const a = makeOrganism('a', 5, 5, { energy: 80, brain: ASKER });
    const b = makeOrganism('b', 6, 5, { energy: 80, brain: ASKER });
    addAll(world, a, b);
    world.step();
    const child = Array.from(world.organisms.values()).find((o) => o.id !== 'a' && o.id !== 'b')!;
    const other = child.lineage.parentId === 'a' ? b : a;
    // Put the second parent next to the child and look at the child's move into it.
    for (const o of [a, b]) o.brain = brainWith({ isRest: 100 });
    child.brain = brainWith({ isRest: 100 });
    world.organisms.delete(child.lineage.parentId!);
    child.x = other.x - 1;
    child.y = other.y;
    world.step();
    const move = child.recentHistory[0].scores.find((s) => s.action.type === 'MOVE_EAST')!.action;
    expect(move.swapRelation).toBe('parent');
  });
});

/** A genome of the given (key, dose) genes, in order. */
function genes(list: readonly [number, number][]): Uint32Array {
  const view = new DataView(new ArrayBuffer(8));
  const dna = new Uint32Array(list.length * GENE_WORDS);
  list.forEach(([key, dose], g) => {
    view.setFloat64(0, dose, true);
    dna.set([key, view.getUint32(0, true), view.getUint32(4, true)], g * GENE_WORDS);
  });
  return dna;
}

/** The genes of a genome as [key, dose] pairs. */
function pairs(dna: Uint32Array): [number, number][] {
  return Array.from({ length: geneCount(dna) }, (_, g): [number, number] => [dna[g * GENE_WORDS], geneDose(dna, g * GENE_WORDS)]);
}
const ofKey = (dna: Uint32Array, key: number) => pairs(dna).filter(([k]) => k === key).map(([, d]) => d);

// These run with DNA on (the default) and Stage 2 off (the default), so a
// child's genome is the crossed genome plus the clone's per-gene mutation.
describe('Mating with DNA: genomes crossed by key (docs/specs/dna.md, Sexual reproduction)', () => {
  const tag = geneKey(GeneClass.trait, TraitId.tag);
  const carry = geneKey(GeneClass.trait, TraitId.carryCapacity);
  const onlyA = geneKey(GeneClass.trait, TraitId.memorySpan);
  const onlyB = geneKey(GeneClass.trait, TraitId.carnivory);

  it('takes each key from one parent: present in the child exactly when the picked parent has it', () => {
    const a = genes([[tag, 10], [carry, 1], [onlyA, 3]]);
    const b = genes([[tag, 200], [carry, 2], [onlyB, 0.5]]);
    const seen = new Set<string>();
    const prng = new PRNG(1);
    for (let i = 0; i < 64; i++) {
      const child = crossGenomes(a, b, prng);
      const t = ofKey(child, tag);
      const c = ofKey(child, carry);
      expect([[10], [200]]).toContainEqual(t);
      expect([[1], [2]]).toContainEqual(c);
      expect([[], [3]]).toContainEqual(ofKey(child, onlyA));
      expect([[], [0.5]]).toContainEqual(ofKey(child, onlyB));
      seen.add(`${t[0]}|${c[0]}|${ofKey(child, onlyA).length}|${ofKey(child, onlyB).length}`);
    }
    expect(seen.size).toBe(16); // every combination of the four independent picks turns up
  });

  it('moves every copy of a duplicated key together', () => {
    const a = genes([[tag, 10], [carry, 1], [tag, 20], [carry, 0.25], [tag, 30]]);
    const b = genes([[carry, 2], [tag, 200]]);
    const prng = new PRNG(2);
    const outcomes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const child = crossGenomes(a, b, prng);
      const t = ofKey(child, tag);
      const c = ofKey(child, carry);
      expect([[10, 20, 30], [200]]).toContainEqual(t);
      expect([[1, 0.25], [2]]).toContainEqual(c);
      outcomes.add(`${t.length}${c.length}`);
    }
    expect(outcomes.size).toBe(4);
  });

  it('moves a hidden brain unit (incoming weights, bias, output weight) as one gene', () => {
    const brain = (v: number): Brain => ({
      skip: BRAIN_INPUTS.map(() => v),
      hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(v),
      hiddenBias: new Array<number>(BRAIN_HIDDEN).fill(v),
      out: new Array<number>(BRAIN_HIDDEN).fill(v),
      outBias: v,
    });
    const org = (v: number) => phenotypeOf(makeOrganism(`o${v}`, 0, 0, { brain: brain(v), memoryWeights: new Array<number>(30).fill(0) }));
    // Parent a lacks unit 0's output weight: if unit 0 comes from a, the child lacks it too (decodes to 0).
    const outKey = geneKey(GeneClass.brainOut, 0);
    const a = genes(pairs(encodeOrganismDNA(org(1))).filter(([k]) => k !== outKey));
    const b = encodeOrganismDNA(org(-1));
    const config = createConfig();
    const prng = new PRNG(3);
    const unit0FromA = new Set<boolean>();
    for (let i = 0; i < 20; i++) {
      const child = decodeOrganismDNA(crossGenomes(a, b, prng), config).brain;
      for (let h = 0; h < BRAIN_HIDDEN; h++) {
        const v = child.hiddenBias[h];
        expect([1, -1]).toContain(v);
        expect(child.hidden.slice(h * BRAIN_INPUT_COUNT, (h + 1) * BRAIN_INPUT_COUNT).every((w) => w === v)).toBe(true);
        expect(child.out[h]).toBe(h === 0 && v === 1 ? 0 : v);
        if (h === 0) unit0FromA.add(v === 1);
      }
      // Direct connections still cross one by one.
      expect(new Set(child.skip).size).toBe(2);
    }
    expect(unit0FromA.size).toBe(2);
  });

  it('caps the child at dnaMaxGenes, after mutation', () => {
    expect(geneCount(capGenome(genes([[tag, 1], [carry, 1], [tag, 2]]), 2))).toBe(2);
    // 60 silent genes (an unknown gene class) per parent, different keys in each.
    const silent = (from: number) => Array.from({ length: 60 }, (_, i): [number, number] => [((7 << 16) | (from + i)) >>> 0, 0]);
    const parent = (id: string, x: number, from: number): Organism => {
      const o = makeOrganism(id, x, 5, { energy: 80, brain: ASKER, memoryWeights: new Array<number>(30).fill(0) });
      return { ...o, genome: genes([...pairs(encodeOrganismDNA(phenotypeOf(o))), ...silent(from)]) };
    };
    const own = geneCount(encodeOrganismDNA(phenotypeOf(parent('p', 0, 0))));
    const cap = own + 5; // the crossed genome carries ~60 of the 120 silent genes
    const world = quietWorld({ reproductionThreshold: 40, dnaMaxGenes: cap });
    addAll(world, parent('a', 5, 0), parent('b', 6, 1000));
    world.step();
    const child = Array.from(world.organisms.values()).find((o) => o.id !== 'a' && o.id !== 'b')!;
    expect(geneCount(child.genome!)).toBe(cap);
    expect(decodeOrganismDNA(child.genome!, world.config)).toEqual(phenotypeOf(child));
  });

  it('is seeded: the same world mates to the same child genome; the child is what its genome decodes to', () => {
    const run = () => {
      const world = quietWorld({ reproductionThreshold: 40 });
      addAll(
        world,
        makeOrganism('a', 5, 5, { energy: 80, brain: ASKER, tag: 10, carnivory: 0.1, dispersal: 2, memoryWeights: new Array<number>(30).fill(0.5) }),
        makeOrganism('b', 6, 5, {
          energy: 80,
          brain: ASKER,
          tag: 200,
          carnivory: 0.9,
          abilities: { diagonal: 1, squeeze: 1, leap: 0 },
          memoryWeights: new Array<number>(30).fill(-0.5),
        })
      );
      world.step();
      return { world, child: Array.from(world.organisms.values()).find((o) => o.id !== 'a' && o.id !== 'b')! };
    };
    const first = run();
    const second = run();
    expect(first.child.genome).toBeDefined();
    expect(Array.from(second.child.genome!)).toEqual(Array.from(first.child.genome!));
    expect(decodeOrganismDNA(first.child.genome!, first.world.config)).toEqual(phenotypeOf(first.child));
    const x = first.child.genome!;
    expect(Array.from(crossGenomes(x, second.child.genome!, new PRNG(5)))).toEqual(Array.from(crossGenomes(x, second.child.genome!, new PRNG(5))));
  });

  it('with Stage 2 off, gives the same child as mating with DNA off (same picks, same PRNG draws)', () => {
    const child = (dnaEnabled: boolean, seed: number) => {
      const world = quietWorld({ seed, reproductionThreshold: 40, dnaEnabled, brainMutationRate: 0.5, traitMutationRate: 0.5, abilityMutationRate: 0.5 });
      const brain = (v: number): Brain => ({ ...brainWith({ isMate: 100 }), hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(v), out: new Array<number>(BRAIN_HIDDEN).fill(v) });
      addAll(
        world,
        makeOrganism('a', 5, 5, { energy: 80, brain: brain(0.01), tag: 10, carryCapacity: 1, dispersal: 2, memoryWeights: new Array<number>(30).fill(0.5) }),
        makeOrganism('b', 6, 5, { energy: 80, brain: brain(-0.01), tag: 200, carnivory: 0.9, memorySpan: 4, abilities: { diagonal: 1, squeeze: 0, leap: 1 }, memoryWeights: new Array<number>(30).fill(-0.5) })
      );
      world.step();
      const c = Array.from(world.organisms.values()).find((o) => o.id !== 'a' && o.id !== 'b')!;
      return { phenotype: phenotypeOf(c), policy: c.policy, rng: world.prng.getState() };
    };
    for (let seed = 0; seed < 6; seed++) expect(child(true, seed)).toEqual(child(false, seed));
  });
});
