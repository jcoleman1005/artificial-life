import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { computeTribeMetrics } from '../src/sim/metrics';
import { senseEnvironment } from '../src/sim/sensors';
import { createHeadStartBrain } from '../src/sim/brain';

const TEST_BRAIN = createHeadStartBrain(new PRNG(0));
import { inheritTag, isKin, shareWeightFor, tagDistance, tagSimilarity } from '../src/sim/tags';
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
};

function makeOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 50,
    policy: { ...NEUTRAL },
    tag: 0,
    carryCapacity: 2,
    brain: TEST_BRAIN,
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 0,
    offspringCount: 0,
    foodEatenCount: 0,
    carriedFood: 0,
    foodGiven: 0,
    foodReceived: 0,
    recentHistory: [],
    ...overrides,
  };
}

/**
 * An empty 10×10 world where only eating changes energy: no metabolism,
 * free movement, reproduction out of reach, no seasons or newcomers.
 */
function emptyWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 3,
    gridWidth: 10,
    gridHeight: 10,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    tickMetabolismCost: 0,
    carryUpkeep: 0,
    moveCost: 0,
    reproductionThreshold: 1000,
    immigrationInterval: 0,
    seasonLength: 0,
    foodSpawnInterval: 9999,
    ...overrides,
  });
}

describe('Tags', () => {
  it('measures hue distance around the colour wheel', () => {
    expect(tagDistance(10, 350)).toBe(20);
    expect(tagDistance(0, 180)).toBe(180);
    expect(tagSimilarity(0, 180)).toBe(0);
    expect(tagSimilarity(30, 30)).toBe(1);
    expect(isKin(10, 350, DEFAULT_CONFIG)).toBe(true); // 89% alike >= 75%
    expect(isKin(0, 90, DEFAULT_CONFIG)).toBe(false); // 50% alike
  });

  it('grades the sharing weight from the stranger weight to the kin weight', () => {
    const policy = { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: -2 };
    expect(shareWeightFor(policy, 1, DEFAULT_CONFIG)).toBe(2);
    expect(shareWeightFor(policy, 0.75, DEFAULT_CONFIG)).toBe(2);
    expect(shareWeightFor(policy, 0.5, DEFAULT_CONFIG)).toBeCloseTo(0);
    expect(shareWeightFor(policy, 0.25, DEFAULT_CONFIG)).toBe(-2);
    expect(shareWeightFor(policy, 0, DEFAULT_CONFIG)).toBe(-2);
  });

  it('inherits unchanged without mutation and always stays in [0, 360)', () => {
    const prng = new PRNG(8);
    expect(inheritTag(123, { ...DEFAULT_CONFIG, tagMutationRate: 0 }, prng)).toBe(123);
    const config = { ...DEFAULT_CONFIG, tagMutationRate: 1, tagMutationStdDev: 40 };
    for (let i = 0; i < 500; i++) {
      const tag = inheritTag(i % 2 === 0 ? 1 : 359, config, prng);
      expect(tag).toBeGreaterThanOrEqual(0);
      expect(tag).toBeLessThan(360);
    }
  });
});

describe('Carrying food', () => {
  it('picks up food into a limited carry, then eats it away from any patch', () => {
    const world = emptyWorld({ foodEnergyYield: 25, foodRegenInterval: 9999 });
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 5 });
    // Full energy, so eating is impossible and picking up is the only food action.
    const forager = makeOrganism('forager', 5, 5, { energy: 100, policy: { ...NEUTRAL, forageDrive: 2 } });
    world.organisms.set(forager.id, forager);

    for (let t = 0; t < 4; t++) world.step();
    expect(forager.carriedFood).toBe(2); // capped at its carry capacity
    expect(world.foodPatches.get('5,5')!.stock).toBe(3);

    // Away from the patch and hungry: eating uses carried food.
    forager.x = 1;
    forager.y = 1;
    forager.energy = 40;
    forager.policy.eatDrive = 2;
    world.step();
    expect(forager.recentHistory[0].chosenAction.type).toBe('EAT');
    expect(forager.energy).toBe(65);
    expect(forager.carriedFood).toBe(1);
  });
});

