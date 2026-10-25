import type { SimulationConfig } from './types';

/**
 * Sensible default configuration for the artificial life simulation.
 * Sized and balanced for mobile viewport clarity and viable evolutionary dynamics.
 */
export const DEFAULT_CONFIG: Readonly<SimulationConfig> = {
  gridWidth: 60,
  gridHeight: 60,
  obstacleDensity: 0.07,
  initialFoodPatches: 44,
  foodPatchCapacity: 8,
  foodPatchInitialStock: 4,
  foodEnergyYield: 25,
  foodRegenInterval: 4,
  foodRegenAmount: 1,
  foodSpawnInterval: 12,
  foodSpawnCount: 4,
  maxFoodPatches: 72,
  windfallsEnabled: false, // off until measured against a control
  windfallInterval: 150,
  windfallUnits: 40,
  windfallPatches: 5,
  windfallLifetime: 120,
  foodRegionCount: 4,
  foodRegionRadius: 8,
  staggeredSeasons: true, // Lean seasons sweep from region to region
  initialOrganisms: 30,
  maxEnergy: 100,
  initialEnergy: 50,
  moveCost: 1.0, // Only deducted on successful movement
  tickMetabolismCost: 0.25, // Base living cost per tick
  reproductionThreshold: 65,
  reproductionEnergyFraction: 0.45,
  reproductionMetabolismTax: 5.0,
  mutationRate: 0.25,
  mutationStdDev: 0.15,
  sensingRadius: 3,
  tagMutationRate: 0.2,
  tagMutationStdDev: 8,
  kinSimilarity: 0.75,
  strangerSimilarity: 0.25,
  sharingEnabled: true,
  carryUpkeep: 0.03,
  maxCarryCapacity: 6,
  dispersalEnabled: true,
  maxDispersal: 8,
  dispersalCost: 1.0, // the same as one move
  memoryEnabled: false, // off until measured against a control
  maxMemorySpan: 100,
  memorySpanStep: 5,
  memoryUpkeep: 0.001, // a 50-tick memory costs 0.05 per tick (a fifth of base metabolism)
  traitMutationRate: 0.1,
  diagonalMoves: true,
  diagonalMoveCost: 1.4,
  squeezeEnabled: true,
  squeezeCostMultiplier: 2,
  leapEnabled: true,
  leapCostMultiplier: 2.5,
  abilityUpkeep: 0.03,
  founderAbilities: 'one',
  abilityMutationRate: 0.02,
  controller: 'brain', // Dials stay as an interpretable reference controller
  brainMutationRate: 0.05,
  brainMutationStdDev: 0.3,
  childhoodTicks: 800, // One full plenty-to-lean season cycle
  signalsEnabled: true,
  signalCost: 0.2,
  signalRadius: 8, // Signals carry well beyond sight (sensingRadius)
  immigrationInterval: 25,
  immigrationCount: 1,
  seasonLength: 800,
  leanFraction: 0.4,
  leanSlowdown: 8,
  seed: 42,
};

export function createConfig(overrides?: Partial<SimulationConfig>): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

/**
 * World sizes. Large is the default; small is the original 30×30 world, kept
 * for comparisons and slower devices.
 */
export const WORLD_SIZES = {
  small: {
    gridWidth: 30,
    gridHeight: 30,
    initialFoodPatches: 22,
    foodSpawnCount: 2,
    maxFoodPatches: 36,
    initialOrganisms: 20,
  },
  large: {
    gridWidth: DEFAULT_CONFIG.gridWidth,
    gridHeight: DEFAULT_CONFIG.gridHeight,
    initialFoodPatches: DEFAULT_CONFIG.initialFoodPatches,
    foodSpawnCount: DEFAULT_CONFIG.foodSpawnCount,
    maxFoodPatches: DEFAULT_CONFIG.maxFoodPatches,
    initialOrganisms: DEFAULT_CONFIG.initialOrganisms,
  },
} as const satisfies Record<string, Partial<SimulationConfig>>;

/**
 * Where food grows: anywhere (the original world), in fertile regions that
 * share one season, or in regions whose lean seasons come at different times.
 */
export const FOOD_LAYOUTS = {
  anywhere: { foodRegionCount: 0, staggeredSeasons: false },
  regions: { foodRegionCount: DEFAULT_CONFIG.foodRegionCount, staggeredSeasons: false },
  shifting: { foodRegionCount: DEFAULT_CONFIG.foodRegionCount, staggeredSeasons: true },
} as const satisfies Record<string, Partial<SimulationConfig>>;

export type WorldSize = keyof typeof WORLD_SIZES;
export type FoodLayout = keyof typeof FOOD_LAYOUTS;
