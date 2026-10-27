import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, crossBrains, type Brain, type BrainInput } from '../src/sim/brain';
import { isParentOf } from '../src/sim/family';
import { createConfig } from '../src/sim/config';
import { LIFE_GENES } from '../src/sim/lifehistory';
import {
  GENE_WORDS,
  mutateGenome,
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

  it('makes one child when both ask, each parent paying its own share plus the tax', () => {
    const world = quietWorld({ reproductionThreshold: 40, reproductionEnergyFraction: 0.5, reproductionMetabolismTax: 5 });
    const a = makeOrganism('a', 5, 5, { energy: 60, brain: ASKER, lineage: { id: 'lin-a', parentId: null, generation: 3, birthTick: 0 } });
    const b = makeOrganism('b', 6, 5, { energy: 80, brain: ASKER, tag: 180 });
    addAll(world, a, b);
    world.step();
    const children = Array.from(world.organisms.values()).filter((o) => o.id !== 'a' && o.id !== 'b');
    expect(children).toHaveLength(1);
    const child = children[0];
    // (Rule of 2026-10-27.) No investment gene on these organisms, so the world's 0.5 applies:
    // a pays floor(60 × 0.5) + 5 = 35, b pays floor(80 × 0.5) + 5 = 45; one child (clutch 1) gets 30 + 40.
    expect(a.energy).toBe(25);
    expect(b.energy).toBe(35);
    expect(child.energy).toBe(70);
    expect(a.offspringCount).toBe(1);
    expect(b.offspringCount).toBe(1);
    expect(a.recentHistory[0].outcome).toBe('success');
    expect(a.recentHistory[0].energyDelta).toBe(-35);
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

describe('Mating rule (2026-10-27): own threshold, own cost, the carrier\'s clutch, a viability gate', () => {
  const children = (w: World) => Array.from(w.organisms.values()).filter((o) => o.id !== 'a' && o.id !== 'b');
  const pair = (w: World, a: Partial<Organism>, b: Partial<Organism>) => {
    const pa = makeOrganism('a', 5, 5, { energy: 60, brain: ASKER, ...a });
    const pb = makeOrganism('b', 6, 5, { energy: 60, brain: ASKER, tag: 180, ...b });
    addAll(w, pa, pb);
    return [pa, pb] as const;
  };

  it('needs both parents at their own reproduction threshold, or nothing happens', () => {
    for (const [ta, tb] of [[70, 40], [40, 70], [70, 70]]) {
      const world = quietWorld({ reproductionThreshold: 40 });
      const [a, b] = pair(world, { reproThreshold: ta }, { reproThreshold: tb });
      world.step();
      expect(children(world)).toHaveLength(0);
      expect(world.matingsTotal).toBe(0);
      // A parent at its threshold asks and is not answered: it pays nothing. (One that isn't ready does something else.)
      for (const [o, t] of [[a, ta], [b, tb]] as const) {
        if (t <= 60) {
          expect(o.recentHistory[0].outcome).toBe('no_partner');
          expect(o.energy).toBe(60);
        }
      }
      // Below its own threshold an organism is not offered MATE, and its partner is told it isn't ready.
      for (const [o, t, p] of [[a, ta, b], [b, tb, a]] as const) {
        const offers = o.recentHistory[0].scores.filter((s) => s.action.type.startsWith('MATE_'));
        if (t > 60) expect(offers).toHaveLength(0);
        else expect(offers.every((s) => s.action.mateReady === p.energy >= (p.reproThreshold ?? 40))).toBe(true);
      }
    }
  });

  it('charges each parent its own energy × its own investment, plus the tax', () => {
    const world = quietWorld({ reproductionThreshold: 40, reproductionMetabolismTax: 5 });
    const [a, b] = pair(world, { energy: 60, investment: 0.2 }, { energy: 80, investment: 0.6 });
    world.step();
    const kids = children(world);
    expect(kids).toHaveLength(1);
    expect(a.energy).toBe(60 - 12 - 5);
    expect(b.energy).toBe(80 - 48 - 5);
    expect(kids[0].energy).toBe(60);
  });

  it('takes the clutch size from the carrier and splits the pair\'s shares equally', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 16; seed++) {
      const world = quietWorld({ seed, reproductionThreshold: 40, reproductionEnergyFraction: 0.5 });
      pair(world, { energy: 80, clutchSize: 3 }, { energy: 80, clutchSize: 1 });
      world.step();
      const kids = children(world);
      const carrier = kids[0].lineage.parentId;
      expect(kids.every((k) => k.lineage.parentId === carrier)).toBe(true);
      expect(kids).toHaveLength(carrier === 'a' ? 3 : 1);
      for (const k of kids) expect(k.energy).toBeCloseTo(80 / kids.length, 12);
      seen.add(carrier!);
    }
    expect(seen.size).toBe(2);
  });

  it('continuous clutch size partitions into floor(f) plus probabilistic marginal child', () => {
    const counts = new Set<number>();
    for (let seed = 0; seed < 24; seed++) {
      const world = quietWorld({ seed, reproductionThreshold: 40, reproductionEnergyFraction: 0.5 });
      pair(world, { energy: 80, clutchSize: 1.4 }, { energy: 80, clutchSize: 1.4 });
      world.step();
      counts.add(children(world).length);
    }
    expect(counts).toEqual(new Set([1, 2])); // 1.4 yields 1 or 2 children
  });

  it('allocates viable children sequentially and dissipates sub-viable remainder without catastrophic cliff', () => {
    const world = quietWorld({ reproductionThreshold: 40, reproductionMetabolismTax: 5, minViableChildEnergy: 10 });
    const [a, b] = pair(world, { energy: 50, investment: 0.2, clutchSize: 6 }, { energy: 50, investment: 0.2, clutchSize: 6 });
    world.step();
    expect(children(world)).toHaveLength(2); // pool 20 / minViable 10 = 2 viable children
    expect([a.energy, b.energy]).toEqual([35, 35]);
    expect(world.matingsTotal).toBe(1);
    expect(world.clutchesFailedTotal).toBe(0);
    expect(world.matingChildrenLostTotal).toBe(4);
    expect(world.matingEnergyLostTotal).toBe(0);
    expect(world.birthsTotal).toBe(2);
    expect(a.recentHistory[0].outcome).toBe('success');
  });

  it('fails a clutch only when pool cannot afford a single viable child', () => {
    const world = quietWorld({ reproductionThreshold: 40, reproductionMetabolismTax: 5, minViableChildEnergy: 10 });
    const [a, b] = pair(world, { energy: 40, investment: 0.1, clutchSize: 2 }, { energy: 40, investment: 0.1, clutchSize: 2 });
    world.step();
    expect(children(world)).toHaveLength(0); // pool 8 < 10
    expect(world.clutchesFailedTotal).toBe(1);
    expect(world.matingChildrenLostTotal).toBe(2);
    expect(world.matingEnergyLostTotal).toBe(8);
    expect(world.birthsTotal).toBe(0);
    expect(a.recentHistory[0].outcome).toBe('clutch_failed');
  });

  it('conserves energy across a clutch, counting children that find no room as lost', () => {
    // Walls on three sides of both parents leave one free cell each, so a clutch of 4 places 1 or 2.
    const world = quietWorld({ reproductionThreshold: 40, reproductionMetabolismTax: 5, minViableChildEnergy: 1 });
    for (const [x, y] of [[5, 4], [5, 6], [6, 4], [6, 6], [7, 5]]) world.obstacles.add(`${x},${y}`);
    const [a, b] = pair(world, { energy: 90, investment: 0.5, clutchSize: 4 }, { energy: 70, investment: 0.5, clutchSize: 4 });
    world.step();
    const kids = children(world);
    expect(kids.length).toBeGreaterThan(0);
    expect(kids.length).toBeLessThan(4);
    const pool = 45 + 35;
    expect(world.matingChildrenTotal).toBe(kids.length);
    expect(world.matingChildrenLostTotal).toBe(4 - kids.length);
    const before = 90 + 70;
    const after = a.energy + b.energy + kids.reduce((s, k) => s + k.energy, 0) + world.matingEnergyLostTotal + 2 * 5;
    expect(after).toBeCloseTo(before, 9);
    expect(world.matingEnergyLostTotal).toBeCloseTo(pool * (1 - kids.length / 4), 9);
  });

  it('gives each child of a clutch its own crossover', () => {
    const world = quietWorld({ reproductionThreshold: 40, minViableChildEnergy: 1, ...NO_MUTATION });
    const brain = (v: number): Brain => ({ ...brainWith({ isMate: 100 }), hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(v) });
    pair(
      world,
      { energy: 90, clutchSize: 4, brain: brain(0.5), memoryWeights: new Array<number>(30).fill(0.5) },
      { energy: 90, clutchSize: 4, brain: brain(-0.5), memoryWeights: new Array<number>(30).fill(-0.5) }
    );
    world.step();
    const kids = children(world);
    expect(kids.length).toBeGreaterThan(1);
    const genomes = new Set(kids.map((k) => Array.from(k.genome!).join(',')));
    expect(genomes.size).toBe(kids.length); // with ~70 independent picks each, no two crossovers coincide
    for (const k of kids) expect(decodeOrganismDNA(k.genome!, world.config)).toEqual(phenotypeOf(k));
  });

  it('carries every life-history gene, the clutch gene included, through the crossover by key', () => {
    const life = LIFE_GENES.map((g) => geneKey(GeneClass.trait, g.traitId));
    expect(LIFE_GENES.find((g) => g.field === 'clutchSize')?.traitId).toBe(46);
    const a = genes(life.map((k, i): [number, number] => [k, i + 1]));
    const b = genes(life.map((k, i): [number, number] => [k, -(i + 1)]));
    const prng = new PRNG(4);
    const signs = new Set<string>();
    for (let n = 0; n < 32; n++) {
      const child = crossGenomes(a, b, prng);
      life.forEach((k, i) => expect([[i + 1], [-(i + 1)]]).toContainEqual(ofKey(child, k)));
      signs.add(life.map((k) => Math.sign(ofKey(child, k)[0])).join(''));
    }
    expect(signs.size).toBeGreaterThan(8); // genes picked independently
  });

  it('with clutchGeneEnabled false: no clutch field, no clutch gene, and no extra PRNG draws', () => {
    const off = new World({ seed: 5, clutchGeneEnabled: false, initialOrganisms: 5 });
    const on = new World({ seed: 5, initialOrganisms: 5 });
    const clutchKey = geneKey(GeneClass.trait, 46);
    for (const o of off.organisms.values()) {
      expect(o.clutchSize).toBeUndefined();
      expect(ofKey(o.genome!, clutchKey)).toHaveLength(0);
    }
    for (const o of on.organisms.values()) {
      expect(o.clutchSize).toBe(1);
      expect(ofKey(o.genome!, clutchKey)).toEqual([1]);
    }
    // Founders draw nothing for it: both worlds' founders differ only by that field.
    const strip = (w: World) => Array.from(w.organisms.values()).map(({ clutchSize: _c, genome: _g, ...o }) => o);
    expect(strip(off)).toEqual(strip(on));
    // A birth mutates gene by gene: the off genome is the on genome without the clutch gene, so it draws one gene fewer.
    const onGenome = [...on.organisms.values()][0].genome!;
    const offGenome = genes(pairs(onGenome).filter(([k]) => k !== clutchKey));
    const p1 = new PRNG(9);
    const p2 = new PRNG(9);
    const config = createConfig({ clutchGeneEnabled: false });
    mutateGenome(offGenome, config, p1);
    mutateGenome(genes(pairs(onGenome).filter(([k]) => k !== clutchKey)), config, p2);
    expect(p1.getState()).toBe(p2.getState());
    expect(decodeOrganismDNA(offGenome, config)).not.toHaveProperty('clutchSize');
  });
});
