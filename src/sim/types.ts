/**
 * Core types and data structures for the Artificial Life simulation.
 */
import type { Brain, Circuit } from './brain';
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
  | 'MATE_NORTH'
  | 'MATE_SOUTH'
  | 'MATE_EAST'
  | 'MATE_WEST'
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
  /** MATE only: the adjacent organism asked. A child is only made if it asks back the same tick. */
  readonly mateId?: string;
  /** MATE only: how alike the partner's tag looks (0..1). */
  readonly mateSimilarity?: number;
  /** MATE only: the partner is one's own child or parent. */
  readonly mateIsFamily?: boolean;
  /** MATE only: the partner has enough energy to reproduce (so could ask back). */
  readonly mateReady?: boolean;
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
  /** Local temperature anomaly at this cell [-1, 1], 0 when weather is off. */
  readonly weatherTemp?: number;
  /** Local precipitation / rain at this cell [0, 1], 0 when weather is off. */
  readonly weatherRain?: number;
  /** Local wind vector at this cell, or null when weather is off. */
  readonly weatherWind?: { readonly wx: number; readonly wy: number } | null;
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
  | 'missed'
  /** Asked a neighbour to mate and it did not ask back. */
  | 'no_partner'
  /** Mated, but the clutch was too poor to be viable (both parents paid; no children). */
  | 'clutch_failed';

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
  /** The second parent, for a child of mating (it carries the first parent's lineage id). */
  readonly mateId?: string;
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
  /**
   * With split diets (dnaEnabled + dnaSplitDiets): plant-eating efficiency,
   * 0..1. Plant food yields foodEnergyYield × herbivory, carnivory becomes the
   * independent meat-eating efficiency, and both cost dietUpkeep per tick.
   * Absent otherwise.
   */
  readonly herbivory?: number;
  /**
   * Life-history genes, each present only while its switch is on (see
   * lifehistory.ts). Absent means the world's fixed value applies.
   * Energy needed to reproduce.
   */
  readonly reproThreshold?: number;
  /** Fraction of the parent's energy a child is born with. */
  readonly investment?: number;
  /** Fat reserve capacity: energy stored above maxEnergy, costing upkeep per unit of capacity. */
  readonly fatCapacity?: number;
  /** Torpor depth 0..1: how much upkeep falls on a resting tick, and how much acting after a rest costs. */
  readonly torporDepth?: number;
  /** Egg shell allocation 0..1 (oviparity vs juvenile birth, and protective shell energy). */
  readonly eggAllocation?: number;
  /** Legacy alias for eggAllocation in older saves. */
  readonly eggRate?: number;
  /** Metabolic rate multiplier on base upkeep; sets the pause between births. */
  readonly metabolicRate?: number;
  /** Children per mating (clutchGeneEnabled; matings only, cloning makes one child). */
  readonly clutchSize?: number;
  /** Body mass / radius slider (sizeGeneEnabled). Scales maxEnergy linearly, increases basal metabolism (size^0.75) and movement costs. */
  readonly size?: number;
  /** Perceptual radius in cells (sensingGeneEnabled). Scans [x - r, x + r] x [y - r, y + r]; charges sensory upkeep per tick (radius^2). */
  readonly sensingRadius?: number;
  /** Nutrient extraction efficiency (digestiveGeneEnabled). Scales energy absorbed from plant and carrion meals; charges gut organ upkeep. */
  readonly digestiveEfficiency?: number;
  /** Fat held now (state; only with fatEnabled). */
  fat?: number;
  /** Chose REST last tick, so acting now pays the wake cost (state; only with torporEnabled). */
  rested?: boolean;
  /** First tick it may reproduce again (state; only with metabolismGeneEnabled). */
  nextBirthTick?: number;
  /** Organisms this one has killed. */
  kills: number;
  /** Inherited neural controller, used when config.controller is 'brain'. */
  readonly brain: Brain;
  /**
   * With dnaEnabled: the genome its body and brain were decoded from (see
   * dna.ts); children inherit it with mutation. Absent otherwise, and in
   * organisms from before it was switched on (encoded at their next birth).
   */
  readonly genome?: Uint32Array;
  /**
   * With dnaGrowableBrain: the sparse brain compiled from the genome (see
   * compileCircuit in dna.ts), used for scoring instead of `brain`. Derived
   * from the genome, never saved; absent in organisms born before the switch
   * was on (they keep the dense brain).
   */
  readonly circuit?: Circuit;
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
 * Inherited movement abilities, each 1 (has it) or 0; with continuous
 * abilities (dnaEnabled + dnaContinuousAbilities) an efficiency in [0, 1],
 * held when above 0, that lowers the move's cost and scales its upkeep. They only work in
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