describe('Giving food', () => {
  it('hands one carried unit to a hungry neighbour, who eats it; no energy moves', () => {
    const world = emptyWorld({ foodEnergyYield: 25 });
    const donor = makeOrganism('donor', 5, 5, {
      energy: 90,
      carriedFood: 1,
      policy: { ...NEUTRAL, shareWithKin: 2 },
    });
    const recipient = makeOrganism('recipient', 6, 5, { energy: 20 });
    world.organisms.set(donor.id, donor);
    world.organisms.set(recipient.id, recipient);

    world.step();

    expect(donor.recentHistory[0].chosenAction.type).toBe('GIVE_EAST');
    expect(donor.energy).toBe(90); // the donor gives food, not energy
    expect(donor.carriedFood).toBe(0);
    expect(donor.foodGiven).toBe(1);
    expect(recipient.energy).toBe(45);
    expect(recipient.foodReceived).toBe(1);
    expect(world.sharesTotal).toBe(1);
    expect(world.kinSharesTotal).toBe(1);
  });

  it('uses the kin weight for look-alikes and the stranger weight for others', () => {
    const world = emptyWorld();
    // Gives generously to kin, refuses strangers.
    const donor = makeOrganism('donor', 5, 5, {
      energy: 90,
      tag: 100,
      carriedFood: 1,
      policy: { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: -2 },
    });
    const stranger = makeOrganism('stranger', 6, 5, { tag: 280, energy: 20 });
    const kin = makeOrganism('kin', 4, 5, { tag: 110, energy: 20 });
    for (const o of [donor, stranger, kin]) world.organisms.set(o.id, o);

    world.step();

    expect(donor.recentHistory[0].chosenAction.type).toBe('GIVE_WEST');
    expect(kin.foodReceived).toBe(1);
    expect(stranger.foodReceived).toBe(0);
  });

  it('is only offered when switched on, carrying food, and the neighbour is hungry', () => {
    const giveOptions = (config: Partial<SimulationConfig>, carried: number, recipientEnergy: number) => {
      const world = emptyWorld(config);
      const donor = makeOrganism('donor', 5, 5, {
        energy: 90,
        carriedFood: carried,
        policy: { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: 2 },
      });
      const recipient = makeOrganism('recipient', 6, 5, { energy: recipientEnergy });
      world.organisms.set(donor.id, donor);
      world.organisms.set(recipient.id, recipient);
      world.step();
      return donor.recentHistory[0].scores.filter((s) => s.action.type.startsWith('GIVE_')).length;
    };
    expect(giveOptions({}, 1, 20)).toBe(1);
    expect(giveOptions({ sharingEnabled: false }, 1, 20)).toBe(0);
    expect(giveOptions({}, 0, 20)).toBe(0); // nothing to give
    expect(giveOptions({}, 1, 50)).toBe(0); // at half energy: not hungry
  });

  it('scores giving by how hungry the neighbour is', () => {
    const scoreFor = (recipientEnergy: number) => {
      const world = emptyWorld();
      const donor = makeOrganism('donor', 5, 5, {
        energy: 90,
        carriedFood: 1,
        policy: { ...NEUTRAL, shareWithKin: 1 },
      });
      const recipient = makeOrganism('recipient', 6, 5, { energy: recipientEnergy });
      world.organisms.set(donor.id, donor);
      world.organisms.set(recipient.id, recipient);
      world.step();
      return donor.recentHistory[0].scores.find((s) => s.action.type === 'GIVE_EAST')?.totalScore;
    };
    // need = (50 - e) / 50; score = 1 × need × 2 − 0.1
    expect(scoreFor(25)).toBeCloseTo(0.9);
    expect(scoreFor(5)).toBeCloseTo(1.7);
  });

  it('never pushes a recipient above maximum energy', () => {
    const world = emptyWorld({ maxEnergy: 100, foodEnergyYield: 100 });
    const donor = makeOrganism('donor', 5, 5, { energy: 90, carriedFood: 1, policy: { ...NEUTRAL, shareWithKin: 2 } });
    const recipient = makeOrganism('recipient', 5, 6, { energy: 10 });
    world.organisms.set(donor.id, donor);
    world.organisms.set(recipient.id, recipient);

    world.step();

    expect(recipient.energy).toBe(100);
  });

  it('cannot keep a boxed-in family alive by passing energy around', () => {
    // A parent surrounded by its four children, no food anywhere and none carried.
    const world = emptyWorld({ tickMetabolismCost: 0.25 });
    const caring = { ...NEUTRAL, shareWithKin: 2, careForChildren: 2 };
    const parent = makeOrganism('parent', 5, 5, { energy: 20, policy: caring });
    world.organisms.set(parent.id, parent);
    [[5, 4], [5, 6], [4, 5], [6, 5]].forEach(([cx, cy], i) => {
      const child = makeOrganism(`child-${i}`, cx, cy, {
        energy: 20,
        policy: caring,
        lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
      });
      world.organisms.set(child.id, child);
    });

    const totalEnergy = () => Array.from(world.organisms.values()).reduce((a, o) => a + o.energy, 0);
    let previous = totalEnergy();
    for (let t = 0; t < 20; t++) {
      world.step();
      const now = totalEnergy();
      expect(now).toBeLessThan(previous);
      previous = now;
    }
    expect(world.sharesTotal).toBe(0);
  });
});

