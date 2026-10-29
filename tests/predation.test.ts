import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_INPUT_COUNT,
  HEAD_START_SKIP,
  brainScore,
  createHeadStartBrain,
  upgradeBrain,
  type Brain,
  type BrainInput,
} from '../src/sim/brain';
import { carrionFromBody, carrionYield, inheritCarnivory, killChance, plantYield } from '../src/sim/traits';
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
    // Isolate mechanisms from the 2026-10-29 DNA defaults: legacy ability costs, diets and mutation.
    dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
    seed: 'predation',
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

describe('Diet', () => {
  it('trades plant energy for carrion energy', () => {
    // Meat-digestion gene off: isolates the diet trade-off itself (carnivoreEfficiency is tested in tier1_genes). Split diets off (2026-10-29 default): they replace this single-axis trade-off.
    const config = { ...DEFAULT_CONFIG, foodEnergyYield: 25, carrionBite: 30, dietTradeoff: 0.6, carnivoreGeneEnabled: false, dnaSplitDiets: false };
    expect(plantYield({ carnivory: 0 }, config)).toBe(25);
    expect(carrionYield({ carnivory: 0 }, config)).toBe(0);
    expect(plantYield({ carnivory: 1 }, config)).toBeCloseTo(10);
    expect(carrionYield({ carnivory: 1 }, config)).toBe(30);
    // With carrion off, diet costs nothing and carrion gives nothing.
    expect(plantYield({ carnivory: 1 }, { ...config, carrionEnabled: false })).toBe(25);
    expect(carrionYield({ carnivory: 1 }, { ...config, carrionEnabled: false })).toBe(0);
  });

  it('is inherited, occasionally shifting, always within 0..1', () => {
    const prng = new PRNG(4);
    const never = { ...DEFAULT_CONFIG, traitMutationRate: 0 };
    const always = { ...DEFAULT_CONFIG, traitMutationRate: 1, carnivoryMutationStdDev: 0.5 };
    expect(inheritCarnivory(0.3, never, prng)).toBe(0.3);
    const shifted = Array.from({ length: 200 }, () => inheritCarnivory(0.3, always, prng));
    expect(shifted.some((c) => c !== 0.3)).toBe(true);
    for (const c of shifted) expect(c >= 0 && c <= 1).toBe(true);
  });

  it('bites harder with more energy and more meat in the diet', () => {
    const config = { ...DEFAULT_CONFIG, bitePowerMin: 0.2 };
    expect(killChance({ energy: 50, carnivory: 1 }, { energy: 50 }, config)).toBeCloseTo(0.5);
    expect(killChance({ energy: 50, carnivory: 0 }, { energy: 50 }, config)).toBeCloseTo(0.1);
    expect(killChance({ energy: 90, carnivory: 1 }, { energy: 10 }, config)).toBeCloseTo(0.9);
  });
});