/** Cell health on fertile ground (overgrazingEnabled). Regions are in the order of World.foodRegions; one entry when there are none. */
export interface OvergrazingMetrics {
  readonly meanHealth: readonly number[];
  /** Mean health of all fertile cells, and the share below 0.5. */
  readonly meanHealthAll: number;
  readonly fractionDegraded: number;
}

export interface FoodPatch {
  readonly x: number;
  readonly y: number;
  stock: number;
  capacity: number;
  /** Index of the food region it grew in (absent: no region, global seasons). */
  readonly region?: number;
  /** Windfalls only: the tick it rots away. Windfall patches never regrow. */
  readonly expiresAt?: number;
  /** With plantsEnabled: the plant growing here (stock is its whole edible units). */
  readonly plant?: Plant;
}

/**
 * A plant's inherited life-history numbers. Plants make no decisions; these
 * numbers set how they grow, store, seed and spread, and they evolve.
 */
export interface PlantGenome {
  /** Growth per tick in full soil and light, before shade. Fast plants pay more upkeep. */
  readonly growthRate: number;
  /** Largest size (edible biomass plus roots). */
  readonly maxBiomass: number;
  /** Biomass a seedling starts with; each seed costs this much from the seed budget. */
  readonly seedSize: number;
  /** Fraction of maxBiomass the plant must reach before it sets seed. */
  readonly seedThreshold: number;
  /** How far (cells, in each direction) its seeds can land. */
  readonly dispersal: number;
  /** Fraction of growth stored as inedible roots. */
  readonly rootShare: number;
  /** In a lean season: how much growth stops, how much biomass moves into roots, and how much upkeep falls (0..1). */
  readonly leanDormancy: number;
}

export type PlantTrait = keyof PlantGenome;

export type PlantDeathCause = 'grazed' | 'shaded' | 'lean' | 'starved';

/** A plant: one individual of the plant population, rooted in one cell. */
export interface Plant {
  readonly id: string;
  /** Founder (or seed-rain) ancestor this plant descends from. */
  readonly lineageId: string;
  readonly parentId: string | null;
  readonly generation: number;
  readonly birthTick: number;
  readonly genome: PlantGenome;
  /** Edible biomass; organisms see and eat its whole units. */
  biomass: number;
  /** Inedible reserve: keeps the plant alive when grazed bare or through lean times. */
  roots: number;
  /** Growth set aside for seeds; a seed is released each time it reaches seedSize. */
  seedBudget: number;
  seedsReleased: number;
  /** The last tick an organism ate or picked up a unit of it (-1 if never). */
  lastGrazedTick: number;
  /** In a lean season and mostly dormant (leanDormancy at least 0.5). */
  dormant: boolean;
}

