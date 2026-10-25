import { describe, expect, it } from 'vitest';
import { World, type WorldState } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, type Brain } from '../src/sim/brain';
import { DEFAULT_CONFIG } from '../src/sim/config';
import {
  MEMORY_REGISTERS,
  MEMORY_WEIGHT_COUNT,
  REGISTER_INPUTS,
  inheritMemorySpan,
  newMemory,
  recall,
  updateMemory,
} from '../src/sim/memory';
import { metabolismCost } from '../src/sim/traits';
import type { Organism, PolicyWeights, SensedInputs, SimulationConfig } from '../src/sim/types';

const ON = { ...DEFAULT_CONFIG, memoryEnabled: true };

describe('Memory: recall and update', () => {
  it('fades a memory linearly over the span, and recalls nothing when off or with no span', () => {
    const memory = newMemory(0, 0);
    memory.food = { x: 10, y: 4, tick: 10 };
    expect(recall(memory, 20, 4, 4, 20, ON).food).toMatchObject({ dx: 6, dy: 0, distance: 6, freshness: 0.5 });
    expect(recall(memory, 20, 4, 4, 30, ON).food).toBeNull();
    expect(recall(memory, 0, 4, 4, 11, ON).food).toBeNull();
    const off = recall(memory, 20, 4, 4, 11, DEFAULT_CONFIG);
    expect([off.food, off.signal, off.home]).toEqual([null, null, null]);
    expect(off.registers).toEqual(new Array(MEMORY_REGISTERS).fill(0));
  });

  it('recalls home except when standing on it', () => {
    const memory = newMemory(3, 3);
    expect(recall(memory, 10, 6, 3, 0, ON).home).toMatchObject({ dx: -3, dy: 0, freshness: 1 });
    expect(recall(memory, 10, 3, 3, 0, ON).home).toBeNull();
  });

  const sensed = (overrides: Partial<SensedInputs>): SensedInputs =>
    ({
      energyRatio: 0.5,
      carriedFood: 0,
      surroundingOrganismCount: 0,
      currentCellFood: 0,
      nearestFood: null,
      nearestSignal: null,
      ...overrides,
    }) as SensedInputs;

  it('remembers the nearest food and the latest signal, and forgets food it finds gone', () => {
    const memory = newMemory(0, 0);
    const weights = new Array<number>(MEMORY_WEIGHT_COUNT).fill(0);
    updateMemory(memory, weights, sensed({ nearestFood: { x: 5, y: 6, dx: 1, dy: 1, distance: 2 } }), 1, { x: 4, y: 5 }, 7);
    expect(memory.food).toEqual({ x: 5, y: 6, tick: 7 });
    updateMemory(memory, weights, sensed({ nearestSignal: { x: 9, y: 9, dx: 4, dy: 4, distance: 8 } }), 1, { x: 4, y: 5 }, 8);
    expect(memory.food).toEqual({ x: 5, y: 6, tick: 7 }); // kept while out of sight
    expect(memory.signal).toEqual({ x: 9, y: 9, tick: 8 });
    updateMemory(memory, weights, sensed({}), 1, { x: 5, y: 6 }, 9); // back at the spot: nothing there
    expect(memory.food).toBeNull();
  });

  it('steps the registers from senses and their own previous values', () => {
    const fanIn = REGISTER_INPUTS.length + MEMORY_REGISTERS + 1;
    const weights = new Array<number>(MEMORY_WEIGHT_COUNT).fill(0);
    weights[0 * fanIn + 0] = 2; // register 0 tracks energy
    weights[1 * fanIn + REGISTER_INPUTS.length + 0] = 1; // register 1 follows register 0's previous value
    weights[2 * fanIn + fanIn - 1] = 0.5; // register 2 is a constant (bias)
    const memory = newMemory(0, 0);
    updateMemory(memory, weights, sensed({ energyRatio: 0.5 }), 1, { x: 0, y: 0 }, 1);
    expect(memory.registers[0]).toBeCloseTo(Math.tanh(1));
    expect(memory.registers[1]).toBe(0);
    expect(memory.registers[2]).toBeCloseTo(Math.tanh(0.5));
    updateMemory(memory, weights, sensed({ energyRatio: 0 }), 1, { x: 0, y: 0 }, 2);
    expect(memory.registers[0]).toBe(0);
    expect(memory.registers[1]).toBeCloseTo(Math.tanh(Math.tanh(1)));
  });
});

