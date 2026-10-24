import type { SimulationConfig } from './types';

/**
 * Sensible default configuration for the artificial life simulation.
 * Sized and balanced for mobile viewport clarity and viable evolutionary dynamics.
 */
export const DEFAULT_CONFIG: Readonly<SimulationConfig> = {
  gridWidth: 30,
  gridHeight: 30,
  obstacleDensity: 0.07,
  initialFoodPatches: 22,
  foodPatchCapacity: 8,
  foodPatchInitialStock: 4,
  foodEnergyYield: 25,
  foodRegenInterval: 4,
  foodRegenAmount: 1,
  foodSpawnInterval: 12,
  foodSpawnCount: 2,
  maxFoodPatches: 36,
  initialOrganisms: 20,
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
  shareAmount: 10,
  shareMultiplier: 1.0, // Pure transfer: sharing moves energy, never creates it
  shareMinEnergyAfter: 25,
  parentalMinEnergyAfter: 5,
  immigrationInterval: 25,
  immigrationCount: 1,
  seed: 42,
};

export function createConfig(overrides?: Partial<SimulationConfig>): SimulationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}