describe('Parental care', () => {
  function parentAndChild(parentEnergy: number, childEnergy: number, carried: number) {
    const world = emptyWorld({ foodEnergyYield: 25 });
    const parent = makeOrganism('parent', 5, 5, {
      energy: parentEnergy,
      carriedFood: carried,
      // Eats as eagerly as it cares, so giving really competes with eating.
      policy: { ...NEUTRAL, careForChildren: 2, eatDrive: 1 },
    });
    const child = makeOrganism('child', 6, 5, {
      energy: childEnergy,
      lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);
    world.step();
    return { world, parent, child };
  }

  it('gives its only carried food to a starving child even when hungry itself', () => {
    const { world, parent, child } = parentAndChild(20, 5, 1);
    const decision = parent.recentHistory[0];
    expect(decision.scores.some((s) => s.action.type === 'EAT')).toBe(true);
    expect(decision.chosenAction.type).toBe('GIVE_EAST');
    expect(parent.carriedFood).toBe(0);
    expect(parent.energy).toBe(20);
    expect(child.energy).toBe(30);
    expect(world.parentalSharesTotal).toBe(1);
  });

  it('scores care on the child’s hunger, and only for hungry children', () => {
    const careOffered = (childEnergy: number) =>
      parentAndChild(80, childEnergy, 1).parent.recentHistory[0].scores.some(
        (s) => 'parentalCare' in s.components
      );
    expect(careOffered(10)).toBe(true);
    expect(careOffered(60)).toBe(false);
  });

  it('does not treat an unrelated hungry neighbour as a child', () => {
    const world = emptyWorld();
    const adult = makeOrganism('adult', 5, 5, { energy: 80, carriedFood: 1, policy: { ...NEUTRAL, careForChildren: 2 } });
    const other = makeOrganism('other', 6, 5, { energy: 10 });
    world.organisms.set(adult.id, adult);
    world.organisms.set(other.id, other);
    world.step();
    expect(other.foodReceived).toBe(0);
  });
});

describe('Passing through children', () => {
  /**
   * A parent pulled east toward food, with its own child directly east of it.
   * By default the child stands on a food patch and eats (eating outranks
   * everything), so it stays put for the tick.
   */
  function parentBehindChild(
    childPolicy: Partial<PolicyWeights> = {},
    childIsOwn = true,
    childEats = true
  ) {
    const world = emptyWorld({ moveCost: 1, foodRegenInterval: 9999 });
    world.foodPatches.set('8,5', { x: 8, y: 5, stock: 5, capacity: 5 });
    if (childEats) world.foodPatches.set('6,5', { x: 6, y: 5, stock: 5, capacity: 5 });
    const parent = makeOrganism('parent', 5, 5, { energy: 40, policy: { ...NEUTRAL, foodAttraction: 2 } });
    const child = makeOrganism('child', 6, 5, {
      energy: 60,
      policy: { ...NEUTRAL, ...childPolicy },
      lineage: { id: 'lin-parent', parentId: childIsOwn ? 'parent' : 'someone-else', generation: 2, birthTick: 0 },
    });
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);
    world.step();
    return { world, parent, child };
  }

  it('lets a parent trade places with its own child; only the parent pays to move', () => {
    const { parent, child } = parentBehindChild();
    expect(parent.recentHistory[0].chosenAction.type).toBe('MOVE_EAST');
    expect(parent.recentHistory[0].outcome).toBe('success');
    expect([parent.x, parent.y]).toEqual([6, 5]);
    expect([child.x, child.y]).toEqual([5, 5]);
    expect(parent.energy).toBe(39);
    expect(child.recentHistory[0].chosenAction.type).toBe('EAT');
    expect(child.energy).toBe(85); // ate (+25) and was swapped for free
  });

  it('does not pass through organisms that are not its children', () => {
    const { parent, child } = parentBehindChild({}, false);
    expect(parent.recentHistory[0].outcome).toBe('blocked_by_organism');
    expect([parent.x, parent.y]).toEqual([5, 5]);
    expect([child.x, child.y]).toEqual([6, 5]);
    expect(parent.energy).toBe(40);
  });

  it('fails that tick if the child moves away, without costing the parent', () => {
    // The child is also pulled to the food and steps east first.
    const { parent, child } = parentBehindChild({ foodAttraction: 2 }, true, false);
    expect(child.recentHistory[0].outcome).toBe('success');
    expect([child.x, child.y]).toEqual([7, 5]);
    expect(parent.recentHistory[0].outcome).toBe('blocked_by_organism');
    expect([parent.x, parent.y]).toEqual([5, 5]);
    expect(parent.energy).toBe(40);
  });

  it('lets a child pass through its parent to reach food underneath', () => {
    // A well-fed parent sits on a patch; its starving child next to it heads for the food.
    const world = emptyWorld({ foodRegenInterval: 9999 });
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 5 });
    const parent = makeOrganism('parent', 5, 5, { energy: 95 });
    const child = makeOrganism('child', 4, 5, {
      energy: 10,
      lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    // Walls keep the parent from wandering off the patch on its own.
    for (const cell of ['5,4', '5,6', '6,5']) world.obstacles.add(cell);
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);

    world.step(); // child swaps onto the patch
    expect(child.recentHistory[0].scores.some((s) => 'passesParent' in s.components)).toBe(true);
    expect([child.x, child.y]).toEqual([5, 5]);
    world.step(); // and eats
    expect(child.recentHistory[0].chosenAction.type).toBe('EAT');
  });

  it('treats a parent and child moving into each other as one trade', () => {
    const world = emptyWorld({ moveCost: 1, foodRegenInterval: 9999 });
    // Food to the east: the parent is drawn toward it, the child (with an
    // aversion to food) away from it, so each moves into the other's cell.
    world.foodPatches.set('8,5', { x: 8, y: 5, stock: 5, capacity: 5 });
    const parent = makeOrganism('parent', 4, 5, { energy: 60, policy: { ...NEUTRAL, foodAttraction: 2 } });
    const child = makeOrganism('child', 5, 5, {
      energy: 60,
      policy: { ...NEUTRAL, foodAttraction: -2 },
      lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);

    world.step();

    expect(parent.recentHistory[0].chosenAction.type).toBe('MOVE_EAST');
    expect(child.recentHistory[0].chosenAction.type).toBe('MOVE_WEST');
    expect([parent.x, child.x]).toEqual([5, 4]); // traded once, not twice
    expect([parent.energy, child.energy]).toEqual([59, 59]); // both moved, both paid
  });

  it('lets only one of several children pass through the same parent in a tick', () => {
    const world = emptyWorld({ foodRegenInterval: 9999 });
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 5, capacity: 5 });
    const parent = makeOrganism('parent', 5, 5, { energy: 95 });
    world.organisms.set(parent.id, parent);
    for (const cell of ['5,4', '5,6']) world.obstacles.add(cell);
    [[4, 5], [6, 5]].forEach(([cx, cy], i) => {
      const child = makeOrganism(`child-${i}`, cx, cy, {
        energy: 10,
        lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
      });
      world.organisms.set(child.id, child);
    });
    world.step();
    const swapped = Array.from(world.organisms.values()).filter(
      (o) => o.id !== 'parent' && o.recentHistory[0].outcome === 'success'
    );
    expect(swapped).toHaveLength(1);
    const cells = new Set(Array.from(world.organisms.values(), (o) => `${o.x},${o.y}`));
    expect(cells.size).toBe(world.organisms.size);
  });

  it('frees a parent boxed in by its four children', () => {
    const world = emptyWorld({ foodRegenInterval: 9999 });
    world.foodPatches.set('8,5', { x: 8, y: 5, stock: 5, capacity: 5 });
    const parent = makeOrganism('parent', 5, 5, { energy: 40, policy: { ...NEUTRAL, foodAttraction: 2, eatDrive: 2 } });
    world.organisms.set(parent.id, parent);
    [[5, 4], [5, 6], [4, 5], [6, 5]].forEach(([cx, cy], i) => {
      // Well fed, so they stay put rather than racing to the food themselves.
      const child = makeOrganism(`child-${i}`, cx, cy, {
        energy: 60,
        lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
      });
      world.organisms.set(child.id, child);
    });

    for (let t = 0; t < 6; t++) world.step();

    expect(parent.foodEatenCount).toBeGreaterThan(0);
    const cells = new Set(Array.from(world.organisms.values(), (o) => `${o.x},${o.y}`));
    expect(cells.size).toBe(world.organisms.size); // never two in one cell
  });
});