describe('Carrion', () => {
  it('is left by a starved body and rots away after carrionLifetime ticks', () => {
    const world = quietWorld({ tickMetabolismCost: 1, carrionLifetime: 5, carrionBodyEnergy: 10 });
    addAll(world, makeOrganism('a', 4, 4, { energy: 0.5 }));
    world.step();
    expect(world.organisms.size).toBe(0);
    expect(world.carrion.get('4,4')).toMatchObject({ stock: 10 });
    for (let i = 0; i < 4; i++) world.step();
    expect(world.carrion.has('4,4')).toBe(true);
    world.step();
    expect(world.carrion.has('4,4')).toBe(false);
    expect(world.carrionUnitsRotted).toBe(10);
  });

  // The two digestion genes are off in these carrion tests to isolate the base meal (they are tested in tier1_genes).
  it('feeds a meat eater its carnivory share of a carrionBite meal; a plant eater cannot eat it', () => {
    const world = quietWorld({ carrionBite: 30, carnivoreGeneEnabled: false, digestiveGeneEnabled: false });
    world.carrion.set('3,3', { x: 3, y: 3, stock: 50, expiresAt: 1000 });
    world.carrion.set('8,8', { x: 8, y: 8, stock: 50, expiresAt: 1000 });
    const eater = brainWith({ isEatCarrion: 100, isRest: 1 });
    const wolf = makeOrganism('wolf', 3, 3, { energy: 40, carnivory: 0.5, brain: eater });
    const sheep = makeOrganism('sheep', 8, 8, { energy: 40, carnivory: 0, brain: eater });
    addAll(world, wolf, sheep);
    world.step();
    expect(wolf.energy).toBe(55); // half of 30
    expect(world.carrion.get('3,3')!.stock).toBe(20);
    world.step(); // the last 20 go in one meal
    expect(wolf.energy).toBe(65);
    expect(world.carrion.has('3,3')).toBe(false);
    expect(world.carrionEatenTotal).toBe(2);
    expect(offered(sheep)).not.toContain('EAT_CARRION');
    expect(sheep.energy).toBe(40);
  });

  it('a meat eater can eat an egg: the child\'s energy × diet share is gained, the egg and its shell are gone', () => {
    const world = quietWorld({ carrionBite: 30, carnivoreGeneEnabled: false, digestiveGeneEnabled: false });
    const child = makeOrganism('kid', 3, 3, { energy: 30 });
    world.eggs.set('kid', { x: 3, y: 3, laidTick: 0, shell: 5, child });
    const wolf = makeOrganism('wolf', 3, 3, { energy: 40, carnivory: 0.5, brain: brainWith({ isEatCarrion: 100 }) });
    const sheep = makeOrganism('sheep', 8, 8, { energy: 40, carnivory: 0, brain: brainWith({ isEatCarrion: 100 }) });
    world.eggs.set('kid2', { x: 8, y: 8, laidTick: 0, shell: 0, child: makeOrganism('kid2', 8, 8, { energy: 30 }) });
    addAll(world, wolf, sheep);
    world.step();
    expect(wolf.energy).toBe(55); // half of 30
    expect(world.eggs.has('kid')).toBe(false);
    expect(world.eggsEatenTotal).toBe(1);
    expect(offered(sheep)).not.toContain('EAT_CARRION'); // a plant eater gets nothing from an egg
    expect(world.eggs.has('kid2')).toBe(true);
  });

  it('eating an egg returns less than laying it cost, even with the best gut', () => {
    const world = quietWorld({ carrionBite: 30, digestiveFounder: 1.5, carnivoreFounder: 1 });
    const child = makeOrganism('kid', 3, 3, { energy: 30 });
    world.eggs.set('kid', { x: 3, y: 3, laidTick: 0, shell: 0, child });
    const wolf = makeOrganism('wolf', 3, 3, {
      energy: 20, carnivory: 1, digestiveEfficiency: 1.5, carnivoreEfficiency: 1, brain: brainWith({ isEatCarrion: 100 }),
    });
    addAll(world, wolf);
    world.step();
    expect(world.eggsEatenTotal).toBe(1);
    expect(wolf.energy).toBeCloseTo(50, 0); // capped at the egg's 30, not 45 (minus a little gut upkeep)
    expect(30).toBeLessThan(30 + world.config.reproductionMetabolismTax); // laying it cost more than that
  });

  it('needs room for a full meal, like plant food', () => {
    const world = quietWorld({ carrionBite: 30, carnivoreGeneEnabled: false, digestiveGeneEnabled: false });
    world.carrion.set('3,3', { x: 3, y: 3, stock: 50, expiresAt: 1000 });
    const wolf = makeOrganism('wolf', 3, 3, { energy: 80, carnivory: 1, brain: brainWith({ isEatCarrion: 100 }) });
    addAll(world, wolf);
    world.step();
    expect(offered(wolf)).not.toContain('EAT_CARRION');
  });
});

describe('No free energy from bodies', () => {
  it('eating one’s own newborn returns less than having it cost, at any parent energy', () => {
    const c = DEFAULT_CONFIG;
    for (let parent = c.reproductionThreshold; parent <= c.maxEnergy; parent++) {
      const child = Math.floor(parent * c.reproductionEnergyFraction);
      const cost = child + c.reproductionMetabolismTax;
      // Even a full meat eater eating the whole body, with no attack cost counted
      expect(carrionFromBody(child, c)).toBeLessThan(cost);
    }
  });
});

describe('No free energy from bodies at any size', () => {
  it('eating a newborn of a larger or smaller parent still returns less than making it', () => {
    const c = DEFAULT_CONFIG;
    for (const size of [c.sizeMin, 0.7, 1, 1.5, 2, c.sizeMax]) {
      for (let e = c.reproductionThreshold * size; e <= c.maxEnergy * size; e++) {
        const child = Math.floor(e * c.reproductionEnergyFraction);
        expect(carrionFromBody(child, c, size)).toBeLessThan(child + c.reproductionMetabolismTax);
      }
    }
  });

  it('leaves more carrion from a bigger body, starved or killed', () => {
    const c = DEFAULT_CONFIG;
    expect(carrionFromBody(0, c, 2)).toBeCloseTo(2 * carrionFromBody(0, c, 1), 9);
    expect(carrionFromBody(40, c, 2)).toBeGreaterThan(carrionFromBody(40, c, 1));
  });
});

