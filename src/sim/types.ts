/**
 * Core types and data structures for the Artificial Life simulation.
 */
import type { Brain } from './brain';
import type { MemoryState, Recalled } from './memory';

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
  | 'MOVE_NORTHEAST'
  | 'MOVE_NORTHWEST'
  | 'MOVE_SOUTHEAST'
  | 'MOVE_SOUTHWEST'
  | 'LEAP_NORTH'
  | 'LEAP_SOUTH'
  | 'LEAP_EAST'
  | 'LEAP_WEST'
  | 'EAT'
  | 'REPRODUCE_NORTH'
  | 'REPRODUCE_SOUTH'
  | 'REPRODUCE_EAST'
  | 'REPRODUCE_WEST'
  | 'PICK_UP'
  | 'GIVE_NORTH'
  | 'GIVE_SOUTH'
  | 'GIVE_EAST'
  | 'GIVE_WEST'
  | 'SIGNAL'
  | 'EAT_CARRION'
  | 'ATTACK_NORTH'
  | 'ATTACK_SOUTH'
  | 'ATTACK_EAST'
  | 'ATTACK_WEST'
  | 'REST';

export interface LegalAction {
  readonly type: ActionType;
  readonly target?: Point;
  /**
   * MOVE only: the target cell holds another organism and the move is a swap:
   * the two trade places if the occupant stays put. Family ('child', 'parent')
   * pass at the normal cost; anyone else is squeezed past at extra cost.
   */
  readonly swapWithId?: string;
  readonly swapRelation?: 'child' | 'parent' | 'squeeze';
  /** MOVE only: the target cell holds a non-family organism (a squeeze or a blocked move). */
  readonly targetOccupied?: boolean;
  /** GIVE only: the adjacent organism receiving a carried food unit. */
  readonly recipientId?: string;
  /** GIVE only: how alike the recipient's tag looks (0..1). */
  readonly recipientSimilarity?: number;
  /** GIVE only: whether the recipient counts as kin (similarity >= kinSimilarity). */
  readonly recipientIsKin?: boolean;
  /**
   * GIVE only: how hungry the recipient is, 0 at half energy rising to 1
   * at empty. Food is only offered to neighbours below half energy.
   */
  readonly recipientNeed?: number;
  /** GIVE only: the recipient is the donor's own child (parental care). */
  readonly recipientIsChild?: boolean;
  /** ATTACK only: the adjacent organism bitten. */
  readonly preyId?: string;
  /** ATTACK only: how alike the prey's tag looks (0..1). */
  readonly preySimilarity?: number;
  /** ATTACK only: the chance the bite kills, if the prey is still adjacent after moves. */
  readonly preyKillChance?: number;
  /** ATTACK only: the prey is the attacker's own child or parent. */
  readonly preyIsFamily?: boolean;
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
  /** Positive: move toward look-alikes and away from strangers. Negative: the reverse ([-2, 2]). */
  kinAffinity: number;
  /** Willingness to give carried food to a hungry look-alike ([-2, 2]). */
  shareWithKin: number;
  /** Willingness to give carried food to a hungry stranger ([-2, 2]). */
  shareWithStrangers: number;
  /** Willingness to give carried food to one's own hungry child, even when hungry oneself ([-2, 2]). */
  careForChildren: number;
  /** Drive to pick up food and carry it for later or for others ([-2, 2]). */
  forageDrive: number;
  /**
   * How strongly a chance to eat pushes every other action down (except
   * feeding one's own hungry child). Starts high: food first ([-2, 2]).
   */
  eatPriority: number;
  /** How hard hunger (below half energy) pulls toward known food ([-2, 2]). */
  hungerUrgency: number;
  /** In childhood, pull toward one's parent while it carries food ([-2, 2]). */
  followFoodParent: number;
  /** Urge to signal while standing on food ([-2, 2]). */
  signalOnFood: number;
  /** Urge to signal while hungry ([-2, 2]). */
  signalWhenHungry: number;
  /** Positive: move toward the nearest signal. Negative: away from it ([-2, 2]). */
  followSignal: number;
  /** Preference for resting (staying put at no extra cost) over other actions ([-2, 2]). */
  restDrive: number;
  /** How strongly to avoid moving into cells held by non-family organisms ([-2, 2]). */
  avoidOccupied: number;
  /** Extra willingness to leap over a neighbour, for organisms able to ([-2, 2]). */
  leapEagerness: number;
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
  /** Food units this organism is carrying. */
  readonly carriedFood: number;
  readonly nearestFood: SensedEntity | null;
  readonly nearestObstacle: SensedEntity | null;
  readonly nearestOrganism: SensedEntity | null;
  readonly surroundingOrganismCount: number;
  /** Organisms in sensing radius at least kinSimilarity alike. */
  readonly nearbyKinCount: number;
  /** Organisms in sensing radius at most strangerSimilarity alike. */
  readonly nearbyStrangerCount: number;
  /**
   * Distance-weighted direction toward similar organisms and away from
   * dissimilar ones, graded by similarity (null when none are in range).
   */
  readonly kinPull: { readonly dx: number; readonly dy: number } | null;
  /** In childhood: one's parent, if in range and carrying food (value = units carried). */
  readonly parentWithFood: SensedEntity | null;
  /**
   * The nearest organism that signalled last tick, within signalRadius
   * (value = how alike its tag looks, 0..1). Null when none.
   */
  readonly nearestSignal: SensedEntity | null;
  /** Carrion energy in this cell. */
  readonly currentCellCarrion: number;
  /** The nearest carrion within sensing radius (value = energy in it). Null when none. */
  readonly nearestCarrion: SensedEntity | null;
  /** Carrion here, a diet that gets something from it, and room for a full meal of it. */
  readonly canEatCarrion: boolean;
  readonly canReproduce: boolean;
  /** Food available to eat here or in hand, and room for energy. */
  readonly canEat: boolean;
  readonly canPickUp: boolean;
  /** Carrying food and the GIVE experiment switch is on. */
  readonly canGive: boolean;
  /** The SIGNAL experiment switch is on. */
  readonly canSignal: boolean;
  /** Memory (null / zeros when memory is off or the span is 0): remembered food, signal and home, and the free registers. */
  readonly rememberedFood: Recalled | null;
  readonly rememberedSignal: Recalled | null;
  readonly home: Recalled | null;
  readonly registers: readonly number[];
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
  | 'rested'
  /** An attack that did not kill (missed, or the prey got away). */
  | 'missed';

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
  /**
   * Visible, inherited marker (a hue in [0, 360)). Others can see whether it
   * looks like theirs. Mutates slowly, so groups can drift apart and split.
   */
  readonly tag: number;
  readonly lineage: LineageInfo;
  age: number;
  offspringCount: number;
  foodEatenCount: number;
  /**
   * Inherited body trait: how many food units this organism can carry.
   * Each unit of capacity adds carryUpkeep to its metabolism every tick.
   */
  readonly carryCapacity: number;
  /**
   * Inherited body trait: how far away (in steps) a child of this organism
   * can be born. 1 means next to the parent; each step beyond the first costs
   * the parent dispersalCost energy at the birth.
   */
  readonly dispersal: number;
  /** Inherited body trait: how many ticks named memories last (0 = no memory). Costs memoryUpkeep per tick of span. */
  readonly memorySpan: number;
  /** Inherited weights that update the free memory registers. */
  readonly memoryWeights: readonly number[];
  /** What it remembers now (not inherited; a child starts with only its birthplace). */
  memory: MemoryState;
  /** Inherited movement abilities (body traits); see Abilities. */
  readonly abilities: Abilities;
  /**
   * Inherited diet, 0..1: the share of a carrion meal's energy it gets
   * (carnivory × carrionBite at most), at the price of plant food
   * (foodEnergyYield × (1 − dietTradeoff × carnivory)), and how hard it bites.
   * 0 is a pure plant eater.
   */
  readonly carnivory: number;
  /** Organisms this one has killed. */
  kills: number;
  /** Inherited neural controller, used when config.controller is 'brain'. */
  readonly brain: Brain;
  /** Food units carried, eaten later or given away (at most carryCapacity). */
  carriedFood: number;
  /** Cumulative food units given to and received from other organisms. */
  foodGiven: number;
  foodReceived: number;
  /** The last tick this organism signalled (-1 if never). Others see it the tick after. */
  signalTick: number;
  recentHistory: DecisionRecord[];
}