describe('Childhood', () => {
  /** What a child at (2, 5) senses about its parent at (5, 5). */
  function childSensesParent(opts: { childAge?: number; parentCarries?: number; related?: boolean }) {
    const world = emptyWorld({ childhoodTicks: 800 });
    const parent = makeOrganism('parent', 5, 5, { carriedFood: opts.parentCarries ?? 1 });
    const child = makeOrganism('child', 2, 5, {
      age: opts.childAge ?? 10,
      lineage: { id: 'lin', parentId: opts.related === false ? 'someone-else' : 'parent', generation: 2, birthTick: 0 },
    });
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);
    return senseEnvironment(child, world.getSnapshot(), world.config);
  }

  it('senses its food-carrying parent separately from real food', () => {
    const sensed = childSensesParent({});
    expect(sensed.parentWithFood).toMatchObject({ x: 5, y: 5, distance: 3, value: 1 });
    expect(sensed.nearestFood).toBeNull();
  });

  it('ignores the parent when it carries nothing, after childhood, or if it is not the parent', () => {
    expect(childSensesParent({ parentCarries: 0 }).parentWithFood).toBeNull();
    expect(childSensesParent({ childAge: 800 }).parentWithFood).toBeNull();
    expect(childSensesParent({ related: false }).parentWithFood).toBeNull();
  });

  it('with a positive followFoodParent, a child walks to its parent and is fed', () => {
    const world = emptyWorld();
    // The parent is walled in on three sides and leans away from its child,
    // so it waits in place; only the child's approach brings them together.
    for (const cell of ['5,4', '5,6', '6,5']) world.obstacles.add(cell);
    const parent = makeOrganism('parent', 5, 5, {
      energy: 80,
      carriedFood: 2,
      policy: { ...NEUTRAL, careForChildren: 2, kinAffinity: -2 },
    });
    const child = makeOrganism('child', 2, 5, {
      energy: 20,
      policy: { ...NEUTRAL, followFoodParent: 1 },
      lineage: { id: 'lin', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);

    // The child starts 3 cells away, so it can only be fed by walking over.
    let closest = Infinity;
    for (let t = 0; t < 4; t++) {
      world.step();
      closest = Math.min(closest, Math.abs(child.x - parent.x) + Math.abs(child.y - parent.y));
    }

    expect(closest).toBe(1);
    expect(child.foodReceived).toBeGreaterThan(0);
  });
});

describe('Food-first head starts (evolvable)', () => {
  function decide(org: Organism, setup?: (world: World) => void) {
    const world = emptyWorld();
    setup?.(world);
    world.organisms.set(org.id, org);
    world.step();
    return org.recentHistory[0];
  }
  const foodFirst = { eatPriority: 2, hungerUrgency: 2 };

  it('with a high eat priority, eats over reproducing, picking up and moving', () => {
    const d = decide(
      makeOrganism('o', 5, 5, {
        energy: 70,
        policy: { ...NEUTRAL, ...foodFirst, reproduceDrive: 2, forageDrive: 2, foodAttraction: 2, exploreTendency: 2 },
      }),
      (w) => {
        w.config.reproductionThreshold = 60;
        w.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
        w.foodPatches.set('7,5', { x: 7, y: 5, stock: 3, capacity: 3 });
      }
    );
    expect(d.chosenAction.type).toBe('EAT');
    const repro = d.scores.find((s) => s.action.type.startsWith('REPRODUCE_'))!;
    expect(repro.components.eatPriority).toBe(-40); // pushed down by 2 × 20
  });

  it('with a high eat priority, eats food underfoot rather than walking to other food', () => {
    const d = decide(
      makeOrganism('o', 5, 5, { energy: 20, policy: { ...NEUTRAL, ...foodFirst, eatDrive: 0.5 } }),
      (w) => {
        w.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
        w.foodPatches.set('7,5', { x: 7, y: 5, stock: 3, capacity: 3 });
      }
    );
    expect(d.chosenAction.type).toBe('EAT');
  });

  it('with a negative eat priority, may skip a meal for something else', () => {
    const d = decide(
      makeOrganism('o', 5, 5, {
        energy: 70,
        policy: { ...NEUTRAL, eatPriority: -2, reproduceDrive: 2 },
      }),
      (w) => {
        w.config.reproductionThreshold = 60;
        w.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
      }
    );
    expect(d.chosenAction.type.startsWith('REPRODUCE_')).toBe(true);
  });

  it('only eats with room for a full meal', () => {
    const fullish = decide(makeOrganism('o', 5, 5, { energy: 80 }), (w) =>
      w.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 })
    );
    expect(fullish.scores.some((s) => s.action.type === 'EAT')).toBe(false);
  });

  it('never pushes down feeding one’s own hungry child', () => {
    const world = emptyWorld();
    const parent = makeOrganism('parent', 5, 5, {
      energy: 30,
      carriedFood: 1,
      policy: { ...NEUTRAL, ...foodFirst, careForChildren: 2, eatDrive: 0.5, shareWithKin: 2 },
    });
    const child = makeOrganism('child', 6, 5, {
      energy: 5,
      lineage: { id: 'lin', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    const stranger = makeOrganism('stranger', 4, 5, { energy: 5 });
    for (const o of [parent, child, stranger]) world.organisms.set(o.id, o);
    world.step();
    const d = parent.recentHistory[0];
    expect(d.chosenAction.type).toBe('GIVE_EAST');
    const toChild = d.scores.find((s) => s.action.type === 'GIVE_EAST')!;
    const toStranger = d.scores.find((s) => s.action.type === 'GIVE_WEST')!;
    expect('eatPriority' in toChild.components).toBe(false);
    expect(toStranger.components.eatPriority).toBe(-40);
  });

  it('hunger urgency steers a hungry organism to food against its own aversion', () => {
    const choice = (energy: number, hungerUrgency: number) =>
      decide(
        makeOrganism('o', 3, 5, {
          energy,
          policy: { ...NEUTRAL, foodAttraction: -2, crowdingAvoidance: 2, hungerUrgency },
        }),
        (w) => w.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 })
      ).chosenAction.type;
    expect(choice(30, 2)).toBe('MOVE_EAST'); // hungry and urgent: goes for food
    expect(choice(70, 2)).not.toBe('MOVE_EAST'); // fed: urgency does not apply
    expect(choice(30, 0)).not.toBe('MOVE_EAST'); // no urgency evolved: aversion wins
  });
});