describe('Attacks', () => {
  it('kill adjacent prey that stays put, leaving carrion worth less than the prey held', () => {
    const world = quietWorld({ bitePowerMin: 0.2, attackCost: 2, carrionBodyEnergy: 10, carrionEfficiency: 0.7 });
    const wolf = makeOrganism('wolf', 5, 5, { energy: 100, carnivory: 1, tag: 0, brain: brainWith({ isAttack: 100 }) });
    const prey = makeOrganism('prey', 6, 5, { energy: 60, tag: 180 });
    addAll(world, wolf, prey);
    let ticks = 0;
    while (world.organisms.has('prey') && ticks < 20) {
      world.step();
      ticks++;
    }
    expect(world.organisms.has('prey')).toBe(false);
    expect(wolf.kills).toBe(1);
    expect(wolf.recentHistory[0]).toMatchObject({ outcome: 'success', chosenAction: { type: 'ATTACK_EAST', preyId: 'prey' } });
    expect(wolf.energy).toBe(100 - 2 * ticks); // each attack costs attackCost; no energy is taken from the prey
    expect(world.carrion.get('6,5')!.stock).toBeCloseTo(10 + 0.7 * 60);
    expect(world.killsTotal).toBe(1);
    expect(world.killsOfStrangersTotal).toBe(1); // opposite hue
    expect(world.lastKill).toMatchObject({ killerTag: 0, preyTag: 180 });
  });

  it('miss when the prey moves out of reach the same tick', () => {
    const world = quietWorld({ bitePowerMin: 1, moveCost: 0 });
    // The prey's only open move is east, away from the wolf.
    world.obstacles.add('6,4');
    world.obstacles.add('6,6');
    const wolf = makeOrganism('wolf', 5, 5, { energy: 100, carnivory: 1, brain: brainWith({ isAttack: 100 }) });
    const prey = makeOrganism('prey', 6, 5, { energy: 1e-6, brain: brainWith({ isMove: 100, moveOccupied: -1000 }) });
    addAll(world, wolf, prey);
    world.step();
    expect(world.organisms.has('prey')).toBe(true);
    expect([prey.x, prey.y]).toEqual([7, 5]);
    expect(wolf.recentHistory[0]).toMatchObject({ outcome: 'missed', chosenAction: { type: 'ATTACK_EAST' } });
    expect(wolf.kills).toBe(0);
  });

  it('are only offered to brains, and only with predation on', () => {
    const dials = quietWorld({ controller: 'dials' });
    const a = makeOrganism('a', 5, 5);
    addAll(dials, a, makeOrganism('b', 6, 5));
    dials.step();
    expect(offered(a).some((t) => t.startsWith('ATTACK_'))).toBe(false);

    const off = quietWorld({ predationEnabled: false });
    const c = makeOrganism('c', 5, 5);
    addAll(off, c, makeOrganism('d', 6, 5));
    off.step();
    expect(offered(c).some((t) => t.startsWith('ATTACK_'))).toBe(false);

    const on = quietWorld();
    const e = makeOrganism('e', 5, 5);
    addAll(on, e, makeOrganism('f', 6, 5, { lineage: { id: 'x', parentId: 'e', generation: 2, birthTick: 0 } }));
    on.step();
    const attack = e.recentHistory[0].scores.find((s) => s.action.type === 'ATTACK_EAST')!.action;
    expect(attack).toMatchObject({ preyId: 'f', preyIsFamily: true, preySimilarity: 1 });
  });

  it('let a killer that is itself killed first bite nobody', () => {
    // Two wolves bite each other; whichever bite resolves first wins, the other never lands.
    const world = quietWorld({ bitePowerMin: 1 });
    const a = makeOrganism('a', 5, 5, { energy: 100, carnivory: 1, brain: brainWith({ isAttack: 100 }) });
    const b = makeOrganism('b', 6, 5, { energy: 100, carnivory: 1, brain: brainWith({ isAttack: 100 }) });
    addAll(world, a, b);
    for (let i = 0; i < 30 && world.organisms.size === 2; i++) world.step();
    expect(world.organisms.size).toBe(1);
    expect(world.killsTotal).toBe(1);
  });
});

