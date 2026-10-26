import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createHeadStartBrain } from '../src/sim/brain';
import { metabolismCost } from '../src/sim/traits';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

const ALL_OFF: Partial<SimulationConfig> = {
  thresholdGeneEnabled: false,
  investmentGeneEnabled: false,
  fatEnabled: false,
  torporEnabled: false,
  eggsEnabled: false,
  metabolismGeneEnabled: false,
};

const ZERO_POLICY: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0,
  eatDrive: 0, reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0,
  careForChildren: 0, forageDrive: 0, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0,
  signalOnFood: 0, signalWhenHungry: 0, followSignal: 0, restDrive: 0, avoidOccupied: 0, leapEagerness: 0,
};

/** An empty, free-of-upkeep world on the dials controller, so one weight decides what an organism does. */
function emptyWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    ...ALL_OFF,
    seed: 3,
    gridWidth: 12,
    gridHeight: 12,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    seasonLength: 0,
    windfallsEnabled: false,
    plantsEnabled: false,
    foodRegionCount: 0,
    foodRegenInterval: 9999,
    foodSpawnInterval: 9999,
    controller: 'dials',
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    memoryEnabled: false,
    abilityUpkeep: 0,
    reproductionThreshold: 1000,
    ...overrides,
  });
}

function addOrganism(world: World, id: string, x: number, y: number, o: Partial<Organism> & { policy?: Partial<PolicyWeights> } = {}): Organism {
  const { policy, ...rest } = o;
  const organism: Organism = {
    id, x, y, energy: 50,
    policy: { ...ZERO_POLICY, ...policy },
    tag: 0, carryCapacity: 0, dispersal: 1, memorySpan: 0, carnivory: 0, kills: 0, memoryWeights: [],
    memory: { food: null, signal: null, home: { x, y }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: createHeadStartBrain(new PRNG(0)),
    lineage: { id: `l-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 0, offspringCount: 0, foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1,
    recentHistory: [],
    ...rest,
  };
  world.organisms.set(id, organism);
  return organism;
}

const lifeFields = (o: Organism) => [o.reproThreshold, o.investment, o.fatCapacity, o.torporDepth, o.eggRate, o.metabolicRate];

describe('life-history genes: switches and inheritance', () => {
  it('founders carry only the genes that are switched on, at their starting values', () => {
    const off = new World({ ...ALL_OFF, seed: 5 });
    for (const o of off.organisms.values()) expect(lifeFields(o).every((v) => v === undefined)).toBe(true);
    const on = new World({ seed: 5 });
    for (const o of on.organisms.values()) {
      expect(lifeFields(o)).toEqual([65, 0.45, 4, 0.1, 0.1, 1]);
    }
    const one = new World({ ...ALL_OFF, fatEnabled: true, seed: 5 });
    for (const o of one.organisms.values()) expect(lifeFields(o)).toEqual([undefined, undefined, 4, undefined, undefined, undefined]);
  });

  it('a genome-decoded world and a directly-inherited world stay identical', () => {
    const run = (dnaEnabled: boolean) => {
      const w = new World({ seed: 11, dnaEnabled, traitMutationRate: 0.5, eggFounder: 0.3 });
      for (let t = 0; t < 250; t++) w.step();
      return JSON.stringify([
        Array.from(w.organisms.values()).map((o) => [o.id, o.x, o.y, o.energy, o.fat, ...lifeFields(o)]),
        Array.from(w.eggs.values()).map((e) => [e.child.id, e.x, e.y]),
      ]);
    };
    expect(run(true)).toBe(run(false));
  });

  it('keeps every evolved value inside its bounds', () => {
    const w = new World({ seed: 12, traitMutationRate: 1, thresholdStep: 40, investmentStep: 0.5, fatStep: 50, torporStep: 1, eggStep: 1, metabolismStep: 2 });
    for (let t = 0; t < 300; t++) w.step();
    expect(w.birthsTotal).toBeGreaterThan(w.config.initialOrganisms);
    const c = w.config;
    for (const o of w.organisms.values()) {
      expect(o.reproThreshold!).toBeGreaterThanOrEqual(c.thresholdMin);
      expect(o.reproThreshold!).toBeLessThanOrEqual(c.thresholdMax);
      expect(o.investment!).toBeGreaterThanOrEqual(c.investmentMin);
      expect(o.investment!).toBeLessThanOrEqual(c.investmentMax);
      expect(o.fatCapacity!).toBeGreaterThanOrEqual(0);
      expect(o.fatCapacity!).toBeLessThanOrEqual(c.maxFat);
      expect(o.fat ?? 0).toBeLessThanOrEqual(o.fatCapacity! + 1e-9);
      for (const v of [o.torporDepth!, o.eggRate!]) expect(v >= 0 && v <= 1).toBe(true);
      expect(o.metabolicRate!).toBeGreaterThanOrEqual(c.metabolismMin);
      expect(o.metabolicRate!).toBeLessThanOrEqual(c.metabolismMax);
    }
  });

  it('a saved world with eggs continues exactly', () => {
    const w = new World({ seed: 13, eggFounder: 0.6 });
    for (let t = 0; t < 200; t++) w.step();
    expect(w.eggsLaidTotal).toBeGreaterThan(0);
    const copy = World.fromState(JSON.parse(JSON.stringify(w.exportState())));
    for (let t = 0; t < 60; t++) {
      w.step();
      copy.step();
    }
    expect(JSON.stringify(copy.exportState())).toBe(JSON.stringify(w.exportState()));
  });
});

describe('reproduction threshold and investment', () => {
  const setup = (energy: number, genes: Partial<Organism>, cfg: Partial<SimulationConfig> = {}) => {
    const w = emptyWorld({ thresholdGeneEnabled: true, investmentGeneEnabled: true, reproductionMetabolismTax: 5, ...cfg });
    const parent = addOrganism(w, 'p', 5, 5, { energy, policy: { reproduceDrive: 2 }, ...genes });
    return { w, parent };
  };

  it('an organism reproduces only from its own threshold', () => {
    const low = setup(60, { reproThreshold: 50, investment: 0.5 });
    low.w.step();
    expect(low.w.organisms.size).toBe(2);
    const high = setup(60, { reproThreshold: 80, investment: 0.5 });
    high.w.step();
    expect(high.w.organisms.size).toBe(1);
  });

  it('a child starts with the parent’s investment share of its energy, and the parent pays it plus the tax', () => {
    for (const investment of [0.2, 0.6]) {
      const { w, parent } = setup(100, { reproThreshold: 50, investment });
      w.step();
      const child = Array.from(w.organisms.values()).find((o) => o.id !== 'p')!;
      expect(child.energy).toBe(Math.floor(100 * investment));
      expect(parent.energy).toBeCloseTo(100 - child.energy - 5);
    }
  });
});

describe('metabolic rate', () => {
  it('scales base upkeep, and sets the pause before the next birth', () => {
    const cfg = { ...emptyWorld().config, tickMetabolismCost: 0.25, metabolismGeneEnabled: true };
    const o = (metabolicRate: number) => ({ carryCapacity: 0, metabolicRate, abilities: { diagonal: 0, squeeze: 0, leap: 0 } }) as Organism;
    expect(metabolismCost(o(0.5), cfg)).toBeCloseTo(0.125);
    expect(metabolismCost(o(1.5), cfg)).toBeCloseTo(0.375);

    for (const [rate, pause] of [[0.5, 24], [1, 12], [1.5, 8]] as const) {
      const w = emptyWorld({ metabolismGeneEnabled: true, reproductionThreshold: 50, birthCooldown: 12 });
      const parent = addOrganism(w, 'p', 5, 5, { energy: 100, metabolicRate: rate, policy: { reproduceDrive: 2 } });
      w.step();
      expect(parent.nextBirthTick).toBe(0 + pause);
      expect(w.organisms.size).toBe(2);
      // No second birth until the pause is over.
      for (let t = 1; t < pause; t++) {
        parent.energy = 100;
        w.step();
      }
      expect(w.organisms.size).toBe(2);
      parent.energy = 100;
      w.step();
      expect(w.organisms.size).toBe(3);
    }
  });
});

describe('fat reserve', () => {
  const fatWorld = () => emptyWorld({ fatEnabled: true, fatUpkeep: 0, fatStoreEfficiency: 0.75, fatReleaseLevel: 0.4, fatReleaseRate: 3 });

  it('stores surplus food at a loss, up to its capacity', () => {
    const w = fatWorld();
    w.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 5 });
    const o = addOrganism(w, 'a', 5, 5, { energy: 98, fatCapacity: 20, fat: 0, policy: { eatDrive: 2 } });
    w.step();
    expect(o.energy).toBe(100);
    expect(o.fat).toBeCloseTo((25 - 2) * 0.75); // 17.25
    w.step(); // a second meal fills the rest of the reserve, never beyond it
    expect(o.fat).toBeCloseTo(20);
    expect(o.energy).toBe(100);
  });

  it('draws on fat when energy is low, at a limited rate, and keeps an organism alive on it', () => {
    const w = fatWorld();
    const o = addOrganism(w, 'a', 5, 5, { energy: 10, fatCapacity: 20, fat: 10, policy: { restDrive: 2 } });
    w.step();
    expect(o.energy).toBeCloseTo(13);
    expect(o.fat).toBeCloseTo(7);
    // Even when spending drops energy to zero, fat drawn in the same tick saves it.
    const w2 = emptyWorld({ fatEnabled: true, fatUpkeep: 0, tickMetabolismCost: 2 });
    const p = addOrganism(w2, 'b', 5, 5, { energy: 1, fatCapacity: 20, fat: 10, policy: { restDrive: 2 } });
    w2.step();
    expect(w2.organisms.has('b')).toBe(true);
    expect(p.fat).toBeLessThan(10);
  });

  it('costs upkeep per unit of capacity, empty or full', () => {
    const cfg = { ...emptyWorld().config, tickMetabolismCost: 0.25, fatEnabled: true, fatUpkeep: 0.01 };
    const o = { carryCapacity: 0, fatCapacity: 30, fat: 0, abilities: { diagonal: 0, squeeze: 0, leap: 0 } } as Organism;
    expect(metabolismCost(o, cfg)).toBeCloseTo(0.55);
  });
});

describe('torpor', () => {
  const torporWorld = (cfg: Partial<SimulationConfig> = {}) =>
    emptyWorld({ torporEnabled: true, tickMetabolismCost: 1, torporSaving: 0.9, torporWakeCost: 4, torporEntryTicks: 3, torporTimer: 10, ...cfg });

  it('sets in after enough rest, and then upkeep falls with depth and the organism makes no choices', () => {
    const w = torporWorld();
    const o = addOrganism(w, 'a', 5, 5, { energy: 80, torporDepth: 1, policy: { restDrive: 2 } });
    for (let t = 0; t < 3; t++) w.step();
    expect(o.torpor).toBe(10);
    expect(o.energy).toBeCloseTo(77); // three ordinary ticks at 1
    w.step();
    expect(o.torpor).toBe(9);
    expect(o.energy).toBeCloseTo(77 - 0.1);
    expect(o.recentHistory[0].chosenAction.type).toBe('REST');
    expect(o.recentHistory[0].scores).toEqual([]);
  });

  it('shallower torpor saves less', () => {
    const w = torporWorld();
    const o = addOrganism(w, 'a', 5, 5, { energy: 80, torporDepth: 0.5, torpor: 5 });
    w.step();
    expect(o.energy).toBeCloseTo(80 - 0.55);
  });

  it('wakes, paying a cost, when food is near; deeper sleepers only notice food closer', () => {
    const wakes = (depth: number, foodAt: [number, number]) => {
      const w = torporWorld();
      w.foodPatches.set(`${foodAt[0]},${foodAt[1]}`, { x: foodAt[0], y: foodAt[1], stock: 3, capacity: 3 });
      const o = addOrganism(w, 'a', 5, 5, { energy: 80, torporDepth: depth, torpor: 8 });
      w.step();
      return { woke: (o.torpor ?? 0) === 0, energy: o.energy };
    };
    const shallow = wakes(0.34, [7, 5]); // radius floor(3 × 0.66) = 1... food 2 away, still asleep
    expect(shallow.woke).toBe(false);
    const light = wakes(0, [7, 5]); // radius 3: wakes
    expect(light.woke).toBe(true);
    const deepUnderfoot = wakes(1, [5, 5]);
    expect(deepUnderfoot.woke).toBe(true);
    expect(deepUnderfoot.energy).toBeLessThan(80 - 1 * 0.1 - 3.9); // paid 4 to wake
    expect(wakes(1, [6, 5]).woke).toBe(false);
  });

  it('wakes when its timer runs out', () => {
    const w = torporWorld();
    const o = addOrganism(w, 'a', 5, 5, { energy: 80, torporDepth: 1, torpor: 2 });
    w.step();
    expect(o.torpor).toBe(1);
    w.step();
    expect(o.torpor).toBe(0);
  });
});

describe('eggs', () => {
  const eggWorld = (cfg: Partial<SimulationConfig> = {}) =>
    emptyWorld({ eggsEnabled: true, reproductionThreshold: 50, eggExtraCost: 3, reproductionMetabolismTax: 5, eggDecayChance: 0, eggHatchRadius: 2, eggHatchEfficiency: 0.8, ...cfg });
  const layer = (w: World) => addOrganism(w, 'p', 5, 5, { energy: 100, eggRate: 1, policy: { reproduceDrive: 2 } });

  it('a laid egg is not an organism; the parent pays the child, the tax and the laying cost', () => {
    const w = eggWorld();
    const parent = layer(w);
    w.step();
    expect(w.organisms.size).toBe(1);
    expect(w.eggs.size).toBe(1);
    expect(w.eggsLaidTotal).toBe(1);
    const egg = Array.from(w.eggs.values())[0];
    expect(egg.child.energy).toBe(45);
    expect(parent.energy).toBeCloseTo(100 - 45 - 5 - 3);
    expect(w.birthsTotal).toBe(0);
  });

  it('waits inert with no food near, then hatches with a share of its energy when food is within reach', () => {
    const w = eggWorld();
    layer(w);
    w.step();
    w.organisms.clear(); // only the egg is left
    const egg = Array.from(w.eggs.values())[0];
    for (let t = 0; t < 20; t++) w.step();
    expect(w.eggs.size).toBe(1);
    expect(egg.child.energy).toBe(45);
    w.foodPatches.set(`${egg.x + 3},${egg.y}`, { x: egg.x + 3, y: egg.y, stock: 2, capacity: 2 });
    w.step();
    expect(w.eggs.size).toBe(1); // food 3 away is out of reach
    w.foodPatches.set(`${egg.x + 2},${egg.y}`, { x: egg.x + 2, y: egg.y, stock: 2, capacity: 2 });
    w.step();
    expect(w.eggs.size).toBe(0);
    expect(w.eggsHatchedTotal).toBe(1);
    expect(w.birthsTotal).toBe(1);
    const hatchling = w.organisms.get(egg.child.id)!;
    expect([hatchling.x, hatchling.y]).toEqual([egg.x, egg.y]);
    expect(hatchling.energy).toBe(Math.floor(45 * 0.8));
  });

  it('can decay, and can hatch into an empty world: a lineage survives its parents', () => {
    const w = eggWorld({ eggDecayChance: 1 });
    layer(w);
    w.step();
    w.step();
    expect(w.eggs.size).toBe(0);
    expect(w.eggsDecayedTotal).toBe(1);

    const w2 = eggWorld();
    layer(w2);
    w2.step();
    w2.organisms.clear(); // the crash
    for (let t = 0; t < 5; t++) w2.step();
    expect(w2.eggs.size).toBe(1);
    const egg = Array.from(w2.eggs.values())[0];
    w2.foodPatches.set(`${egg.x},${egg.y + 1}`, { x: egg.x, y: egg.y + 1, stock: 2, capacity: 2 });
    w2.step();
    expect(w2.organisms.size).toBe(1);
  });
});
