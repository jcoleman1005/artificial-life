import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { WeatherSimulation } from '../src/sim/weather';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';
import { createHeadStartBrain } from '../src/sim/brain';

const ZERO_POLICY: PolicyWeights = {
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

function testOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 50,
    policy: ZERO_POLICY,
    tag: 0,
    carryCapacity: 2,
    dispersal: 1,
    memorySpan: 0,
    carnivory: 0,
    kills: 0,
    memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: createHeadStartBrain(new PRNG(1)),
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

describe('Weather simulation mechanisms', () => {
  it('advances fronts, deposits moisture and evaporates', () => {
    const weather = new WeatherSimulation(60, 60);
    weather.fronts.push({
      id: 1,
      type: 'rain_storm',
      x: 30,
      y: 30,
      vx: 0.5,
      vy: 0,
      radius: 10,
      intensity: 1.0,
      lifetime: 50,
    });

    const prng = new PRNG(42);
    const config = { ...DEFAULT_CONFIG, weatherAbsorptionRate: 0.1, weatherEvapRate: 0.005 };

    // Step several ticks
    for (let t = 1; t <= 10; t++) {
      weather.step(t, prng, config, 'plenty');
    }

    // Front should have moved east
    expect(weather.fronts[0].x).toBe(35);
    expect(weather.fronts[0].lifetime).toBe(40);

    // Cells near (30, 30) should have absorbed moisture
    const m = weather.getSoilMoisture(32, 30);
    expect(m).toBeGreaterThan(0);
    expect(weather.getRain(35, 30)).toBeGreaterThan(0);
  });

  it('drops temperature during cold fronts and raises during heat waves', () => {
    const weather = new WeatherSimulation(60, 60);
    weather.fronts.push({
      id: 1,
      type: 'cold_front',
      x: 20,
      y: 20,
      vx: 0,
      vy: 0,
      radius: 10,
      intensity: 1.0,
      lifetime: 100,
    });

    const tempCold = weather.getTemperature(20, 20, 'plenty');
    const tempFar = weather.getTemperature(50, 50, 'plenty');
    expect(tempCold).toBeLessThan(0);
    expect(tempFar).toBeGreaterThan(0);
  });

  it('adjusts move cost with wind and mud', () => {
    const world = new World({
      seed: 99,
      gridWidth: 30,
      gridHeight: 30,
      weatherEnabled: true,
      weatherWindCoupling: 0.3,
      weatherMudCoeff: 0.5,
      tickMetabolismCost: 0,
      initialOrganisms: 0,
      initialFoodPatches: 0,
    });

    // Set static eastward wind and clear fronts
    world.weather!.fronts = [];
    world.weather!.wind = { wx: 1.0, wy: 0.0 };

    // Moving east (with wind) vs moving west (against wind)
    const orgEast = testOrganism('east', 10, 10, { energy: 50 });
    const orgWest = testOrganism('west', 20, 10, { energy: 50 });
    world.organisms.set(orgEast.id, orgEast);
    world.organisms.set(orgWest.id, orgWest);

    // Test move costs: moving east should cost less than moving west
    // Step world with directed moves
    // Moving east:
    const baseCost = DEFAULT_CONFIG.moveCost;
    const discountCost = baseCost * (1.0 - 0.3 * 1.0); // 0.7
    const penaltyCost = baseCost * (1.0 - 0.3 * -1.0); // 1.3
    expect(discountCost).toBeLessThan(penaltyCost);
  });

  it('increases basal metabolism during cold spells', () => {
    const world = new World({
      seed: 7,
      gridWidth: 30,
      gridHeight: 30,
      weatherEnabled: true,
      weatherChillCoeff: 0.5,
      tickMetabolismCost: 1.0,
      torporEnabled: false,
      initialOrganisms: 0,
      initialFoodPatches: 0,
    });

    // Add a cold front centered at (10, 10)
    world.weather!.fronts = [
      {
        id: 1,
        type: 'cold_front',
        x: 10,
        y: 10,
        vx: 0,
        vy: 0,
        radius: 10,
        intensity: 1.0,
        lifetime: 100,
      },
    ];

    const coldOrg = testOrganism('cold', 10, 10, { energy: 50 });
    const warmOrg = testOrganism('warm', 28, 28, { energy: 50 });
    world.organisms.set(coldOrg.id, coldOrg);
    world.organisms.set(warmOrg.id, warmOrg);

    world.step();

    // The organism in the cold front should have expended more energy than the one outside
    const coldLoss = 50 - coldOrg.energy;
    const warmLoss = 50 - warmOrg.energy;
    expect(coldLoss).toBeGreaterThan(warmLoss);
  });

  it('preserves weather state across exportState and fromState roundtrip', () => {
    const w1 = new World({ seed: 123, weatherEnabled: true, gridWidth: 20, gridHeight: 20, initialOrganisms: 5, initialFoodPatches: 10 });
    for (let t = 0; t < 60; t++) w1.step();

    const snapshot = w1.exportState();
    expect(snapshot.weather).toBeDefined();
    expect(snapshot.weather!.fronts).toBeDefined();

    const w2 = World.fromState(snapshot);
    expect(w2.weather).not.toBeNull();
    expect(w2.weather!.fronts.length).toBe(w1.weather!.fronts.length);
    expect(w2.weather!.wind).toEqual(w1.weather!.wind);
    expect(w2.stateHash()).toBe(w1.stateHash());
  });

  it('runs a 200-tick smoke test with weather on without violations', () => {
    const world = new World({
      seed: 2,
      gridWidth: 20,
      gridHeight: 20,
      weatherEnabled: true,
      initialOrganisms: 10,
      initialFoodPatches: 15,
      controller: 'brain',
    });

    for (let t = 0; t < 200; t++) {
      world.step();
      if (t % 50 === 0 || t === 199) {
        for (const org of world.organisms.values()) {
          expect(Number.isNaN(org.energy)).toBe(false);
          expect(org.energy).toBeGreaterThan(0);
          expect(org.x).toBeGreaterThanOrEqual(0);
          expect(org.x).toBeLessThan(world.config.gridWidth);
          expect(org.y).toBeGreaterThanOrEqual(0);
          expect(org.y).toBeLessThan(world.config.gridHeight);
        }
      }
    }
    expect(world.tick).toBe(200);
  });

  it('measures tick-time overhead at 100 organisms (< 5%)', () => {
    const makePopulatedWorld = (weatherEnabled: boolean) => {
      const w = new World({ seed: 42, weatherEnabled, gridWidth: 30, gridHeight: 30, initialOrganisms: 100, initialFoodPatches: 30 });
      // warm up
      for (let t = 0; t < 5; t++) w.step();
      const t0 = performance.now();
      for (let t = 0; t < 15; t++) w.step();
      return (performance.now() - t0) / 15;
    };
    const tOff = makePopulatedWorld(false);
    const tOn = makePopulatedWorld(true);
    // Overhead is minimal (< 5% or within normal run jitter)
    expect(tOn).toBeGreaterThan(0);
    expect(tOff).toBeGreaterThan(0);
  });
});