describe('Brains from older saves', () => {
  it('gain the new inputs with their head start, and score old situations exactly as before', () => {
    const brain = createHeadStartBrain(new PRNG(9));
    const oldCount = BRAIN_INPUTS.indexOf('isEatCarrion');
    const old: Brain = {
      ...brain,
      skip: brain.skip.slice(0, oldCount),
      hidden: Array.from({ length: BRAIN_HIDDEN }, (_, h) => brain.hidden.slice(h * BRAIN_INPUT_COUNT, h * BRAIN_INPUT_COUNT + oldCount)).flat(),
    };
    const upgraded = upgradeBrain(old);
    expect(upgraded.skip).toHaveLength(BRAIN_INPUT_COUNT);
    expect(upgraded.hidden).toHaveLength(BRAIN_HIDDEN * BRAIN_INPUT_COUNT);
    expect(upgraded.skip.slice(oldCount)).toEqual(HEAD_START_SKIP.slice(oldCount));
    const features = Array.from({ length: BRAIN_INPUT_COUNT }, (_, i) => (i < oldCount ? Math.sin(i + 1) : 0));
    const before = old.skip.reduce((a, w, i) => a + w * features[i], 0);
    const after = brainScore(upgraded, features);
    let hidden = old.outBias;
    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let sum = old.hiddenBias[h];
      for (let i = 0; i < oldCount; i++) sum += old.hidden[h * oldCount + i] * features[i];
      hidden += old.out[h] * Math.tanh(sum);
    }
    expect(after.score).toBeCloseTo(before + hidden, 10);
    expect(upgradeBrain(upgraded)).toBe(upgraded);
  });

  it('load a save from before carrion: no carrion, plant-eating organisms with upgraded brains', () => {
    const world = new World({ seed: 3, gridWidth: 20, gridHeight: 20, initialOrganisms: 10, foodRegionCount: 0 });
    for (let i = 0; i < 5; i++) world.step();
    const state = JSON.parse(JSON.stringify(world.exportState()));
    const oldCount = BRAIN_INPUTS.indexOf('isEatCarrion');
    delete state.carrion;
    for (const o of state.organisms) {
      delete o.carnivory;
      delete o.kills;
      o.brain.skip = o.brain.skip.slice(0, oldCount);
      o.brain.hidden = Array.from({ length: BRAIN_HIDDEN }, (_, h) =>
        o.brain.hidden.slice(h * BRAIN_INPUT_COUNT, h * BRAIN_INPUT_COUNT + oldCount)
      ).flat();
    }
    const loaded = World.fromState(state);
    expect(loaded.carrion.size).toBe(0);
    for (const o of loaded.organisms.values()) {
      expect(o.carnivory).toBe(0);
      expect(o.brain.skip).toHaveLength(BRAIN_INPUT_COUNT);
    }
    for (let i = 0; i < 20; i++) loaded.step();
    expect(loaded.tick).toBe(25);
  });
});

describe('A world with carrion and predation', () => {
  it('keeps invariants, saves and restores exactly, and stays deterministic', () => {
    const run = () => {
      const w = new World({ seed: 'hunt', gridWidth: 30, gridHeight: 30, initialOrganisms: 30, foodRegionCount: 2 });
      for (let t = 0; t < 300; t++) {
        w.step();
        for (const o of w.organisms.values()) {
          expect(o.energy > 0 && o.energy <= w.config.maxEnergy).toBe(true);
          expect(o.carnivory >= 0 && o.carnivory <= 1).toBe(true);
        }
        for (const c of w.carrion.values()) expect(c.stock).toBeGreaterThan(0);
      }
      return w;
    };
    const a = run();
    const b = run();
    expect([b.organisms.size, b.killsTotal, b.carrionEatenTotal]).toEqual([a.organisms.size, a.killsTotal, a.carrionEatenTotal]);

    const copy = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    for (let t = 0; t < 50; t++) {
      a.step();
      copy.step();
    }
    // Compared as saved (JSON writes a mutated weight of -0 as 0, which changes no outcome).
    expect(JSON.stringify(copy.exportState())).toBe(JSON.stringify(a.exportState()));
  }, 60_000);
});
