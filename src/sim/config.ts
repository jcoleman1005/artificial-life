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
  windfallsEnabled: true,
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
  memoryEnabled: true,
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
  carrionEnabled: true,
  // Bodies never hold more than they cost: eating one's own child (or
  // anyone) returns less than the energy put into it.
  carrionBodyEnergy: 10,
  carrionEfficiency: 0.7,
  carrionBite: 30,
  carrionLifetime: 200,
  dietTradeoff: 0.6, // a full meat eater gets 40% of a plant's energy
  carnivoryMutationStdDev: 0.08,
  predationEnabled: true,
  attackCost: 2,
  bitePowerMin: 0.2,
  sexEnabled: true,
  elevationEnabled: true, // off reproduces the world without continents (the control arm)
  elevationPlateCount: 6, // three continental and three oceanic plates
  elevationContinentalShare: 0.5,
  elevationSeaFraction: 0.38, // about 38% of the map is ocean, leaving large continents
  elevationMinContinent: 150, // fragments below this many cells are flooded
  elevationNoise: 0.12,
  elevationRidge: 0.25,
  elevationDeepThreshold: 0.2, // deeper than a fifth of the depth range cannot be crossed
  elevationRiverFraction: 0.03,
  elevationSlopeUp: 5, // a steep step of 0.1 of the height range costs 50% more
  elevationSlopeDown: 2, // and the same step down saves 20%
  elevationLapse: 0.4, // the highest peaks are 0.4 colder
  elevationWadeDrag: 1, // the deepest wadeable water doubles a size-1 body's move cost
  elevationWaterChill: 0.25, // standing in water is 0.25 colder
  elevationRiparianReach: 5, // wetness fades out over five cells from water
  elevationFertilityMean: 0.6, // about the old disc world's total food, now spread by water, slope and height
  elevationFertilityMin: 0.04,
  landSensingEnabled: true, // four brain inputs: slope, water and roughness of the cell a move enters, and cover underfoot (zero when their field is off)
  swimGeneEnabled: true, // inherited swimming (trait 57); only with elevation. Off: nobody can cross deep water
  swimFounder: 0, // founders cannot swim; it has to arise by mutation near the shore
  swimStep: 0.05,
  swimMin: 0,
  swimMax: 1,
  swimDeepThreshold: 0.5, // swimming needed to cross deep water
  swimUpkeepRate: 0.02, // upkeep per tick per unit of (swim * sizeFactor): fins and fat cost on land too
  swimLandDrag: 0.5, // a full swimmer pays 50% more to move on dry land
  swimDeepDrag: 1, // a swimmer at the threshold pays 1 + this x (1 - swim) in deep water
  marineEnabled: true, // plants also grow under water (shallows richest); seeds stay in their own medium
  marineFertility: 0.5, // soil fertility of the shallowest water, 0..1
  marineDeepLight: 0.25, // share of that fertility left at the deepest water
  terrainEnabled: true, // off reproduces the world without terrain (the control arm)
  terrainScale: 8, // patches about 8 cells across on the 60×60 grid
  terrainThreshold: 0.5, // about half of the ground is open
  terrainRoughnessCoeff: 1.0, // the roughest ground doubles a size-1 body's move cost
  fertilityDynamicEnabled: true, // off keeps the fixed disc map (the control arm)
  fertilityInterval: 10,
  fertilityRebuildRate: 0.002, // about 86% of the gap in ~1,000 ticks
  fertilityMoistureRate: 0.001, // gentle: one storm passage is worth 5-10% of the gap
  fertilityGrazeWear: 0.0012, // three times the first value (0.0004); ×5 and above cost population in the merged world (docs/findings.md)
  fertilityTrampleWear: 0.0003, // three times the first value (0.0001)
  fertilityMax: 1.0, // no hot spots above the disc value
  terrainWearEnabled: true, // off keeps the terrain as first made (the control arm)
  terrainTrampleRoughness: 0.005, // a path takes a few hundred crossings to wear down
  terrainTrampleCover: 0.003,
  terrainGrazeCover: 0.004,
  terrainRecoveryRate: 0.002, // about 500 ticks to close most of the gap
  terrainRecoveryInterval: 10,
  terrainCoverShelter: 0.6, // full cover removes 60% of the temperature swing and the rain and wind exposure
  ledgerEnabled: true, // observer only; never changes the world
  ledgerCheckInterval: 25, // a check sums the animals' stored energy once; 1 checks every tick (tests)
  immigrationEnabled: false, // watch only the founders and their descendants
  immigrationInterval: 25,
  immigrationCount: 1,
  seasonLength: 800,
  leanFraction: 0.4,
  leanSlowdown: 8,
  plantsEnabled: true,
  plantUpkeep: 0.01,
  growthCostFactor: 0.1, // fast growth loses where light × soil × open space is below this
  shadeStrength: 0.5,
  marginFertility: 0.2,
  seedAllocation: 0.5,
  plantMutationRate: 0.2,
  plantMutationStdDev: 0.08,
  seedRainInterval: 50,
  seedRainCount: 3,
  overgrazingEnabled: false, // staying on a patch has a future cost; off because it failed the ship-on gate (docs/findings.md)
  overgrazingDamagePerBite: 0.02,
  overgrazingRecoveryRate: 0.005,
  overgrazingRestTicks: 50,
  overgrazingMatchedRandom: false,
  dnaEnabled: true, // Stage 1 is bit-identical to DNA off (docs/specs/dna.md)
  dnaContinuousAbilities: false, // Stage 1b.1 (needs dnaEnabled)
  abilityMutationStdDev: 0.1,
  dnaSplitDiets: false, // Stage 1b.2 (needs dnaEnabled)
  dietUpkeep: 0.05, // a founder plant eater (herbivory 1) pays a fifth of base metabolism
  // Life-history genes. Each starts every founder at the world's old fixed value (or a small
  // one) and costs something; the switch is the lock for a control arm.
  thresholdGeneEnabled: true,
  thresholdStep: 3,
  thresholdMin: 30,
  thresholdMax: 95,
  investmentGeneEnabled: true,
  investmentStep: 0.03,
  investmentMin: 0.15,
  investmentMax: 0.8,
  fatEnabled: true,
  fatFounder: 4,
  fatStep: 4,
  maxFat: 60,
  fatUpkeep: 0.004, // a 40-unit reserve costs 0.16 per tick (two thirds of base metabolism)
  fatStoreEfficiency: 0.75,
  fatReleaseLevel: 0.4,
  fatReleaseRate: 3,
  torporEnabled: true,
  torporFounder: 0.1,
  torporStep: 0.1,
  torporSaving: 0.9, // a full-depth rest pays a tenth of its upkeep
  torporWakeCost: 4,
  eggsEnabled: true,
  eggFounder: 0.1,
  eggStep: 0.1,
  eggExtraCost: 3,
  eggDecayChance: 0.002,
  eggHatchRadius: 2,
  eggHatchEfficiency: 0.85,
  metabolismGeneEnabled: true,
  metabolismFounder: 1,
  metabolismStep: 0.1,
  metabolismMin: 0.5,
  metabolismMax: 1.5,
  birthCooldown: 12,
  // Clutch size (matings only). Founders 1. Max 6: the carrier's 4 free neighbours plus a little
  // dispersal room.
  clutchGeneEnabled: true,
  clutchStep: 0.2,
  clutchMin: 1,
  clutchMax: 6,
  // 10: two birth taxes; ~40 ticks of base upkeep; 40% of a meal (foodEnergyYield 25); a third of a
  // founder clone child (65 × 0.45 ≈ 29). Founder pairs pass with clutches of 1–5, fail at 6.
  minViableChildEnergy: 10,
  // Tier 1 physical & energetic architecture genes
  sizeGeneEnabled: true,
  sizeFounder: 1.0,
  sizeStep: 0.1,
  sizeMin: 0.4,
  sizeMax: 2.5,
  sizeMetabolismExponent: 0.75,
  sensingGeneEnabled: true,
  sensingFounder: 3,
  sensingStep: 0.5,
  sensingMin: 1,
  sensingMax: 6,
  sensingUpkeepPerCell: 0.003,
  digestiveGeneEnabled: true,
  digestiveFounder: 1.0,
  digestiveStep: 0.08,
  digestiveMin: 0.5,
  digestiveMax: 1.5,
  digestiveUpkeepRate: 0.04,
  fatDragCoeff: 0.5,
  carnivoreGeneEnabled: true,
  carnivoreFounder: 0.5, // half of a carrion meal absorbed at the start, so selection can move it either way
  carnivoreStep: 0.05,
  carnivoreMin: 0,
  carnivoreMax: 1,
  carnivoreUpkeepRate: 0.04,
  dnaVariationEnabled: false, // Stage 2 (needs dnaEnabled; docs/specs/dna.md)
  dnaInsertionRate: 0.001,
  dnaDeletionRate: 0.001,
  dnaDuplicationRate: 0.001,
  dnaDuplicationMaxLength: 4,
  dnaKeyFlipFraction: 0.05,
  dnaDosageCompensation: false,
  dnaUpkeepPerGene: 0.00005, // a 415-gene founder (52 brain inputs) pays about 8% of base metabolism
  dnaMaxGenes: 1500,
  dnaGrowableBrain: false, // Stage 3 (needs dnaEnabled): hidden units past the 6 founders are expressed; wrapped unit fields land on them, other wrapped brain keys stay silent (docs/specs/dna.md)
  dnaMaxInternal: 16, // hidden units a genome can address with the growable brain (clamped to 6..256)
  dnaUpkeepPerConnection: 0.00005, // an expressed acquired connection costs as much as a gene
  // Reproductive isolation (docs/specs/speciation.md); tolerance and full distance are set from the phase 0 diagnostic (docs/findings.md, Parameter log)
  hybridIncompatibilityEnabled: true,
  hybridTolerance: 0.15,
  hybridFull: 0.35,
  hybridMaxInviability: 0.8,
  hybridControlInviability: 0,
  genomeDistanceBrainScale: 1,
  // Weather systems (docs/specs/weather.md)
  weatherEnabled: true,
  weatherMaxFronts: 2,
  weatherSpawnInterval: 150,
  thermalPhysicsEnabled: true, // off reproduces the old cold-only rule (the control arm)
  thermalHeatCoeff: 0.4, // the same size as the cold surcharge
  thermalHeatThreshold: 0.1, // the plenty-season baseline: only heat waves cost, so the everyday economy is unchanged
  thermalFatInsulation: 0.5, // full fat halves the cold surcharge and raises the heat surcharge by half
  weatherChillCoeff: 0.4,
  weatherMudCoeff: 0.25,
  weatherWindCoupling: 0.25,
  weatherSeedDrift: 1.5,
  weatherSignalDrift: 2.0,
  weatherEvapRate: 0.005,
  weatherAbsorptionRate: 0.05,
  // Nutrient cycle (soil-plant-unit biogeochemical loop)
  nutrientCycleEnabled: true,
  nutrientCapacity: 3.0,
  nutrientRegenRate: 0.01,
  nutrientDiffusionRate: 0.01,
  nutrientPlantUptake: 0.2,
  nutrientPlantDecomp: 0.8,
  nutrientExcretion: 0.005,
  nutrientCarrionDecomp: 0.01,
  nutrientLeanThreshold: 0.4,
  // Red Queen: Trophic chemical coevolution
  plantDefenseEnabled: true,
  plantDefenseCostFactor: 0.5,
  defenseYieldPenalty: 0.75,
  toxinMalaiseCost: 8.0,
  detoxGeneEnabled: true,
  detoxFounder: 0.1,
  detoxStep: 0.05,
  detoxMin: 0,
  detoxMax: 1,
  detoxUpkeepRate: 0.03,
  // Growth and ageing (docs/specs/growth.md). Each switch is the lock for its control arm.
  growthEnabled: true,
  hatchMaturity: 0.35, // maturity at birth or hatching (founders start grown)
  hatchScale: 0.4, // body scale at maturity 0; a newborn (maturity 0.35) is 0.61 of adult size
  growthTicks: 100, // fed ticks from maturity 0 to 1: the fixed duration with the gene off, the reference duration for the heat cost with it on (a newborn needs about 55)
  growthEnergyFloor: 0.4, // growth stalls below this fraction of the current maximum energy
  growthCostPerTick: 0.05, // extra energy (heat) paid on each tick that adds growth, at duration growthTicks
  matureAt: 0.9, // REPRODUCE and MATE are illegal below this maturity
  growthGeneEnabled: true, // with growth: duration is an inherited gene (trait 55)
  growthDurationFounder: 100,
  growthDurationMin: 20,
  growthDurationMax: 800,
  growthDurationStep: 10,
  growthDurationCostExponent: 1.5, // heat per tick x (growthTicks / duration)^1.5: total cost to grow ~ duration^-0.5 (4x faster = 2x the heat, 4x slower = half)
  hatchMaturityGeneEnabled: true, // with growth: the maturity a newborn starts at is an inherited gene (trait 56); launch cost scales with it
  hatchMaturityMin: 0.2,
  hatchMaturityMax: 1.0,
  hatchMaturityStep: 0.05,
  ageingEnabled: true,
  senescenceAge: 4000, // upkeep starts rising past this age
  senescenceRate: 0.001, // extra upkeep multiplier per tick past senescenceAge (x5 at maxAge)
  maxAge: 8000, // death of old age
  // Species detection: an observer, so none of these can change a fingerprint (docs/specs/species.md).
  speciesEnabled: true,
  speciesInterval: 50,
  speciesThreshold: 0.2,
  speciesMinSize: 5,
  speciesPersistTicks: 200,
  speciesExtinctTicks: 100,
  speciesBrainWeight: 0.3,
  speciesTagWeight: 0.1,
  // Red Queen Phase 2: Predator–Prey Arms Race
  predationDefenseEnabled: true,
  toughnessGeneEnabled: true,
  toughnessFounder: 0.1,
  toughnessStep: 0.05,
  toughnessMin: 0,
  toughnessMax: 1,
  toughnessUpkeepRate: 0.025,
  armorEffectiveness: 0.75,
  armorDragCoeff: 0.35,
  toxicityGeneEnabled: true,
  toxicityFounder: 0.05,
  toxicityStep: 0.05,
  toxicityMin: 0,
  toxicityMax: 1,
  toxicityUpkeepRate: 0.025,
  stealthGeneEnabled: true,
  stealthFounder: 0.1,
  stealthStep: 0.05,
  stealthMin: 0,
  stealthMax: 1,
  stealthUpkeepRate: 0.02,
  stealthAmbushBonus: 0.3,
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
