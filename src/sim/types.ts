/**
 * Core types and data structures for the Artificial Life simulation.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export type Direction = 'north' | 'south' | 'east' | 'west';

export interface DirectionOffset {
  readonly dir: Direction;
  readonly dx: number;
  readonly dy: number;
}

export const DIRECTION_OFFSETS: readonly DirectionOffset[] = [
  { dir: 'north', dx: 0, dy: -1 },
  { dir: 'south', dx: 0, dy: 1 },
  { dir: 'east', dx: 1, dy: 0 },
  { dir: 'west', dx: -1, dy: 0 },
] as const;

export type ActionType =
  | 'MOVE_NORTH'
  | 'MOVE_SOUTH'
  | 'MOVE_EAST'
  | 'MOVE_WEST'
  | 'EAT'
  | 'REPRODUCE_NORTH'
  | 'REPRODUCE_SOUTH'
  | 'REPRODUCE_EAST'
  | 'REPRODUCE_WEST'
  | 'REST';

export interface LegalAction {
  readonly type: ActionType;
  readonly target?: Point;
}

export interface PolicyWeights {
  /** Preference for moving toward sensed food patches ([-2, 2]). */
  foodAttraction: number;
  /** Preference for moving away from sensed obstacles ([-2, 2]). */
  obstacleAvoidance: number;
  /** Preference for avoiding other organisms to prevent crowding ([-2, 2]). */
  crowdingAvoidance: number;
  /** Intrinsic tendency to wander/explore ([-2, 2]). */
  exploreTendency: number;
  /** Drive to eat when food is available ([-2, 2]). */
  eatDrive: number;
  /** Drive to reproduce when energy threshold is reached ([-2, 2]). */
  reproduceDrive: number;
}

export interface SensedEntity {
  readonly x: number;
  readonly y: number;
  readonly distance: number; // Manhattan distance
  readonly dx: number;
  readonly dy: number;
  readonly value?: number;
}

export interface SensedInputs {
  readonly currentEnergy: number;
  readonly energyRatio: number; // [0, 1]
  readonly currentCellFood: number;
  readonly nearestFood: SensedEntity | null;
  readonly nearestObstacle: SensedEntity | null;
  readonly nearestOrganism: SensedEntity | null;
  readonly surroundingOrganismCount: number;
  readonly canEat: boolean;
  readonly canReproduce: boolean;
}

export interface ActionScore {
  readonly action: LegalAction;
  readonly totalScore: number;
  readonly components: Record<string, number>;
}

export type DecisionOutcome =
  | 'success'
  | 'blocked_by_obstacle'
  | 'blocked_by_boundary'
  | 'blocked_by_organism'
  | 'conflict_lost'
  | 'no_food'
  | 'energy_too_low'
  | 'rested';

export interface DecisionRecord {
  readonly tick: number;
  readonly sensed: SensedInputs;
  readonly scores: ActionScore[];
  readonly chosenAction: LegalAction;
  readonly outcome: DecisionOutcome;
  readonly energyDelta: number;
  readonly energyAfter: number;
}

export interface LineageInfo {
  readonly id: string; // Clan / root ancestor lineage identifier
  readonly parentId: string | null;
  readonly generation: number;
  readonly birthTick: number;
}

export interface Organism {
  readonly id: string;
  x: number;
  y: number;
  energy: number;
  policy: PolicyWeights;
  readonly lineage: LineageInfo;
  age: number;
  offspringCount: number;
  foodEatenCount: number;
  recentHistory: DecisionRecord[];
}

export interface FoodPatch {
  readonly x: number;
  readonly y: number;
  stock: number;
  capacity: number;
}

export interface SimulationConfig {
  gridWidth: number;
  gridHeight: number;
  obstacleDensity: number;
  initialFoodPatches: number;
  foodPatchCapacity: number;
  foodPatchInitialStock: number;
  foodEnergyYield: number; // Energy gained by eating 1 unit of food
  foodRegenInterval: number; // Regenerate stock every N ticks
  foodRegenAmount: number;
  foodSpawnInterval: number; // Spawn new patches every N ticks
  foodSpawnCount: number;
  maxFoodPatches: number;
  initialOrganisms: number;
  maxEnergy: number;
  initialEnergy: number;
  moveCost: number;
  tickMetabolismCost: number;
  reproductionThreshold: number;
  reproductionEnergyFraction: number; // Fraction of parent energy transferred to child
  reproductionMetabolismTax: number; // Flat cost paid during reproduction
  mutationRate: number; // Probability per weight of mutating
  mutationStdDev: number; // Standard deviation of mutation perturbation
  sensingRadius: number; // Distance for local sensing (Chebyshev radius)
  seed: number | string;
}

export interface PolicyDiversityMetrics {
  foodAttractionVariance: number;
  obstacleAvoidanceVariance: number;
  crowdingAvoidanceVariance: number;
  exploreTendencyVariance: number;
  eatDriveVariance: number;
  reproduceDriveVariance: number;
  averageDiversity: number;
}

export interface WorldMetrics {
  tick: number;
  population: number;
  totalFoodStock: number;
  activePatchCount: number;
  birthsTotal: number;
  deathsTotal: number;
  maxGeneration: number;
  averageLifespan: number;
  averageOffspringPerParent: number;
  activeLineageCount: number;
  diversity: PolicyDiversityMetrics;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly obstacles: ReadonlySet<string>; // "x,y" strings for fast lookup
  readonly foodPatches: ReadonlyMap<string, FoodPatch>; // keyed by "x,y"
  readonly organisms: readonly Organism[];
}