describe('Immigration', () => {
  it('adds founders with new lineages at the configured interval', () => {
    const world = emptyWorld({ immigrationInterval: 10, immigrationCount: 2 });
    for (let t = 0; t < 30; t++) world.step();
    expect(world.immigrantsTotal).toBe(6);
    const lineages = new Set(Array.from(world.organisms.values(), (o) => o.lineage.id));
    expect(lineages.size).toBe(world.organisms.size);
    for (const o of world.organisms.values()) {
      expect(o.lineage.parentId).toBeNull();
      expect(o.lineage.birthTick).toBeGreaterThan(0);
    }
  });

  it('is off when the interval is 0', () => {
    const world = emptyWorld({ immigrationInterval: 0 });
    for (let t = 0; t < 60; t++) world.step();
    expect(world.immigrantsTotal).toBe(0);
    expect(world.organisms.size).toBe(0);
  });
});

describe('Kin affinity', () => {
  it('moves a positive-affinity organism toward a look-alike and a negative one away', () => {
    for (const [affinity, expected] of [
      [2, 'MOVE_EAST'],
      [-2, 'MOVE_WEST'],
    ] as const) {
      const world = emptyWorld({ sharingEnabled: false });
      const mover = makeOrganism('mover', 3, 5, { tag: 50, policy: { ...NEUTRAL, kinAffinity: affinity } });
      const lookAlike = makeOrganism('look-alike', 6, 5, { tag: 55 });
      world.organisms.set(mover.id, mover);
      world.organisms.set(lookAlike.id, lookAlike);

      world.step();

      expect(mover.recentHistory[0].chosenAction.type).toBe(expected);
    }
  });
});

