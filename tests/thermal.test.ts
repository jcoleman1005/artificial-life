import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG, createConfig } from '../src/sim/config';
import { createHeadStartBrain } from '../src/sim/brain';
import { metabolismCost, thermalUpkeepFactor } from '../src/sim/traits';
import type { Organism, PolicyWeights } from '../src/sim/types';

// Thermal physics (docs/decisions.md, "Thermal physics"): both extremes cost, scaled by the
// body. Tests of the law use the pure function; one test runs it through a world step.

const ZERO_POLICY: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0, eatDrive: 0,
  reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0, careForChildren: 0,
  forageDrive: 0, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0, signalOnFood: 0,
  signalWhenHungry: 0, followSignal: 0, restDrive: 0, avoidOccupied: 0, leapEagerness: 0,
};

function body(overrides: Partial<Organism> = {}): Organism {
  return {
    id: 'o', x: 5, y: 5, energy: 50, policy: ZERO_POLICY, tag: 0, carryCapacity: 2, dispersal: 1,
    memorySpan: 0, carnivory: 0, kills: 0, memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 }, brain: createHeadStartBrain(new PRNG(1)),
    lineage: { id: 'l', parentId: null, generation: 1, birthTick: 0 }, age: 100, offspringCount: 0,
    foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1, recentHistory: [],
    ...overrides,
  };
}

const on = createConfig({ thermalPhysicsEnabled: true });
const off = createConfig({ thermalPhysicsEnabled: false });
const HEAT = 0.9; // a heat wave on top of the plenty-season baseline: 0.8 above the threshold
const COLD = -0.5;

describe('Thermal physics', () => {
  it('leaves a founder-shaped body paying exactly the old cold cost, and nothing at comfortable temperatures', () => {
    const founder = body({ size: 1, metabolicRate: 1, fat: 0, fatCapacity: 4 });
    for (const t of [-0.1, -0.5, -1]) {
      expect(thermalUpkeepFactor(founder, t, on)).toBeCloseTo(1 + DEFAULT_CONFIG.weatherChillCoeff * Math.abs(t), 12);
    }
    for (const t of [0, 0.05, 0.1]) expect(thermalUpkeepFactor(founder, t, on)).toBe(1);
  });

  it('with the switch off is the old rule: cold costs the same for every body and heat costs nothing', () => {
    const small = body({ size: 0.5, metabolicRate: 0.6 });
    const large = body({ size: 2, metabolicRate: 1.4, fat: 30, fatCapacity: 60 });
    expect(thermalUpkeepFactor(small, COLD, off)).toBe(thermalUpkeepFactor(large, COLD, off));
    expect(thermalUpkeepFactor(small, COLD, off)).toBeCloseTo(1 + off.weatherChillCoeff * 0.5, 12);
    expect(thermalUpkeepFactor(small, HEAT, off)).toBe(1);
  });

  it('makes small, lean, slow-burning bodies suffer most in the cold', () => {
    const base = thermalUpkeepFactor(body({ size: 1, metabolicRate: 1 }), COLD, on);
    expect(thermalUpkeepFactor(body({ size: 0.5, metabolicRate: 1 }), COLD, on)).toBeGreaterThan(base); // surface to volume
    expect(thermalUpkeepFactor(body({ size: 2, metabolicRate: 1 }), COLD, on)).toBeLessThan(base);
    expect(thermalUpkeepFactor(body({ size: 1, metabolicRate: 1.5 }), COLD, on)).toBeLessThan(base); // makes more heat
    expect(thermalUpkeepFactor(body({ size: 1, metabolicRate: 0.6 }), COLD, on)).toBeGreaterThan(base);
    // fat insulates
    expect(thermalUpkeepFactor(body({ size: 1, fat: 20, fatCapacity: 20 }), COLD, on)).toBeLessThan(base);
  });

  it('makes large, fat, fast-burning bodies suffer most in the heat, and only above the threshold', () => {
    const base = thermalUpkeepFactor(body({ size: 1, metabolicRate: 1 }), HEAT, on);
    expect(base).toBeGreaterThan(1);
    expect(thermalUpkeepFactor(body({ size: 2, metabolicRate: 1 }), HEAT, on)).toBeGreaterThan(base);
    expect(thermalUpkeepFactor(body({ size: 0.5, metabolicRate: 1 }), HEAT, on)).toBeLessThan(base);
    expect(thermalUpkeepFactor(body({ size: 1, metabolicRate: 1.5 }), HEAT, on)).toBeGreaterThan(base);
    expect(thermalUpkeepFactor(body({ size: 1, fat: 20, fatCapacity: 20 }), HEAT, on)).toBeGreaterThan(base);
    expect(thermalUpkeepFactor(body({ size: 2 }), on.thermalHeatThreshold, on)).toBe(1);
  });

  it('ignores size, rate and fat for bodies that lack those genes (the factor needs only the switches)', () => {
    const noGenes = createConfig({ thermalPhysicsEnabled: true, sizeGeneEnabled: false, metabolismGeneEnabled: false, fatEnabled: false });
    const a = thermalUpkeepFactor(body({ size: 0.5, metabolicRate: 0.6, fat: 5, fatCapacity: 10 }), COLD, noGenes);
    expect(a).toBeCloseTo(1 + noGenes.weatherChillCoeff * 0.5, 12);
  });

  it('is applied to a body\'s upkeep in a world step, and the ledger still balances', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      worldWrapEnabled: false, climateBeltsEnabled: false, hemisphericSeasonsEnabled: false, /* isolates the mechanism from the globe: exact costs and positions on a small flat world */ seed: 7, gridWidth: 30, gridHeight: 30, weatherEnabled: true, thermalPhysicsEnabled: true,
      torporEnabled: false, // so a rest does not discount the upkeep being measured
      initialOrganisms: 0, initialFoodPatches: 0, ledgerCheckInterval: 1,
    });
    world.weather!.fronts = [
      { id: 1, type: 'heat_wave', x: 10, y: 10, vx: 0, vy: 0, radius: 10, intensity: 1, lifetime: 100 },
    ];
    const big = body({ id: 'big', x: 10, y: 10, size: 2, metabolicRate: 1, energy: 150 });
    world.organisms.set(big.id, big);
    const expectedBase = metabolismCost(big, world.config);
    const temp = world.weather!.getTemperature(10, 10, null);
    expect(temp).toBeGreaterThan(on.thermalHeatThreshold);
    world.step();
    const season = world.ledger.report();
    expect(season).not.toBeNull();
    // The measured upkeep exceeds the plain upkeep by the heat factor (the season shifts temp by ±0.1,
    // so allow for either baseline).
    const lo = expectedBase * thermalUpkeepFactor(big, temp - 0.1, world.config);
    const hi = expectedBase * thermalUpkeepFactor(big, temp + 0.1, world.config);
    expect(season!.flows.upkeep).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(season!.flows.upkeep).toBeLessThanOrEqual(hi + 1e-9);
    expect(season!.flows.upkeep).toBeGreaterThan(expectedBase);
    expect(season!.violations).toBe(0);
  });
});