/**
 * Inherited movement abilities, each 1 (has it) or 0. They only work in
 * worlds where the matching config switch is on, and each one held there
 * costs abilityUpkeep energy per tick.
 */
export interface Abilities {
  /** Can move diagonally. */
  readonly diagonal: number;
  /** Can squeeze past (trade places with) a non-family neighbour that stays put. */
  readonly squeeze: number;
  /** Can leap over an adjacent organism into the free cell beyond. */
  readonly leap: number;
}

export type AbilityName = keyof Abilities;

export interface FoodPatch {
  readonly x: number;
  readonly y: number;
  stock: number;
  capacity: number;
  /** Index of the food region it grew in (absent: no region, global seasons). */
  readonly region?: number;
  /** Windfalls only: the tick it rots away. Windfall patches never regrow. */
  readonly expiresAt?: number;
}

/** What a dead organism leaves behind: food only meat eaters get much from. Never regrows. */
export interface CarrionPatch {
  readonly x: number;
  readonly y: number;
  /** Energy left in it. A meal takes up to carrionBite; the eater gets its carnivory share. */
  stock: number;
  /** The tick it rots away (renewed when another body lands on it). */
  expiresAt: number;
}

/** A fertile disc where food patches grow. Each may run its own season clock. */
export interface FoodRegion {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** How far ahead (0..1 of a cycle) this region's seasons run when staggered. */
  readonly seasonPhase: number;
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
  windfallsEnabled: boolean; // Experiment switch for rare, short-lived bursts of food anywhere
  windfallInterval: number; // A windfall every N ticks
  windfallUnits: number; // Food units in one windfall, spread over windfallPatches patches
  windfallPatches: number; // Patches in one windfall (a small cluster)
  windfallLifetime: number; // Ticks before a windfall's leftovers rot away
  foodRegionCount: number; // Fertile regions where food grows (0 = food anywhere)
  foodRegionRadius: number; // Radius of each region, in cells
  staggeredSeasons: boolean; // Each region's lean season comes at a different time
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
  tagMutationRate: number; // Probability a child's tag shifts at birth
  tagMutationStdDev: number; // Degrees of hue shift when it does
  kinSimilarity: number; // Tag similarity at/above which neighbours count as kin (0..1)
  strangerSimilarity: number; // Tag similarity at/below which neighbours count as strangers
  sharingEnabled: boolean; // Experiment switch for giving carried food to neighbours
  carryUpkeep: number; // Extra energy per tick for each unit of carry capacity
  maxCarryCapacity: number; // Upper bound on the inherited carry capacity
  dispersalEnabled: boolean; // Experiment switch: children can be born up to their parent's dispersal distance away
  maxDispersal: number; // Upper bound on the inherited dispersal distance
  dispersalCost: number; // Energy the parent pays per step beyond the first
  memoryEnabled: boolean; // Experiment switch for memory (named memories and free registers, brain only)
  maxMemorySpan: number; // Upper bound on the inherited memory span (ticks)
  memorySpanStep: number; // How far a child's memory span can shift at birth
  memoryUpkeep: number; // Energy per tick for each tick of memory span
  traitMutationRate: number; // Probability a child's body trait shifts by ±1 at birth
  diagonalMoves: boolean; // Allow diagonal moves (for organisms with the ability)
  diagonalMoveCost: number; // Diagonal move cost, as a multiple of moveCost
  squeezeEnabled: boolean; // Allow squeezing past a non-family organism that stays put (for organisms with the ability)
  squeezeCostMultiplier: number; // Squeeze cost, as a multiple of the move's cost
  leapEnabled: boolean; // Allow leaping (for organisms with the ability)
  leapCostMultiplier: number; // Leap cost, as a multiple of moveCost
  abilityUpkeep: number; // Extra energy per tick for each movement ability held (in worlds where it is enabled)
  founderAbilities: 'one' | 'all'; // 'one': each founder gets one enabled ability or none, at random; 'all': every enabled ability
  abilityMutationRate: number; // Probability each ability flips (gained or lost) at birth
  controller: 'dials' | 'brain'; // Which inherited controller chooses actions
  brainMutationRate: number; // Probability each brain weight mutates at birth
  brainMutationStdDev: number; // Size of a brain weight mutation
  childhoodTicks: number;
  signalsEnabled: boolean; // Experiment switch for the SIGNAL action
  signalCost: number; // Energy spent on one signal
  signalRadius: number; // How far (Manhattan) a signal can be sensed // For this long after birth, a parent carrying food senses as a food source
  carrionEnabled: boolean; // Dead organisms leave carrion, and diet (carnivory) trades plant food for meat
  carrionBodyEnergy: number; // Carrion energy any body leaves (a starved one leaves only this)
  carrionEfficiency: number; // Plus this share of the energy the body still held (a killed one usually holds some)
  carrionBite: number; // Carrion energy one meal takes; the eater gains carnivory × that
  carrionLifetime: number; // Ticks before carrion rots away
  dietTradeoff: number; // Plant food yields foodEnergyYield × (1 − dietTradeoff × carnivory)
  carnivoryMutationStdDev: number; // How far a child's carnivory shifts when it mutates (with traitMutationRate)
  predationEnabled: boolean; // Allow ATTACK (brain only): a kill turns the prey into carrion
  attackCost: number; // Energy spent on one attack, hit or miss
  bitePowerMin: number; // Bite strength of a pure plant eater, as a fraction of a full meat eater's
  immigrationInterval: number; // Every N ticks newcomers arrive (0 = off)
  immigrationCount: number; // Newcomers per arrival
  seasonLength: number; // Ticks per plenty + lean cycle (0 = no seasons)
  leanFraction: number; // Fraction of each cycle that is lean (at the end)
  leanSlowdown: number; // During lean, food regrows this many times slower and no patches spawn
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

export interface TribeMetrics {
  /** Groups of >= minTribeSize look-alikes living within 2 cells of each other. */
  tribeCount: number;
  largestTribe: number;
  /** Share of the population that belongs to some tribe. */
  inTribeFraction: number;
  /** Average share of each organism's neighbours (within 2 cells) that are kin. */
  localKinFraction: number;
  /** Share of all organism pairs that are kin: what clustering would be by chance. */
  globalKinFraction: number;
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
  tribes: TribeMetrics;
  sharesTotal: number;
  kinSharesTotal: number;
  parentalSharesTotal: number;
  immigrantsTotal: number;
  signalsTotal: number;
  /** Signals sent while standing on food. */
  signalsOnFoodTotal: number;
  /** Kills so far, and how many of the prey looked like strangers / kin to their killer. */
  killsTotal: number;
  killsOfStrangersTotal: number;
  killsOfKinTotal: number;
  /** Carrion meals eaten so far, and carrion energy lying in the world now. */
  carrionEatenTotal: number;
  carrionStock: number;
  /** Mean carnivory now, and how many organisms are mostly meat eaters (carnivory >= 0.5). */
  averageCarnivory: number;
  meatEaters: number;
  /** Current season, or null when seasons are off. */
  season: 'plenty' | 'lean' | null;
}

export interface WorldSnapshot {
  readonly tick: number;
  readonly gridWidth: number;
  readonly gridHeight: number;
  readonly obstacles: ReadonlySet<string>; // "x,y" strings for fast lookup
  readonly foodPatches: ReadonlyMap<string, FoodPatch>; // keyed by "x,y"
  readonly organisms: readonly Organism[];
  /** Snapshot organisms keyed by "x,y", for adjacency checks. */
  readonly organismAt: ReadonlyMap<string, Organism>;
  /** Fast lookups indexed by y * gridWidth + x: 1 where there is an obstacle. */
  readonly obstacleGrid: Uint8Array;
  /** Food stock in each cell (0 when no patch or empty). */
  readonly foodGrid: Int32Array;
  /** Carrion energy in each cell (0 when none). */
  readonly carrionGrid: Float32Array;
  /** Index into `organisms` of the organism in each cell, or -1. */
  readonly organismGrid: Int32Array;
  /** Indices into `organisms` of those that signalled last tick. */
  readonly signallers: readonly number[];
}
