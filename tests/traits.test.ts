import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { founderCarryCapacity, inheritCarryCapacity, metabolismCost } from '../src/sim/traits';
import type { Organism } from '../src/sim/types';
import { createHeadStartBrain } from '../src/sim/brain';

describe('Carry capacity trait', () => {
  it('gives founders 1-3 units', () => {
    const prng = new PRNG(4);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(founderCarryCapacity(DEFAULT_CONFIG, prng));
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('is inherited unchanged without mutation, and otherwise shifts by one within bounds', () => {
    const prng = new PRNG(9);
    expect(inheritCarryCapacity(4, { ...DEFAULT_CONFIG, traitMutationRate: 0 }, prng)).toBe(4);

    const always = { ...DEFAULT_CONFIG, traitMutationRate: 1, maxCarryCapacity: 6 };
    const fromMiddle = new Set<number>();
    for (let i = 0; i < 200; i++) fromMiddle.add(inheritCarryCapacity(3, always, prng));
    expect([...fromMiddle].sort()).toEqual([2, 4]);
    for (let i = 0; i < 200; i++) {
      expect(inheritCarryCapacity(0, always, prng)).toBeGreaterThanOrEqual(0);
      expect(inheritCarryCapacity(6, always, prng)).toBeLessThanOrEqual(6);
    }
  });

  it('costs upkeep every tick in proportion to capacity', () => {
    const config = { ...DEFAULT_CONFIG, tickMetabolismCost: 0.25, carryUpkeep: 0.05 };
    expect(metabolismCost({ carryCapacity: 0 } as Organism, config)).toBeCloseTo(0.25);
    expect(metabolismCost({ carryCapacity: 4 } as Organism, config)).toBeCloseTo(0.45);

    const world = new World({
      seed: 1,
      initialOrganisms: 1,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      immigrationInterval: 0,
      tickMetabolismCost: 0.25,
      carryUpkeep: 0.05,
      moveCost: 0,
    });
    const org = Array.from(world.organisms.values())[0];
    const before = org.energy;
    world.step();
    expect(before - org.energy).toBeCloseTo(0.25 + 0.05 * org.carryCapacity);
  });

  it('limits picking up to the organism’s own capacity; capacity 0 carries nothing', () => {
    for (const capacity of [0, 1, 4]) {
      const world = new World({
        seed: 2,
        gridWidth: 10,
        gridHeight: 10,
        initialOrganisms: 0,
        initialFoodPatches: 0,
        obstacleDensity: 0,
        immigrationInterval: 0,
        seasonLength: 0,
        tickMetabolismCost: 0,
        carryUpkeep: 0,
        reproductionThreshold: 1000, // no offspring wandering through it
        foodRegenInterval: 9999,
        foodSpawnInterval: 9999,
      });
      world.foodPatches.set('5,5', { x: 5, y: 5, stock: 10, capacity: 10 });
      const forager = Array.from({ length: 1 }, () => ({
        id: 'f',
        x: 5,
        y: 5,
        energy: 100,
        policy: {
          foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0,
          eatDrive: 0, reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0,
          careForChildren: 0, forageDrive: 2, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0,
          signalOnFood: 0, signalWhenHungry: 0, followSignal: 0,
        },
        tag: 0,
        carryCapacity: capacity,
        brain: createHeadStartBrain(new PRNG(0)),
        lineage: { id: 'l', parentId: null, generation: 1, birthTick: 0 },
        age: 0,
        offspringCount: 0,
        foodEatenCount: 0,
        carriedFood: 0,
        foodGiven: 0,
        foodReceived: 0,
        signalTick: -1,
        recentHistory: [],
      }))[0] satisfies Organism;
      world.organisms.set(forager.id, forager);
      for (let t = 0; t < 8; t++) world.step();
      expect(forager.carriedFood).toBe(capacity);
    }
  });

  it('is passed from parent to child in a running world', () => {
    const world = new World({ seed: 'traits', traitMutationRate: 0 });
    const founders = new Map(Array.from(world.organisms.values(), (o) => [o.lineage.id, o.carryCapacity]));
    for (let t = 0; t < 300; t++) world.step();
    for (const o of world.organisms.values()) {
      if (founders.has(o.lineage.id)) expect(o.carryCapacity).toBe(founders.get(o.lineage.id));
    }
  });
});