/** Plant population statistics (null in WorldMetrics when plants are off). */
export interface PlantMetrics {
  count: number;
  /** Plants with less than one edible unit. */
  seedlings: number;
  dormant: number;
  edibleBiomass: number;
  roots: number;
  traits: Record<PlantTrait, { mean: number; sd: number }>;
  deaths: Record<PlantDeathCause, number>;
  seedsReleasedTotal: number;
  seedRainTotal: number;
  /** Units of plant eaten or picked up by organisms. */
  grazedTotal: number;
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

/** An egg: a child waiting inert, in a cell, until conditions are favorable. */
export interface Egg {
  readonly x: number;
  readonly y: number;
  readonly laidTick: number;
  /** Protective energetic shell buffer remaining. */
  shell: number;
  /** The child it will hatch into (its energy is what the egg holds). */
  readonly child: Organism;
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
  sexEnabled: boolean; // Allow MATE (brain only): two neighbours who ask each other make a child that mixes their genes
  immigrationEnabled: boolean; // Newcomers arrive during the run (off: only the founders and their descendants)
  immigrationInterval: number; // Every N ticks newcomers arrive (0 = off)
  immigrationCount: number; // Newcomers per arrival
  seasonLength: number; // Ticks per plenty + lean cycle (0 = no seasons)
  leanFraction: number; // Fraction of each cycle that is lean (at the end)
  leanSlowdown: number; // During lean, food regrows this many times slower and no patches spawn
  plantsEnabled: boolean; // Food is a population of evolving plants instead of fixed patches
  plantUpkeep: number; // Plant upkeep per tick per unit of size (biomass + roots)
  growthCostFactor: number; // Upkeep per tick per unit of growthRate (times vigour), paid whatever the light
  shadeStrength: number; // Growth falls by this times the share of the 8 neighbouring cells holding a plant
  marginFertility: number; // Soil outside the fertile regions (inside = 1)
  seedAllocation: number; // Share of growth a mature plant puts into seeds
  plantMutationRate: number; // Probability each plant trait mutates in a seed
  plantMutationStdDev: number; // Size of a plant trait mutation, as a fraction of the trait's range
  seedRainInterval: number; // Every N ticks seeds with random genomes land (0 = off)
  seedRainCount: number; // Seeds per seed rain
  dnaEnabled: boolean; // Inherited traits and weights live in a genome the phenotype is decoded from (Stage 1: behaviour-neutral)
  dnaContinuousAbilities: boolean; // With DNA: abilities are efficiencies in [0, 1] (cost and upkeep scale with them) instead of 0/1
  abilityMutationStdDev: number; // Continuous abilities: how far an efficiency drifts when it mutates (with traitMutationRate)
  dnaSplitDiets: boolean; // With DNA: independent plant (herbivory) and meat (carnivory) efficiencies, each costing dietUpkeep, instead of the dietTradeoff
  overgrazingEnabled: boolean; // Each bite damages the cell's health; regrowth is scaled by it (docs/decisions.md)
  overgrazingDamagePerBite: number; // Health lost per bite, health in [0, 1]
  overgrazingRecoveryRate: number; // Health regained per tick once rested
  overgrazingRestTicks: number; // Ticks without a bite before a cell starts to recover
  overgrazingMatchedRandom: boolean; // Control: the same damage lands on random fertile cells, not where bites happen
  dietUpkeep: number; // Split diets: energy per tick per unit of herbivory + carnivory
  thresholdGeneEnabled: boolean; // Reproduction threshold evolves (off: everyone uses reproductionThreshold)
  thresholdStep: number; // How far a threshold shifts when it mutates (with traitMutationRate)
  thresholdMin: number; // Lowest threshold that can evolve
  thresholdMax: number; // Highest threshold that can evolve
  investmentGeneEnabled: boolean; // Investment per child evolves (off: everyone uses reproductionEnergyFraction)
  investmentStep: number; // How far the fraction shifts when it mutates
  investmentMin: number;
  investmentMax: number;
  fatEnabled: boolean; // Organisms can evolve a fat reserve above maxEnergy
  fatFounder: number; // Founders' fat capacity
  fatStep: number; // How far the capacity shifts when it mutates
  maxFat: number; // Largest capacity
  fatUpkeep: number; // Energy per tick per unit of capacity, empty or full
  fatStoreEfficiency: number; // Share of surplus food energy that becomes fat (the rest is lost)
  fatReleaseLevel: number; // Fat is drawn on when energy is below this fraction of maxEnergy
  fatReleaseRate: number; // Most fat drawn on per tick
  torporEnabled: boolean; // Organisms can evolve a deep rest below ordinary REST
  torporFounder: number; // Founders' torpor depth
  torporStep: number;
  torporSaving: number; // Upkeep falls by this fraction on a resting tick at depth 1
  torporWakeCost: number; // Energy paid to act after a rest at depth 1 (scales with depth)
  eggsEnabled: boolean; // Organisms can evolve to lay eggs that wait for food
  eggFounder: number; // Founders' chance of laying an egg
  eggStep: number;
  eggExtraCost: number; // Extra energy the parent pays to lay an egg
  eggDecayChance: number; // Chance per tick an egg fails
  eggHatchRadius: number; // An egg hatches when food is within this many cells
  eggHatchEfficiency: number; // Share of the egg's energy the hatchling starts with
  metabolismGeneEnabled: boolean; // Base metabolic rate evolves, tied to the pause between births
  metabolismFounder: number;
  metabolismStep: number;
  metabolismMin: number;
  metabolismMax: number;
  birthCooldown: number; // Ticks between births at rate 1 (shorter when faster, longer when slower)
  clutchGeneEnabled: boolean; // Children per mating evolve (clutchSize; matings only; off: one child per mating)
  clutchStep: number;
  clutchMin: number;
  clutchMax: number;
  minViableChildEnergy: number; // A mating whose energy per child is below this fails: both parents pay, no children
  sizeGeneEnabled: boolean; // Body size / mass evolves (scales maxEnergy linearly, metabolism as size^0.75, move cost with mass)
  sizeFounder: number;
  sizeStep: number;
  sizeMin: number;
  sizeMax: number;
  sizeMetabolismExponent: number; // Exponent for Kleiber's Law allometric scaling (default 0.75)
  sensingGeneEnabled: boolean; // Sensory radius evolves (1..6 cells, charges upkeep scaling with radius^2)
  sensingFounder: number;
  sensingStep: number;
  sensingMin: number;
  sensingMax: number;
  sensingUpkeepPerCell: number; // Upkeep per tick per squared cell radius
  digestiveGeneEnabled: boolean; // Digestive efficiency evolves (scales plant/carrion meal extraction, charges organ upkeep)
  digestiveFounder: number;
  digestiveStep: number;
  digestiveMin: number;
  digestiveMax: number;
  digestiveUpkeepRate: number; // Upkeep per tick per unit of digestive efficiency
  fatDragCoeff: number; // Dynamic movement drag multiplier based on fat stored
  dnaVariationEnabled: boolean; // With DNA (Stage 2): mutation counts are Poisson-sampled, genes can be inserted, deleted and duplicated, and every gene costs dnaUpkeepPerGene
  dnaInsertionRate: number; // Per gene per birth: a new random gene appears at a random position
  dnaDeletionRate: number; // Per gene per birth: a gene is removed
  dnaDuplicationRate: number; // Per gene per birth: a segment of 1 to dnaDuplicationMaxLength genes is copied and inserted elsewhere
  dnaDuplicationMaxLength: number; // Longest duplicated segment (genes)
  dnaKeyFlipFraction: number; // Share of point mutations that flip one bit of a gene's index field (retargeting it) instead of stepping its dose
  dnaDosageCompensation: boolean; // A duplicated segment and its original each keep half the dose (summed traits), so a duplication changes nothing until the copies drift
  dnaUpkeepPerGene: number; // Energy per tick per gene
  dnaMaxGenes: number; // Insertions and duplications stop at this genome length (a safety rail for tick cost)
  dnaGrowableBrain: boolean; // With DNA (Stage 3): the brain is compiled from the genome as a sparse circuit with up to dnaMaxInternal hidden units; every brain gene is expressed
  dnaMaxInternal: number; // Hidden units a genome can address with the growable brain (clamped to 6..256)
  dnaUpkeepPerConnection: number; // Energy per tick per expressed acquired connection (in hidden units past the founders' 6)
  // Weather systems
  weatherEnabled: boolean;
  weatherMaxFronts: number;
  weatherSpawnInterval: number;
  weatherChillCoeff: number;
  weatherMudCoeff: number;
  weatherWindCoupling: number;
  weatherSeedDrift: number;
  weatherSignalDrift: number;
  weatherEvapRate: number;
  weatherAbsorptionRate: number;
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
  /**
   * Children made by mating so far (the rest of birthsTotal are clones), and
   * how the partners looked to each other: alike (kin cut-off), strangers, or
   * parent and child.
   */
  matingsTotal: number;
  matingsAlikeTotal: number;
  matingsOfStrangersTotal: number;
  matingsInFamilyTotal: number;
  /**
   * Children of mating born so far (the rest of birthsTotal are clones);
   * matings whose clutch failed the viability gate (minViableChildEnergy);
   * children of mating not born (failed clutches, and children with no free
   * cell), and the energy their parents paid for them, which is lost.
   */
  matingChildrenTotal: number;
  clutchesFailedTotal: number;
  matingChildrenLostTotal: number;
  matingEnergyLostTotal: number;
  /** Carrion meals eaten so far, and carrion energy lying in the world now. */
  carrionEatenTotal: number;
  carrionStock: number;
  /** Mean carnivory now, and how many organisms are mostly meat eaters (carnivory >= 0.5). */
  averageCarnivory: number;
  meatEaters: number;
  /** Genes per genome now (mean, spread, longest), or null without DNA. */
  genomeLength: { mean: number; sd: number; max: number } | null;
  /** Current season, or null when seasons are off. */
  season: 'plenty' | 'lean' | null;
  /** Plant population, or null when plants are off. */
  plants: PlantMetrics | null;
  /** Cell health of the fertile ground, or null when overgrazing is off. */
  overgrazing: OvergrazingMetrics | null;
  /** Life-history genes, or null when none is on. */
  life: LifeMetrics | null;
  /** Weather conditions, or null when weather is off. */
  weather: WeatherMetrics | null;
}

export interface WeatherMetrics {
  frontCount: number;
  avgTemp: number;
  windSpeed: number;
  windAngle: number;
}

/** Population means of the life-history genes that are switched on, and egg/rest/fat counts. */
export interface LifeMetrics {
  reproThreshold: number | null;
  investment: number | null;
  fatCapacity: number | null;
  torporDepth: number | null;
  eggAllocation: number | null;
  eggRate?: number | null;
  metabolicRate: number | null;
  clutchSize: number | null;
  size: number | null;
  sensingRadius: number | null;
  digestiveEfficiency: number | null;
  /** Mean fat held, and organisms that rested last tick. */
  fat: number | null;
  resting: number | null;
  /** Eggs waiting now, and laid / hatched / failed so far. */
  eggs: number | null;
  eggsLaidTotal: number;
  eggsHatchedTotal: number;
  eggsDecayedTotal: number;
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
  /** Active weather state snapshot, or null when weather is off. */
  readonly weather?: WeatherSnapshot | null;
}

export type WeatherFrontType = 'rain_storm' | 'cold_front' | 'heat_wave';

export interface WeatherFront {
  readonly id: number;
  readonly type: WeatherFrontType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  intensity: number;
  lifetime: number;
}

export interface WeatherSnapshot {
  readonly fronts: readonly WeatherFront[];
  readonly wind: { readonly wx: number; readonly wy: number };
  readonly moistureGrid: Uint8Array;
}
