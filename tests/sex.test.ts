import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, crossBrains, type Brain, type BrainInput } from '../src/sim/brain';
import { isParentOf } from '../src/sim/family';
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

  it('mixes body traits and tags from both parents (without mutation)', () => {
    const seen = { tag: new Set<number>(), carnivory: new Set<number>(), dispersal: new Set<number>() };
    for (let seed = 0; seed < 12; seed++) {
      const world = quietWorld({ seed, reproductionThreshold: 40, ...NO_MUTATION });
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
