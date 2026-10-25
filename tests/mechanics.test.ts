import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { mutatePolicy } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
import type { Organism, SimulationConfig } from '../src/sim/types';
import { DEFAULT_CONFIG } from '../src/sim/config';

describe('Artificial Life Core Mechanics', () => {
  it('1. World initialization with a fixed seed is completely deterministic', () => {
    const world1 = new World({ seed: 777 });
    const world2 = new World({ seed: 777 });

    expect(world1.obstacles.size).toBe(world2.obstacles.size);
    expect(Array.from(world1.obstacles).sort()).toEqual(
      Array.from(world2.obstacles).sort()
    );

    expect(world1.foodPatches.size).toBe(world2.foodPatches.size);
    expect(world1.organisms.size).toBe(world2.organisms.size);

    const orgs1 = Array.from(world1.organisms.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const orgs2 = Array.from(world2.organisms.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    for (let i = 0; i < orgs1.length; i++) {
      expect(orgs1[i].id).toBe(orgs2[i].id);
      expect(orgs1[i].x).toBe(orgs2[i].x);
      expect(orgs1[i].y).toBe(orgs2[i].y);
      expect(orgs1[i].energy).toBe(orgs2[i].energy);
      expect(orgs1[i].policy).toEqual(orgs2[i].policy);
      expect(orgs1[i].lineage).toEqual(orgs2[i].lineage);
    }
  });

  it('2. Energy bounds and action costs', () => {
    const world = new World({
      seed: 101,
      initialOrganisms: 1,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      tickMetabolismCost: 1.0,
      carryUpkeep: 0, // isolate base metabolism
      moveCost: 2.0,
      maxEnergy: 50,
      initialEnergy: 10,
    });

    const org = Array.from(world.organisms.values())[0];
    expect(org.energy).toBe(10);

    // Let's place an obstacle directly in front to block it
    world.obstacles.add(`${org.x + 1},${org.y}`);
    world.obstacles.add(`${org.x - 1},${org.y}`);
    world.obstacles.add(`${org.x},${org.y + 1}`);
    world.obstacles.add(`${org.x},${org.y - 1}`);

    // Org cannot move; must rest. It pays tick metabolism (1.0), but not move cost (2.0)
    world.step();
    const afterStep1 = world.getOrganism(org.id);
    expect(afterStep1).toBeDefined();
    expect(afterStep1!.energy).toBe(9.0);

    // Let energy drop to 0
    for (let t = 0; t < 9; t++) {
      world.step();
    }
    // Org should die and be removed from world
    expect(world.getOrganism(org.id)).toBeUndefined();
    expect(world.deathsTotal).toBe(1);
  });

  it('3. Illegal movement and obstacle blocking', () => {
    const world = new World({
      seed: 42,
      gridWidth: 10,
      gridHeight: 10,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      obstacleDensity: 0,
    });

    // Place an organism at the corner (0, 0)
    const org: Organism = {
      id: 'test-org-1',
      x: 0,
      y: 0,
      energy: 50,
      policy: {
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
      },
      lineage: { id: 'lineage-1', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      tag: 0,
      carryCapacity: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      recentHistory: [],
    };
    world.organisms.set(org.id, org);

    // Add obstacles to East (1, 0) and South (0, 1)
    world.obstacles.add('1,0');
    world.obstacles.add('0,1');

    const snapshot = world.getSnapshot();
    const sensed = senseEnvironment(org, snapshot, world.config);

    // Sensed obstacles include the map boundary (-1, 0) and (0, -1) as well as (1, 0) and (0, 1)
    expect(sensed.nearestObstacle).toBeDefined();

    world.step();

    // Organism could not move North (y < 0), West (x < 0), East (obstacle), or South (obstacle)
    // Thus it stayed at (0, 0)
    const afterOrg = world.getOrganism('test-org-1');
    expect(afterOrg).toBeDefined();
    expect(afterOrg!.x).toBe(0);
    expect(afterOrg!.y).toBe(0);
    expect(afterOrg!.recentHistory[0].chosenAction.type).toBe('REST');
  });

  it('4. Finite food consumption and regeneration', () => {
    const world = new World({
      seed: 99,
      gridWidth: 10,
      gridHeight: 10,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      foodRegenInterval: 3,
      foodRegenAmount: 2,
      foodSpawnInterval: 9999, // disable spawning
      foodEnergyYield: 20,
      maxEnergy: 100,
    });

    // Add a food patch at (5, 5) with stock 2, capacity 5
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 2, capacity: 5 });

    // Place an organism on (5, 5) with hunger and high eatDrive
    const org: Organism = {
      id: 'hungry-org',
      x: 5,
      y: 5,
      energy: 40,
      policy: {
        foodAttraction: 0,
        obstacleAvoidance: 0,
        crowdingAvoidance: 0,
        exploreTendency: 0,
        eatDrive: 2.0, // strong drive to eat
        reproduceDrive: -1.0,
        kinAffinity: 0,
        shareWithKin: 0,
        shareWithStrangers: 0,
        careForChildren: 0,
        forageDrive: 0,
        eatPriority: 0,
        hungerUrgency: 0,
        followFoodParent: 0,
      },
      lineage: { id: 'lineage-1', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      tag: 0,
      carryCapacity: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      recentHistory: [],
    };
    world.organisms.set(org.id, org);

    // Step 1: organism eats 1 unit of food
    world.step();
    const patchAfterEat1 = world.foodPatches.get('5,5')!;
    expect(patchAfterEat1.stock).toBe(1);
    expect(org.energy).toBeGreaterThan(40);
    expect(org.foodEatenCount).toBe(1);

    // Step 2: organism eats second unit of food
    world.step();
    const patchAfterEat2 = world.foodPatches.get('5,5')!;
    expect(patchAfterEat2.stock).toBe(0);

    // Step 3 (tick 3): food regeneration triggers!
    world.step();
    const patchAfterRegen = world.foodPatches.get('5,5')!;
    expect(patchAfterRegen.stock).toBe(2); // regenerated by 2
  });

  it('5. Fair conflict resolution when two organisms claim the same cell', () => {
    const world = new World({
      seed: 1234,
      gridWidth: 10,
      gridHeight: 10,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      tickMetabolismCost: 0.1,
      moveCost: 1.0,
    });

    // Place Org A at (4, 5) and Org B at (6, 5)
    // Place a food patch at (5, 5) so both are attracted to move to (5, 5)
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 10, capacity: 10 });

    const orgA: Organism = {
      id: 'org-A',
      x: 4,
      y: 5,
      energy: 50,
      policy: {
        foodAttraction: 2.0,
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
      },
      lineage: { id: 'lin-A', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      tag: 0,
      carryCapacity: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      recentHistory: [],
    };

    const orgB: Organism = {
      id: 'org-B',
      x: 6,
      y: 5,
      energy: 50,
      policy: {
        foodAttraction: 2.0,
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
      },
      lineage: { id: 'lin-B', parentId: null, generation: 1, birthTick: 0 },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      tag: 0,
      carryCapacity: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      recentHistory: [],
    };

    world.organisms.set(orgA.id, orgA);
    world.organisms.set(orgB.id, orgB);

    // Step 1: Both choose to move into (5, 5)
    world.step();

    const afterA = world.getOrganism('org-A')!;
    const afterB = world.getOrganism('org-B')!;

    // Exactly one must be at (5, 5) and the other must remain at its starting cell
    const winnerAt55 = (afterA.x === 5 && afterA.y === 5) || (afterB.x === 5 && afterB.y === 5);
    expect(winnerAt55).toBe(true);
    expect(afterA.x === 5 && afterB.x === 5).toBe(false); // They cannot both occupy (5, 5)

    if (afterA.x === 5) {
      // Org A won
      expect(afterB.x).toBe(6);
      expect(afterB.recentHistory[0].outcome).toBe('conflict_lost');
      // Org B was not charged moveCost (only metabolism)
      expect(afterB.energy).toBeCloseTo(49.9, 1);
      // Org A paid moveCost + metabolism
      expect(afterA.energy).toBeCloseTo(48.9, 1);
    } else {
      // Org B won
      expect(afterA.x).toBe(4);
      expect(afterA.recentHistory[0].outcome).toBe('conflict_lost');
      expect(afterA.energy).toBeCloseTo(49.9, 1);
      expect(afterB.energy).toBeCloseTo(48.9, 1);
    }
  });

  it('6. Reproduction energy transfer and adjacent-cell rules', () => {
    const world = new World({
      seed: 42,
      gridWidth: 10,
      gridHeight: 10,
      initialOrganisms: 0,
      initialFoodPatches: 0,
      obstacleDensity: 0,
      reproductionThreshold: 60,
      reproductionEnergyFraction: 0.4,
      reproductionMetabolismTax: 5,
      tickMetabolismCost: 0,
    });

    const parent: Organism = {
      id: 'parent-1',
      x: 5,
      y: 5,
      energy: 80,
      policy: {
        foodAttraction: 0,
        obstacleAvoidance: 0,
        crowdingAvoidance: 0,
        exploreTendency: 0,
        eatDrive: 0,
        reproduceDrive: 2.0, // High drive to reproduce
        kinAffinity: 0,
        shareWithKin: 0,
        shareWithStrangers: 0,
        careForChildren: 0,
        forageDrive: 0,
        eatPriority: 0,
        hungerUrgency: 0,
        followFoodParent: 0,
      },
      lineage: { id: 'clan-alpha', parentId: null, generation: 1, birthTick: 0 },
      age: 5,
      offspringCount: 0,
      foodEatenCount: 0,
      tag: 0,
      carryCapacity: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      recentHistory: [],
    };

    world.organisms.set(parent.id, parent);

    world.step();

    // Population should now be 2 (parent + offspring)
    expect(world.organisms.size).toBe(2);
    expect(parent.offspringCount).toBe(1);

    // Find the offspring
    const offspring = Array.from(world.organisms.values()).find(
      (o) => o.id !== 'parent-1'
    )!;
    expect(offspring).toBeDefined();

    // Check offspring properties
    expect(offspring.lineage.id).toBe('clan-alpha');
    expect(offspring.lineage.parentId).toBe('parent-1');
    expect(offspring.lineage.generation).toBe(2);
    expect(offspring.age).toBe(0);

    // Expected energy transfer:
    // childEnergy = floor(80 * 0.4) = 32
    // tax = 5
    // parentRemaining = 80 - 32 - 5 = 43
    expect(offspring.energy).toBe(32);
    expect(parent.energy).toBe(43);

    // Offspring must be in an adjacent cell (distance == 1)
    const dist = Math.abs(offspring.x - parent.x) + Math.abs(offspring.y - parent.y);
    expect(dist).toBe(1);
  });

  it('7. Inheritance and mutation rules', () => {
    const prng = new PRNG(12345);
    const parentPolicy = {
      foodAttraction: 1.0,
      obstacleAvoidance: 0.8,
      crowdingAvoidance: 0.2,
      exploreTendency: 0.5,
      eatDrive: 1.2,
      reproduceDrive: 0.9,
      kinAffinity: 0,
      shareWithKin: 0,
      shareWithStrangers: 0,
      careForChildren: 0,
      forageDrive: 0,
      eatPriority: 0,
      hungerUrgency: 0,
      followFoodParent: 0,
    };

    // If mutation rate is 0, offspring policy is strictly identical to parent
    const unmutated = mutatePolicy(
      parentPolicy,
      { ...DEFAULT_CONFIG, mutationRate: 0.0 },
      prng
    );
    expect(unmutated).toEqual(parentPolicy);

    // If mutation rate is 1.0, all weights are mutated and clamped
    const mutated = mutatePolicy(
      parentPolicy,
      { ...DEFAULT_CONFIG, mutationRate: 1.0, mutationStdDev: 0.3 },
      prng
    );
    expect(mutated).not.toEqual(parentPolicy);
    for (const key of Object.keys(parentPolicy) as (keyof typeof parentPolicy)[]) {
      expect(mutated[key]).toBeGreaterThanOrEqual(-2.0);
      expect(mutated[key]).toBeLessThanOrEqual(2.0);
    }
  });

  it('8. Identical outcomes for repeated multi-tick seeded runs', () => {
    const config: Partial<SimulationConfig> = {
      seed: 'antigravity-determinism-check',
      initialOrganisms: 15,
      initialFoodPatches: 20,
      gridWidth: 20,
      gridHeight: 20,
    };

    const run1 = new World(config);
    const run2 = new World(config);

    // Step both simulations for 35 ticks
    for (let tick = 0; tick < 35; tick++) {
      run1.step();
      run2.step();
    }

    expect(run1.tick).toBe(run2.tick);
    expect(run1.birthsTotal).toBe(run2.birthsTotal);
    expect(run1.deathsTotal).toBe(run2.deathsTotal);
    expect(run1.organisms.size).toBe(run2.organisms.size);

    const orgs1 = Array.from(run1.organisms.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    const orgs2 = Array.from(run2.organisms.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    for (let i = 0; i < orgs1.length; i++) {
      expect(orgs1[i].id).toBe(orgs2[i].id);
      expect(orgs1[i].x).toBe(orgs2[i].x);
      expect(orgs1[i].y).toBe(orgs2[i].y);
      expect(orgs1[i].energy).toBe(orgs2[i].energy);
      expect(orgs1[i].age).toBe(orgs2[i].age);
      expect(orgs1[i].offspringCount).toBe(orgs2[i].offspringCount);
      expect(orgs1[i].policy).toEqual(orgs2[i].policy);
    }

    // Check food patches
    expect(run1.foodPatches.size).toBe(run2.foodPatches.size);
    for (const [key, patch1] of run1.foodPatches) {
      const patch2 = run2.foodPatches.get(key)!;
      expect(patch2).toBeDefined();
      expect(patch1.stock).toBe(patch2.stock);
    }

    // Check metrics
    expect(run1.metrics).toEqual(run2.metrics);
  });

  it('9. Extended multi-generation run demonstrates continuous life cycle', () => {
    const world = new World({ seed: 42 });
    const initialPop = world.organisms.size;
    expect(initialPop).toBeGreaterThanOrEqual(15);

    // Run for 150 ticks
    for (let t = 0; t < 150; t++) {
      world.step();
    }

    // Organisms must have found food and eaten
    const livingOrgs = Array.from(world.organisms.values());
    const totalFoodEaten = livingOrgs.reduce((sum, o) => sum + o.foodEatenCount, 0);
    expect(totalFoodEaten).toBeGreaterThan(0);

    // Reproduction must have occurred and produced next generation(s)
    expect(world.birthsTotal).toBeGreaterThan(initialPop);
    expect(world.metrics.maxGeneration).toBeGreaterThanOrEqual(2);

    // Deaths must have occurred naturally
    expect(world.deathsTotal).toBeGreaterThan(0);

    // Diversity metrics are actively populated
    expect(world.metrics.diversity.averageDiversity).toBeGreaterThan(0);
  });
});
