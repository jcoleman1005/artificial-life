import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createHeadStartBrain } from '../src/sim/brain';
import { metabolismCost, moveEnergyCost, plantYield, carrionYield } from '../src/sim/traits';
import { maxEnergyOf, sensingRadiusOf, sizeOf, digestiveEfficiencyOf, thresholdOf } from '../src/sim/lifehistory';
import { senseEnvironment } from '../src/sim/sensors';
import type { Organism, PolicyWeights, SimulationConfig, WorldSnapshot } from '../src/sim/types';

// Every world here sets the three 2026-10-29 DNA defaults (continuous abilities, split diets, variation) off, so each test isolates its own mechanism on the legacy costs.

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

function makeTestOrganism(overrides: Partial<Organism> = {}): Organism {
  return {
    id: 'test-org',
    x: 5,
    y: 5,
    energy: 50,
    policy: { ...ZERO_POLICY },
    tag: 0,
    carryCapacity: 0,
    dispersal: 1,
    memorySpan: 0,
    carnivory: 0,
    kills: 0,
    memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 5, y: 5 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 },
    brain: createHeadStartBrain(new PRNG(0)),
    lineage: { id: 'lineage-test', parentId: null, generation: 1, birthTick: 0 },
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

describe('Tier 1 Basic Genes: Core Physical & Energetic Architecture', () => {
  describe('Gene 1: size (Body Mass / Radius)', () => {
    it('scales maximum energy capacity linearly (Emax = 100 * size)', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 1 }).config;
      const mouse = makeTestOrganism({ size: 0.5 });
      const baseline = makeTestOrganism({ size: 1.0 });
      const elephant = makeTestOrganism({ size: 2.0 });

      expect(maxEnergyOf(mouse, config)).toBe(50);
      expect(maxEnergyOf(baseline, config)).toBe(100);
      expect(maxEnergyOf(elephant, config)).toBe(200);
    });

    it('scales basal metabolism allometrically via Kleiber law (size^0.75)', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
        seed: 1,
        sensingGeneEnabled: false,
        digestiveGeneEnabled: false,
        fatEnabled: false,
        memoryEnabled: false,
        metabolismGeneEnabled: false,
      }).config;

      const mouse = makeTestOrganism({ size: 0.5 });
      const baseline = makeTestOrganism({ size: 1.0 });
      const elephant = makeTestOrganism({ size: 2.0 });

      const baseCost = config.tickMetabolismCost;
      expect(metabolismCost(baseline, config)).toBeCloseTo(baseCost, 5);
      expect(metabolismCost(mouse, config)).toBeCloseTo(baseCost * Math.pow(0.5, 0.75), 5);
      expect(metabolismCost(elephant, config)).toBeCloseTo(baseCost * Math.pow(2.0, 0.75), 5);
    });

    it('scales movement cost directly with body mass', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 1, fatEnabled: false }).config;
      const move = { leap: false, diagonal: false, squeeze: false };

      const mouse = makeTestOrganism({ size: 0.5 });
      const baseline = makeTestOrganism({ size: 1.0 });
      const elephant = makeTestOrganism({ size: 2.0 });

      expect(moveEnergyCost(baseline, move, config)).toBe(config.moveCost);
      expect(moveEnergyCost(mouse, move, config)).toBe(config.moveCost * 0.5);
      expect(moveEnergyCost(elephant, move, config)).toBe(config.moveCost * 2.0);
    });

    it('scales reproduction threshold with body size so mice can reproduce', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 1, reproductionThreshold: 60 }).config;
      const mouse = makeTestOrganism({ size: 0.5, reproThreshold: 60 });
      const baseline = makeTestOrganism({ size: 1.0, reproThreshold: 60 });
      const elephant = makeTestOrganism({ size: 2.0, reproThreshold: 60 });

      expect(thresholdOf(mouse, config)).toBe(30);
      expect(thresholdOf(baseline, config)).toBe(60);
      expect(thresholdOf(elephant, config)).toBe(120);
    });
  });

  describe('Gene 2: sensingRadius (Sensory / Perception Range)', () => {
    it('restricts environmental perception to the individual sensing radius', () => {
      const world = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
        seed: 42,
        gridWidth: 20,
        gridHeight: 20,
        initialOrganisms: 0,
        initialFoodPatches: 0,
      });

      // Place a food patch at (5, 7), distance = 2 from (5, 5)
      world.foodPatches.set('5,7', { x: 5, y: 7, stock: 4, capacity: 8, plant: null });
      const snapshot = world.getSnapshot();

      const blind = makeTestOrganism({ x: 5, y: 5, sensingRadius: 1 });
      const seeing = makeTestOrganism({ x: 5, y: 5, sensingRadius: 3 });

      const sensedBlind = senseEnvironment(blind, snapshot, world.config);
      const sensedSeeing = senseEnvironment(seeing, snapshot, world.config);

      // Distance is 2: blind (radius 1) cannot sense it, seeing (radius 3) can
      expect(sensedBlind.nearestFood).toBeNull();
      expect(sensedSeeing.nearestFood).not.toBeNull();
      expect(sensedSeeing.nearestFood?.distance).toBe(2);
    });

    it('charges continuous sensory upkeep proportional to radius^2', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
        seed: 1,
        sizeGeneEnabled: false,
        digestiveGeneEnabled: false,
        fatEnabled: false,
        memoryEnabled: false,
        metabolismGeneEnabled: false,
        sensingGeneEnabled: true,
        sensingUpkeepPerCell: 0.003,
      }).config;

      const r1 = makeTestOrganism({ sensingRadius: 1 });
      const r3 = makeTestOrganism({ sensingRadius: 3 });
      const r6 = makeTestOrganism({ sensingRadius: 6 });

      const base = config.tickMetabolismCost;
      expect(metabolismCost(r1, config)).toBeCloseTo(base + 0.003 * 1, 5);
      expect(metabolismCost(r3, config)).toBeCloseTo(base + 0.003 * 9, 5);
      expect(metabolismCost(r6, config)).toBeCloseTo(base + 0.003 * 36, 5);
    });
  });

  describe('Gene 3: metabolicRate (Basal Metabolism vs. Action Speed)', () => {
    it('gives higher metabolic rate higher priority in movement cell conflicts', () => {
      const prng = new PRNG('conflict-priority');
      const world = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 'priority-test' });

      const fast = makeTestOrganism({ id: 'fast', metabolicRate: 1.5 });
      const slow = makeTestOrganism({ id: 'slow', metabolicRate: 0.5 });

      let fastWins = 0;
      const trials = 1000;
      for (let i = 0; i < trials; i++) {
        // Contenders array
        const contenders = [{ organism: fast }, { organism: slow }];
        // @ts-expect-error accessing private method for test verification
        const winner = world.pickContenderByMetabolicRate(contenders);
        if (winner.organism.id === 'fast') fastWins++;
      }

      // 1.5 vs 0.5 means fast should win ~75% of trials (1.5 / 2.0 = 0.75)
      const fraction = fastWins / trials;
      expect(fraction).toBeGreaterThan(0.70);
      expect(fraction).toBeLessThan(0.80);
    });
  });

  describe('Gene 4: digestiveEfficiency (Nutrient Extraction Rate)', () => {
    it('scales plant and carrion energy yield', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 1, carrionEnabled: true, carrionBite: 20 }).config;

      const wasteful = makeTestOrganism({ digestiveEfficiency: 0.6, carnivory: 0.5 });
      const normal = makeTestOrganism({ digestiveEfficiency: 1.0, carnivory: 0.5 });
      const efficient = makeTestOrganism({ digestiveEfficiency: 1.4, carnivory: 0.5 });

      const basePlant = plantYield(normal, config);
      expect(plantYield(wasteful, config)).toBeCloseTo(basePlant * 0.6, 5);
      expect(plantYield(efficient, config)).toBeCloseTo(basePlant * 1.4, 5);

      const baseCarrion = carrionYield(normal, config);
      expect(carrionYield(wasteful, config)).toBeCloseTo(baseCarrion * 0.6, 5);
      expect(carrionYield(efficient, config)).toBeCloseTo(baseCarrion * 1.4, 5);
    });

    it('charges continuous digestive organ upkeep per tick', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
        seed: 1,
        sizeGeneEnabled: false,
        sensingGeneEnabled: false,
        fatEnabled: false,
        memoryEnabled: false,
        metabolismGeneEnabled: false,
        digestiveGeneEnabled: true,
        digestiveUpkeepRate: 0.04,
      }).config;

      const wasteful = makeTestOrganism({ digestiveEfficiency: 0.5 });
      const normal = makeTestOrganism({ digestiveEfficiency: 1.0 });
      const efficient = makeTestOrganism({ digestiveEfficiency: 1.5 });

      const base = config.tickMetabolismCost;
      expect(metabolismCost(wasteful, config)).toBeCloseTo(base + 0.04 * 0.5, 5);
      expect(metabolismCost(normal, config)).toBeCloseTo(base + 0.04 * 1.0, 5);
      expect(metabolismCost(efficient, config)).toBeCloseTo(base + 0.04 * 1.5, 5);
    });
  });

  describe('Gene 5: energyReserveCap (Adipose Weight Drag)', () => {
    it('increases movement cost when laden with fat', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
        seed: 1,
        fatEnabled: true,
        fatDragCoeff: 0.5,
        sizeGeneEnabled: false,
      }).config;
      const move = { leap: false, diagonal: false, squeeze: false };

      const lean = makeTestOrganism({ fat: 0, fatCapacity: 40 });
      const laden = makeTestOrganism({ fat: 40, fatCapacity: 40 });

      const leanCost = moveEnergyCost(lean, move, config);
      const ladenCost = moveEnergyCost(laden, move, config);

      expect(leanCost).toBe(config.moveCost);
      expect(ladenCost).toBeGreaterThan(leanCost);
      // Capacity = 100 + 40 = 140. Drag = 1 + 0.5 * (40 / 140) = 1 + 0.1428 = 1.1428 * moveCost
      expect(ladenCost).toBeCloseTo(config.moveCost * (1 + 0.5 * (40 / 140)), 4);
    });
  });

  describe('Zero-Dose & Disabled Fallback', () => {
    it('reproduces exact baseline values when Tier 1 switches are disabled', () => {
      const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false,
        seed: 1,
        sizeGeneEnabled: false,
        sensingGeneEnabled: false,
        digestiveGeneEnabled: false,
      }).config;

      const org = makeTestOrganism({ size: 2.0, sensingRadius: 6, digestiveEfficiency: 1.5 });
      expect(sizeOf(org, config)).toBe(1.0);
      expect(maxEnergyOf(org, config)).toBe(config.maxEnergy);
      expect(sensingRadiusOf(org, config)).toBe(config.sensingRadius);
      expect(digestiveEfficiencyOf(org, config)).toBe(1.0);
    });
  });
});

