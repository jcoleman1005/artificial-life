import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { createHeadStartBrain } from '../src/sim/brain';
import { inheritCanLeap } from '../src/sim/traits';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

const TEST_BRAIN = createHeadStartBrain(new PRNG(0));

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
  avoidOccupied: 0,
  leapEagerness: 0,
};

function makeOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 50,
    policy: { ...NEUTRAL },
    tag: 0,
    carryCapacity: 0,
    canLeap: 0,
    brain: TEST_BRAIN,
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 100,
    offspringCount: 0,
    foodEatenCount: 0,
    carriedFood: 0,
    foodGiven: 0,
    foodReceived: 0,
    recentHistory: [],
    ...overrides,
  };
}

/** An empty world where only movement costs energy, with all mobility options on. */
function mobileWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 21,
    gridWidth: 12,
    gridHeight: 12,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    immigrationInterval: 0,
    seasonLength: 0,
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    leapUpkeep: 0,
    reproductionThreshold: 1000,
    foodRegenInterval: 9999,
    foodSpawnInterval: 9999,
    moveCost: 1,
    diagonalMoves: true,
    diagonalMoveCost: 1.4,
    squeezeEnabled: true,
    squeezeCostMultiplier: 2,
    leapEnabled: true,
    leapCostMultiplier: 2.5,
    ...overrides,
  });
}

function addAll(world: World, ...orgs: Organism[]) {
  for (const o of orgs) world.organisms.set(o.id, o);
}

const offered = (o: Organism) => o.recentHistory[0].scores.map((s) => s.action.type);

describe('Diagonal moves', () => {
  it('takes a diagonal toward food and pays the diagonal cost', () => {
    const world = mobileWorld();
    world.foodPatches.set('7,3', { x: 7, y: 3, stock: 3, capacity: 3 });
    const o = makeOrganism('o', 5, 5, { policy: { ...NEUTRAL, foodAttraction: 2 } });
    addAll(world, o);
    world.step();
    expect(o.recentHistory[0].chosenAction.type).toBe('MOVE_NORTHEAST');
    expect([o.x, o.y]).toEqual([6, 4]);
    expect(o.energy).toBeCloseTo(48.6);
  });

  it('cannot cut a corner between two obstacles', () => {
    const world = mobileWorld();
    world.obstacles.add('6,5');
    world.obstacles.add('5,4');
    const o = makeOrganism('o', 5, 5);
    addAll(world, o);
    world.step();
    expect(offered(o)).not.toContain('MOVE_NORTHEAST');
    expect(offered(o)).toContain('MOVE_SOUTHEAST');
  });

  it('offers only the 4 orthogonal moves when diagonals are off', () => {
    const world = mobileWorld({ diagonalMoves: false });
    const o = makeOrganism('o', 5, 5);
    addAll(world, o);
    world.step();
    expect(offered(o).filter((t) => t.startsWith('MOVE_')).sort()).toEqual(
      ['MOVE_EAST', 'MOVE_NORTH', 'MOVE_SOUTH', 'MOVE_WEST']
    );
  });
});