describe('Tribe metrics', () => {
  it('finds separate groups of nearby look-alikes and measures clustering above chance', () => {
    const organisms: Organism[] = [];
    // Two tight groups of 6 with very different tags, far apart.
    for (let i = 0; i < 6; i++) {
      organisms.push(makeOrganism(`a${i}`, 1 + (i % 3), 1 + Math.floor(i / 3), { tag: 10 }));
      organisms.push(makeOrganism(`b${i}`, 20 + (i % 3), 20 + Math.floor(i / 3), { tag: 200 }));
    }
    // A loner that looks like group A but lives far away.
    organisms.push(makeOrganism('loner', 10, 25, { tag: 12 }));

    const m = computeTribeMetrics(organisms, DEFAULT_CONFIG);
    expect(m.tribeCount).toBe(2);
    expect(m.largestTribe).toBe(6);
    expect(m.inTribeFraction).toBeCloseTo(12 / 13, 2);
    expect(m.localKinFraction).toBe(1);
    expect(m.globalKinFraction).toBeLessThan(0.6);
  });

  it('does not count a mixed crowd of strangers as a tribe', () => {
    // Six neighbours whose tags are all at least 60° apart (at most 67% alike).
    const organisms = Array.from({ length: 6 }, (_, i) =>
      makeOrganism(`m${i}`, i % 3, Math.floor(i / 3), { tag: i * 60 })
    );
    const m = computeTribeMetrics(organisms, DEFAULT_CONFIG);
    expect(m.tribeCount).toBe(0);
    expect(m.localKinFraction).toBe(0);
  });
});

describe('Long run with sharing', () => {
  it('keeps energy and tags within bounds and never puts two organisms in one cell', () => {
    const world = new World({ seed: 'tribes-invariants' });
    const violations: string[] = [];
    for (let t = 0; t < 600; t++) {
      world.step();
      const cells = new Set<string>();
      for (const o of world.organisms.values()) {
        const key = `${o.x},${o.y}`;
        if (!(o.energy > 0 && o.energy <= world.config.maxEnergy)) violations.push(`energy ${o.energy}`);
        if (!(o.tag >= 0 && o.tag < 360)) violations.push(`tag ${o.tag}`);
        if (!(o.carriedFood >= 0 && o.carriedFood <= o.carryCapacity)) {
          violations.push(`carried ${o.carriedFood}`);
        }
        if (cells.has(key)) violations.push(`overlap at ${key}`);
        cells.add(key);
      }
    }
    expect(violations).toEqual([]);
   }, 30_000);
});