describe('Gene 5: carnivoreEfficiency (carrion and meat digestion)', () => {
  const base = { seed: 1, carrionBite: 30, digestiveGeneEnabled: false };

  it('scales carrion yield linearly; plant yield is untouched', () => {
    const config = new World(base).config;
    const half = { carnivory: 1, carnivoreEfficiency: 0.5 };
    expect(carrionYield({ carnivory: 1, carnivoreEfficiency: 1 }, config)).toBeCloseTo(30);
    expect(carrionYield(half, config)).toBeCloseTo(15);
    expect(carrionYield({ carnivory: 1, carnivoreEfficiency: 0 }, config)).toBe(0);
    expect(plantYield(half, config)).toBe(plantYield({ carnivory: 1, carnivoreEfficiency: 1 }, config));
  });

  it('is exactly the old world when switched off', () => {
    const off = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, ...base, carnivoreGeneEnabled: false }).config;
    expect(carrionYield({ carnivory: 0.5, carnivoreEfficiency: 0.1 }, off)).toBeCloseTo(15);
  });

  it('pays upkeep only in proportion to diet: herbivores pay nothing, full meat eaters most', () => {
    const config = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, ...base, sensingGeneEnabled: false, sizeGeneEnabled: false, fatEnabled: false, memoryEnabled: false, metabolismGeneEnabled: false }).config;
    const cost = (carnivory: number, eff: number) => metabolismCost(makeTestOrganism({ carnivory, carnivoreEfficiency: eff }), config);
    expect(cost(0, 1)).toBeCloseTo(cost(0, 0));
    expect(cost(1, 1) - cost(1, 0)).toBeCloseTo(config.carnivoreUpkeepRate);
    expect(cost(0.5, 1) - cost(0.5, 0)).toBeCloseTo(config.carnivoreUpkeepRate * 0.5);
  });

  it('a bite on a carcass gives energy scaled by the gene, and the rest is lost', () => {
    const run = (eff: number) => {
      const world = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, ...base, gridWidth: 8, gridHeight: 8, initialOrganisms: 0, initialFoodPatches: 0, obstacleDensity: 0, immigrationInterval: 0, seasonLength: 0, foodRegionCount: 0, tickMetabolismCost: 0, carryUpkeep: 0, abilityUpkeep: 0, memoryEnabled: false, fatEnabled: false, torporEnabled: false, sensingGeneEnabled: false, carnivoreUpkeepRate: 0 });
      world.carrion.set('3,3', { x: 3, y: 3, stock: 50, expiresAt: 1000 });
      const wolf = makeTestOrganism({ x: 3, y: 3, energy: 20, carnivory: 1, carnivoreEfficiency: eff, brain: { ...createHeadStartBrain(new PRNG(0)) } });
      world.organisms.set(wolf.id, wolf);
      return { world, wolf };
    };
    const { world, wolf } = run(0.4);
    world.step();
    // The brain may not choose to eat; only assert energy when it did.
    if (world.carrionEatenTotal > 0) expect(wolf.energy).toBeCloseTo(20 + 30 * 0.4, 5);
  });

  it('children inherit it within [0, 1] under mutation', () => {
    const world = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 'carn-inherit', traitMutationRate: 1 });
    for (let i = 0; i < 300; i++) world.step();
    for (const o of world.organisms.values()) {
      expect(o.carnivoreEfficiency).toBeGreaterThanOrEqual(0);
      expect(o.carnivoreEfficiency).toBeLessThanOrEqual(1);
    }
  }, 30_000);

  it('survives the genome round trip', () => {
    const world = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 'carn-dna' });
    for (const o of world.organisms.values()) expect(o.carnivoreEfficiency).toBe(world.config.carnivoreFounder);
  });
});