describe('Memory: the inherited span and its cost', () => {
  it('shifts the span by memorySpanStep at most, within 0 and the maximum', () => {
    const prng = new PRNG(3);
    const config = { ...ON, traitMutationRate: 1, maxMemorySpan: 20, memorySpanStep: 5 };
    for (let i = 0; i < 100; i++) {
      const parent = [0, 5, 20][i % 3];
      const child = inheritMemorySpan(parent, config, prng);
      expect(Math.abs(child - parent)).toBeLessThanOrEqual(5);
      expect(child).toBeGreaterThanOrEqual(0);
      expect(child).toBeLessThanOrEqual(20);
    }
  });

  it('charges upkeep per tick of span, only when memory is on', () => {
    const org = { carryCapacity: 0, memorySpan: 50, abilities: { diagonal: 0, squeeze: 0, leap: 0 } } as unknown as Organism;
    const base = { ...DEFAULT_CONFIG, carryUpkeep: 0, abilityUpkeep: 0, memoryUpkeep: 0.001 };
    expect(metabolismCost(org, { ...base, memoryEnabled: true })).toBeCloseTo(base.tickMetabolismCost + 0.05);
    expect(metabolismCost(org, { ...base, memoryEnabled: false })).toBeCloseTo(base.tickMetabolismCost);
  });
});

const NEUTRAL: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0,
  eatDrive: 0, reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0,
  careForChildren: 0, forageDrive: 0, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0,
  signalOnFood: 0, signalWhenHungry: 0, followSignal: 0, restDrive: 0, avoidOccupied: 0, leapEagerness: 0,
};

/** A brain whose only connection is `input` (weight w): it does nothing else. */
function singleInputBrain(input: (typeof BRAIN_INPUTS)[number], w: number): Brain {
  const skip = new Array<number>(BRAIN_INPUT_COUNT).fill(0);
  skip[BRAIN_INPUTS.indexOf(input)] = w;
  return {
    skip,
    hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(0),
    hiddenBias: new Array<number>(BRAIN_HIDDEN).fill(0),
    out: new Array<number>(BRAIN_HIDDEN).fill(0),
    outBias: 0,
  };
}

describe('Memory: in a running world', () => {
  function rememberingWorld(memoryEnabled: boolean): { world: World; org: Organism } {
    const config: Partial<SimulationConfig> = {
      seed: 'remember',
      gridWidth: 20,
      gridHeight: 20,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      foodRegionCount: 0,
      immigrationInterval: 0,
      seasonLength: 0,
      foodSpawnInterval: 9999,
      tickMetabolismCost: 0,
      carryUpkeep: 0,
      abilityUpkeep: 0,
      memoryUpkeep: 0,
      signalsEnabled: false,
      diagonalMoves: false,
      squeezeEnabled: false,
      leapEnabled: false,
      sensingRadius: 3,
      memoryEnabled,
    };
    const world = new World(config);
    const memory = newMemory(5, 10);
    memory.food = { x: 14, y: 10, tick: 0 }; // 9 cells east: far out of sight
    const org: Organism = {
      id: 'a', x: 5, y: 10, energy: 80, policy: { ...NEUTRAL }, tag: 0, carryCapacity: 0, dispersal: 1,
      memorySpan: 60, memoryWeights: new Array<number>(MEMORY_WEIGHT_COUNT).fill(0), memory,
      abilities: { diagonal: 0, squeeze: 0, leap: 0 }, brain: singleInputBrain('moveRememberedFood', 5),
      lineage: { id: 'l', parentId: null, generation: 1, birthTick: 0 }, age: 0, offspringCount: 0,
      foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1, recentHistory: [],
    };
    world.organisms.set(org.id, org);
    return { world, org };
  }

  it('lets a brain head for food it remembers but can no longer see', () => {
    const { world, org } = rememberingWorld(true);
    for (let t = 0; t < 6; t++) world.step();
    expect(org.x).toBe(11);
    expect(org.recentHistory[0].sensed.rememberedFood).toMatchObject({ x: 14, y: 10 });
  });

  it('does nothing with memory switched off (the control)', () => {
    const { world, org } = rememberingWorld(false);
    for (let t = 0; t < 6; t++) world.step();
    expect(org.recentHistory[0].sensed.rememberedFood).toBeNull();
    expect(org.x).toBeLessThan(11); // all moves score alike, so it only drifts at random
  });

  it('saves and restores memory: a restored world continues exactly', () => {
    const world = new World({ seed: 'mem-snap', gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22, maxFoodPatches: 36, memoryEnabled: true });
    for (let t = 0; t < 150; t++) world.step();
    const restored = World.fromState(JSON.parse(JSON.stringify(world.exportState())) as WorldState);
    for (let t = 0; t < 150; t++) {
      world.step();
      restored.step();
    }
    const plain = (w: World) => JSON.parse(JSON.stringify(w.exportState())) as WorldState;
    expect(plain(restored)).toEqual(plain(world));
    expect(Array.from(world.organisms.values()).some((o) => o.memory.food !== null)).toBe(true);
  }, 30_000);
});