describe('Sensing occupied cells', () => {
  it('marks moves into a stranger’s cell and penalises them by avoidOccupied', () => {
    const world = mobileWorld();
    world.foodPatches.set('8,5', { x: 8, y: 5, stock: 3, capacity: 3 });
    world.foodPatches.set('6,5', { x: 6, y: 5, stock: 3, capacity: 3 }); // keeps the stranger eating
    const mover = makeOrganism('mover', 5, 5, {
      energy: 80,
      policy: { ...NEUTRAL, foodAttraction: 2, avoidOccupied: 2 },
    });
    const stranger = makeOrganism('stranger', 6, 5);
    addAll(world, mover, stranger);
    world.step();
    const east = mover.recentHistory[0].scores.find((s) => s.action.type === 'MOVE_EAST')!;
    expect(east.components.occupied).toBe(-3); // 2 × 1.5
    expect(mover.recentHistory[0].chosenAction.type).not.toBe('MOVE_EAST');
  });

  it('does not penalise moving into one’s own family member', () => {
    const world = mobileWorld();
    const parent = makeOrganism('parent', 5, 5, { policy: { ...NEUTRAL, avoidOccupied: 2 } });
    const child = makeOrganism('child', 6, 5, {
      lineage: { id: 'lin', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    addAll(world, parent, child);
    world.step();
    const east = parent.recentHistory[0].scores.find((s) => s.action.type === 'MOVE_EAST')!;
    expect('occupied' in east.components).toBe(false);
  });
});

describe('Squeezing past', () => {
  /** A mover pulled east toward food, with a stranger directly east of it. */
  function squeezeScene(strangerEats: boolean, config: Partial<SimulationConfig> = {}) {
    const world = mobileWorld({ diagonalMoves: false, leapEnabled: false, ...config });
    world.foodPatches.set('8,5', { x: 8, y: 5, stock: 3, capacity: 3 }); // within sensing range (3)
    if (strangerEats) world.foodPatches.set('6,5', { x: 6, y: 5, stock: 3, capacity: 3 });
    const mover = makeOrganism('mover', 5, 5, { energy: 80, policy: { ...NEUTRAL, foodAttraction: 2 } });
    const stranger = makeOrganism('stranger', 6, 5, {
      policy: { ...NEUTRAL, foodAttraction: strangerEats ? 0 : 2 },
    });
    addAll(world, mover, stranger);
    world.step();
    return { mover, stranger };
  }

  it('trades places with a stranger that stays put, at twice the move cost', () => {
    const { mover, stranger } = squeezeScene(true);
    expect(mover.recentHistory[0].chosenAction.type).toBe('MOVE_EAST');
    expect('squeezesPast' in mover.recentHistory[0].scores.find((s) => s.action.type === 'MOVE_EAST')!.components).toBe(true);
    expect([mover.x, stranger.x]).toEqual([6, 5]);
    expect(mover.energy).toBe(78);
    expect(stranger.recentHistory[0].chosenAction.type).toBe('EAT');
  });

  it('fails, at no cost, when the stranger moves away that tick', () => {
    const { mover, stranger } = squeezeScene(false);
    expect(stranger.recentHistory[0].outcome).toBe('success');
    expect(mover.recentHistory[0].outcome).toBe('blocked_by_organism');
    expect([mover.x, mover.energy]).toEqual([5, 80]);
  });

  it('is blocked outright when squeezing is off', () => {
    const { mover, stranger } = squeezeScene(true, { squeezeEnabled: false });
    expect(mover.recentHistory[0].outcome).toBe('blocked_by_organism');
    expect([mover.x, stranger.x]).toEqual([5, 6]);
  });

  it('lets two strangers walking into each other trade places', () => {
    const world = mobileWorld({ diagonalMoves: false, leapEnabled: false });
    world.foodPatches.set('8,5', { x: 8, y: 5, stock: 3, capacity: 3 }); // within sensing range (3)
    const a = makeOrganism('a', 5, 5, { energy: 80, policy: { ...NEUTRAL, foodAttraction: 2 } });
    const b = makeOrganism('b', 6, 5, { energy: 80, policy: { ...NEUTRAL, foodAttraction: -2 } });
    addAll(world, a, b);
    world.step();
    expect([a.x, b.x]).toEqual([6, 5]);
    expect([a.energy, b.energy]).toEqual([78, 78]);
  });
});

describe('Leaping', () => {
  function leapScene(opts: { canLeap?: number; landing?: 'free' | 'organism' | 'obstacle' } = {}) {
    const world = mobileWorld({ diagonalMoves: false, squeezeEnabled: false });
    world.foodPatches.set('9,5', { x: 9, y: 5, stock: 3, capacity: 3 });
    world.foodPatches.set('6,5', { x: 6, y: 5, stock: 3, capacity: 3 }); // the one leapt over stays eating
    const leaper = makeOrganism('leaper', 5, 5, {
      energy: 80,
      canLeap: opts.canLeap ?? 1,
      policy: { ...NEUTRAL, foodAttraction: 2, leapEagerness: 2 },
    });
    const over = makeOrganism('over', 6, 5);
    addAll(world, leaper, over);
    if (opts.landing === 'organism') addAll(world, makeOrganism('lander', 7, 5));
    if (opts.landing === 'obstacle') world.obstacles.add('7,5');
    world.step();
    return { leaper, over };
  }

  it('jumps over an adjacent organism into the free cell beyond, at 2.5× the move cost', () => {
    const { leaper, over } = leapScene();
    expect(leaper.recentHistory[0].chosenAction.type).toBe('LEAP_EAST');
    expect([leaper.x, leaper.y]).toEqual([7, 5]);
    expect(leaper.energy).toBe(77.5);
    expect([over.x, over.y]).toEqual([6, 5]);
  });

  it('is only offered to organisms with the trait, over an organism, onto a free cell', () => {
    const leaps = (o: Organism) => offered(o).filter((t) => t.startsWith('LEAP_'));
    expect(leaps(leapScene({ canLeap: 0 }).leaper)).toEqual([]);
    expect(leaps(leapScene({ landing: 'organism' }).leaper)).not.toContain('LEAP_EAST');
    expect(leaps(leapScene({ landing: 'obstacle' }).leaper)).not.toContain('LEAP_EAST');
    // Nothing to leap over to the west
    expect(leaps(leapScene().leaper)).not.toContain('LEAP_WEST');
  });

  it('is inherited, flipping only through mutation', () => {
    const prng = new PRNG(3);
    expect(inheritCanLeap(1, { ...DEFAULT_CONFIG, traitMutationRate: 0 }, prng)).toBe(1);
    expect(inheritCanLeap(1, { ...DEFAULT_CONFIG, traitMutationRate: 1 }, prng)).toBe(0);
    expect(inheritCanLeap(0, { ...DEFAULT_CONFIG, traitMutationRate: 1 }, prng)).toBe(1);
  });
});

describe('All mobility options together', () => {
  it('keeps invariants and stays deterministic over a long run (both controllers)', () => {
    for (const controller of ['dials', 'brain'] as const) {
      const run = () => {
        const w = new World({ seed: 'mobility', controller });
        const violations: string[] = [];
        const kinds = new Set<string>();
        for (let t = 0; t < 500; t++) {
          w.step();
          const cells = new Set<string>();
          for (const o of w.organisms.values()) {
            const key = `${o.x},${o.y}`;
            if (cells.has(key)) violations.push(`overlap ${key}`);
            cells.add(key);
            if (!(o.energy > 0 && o.energy <= w.config.maxEnergy)) violations.push(`energy ${o.energy}`);
            if (w.obstacles.has(key)) violations.push(`on obstacle ${key}`);
            const d = o.recentHistory[0];
            if (d?.outcome === 'success') {
              const type = d.chosenAction.type;
              if (type.startsWith('LEAP_')) kinds.add('leap');
              else if (/^MOVE_(NORTH|SOUTH)(EAST|WEST)$/.test(type)) kinds.add('diagonal');
              if (d.chosenAction.swapRelation === 'squeeze') kinds.add('squeeze');
            }
          }
        }
        return { violations, kinds, pop: w.organisms.size, births: w.birthsTotal };
      };
      const a = run();
      const b = run();
      expect(a.violations).toEqual([]);
      expect([...a.kinds].sort()).toEqual(['diagonal', 'leap', 'squeeze']);
      expect([b.pop, b.births]).toEqual([a.pop, a.births]);
    }
  }, 60_000);
});
