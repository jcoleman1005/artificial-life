import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_INPUTS, brainFeatures, createHeadStartBrain } from '../src/sim/brain';
import { getLegalActions } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
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

function makeOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 60,
    policy: { ...NEUTRAL },
    tag: 0,
    carryCapacity: 1,
    dispersal: 1,
    memorySpan: 0,
    carnivory: 0,
    kills: 0,
    memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: createHeadStartBrain(new PRNG(0)),
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 0,
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

/** A 15×15 world where only signals and eating change energy. */
function signalWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({ worldWrapEnabled: false, climateBeltsEnabled: false, hemisphericSeasonsEnabled: false, /* isolates the mechanism from the globe: exact costs and positions on a small flat world */ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
    seed: 'signals',
    gridWidth: 15,
    gridHeight: 15,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    foodRegionCount: 0,
    controller: 'dials', // these tests exercise the dial policy
    // Classic 4-way movement, so these tests isolate signals.
    diagonalMoves: false,
    squeezeEnabled: false,
    leapEnabled: false,
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    moveCost: 0,
    reproductionThreshold: 1000,
    immigrationInterval: 0,
    seasonLength: 0,
    foodSpawnInterval: 9999,
    sensingRadius: 3,
    signalRadius: 8,
    signalCost: 0.5,
    weatherEnabled: false,
    ...overrides,
  });
}

function boxIn(world: World, x: number, y: number): void {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) world.obstacles.add(`${x + dx},${y + dy}`);
}

/** A boxed-in hungry organism that signals every tick. */
function addBeacon(world: World, x: number, y: number): Organism {
  const beacon = makeOrganism('beacon', x, y, { energy: 20, policy: { ...NEUTRAL, signalWhenHungry: 2 } });
  boxIn(world, x, y);
  world.organisms.set(beacon.id, beacon);
  return beacon;
}

describe('Signals', () => {
  it('costs energy, keeps the signaller in place, and is sensed the next tick beyond sight', () => {
    const world = signalWorld();
    const beacon = addBeacon(world, 2, 5);
    const near = makeOrganism('near', 8, 5); // 6 away: beyond sight (3), within signal range (8)
    const far = makeOrganism('far', 12, 5); // 10 away: out of range (and out of near's sight)
    boxIn(world, 8, 5);
    boxIn(world, 12, 5);
    world.organisms.set(near.id, near);
    world.organisms.set(far.id, far);

    world.step();
    expect(beacon.recentHistory[0].chosenAction.type).toBe('SIGNAL');
    expect(beacon.energy).toBe(19.5);
    expect([beacon.x, beacon.y]).toEqual([2, 5]);
    // Decisions are simultaneous: nobody sees a signal sent this tick
    expect(near.recentHistory[0].sensed.nearestSignal).toBeNull();

    world.step();
    expect(near.recentHistory[0].sensed.nearestSignal).toMatchObject({ dx: -6, dy: 0, distance: 6, value: 1 });
    expect(near.recentHistory[0].sensed.nearestOrganism).toBeNull(); // too far to see
    expect(far.recentHistory[0].sensed.nearestSignal).toBeNull();
    expect(world.getMetrics().signalsTotal).toBe(2);
  });

  it('moves toward a signal with a positive followSignal and away with a negative one', () => {
    for (const [weight, expectCloser] of [[2, true], [-2, false]] as const) {
      const world = signalWorld({ signalRadius: 14 });
      addBeacon(world, 2, 5);
      const listener = makeOrganism('listener', 8, 5, { policy: { ...NEUTRAL, followSignal: weight } });
      world.organisms.set(listener.id, listener);
      world.step(); // the first signal goes out
      const startX = listener.x;
      for (let t = 0; t < 3; t++) world.step();
      if (expectCloser) expect(listener.x).toBe(startX - 3);
      else expect(listener.x).toBe(startX + 3);
      expect(listener.recentHistory[0].scores.some((s) => 'signalPull' in s.components)).toBe(true);
    }
  });

  it('signals on food only with a positive signalOnFood, and counts it', () => {
    for (const weight of [2, -2]) {
      const world = signalWorld();
      world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 5 });
      // Full, so it cannot eat; boxed in, so it cannot wander off
      const finder = makeOrganism('finder', 5, 5, { energy: 100, policy: { ...NEUTRAL, signalOnFood: weight } });
      boxIn(world, 5, 5);
      world.organisms.set(finder.id, finder);
      world.step();
      const signalled = finder.recentHistory[0].chosenAction.type === 'SIGNAL';
      expect(signalled).toBe(weight > 0);
      expect(world.getMetrics().signalsOnFoodTotal).toBe(weight > 0 ? 1 : 0);
    }
  });

  it('is never legal when the experiment switch is off', () => {
    const world = signalWorld({ signalsEnabled: false });
    const org = makeOrganism('a', 5, 5, { energy: 10, policy: { ...NEUTRAL, signalWhenHungry: 2 } });
    world.organisms.set(org.id, org);
    const snapshot = world.getSnapshot();
    const sensed = senseEnvironment(org, snapshot, world.config);
    expect(getLegalActions(org, snapshot, world.config, sensed).some((a) => a.type === 'SIGNAL')).toBe(false);
    for (let t = 0; t < 20; t++) world.step();
    expect(world.signalsTotal).toBe(0);
  });

  it('gives the brain inputs for when to signal and where signals are', () => {
    const world = signalWorld();
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 5 });
    addBeacon(world, 5, 9);
    const org = makeOrganism('a', 5, 5, { energy: 40 });
    boxIn(world, 5, 5);
    world.organisms.set(org.id, org);
    world.step();
    const snapshot = world.getSnapshot();
    const sensed = senseEnvironment(org, snapshot, world.config);
    const feature = (type: 'SIGNAL' | 'MOVE_SOUTH', name: string) =>
      brainFeatures({ type }, org, sensed, world.config, false, new PRNG(1))[BRAIN_INPUTS.indexOf(name as never)];
    expect(feature('SIGNAL', 'isSignal')).toBe(1);
    expect(feature('SIGNAL', 'signalOnFood')).toBe(1);
    expect(feature('SIGNAL', 'signalHunger')).toBeCloseTo(1 - org.energy / 100);
    expect(feature('MOVE_SOUTH', 'moveSignal')).toBeGreaterThan(0);
    expect(feature('MOVE_SOUTH', 'moveSignalAlike')).toBeGreaterThan(0);
  });
});
