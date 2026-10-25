import { PRNG } from './prng';
import type {
  ActionScore,
  DecisionOutcome,
  DecisionRecord,
  FoodPatch,
  FoodRegion,
  LegalAction,
  Organism,
  SimulationConfig,
  WorldMetrics,
  WorldSnapshot,
} from './types';
import { createConfig } from './config';
import { senseEnvironment } from './sensors';
import {
  createRandomPolicy,
  evaluatePolicy,
  getLegalActions,
  mutatePolicy,
} from './policy';
import { computeWorldMetrics } from './metrics';
import { MetricsHistory, type HistorySample } from './history';
import { inheritTag } from './tags';
import { regionSeasonAt, seasonAt } from './seasons';
import {
  founderAbilities,
  founderCarryCapacity,
  founderDispersal,
  inheritAbilities,
  inheritCarryCapacity,
  inheritDispersal,
  metabolismCost,
} from './traits';
import { isDiagonalMove, isLeapAction, isMoveAction } from './directions';
import { createHeadStartBrain, evaluateBrain, mutateBrain } from './brain';
import {
  MEMORY_WEIGHT_COUNT,
  founderMemorySpan,
  founderMemoryWeights,
  inheritMemorySpan,
  inheritMemoryWeights,
  newMemory,
  updateMemory,
} from './memory';
import {
  SoilField,
  computePlantMetrics,
  createPlant,
  founderGenome,
  grazePlant,
  newPlantCounters,
  plantAt,
  stepPlants,
  type PlantCounters,
} from './plants';

/**
 * Everything needed to continue a world exactly where it was: settings,
 * random number generator, counters, terrain, food and organisms (in their
 * original order, which sensing tie-breaks depend on), plus the trend
 * history. Plain data, safe to clone, store or turn into JSON.
 */
export interface WorldState {
  readonly version: 1;
  readonly config: SimulationConfig;
  readonly prng: { readonly seed: number; readonly state: number };
  readonly tick: number;
  readonly nextOrganismSeq: number;
  readonly counters: Readonly<Record<WorldCounter, number>>;
  readonly obstacles: readonly string[];
  readonly foodRegions: readonly FoodRegion[];
  readonly foodPatches: readonly FoodPatch[];
  readonly organisms: readonly Organism[];
  readonly history: { readonly samples: readonly HistorySample[]; readonly interval: number };
  /** Plant totals (absent in saves from before plants). */
  readonly plantCounters?: PlantCounters;
}

const WORLD_COUNTERS = [
  'birthsTotal',
  'deathsTotal',
  'sharesTotal',
  'kinSharesTotal',
  'parentalSharesTotal',
  'immigrantsTotal',
  'signalsTotal',
  'signalsOnFoodTotal',
  'deceasedCount',
  'deceasedLifespanSum',
  'birthDistanceSum',
  'windfallsTotal',
  'windfallUnitsPlaced',
  'windfallUnitsRotted',
] as const;
type WorldCounter = (typeof WORLD_COUNTERS)[number];

const clone = <T>(value: T): T => structuredClone(value);

export class World {
  public readonly config: SimulationConfig;
  public readonly prng: PRNG;
  public tick = 0;

  public readonly obstacles = new Set<string>(); // "x,y"
  public readonly foodPatches = new Map<string, FoodPatch>(); // "x,y" -> FoodPatch
  /** Fertile regions where food grows (empty: food can grow anywhere). */
  public readonly foodRegions: FoodRegion[] = [];
  public readonly organisms = new Map<string, Organism>(); // id -> Organism

  private nextOrganismSeq = 0;
  public birthsTotal = 0;
  public deathsTotal = 0;
  public sharesTotal = 0;
  public kinSharesTotal = 0;
  public parentalSharesTotal = 0;
  public immigrantsTotal = 0;
  public signalsTotal = 0;
  public signalsOnFoodTotal = 0;
  /** Running totals of lifespans at death (a total, not a list, so memory stays flat). */
  public deceasedCount = 0;
  public deceasedLifespanSum = 0;
  /** Sum of birth distances (steps from parent to child), for the mean. */
  public birthDistanceSum = 0;
  /** Windfalls so far, the food they brought, and the food that rotted uneaten. */
  public windfallsTotal = 0;
  public windfallUnitsPlaced = 0;
  public windfallUnitsRotted = 0;
  /** Plant totals (births, seeds, deaths by cause); used when plantsEnabled. */
  public plantCounters: PlantCounters = newPlantCounters();
  /** Soil fertility and season region per cell, built on first use (terrain and regions never change). */
  private soilField: SoilField | null = null;

  public selectedOrganismId: string | null = null;
  private cachedMetrics: WorldMetrics | null = null;
  /** Sampled metrics over the whole run, for trend charts and export. */
  public readonly history = new MetricsHistory();

  constructor(configOverrides?: Partial<SimulationConfig>) {
    this.config = createConfig(configOverrides);
    this.prng = new PRNG(this.config.seed);
    this.init();
  }

  /**
   * Initializes the world state deterministically using the configured PRNG seed.
   */
  public init(): void {
    this.tick = 0;
    this.birthsTotal = 0;
    this.deathsTotal = 0;
    this.sharesTotal = 0;
    this.kinSharesTotal = 0;
    this.parentalSharesTotal = 0;
    this.immigrantsTotal = 0;
    this.signalsTotal = 0;
    this.signalsOnFoodTotal = 0;
    this.deceasedCount = 0;
    this.deceasedLifespanSum = 0;
    this.birthDistanceSum = 0;
    this.windfallsTotal = 0;
    this.windfallUnitsPlaced = 0;
    this.windfallUnitsRotted = 0;
    this.plantCounters = newPlantCounters();
    this.soilField = null;
    this.nextOrganismSeq = 0;
    this.obstacles.clear();
    this.foodPatches.clear();
    this.foodRegions.length = 0;
    this.organisms.clear();
    this.selectedOrganismId = null;
    this.history.clear();

    this.prng.reset();

    // 1. Generate obstacles (terrain barriers)
    const { gridWidth, gridHeight, obstacleDensity } = this.config;
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        // Keep a clear border to prevent instant edge entrapment
        if (x > 1 && x < gridWidth - 2 && y > 1 && y < gridHeight - 2) {
          if (this.prng.next() < obstacleDensity) {
            this.obstacles.add(`${x},${y}`);
          }
        }
      }
    }

    // 2. Fertile regions (when enabled), then the initial food patches in them
    this.createFoodRegions();
    let placedPatches = 0;
    let patchAttempts = 0;
    while (
      placedPatches < this.config.initialFoodPatches &&
      patchAttempts < gridWidth * gridHeight * 3
    ) {
      patchAttempts++;
      if (this.tryPlacePatch()) placedPatches++;
    }

    // 3. Generate initial pioneer organisms at valid free locations
    let placedOrganisms = 0;
    let orgAttempts = 0;
    const occupiedCells = new Set<string>();

    while (
      placedOrganisms < this.config.initialOrganisms &&
      orgAttempts < gridWidth * gridHeight * 3
    ) {
      orgAttempts++;
      const x = this.prng.nextInt(0, gridWidth - 1);
      const y = this.prng.nextInt(0, gridHeight - 1);
      const key = `${x},${y}`;

      if (!this.obstacles.has(key) && !occupiedCells.has(key)) {
        occupiedCells.add(key);
        const organism = this.createFounder(x, y);
        this.organisms.set(organism.id, organism);
        placedOrganisms++;
      }
    }

    this.birthsTotal = placedOrganisms;
    this.updateMetrics();
  }

  /**
   * Places food regions as discs at random centres, kept apart where
   * possible. Each gets an evenly spaced season phase, used when seasons are
   * staggered. Draws nothing from the PRNG when regions are off.
   */
  private createFoodRegions(): void {
    const { foodRegionCount: count, foodRegionRadius: radius, gridWidth, gridHeight } = this.config;
    for (let i = 0; i < count; i++) {
      let best: { x: number; y: number } | null = null;
      let bestGap = -Infinity;
      // Up to 20 tries for a centre at least 1.5 radii from the others;
      // otherwise the try farthest from its nearest neighbour.
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = this.prng.nextInt(0, gridWidth - 1);
        const y = this.prng.nextInt(0, gridHeight - 1);
        let gap = Infinity;
        for (const r of this.foodRegions) gap = Math.min(gap, Math.hypot(r.x - x, r.y - y));
        if (gap > bestGap) {
          best = { x, y };
          bestGap = gap;
        }
        if (gap >= radius * 1.5) break;
      }
      this.foodRegions.push({ ...best!, radius, seasonPhase: i / count });
    }
  }

  /**
   * One attempt to place a new food patch at a random cell: anywhere when
   * there are no regions, otherwise inside a randomly chosen region that is
   * not in a lean season (pass `skipLean`). Returns whether a patch was placed.
   */
  private tryPlacePatch(skipLean = false): boolean {
    const { gridWidth, gridHeight } = this.config;
    let x: number;
    let y: number;
    let region: number | undefined;
    if (this.foodRegions.length === 0) {
      x = this.prng.nextInt(0, gridWidth - 1);
      y = this.prng.nextInt(0, gridHeight - 1);
    } else {
      region = this.prng.nextInt(0, this.foodRegions.length - 1);
      const r = this.foodRegions[region];
      const radius = Math.floor(r.radius);
      const dx = this.prng.nextInt(-radius, radius);
      const dy = this.prng.nextInt(-radius, radius);
      if (dx * dx + dy * dy > r.radius * r.radius) return false;
      if (skipLean && regionSeasonAt(this.tick, r, this.config)?.season === 'lean') return false;
      x = r.x + dx;
      y = r.y + dy;
      if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) return false;
    }
    const key = `${x},${y}`;
    if (this.obstacles.has(key) || this.foodPatches.has(key)) return false;
    if (this.config.plantsEnabled) {
      // A founder plant instead of a patch, starting with the patch's stock.
      const plant = createPlant(this.plantCounters, founderGenome(this.prng), this.config.foodPatchInitialStock, this.tick, null);
      plantAt(this.foodPatches, this.soil(), gridWidth, x, y, plant);
      return true;
    }
    this.foodPatches.set(key, {
      x,
      y,
      stock: this.config.foodPatchInitialStock,
      capacity: this.config.foodPatchCapacity,
      ...(region === undefined ? {} : { region }),
    });
    return true;
  }

  /** Soil fertility and season regions, built once the terrain and regions exist. */
  private soil(): SoilField {
    this.soilField ??= new SoilField(this.config, this.foodRegions, this.obstacles);
    return this.soilField;
  }

  /**
   * A founder of a new lineage with a random policy and tag: the initial
   * pioneers, and later immigrants.
   */
  private createFounder(x: number, y: number): Organism {
    this.nextOrganismSeq++;
    const policy = createRandomPolicy(this.prng);
    const tag = Number(this.prng.nextFloat(0, 360).toFixed(2));
    const carryCapacity = founderCarryCapacity(this.config, this.prng);
    const brain = createHeadStartBrain(this.prng);
    const abilities = founderAbilities(this.config, this.prng);
    const dispersal = founderDispersal(this.config, this.prng);
    const memorySpan = founderMemorySpan(this.config, this.prng);
    const memoryWeights = founderMemoryWeights(this.prng);
    return {
      id: `org-${this.nextOrganismSeq}`,
      x,
      y,
      energy: this.config.initialEnergy,
      policy,
      tag,
      carryCapacity,
      abilities,
      dispersal,
      memorySpan,
      memoryWeights,
      memory: newMemory(x, y),
      brain,
      lineage: {
        id: `lineage-${this.nextOrganismSeq}`,
        parentId: null,
        generation: 1,
        birthTick: this.tick,
      },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      signalTick: -1,
      recentHistory: [],
    };
  }

  /**
   * A copy of the full state (organisms keep only their latest decision,
   * which is all the simulation and the page use).
   */
  public exportState(): WorldState {
    return {
      version: 1,
      config: { ...this.config },
      prng: { seed: this.prng.getSeed(), state: this.prng.getState() >>> 0 },
      tick: this.tick,
      nextOrganismSeq: this.nextOrganismSeq,
      counters: Object.fromEntries(WORLD_COUNTERS.map((k) => [k, this[k]])) as Record<WorldCounter, number>,
      obstacles: Array.from(this.obstacles),
      foodRegions: this.foodRegions.map((r) => ({ ...r })),
      foodPatches: Array.from(this.foodPatches.values(), (p) => clone(p)),
      organisms: Array.from(this.organisms.values(), (o) => clone({ ...o, recentHistory: o.recentHistory.slice(0, 1) })),
      history: this.history.exportState(),
      plantCounters: { ...this.plantCounters },
    };
  }

  /** A world that continues exactly from a saved state. */
  public static fromState(state: WorldState): World {
    if (state.version !== 1) throw new Error(`Unknown world state version ${String(state.version)}`);
    const world = new World({ ...state.config, initialOrganisms: 0, initialFoodPatches: 0, obstacleDensity: 0, foodRegionCount: 0 });
    Object.assign(world.config, state.config);
    world.prng.setSeed(state.prng.seed);
    world.prng.setState(state.prng.state);
    world.tick = state.tick;
    world.nextOrganismSeq = state.nextOrganismSeq;
    // Saves from before a field existed load with its neutral default.
    for (const k of WORLD_COUNTERS) world[k] = state.counters[k] ?? 0;
    world.obstacles.clear();
    for (const key of state.obstacles) world.obstacles.add(key);
    world.foodRegions.length = 0;
    world.foodRegions.push(...state.foodRegions.map((r) => ({ ...r })));
    world.foodPatches.clear();
    for (const p of state.foodPatches) world.foodPatches.set(`${p.x},${p.y}`, clone(p));
    world.plantCounters = { ...newPlantCounters(), ...state.plantCounters };
    world.soilField = null;
    world.organisms.clear();
    for (const o of state.organisms) {
      world.organisms.set(o.id, {
        ...clone(o),
        dispersal: o.dispersal ?? 1,
        memorySpan: o.memorySpan ?? 0,
        memoryWeights: o.memoryWeights ? [...o.memoryWeights] : new Array<number>(MEMORY_WEIGHT_COUNT).fill(0),
        memory: o.memory ? clone(o.memory) : newMemory(o.x, o.y),
      });
    }
    world.history.importState(state.history);
    world.selectedOrganismId = null;
    world.cachedMetrics = null;
    return world;
  }

  /**
   * Resets the simulation to tick 0. Optionally with a new seed.
   */
  public reset(newSeed?: number | string): void {
    if (newSeed !== undefined) {
      this.config.seed = newSeed;
      this.prng.setSeed(newSeed);
    }
    this.init();
  }

  /**
   * Captures an immutable pre-tick snapshot of the world for simultaneous decisions.
   */
  public getSnapshot(): WorldSnapshot {
    const foodCopy = new Map<string, FoodPatch>();
    for (const [k, v] of this.foodPatches) {
      foodCopy.set(k, { ...v });
    }

    const { gridWidth, gridHeight } = this.config;
    const obstacleGrid = new Uint8Array(gridWidth * gridHeight);
    const foodGrid = new Int32Array(gridWidth * gridHeight);
    const organismGrid = new Int32Array(gridWidth * gridHeight).fill(-1);
    for (const key of this.obstacles) {
      const [ox, oy] = key.split(',').map(Number);
      obstacleGrid[oy * gridWidth + ox] = 1;
    }
    for (const patch of this.foodPatches.values()) {
      foodGrid[patch.y * gridWidth + patch.x] = patch.stock;
    }

    const orgsList: Organism[] = [];
    const organismAt = new Map<string, Organism>();
    const signallers: number[] = [];
    for (const org of this.organisms.values()) {
      const copy: Organism = {
        ...org,
        policy: { ...org.policy },
        lineage: { ...org.lineage },
        recentHistory: [...org.recentHistory],
      };
      organismGrid[org.y * gridWidth + org.x] = orgsList.length;
      if (org.signalTick >= 0 && org.signalTick === this.tick - 1) signallers.push(orgsList.length);
      orgsList.push(copy);
      organismAt.set(`${org.x},${org.y}`, copy);
    }

    return {
      tick: this.tick,
      gridWidth: this.config.gridWidth,
      gridHeight: this.config.gridHeight,
      obstacles: new Set(this.obstacles),
      foodPatches: foodCopy,
      organisms: orgsList,
      organismAt,
      obstacleGrid,
      foodGrid,
      organismGrid,
      signallers,
    };
  }

  /**
   * Advances the simulation by exactly one discrete tick.
   * Enforces simultaneous decisions, fair seeded tie-breakers, and explicit energy accounting.
   */
  public step(): void {
    if (this.organisms.size === 0) {
      // Same order as a populated tick: advance, then update the environment.
      this.tick++;
      this.updateEnvironment();
      this.updateMetrics();
      return;
    }

    // Phase 1: Pre-tick snapshot
    const snapshot = this.getSnapshot();

    // Phase 2: Simultaneous decision evaluation
    // Sort organisms by ID for strictly deterministic order of iteration
    const sortedLiving = Array.from(this.organisms.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    interface IntendedActionData {
      organism: Organism;
      sensed: ReturnType<typeof senseEnvironment>;
      scores: ActionScore[];
      chosenAction: LegalAction;
      moveTargetKey?: string;
      /** A move that trades places with this child or parent instead. */
      swapWithId?: string;
      reproTargetKey?: string;
      approved: boolean;
      outcome: DecisionOutcome;
    }

    const intentions = new Map<string, IntendedActionData>();

    for (const org of sortedLiving) {
      const sensed = senseEnvironment(org, snapshot, this.config);
      const legalActions = getLegalActions(org, snapshot, this.config, sensed);
      const choose = this.config.controller === 'brain' ? evaluateBrain : evaluatePolicy;
      const { chosenAction, scores } = choose(org, legalActions, sensed, this.config, this.prng);

      let moveTargetKey: string | undefined;
      let swapWithId: string | undefined;
      let reproTargetKey: string | undefined;

      if (isMoveAction(chosenAction.type) && chosenAction.swapWithId) {
        // A swap keeps both cells occupied, so it stays out of the ordinary
        // move resolution below and the parent's cell remains reserved.
        swapWithId = chosenAction.swapWithId;
      } else if (
        (isMoveAction(chosenAction.type) || isLeapAction(chosenAction.type)) &&
        chosenAction.target
      ) {
        // Leaps resolve like moves to their landing cell.
        moveTargetKey = `${chosenAction.target.x},${chosenAction.target.y}`;
      } else if (chosenAction.type.startsWith('REPRODUCE_') && chosenAction.target) {
        reproTargetKey = `${chosenAction.target.x},${chosenAction.target.y}`;
      }

      intentions.set(org.id, {
        organism: org,
        sensed,
        scores,
        chosenAction,
        moveTargetKey,
        swapWithId,
        reproTargetKey,
        approved: true,
        outcome: 'success',
      });
    }

    // Phase 3: Conflict Resolution
    // 3a. Resolve multiple organisms moving to the SAME target cell
    const cellToMoveContenders = new Map<string, IntendedActionData[]>();
    for (const item of intentions.values()) {
      if (item.moveTargetKey) {
        const list = cellToMoveContenders.get(item.moveTargetKey) ?? [];
        list.push(item);
        cellToMoveContenders.set(item.moveTargetKey, list);
      }
    }

    for (const contenders of cellToMoveContenders.values()) {
      if (contenders.length > 1) {
        // Pick one winner using seeded PRNG
        const winner = this.prng.choice(contenders);
        for (const c of contenders) {
          if (c !== winner) {
            c.approved = false;
            c.outcome = 'conflict_lost';
          }
        }
      }
    }

    // 3b. Resolve moves into cells that remain occupied by stationary organisms
    // An organism is stationary if it is eating, resting, reproducing, or had its move rejected.
    let changed = true;
    while (changed) {
      changed = false;
      // Recompute which cells will be occupied by stationary organisms
      const stationaryPositions = new Set<string>();
      for (const item of intentions.values()) {
        if (!item.moveTargetKey || !item.approved) {
          stationaryPositions.add(`${item.organism.x},${item.organism.y}`);
        }
      }

      for (const item of intentions.values()) {
        if (item.approved && item.moveTargetKey) {
          if (stationaryPositions.has(item.moveTargetKey)) {
            item.approved = false;
            item.outcome = 'blocked_by_organism';
            changed = true;
          }
        }
      }
    }

    // 3c. Prevent head-on cell swaps (A moves to B, B moves to A). Each mover
    // has one target, so only the organism standing there can be its partner.
    const intentionAt = new Map<string, IntendedActionData>();
    for (const item of intentions.values()) {
      intentionAt.set(`${item.organism.x},${item.organism.y}`, item);
    }
    for (const itemA of intentions.values()) {
      if (!itemA.approved || !itemA.moveTargetKey) continue;
      const itemB = intentionAt.get(itemA.moveTargetKey);
      if (!itemB || itemB === itemA || !itemB.approved || !itemB.moveTargetKey) continue;
      if (itemB.moveTargetKey === `${itemA.organism.x},${itemA.organism.y}`) {
        // Mutual swap conflict: neither can pass through
        itemA.approved = false;
        itemA.outcome = 'blocked_by_organism';
        itemB.approved = false;
        itemB.outcome = 'blocked_by_organism';
      }
    }

    // 3c'. Family swaps. Two family members swapping into each other make one
    // trade. Otherwise a swap needs its target to stay in its cell this tick
    // (not moving away, not swapping elsewhere), and only one swapper per
    // target can take its cell: a seeded random pick among contenders.
    const swapsByTarget = new Map<string, IntendedActionData[]>();
    for (const item of intentions.values()) {
      if (!item.swapWithId) continue;
      const list = swapsByTarget.get(item.swapWithId) ?? [];
      list.push(item);
      swapsByTarget.set(item.swapWithId, list);
    }
    const rejectSwap = (item: IntendedActionData) => {
      item.approved = false;
      item.outcome = 'blocked_by_organism';
    };
    for (const [targetId, swappers] of swapsByTarget) {
      const target = intentions.get(targetId);
      const mutual = swappers.find((s) => target?.swapWithId === s.organism.id);
      if (mutual) {
        for (const s of swappers) if (s !== mutual) rejectSwap(s);
        continue;
      }
      const targetStays =
        target !== undefined && !(target.moveTargetKey && target.approved) && !target.swapWithId;
      if (!targetStays) {
        swappers.forEach(rejectSwap);
        continue;
      }
      const winner = swappers.length === 1 ? swappers[0] : this.prng.choice(swappers);
      for (const s of swappers) if (s !== winner) rejectSwap(s);
    }

    // 3d. Resolve reproduction collisions
    // Reproduction requires the target cell to be completely empty after moves are finalized
    const finalOccupiedCells = new Set<string>();
    for (const item of intentions.values()) {
      if (item.approved && item.moveTargetKey && item.chosenAction.target) {
        finalOccupiedCells.add(`${item.chosenAction.target.x},${item.chosenAction.target.y}`);
      } else {
        finalOccupiedCells.add(`${item.organism.x},${item.organism.y}`);
      }
    }

    const reproContenders = new Map<string, IntendedActionData[]>();
    for (const item of intentions.values()) {
      if (item.reproTargetKey) {
        if (finalOccupiedCells.has(item.reproTargetKey)) {
          item.approved = false;
          item.outcome = 'blocked_by_organism';
        } else {
          const list = reproContenders.get(item.reproTargetKey) ?? [];
          list.push(item);
          reproContenders.set(item.reproTargetKey, list);
        }
      }
    }

    for (const contenders of reproContenders.values()) {
      if (contenders.length > 1) {
        const winner = this.prng.choice(contenders);
        for (const c of contenders) {
          if (c !== winner) {
            c.approved = false;
            c.outcome = 'conflict_lost';
          }
        }
      }
    }

    // Cells a dispersing child cannot land in: taken after this tick's moves,
    // or the approved birth cell of another parent. Children placed earlier
    // this tick are added as they are born.
    const birthBlocked = new Set(finalOccupiedCells);
    for (const item of intentions.values()) {
      if (item.reproTargetKey && item.approved) birthBlocked.add(item.reproTargetKey);
    }

    // Phase 4: Action Execution & Energy Accounting
    const newBorns: Organism[] = [];
    // Food gifts leave the donor during its action and are eaten by the
    // recipient after all actions, so every organism acts on the same
    // pre-tick state.
    const pendingGifts: { recipientId: string }[] = [];
    // Family swaps also happen after all actions, so the one being passed acts
    // from the cell it stood in. Keyed by the pair, so a mutual swap (both
    // moving into each other) trades places once.
    const pendingSwaps = new Map<string, { mover: Organism; otherId: string }>();

    for (const item of intentions.values()) {
      const { organism, sensed, scores, chosenAction, approved } = item;
      const startCell = { x: organism.x, y: organism.y };
      let outcome = item.outcome;
      // Base metabolism, plus the upkeep of carry capacity
      const metabolism = metabolismCost(organism, this.config);
      let energyDelta = -metabolism;
      organism.energy -= metabolism;

      switch (chosenAction.type) {
        case 'EAT': {
          const key = `${organism.x},${organism.y}`;
          const patch = this.foodPatches.get(key);
          // Eat from the patch underfoot if there is one, otherwise from carried food.
          const fromPatch = patch !== undefined && patch.stock > 0;
          if ((fromPatch || organism.carriedFood > 0) && organism.energy < this.config.maxEnergy) {
            const energyGain = Math.min(
              this.config.maxEnergy - organism.energy,
              this.config.foodEnergyYield
            );
            organism.energy += energyGain;
            if (fromPatch) {
              patch.stock -= 1;
              grazePlant(patch, this.tick, this.plantCounters);
            } else organism.carriedFood -= 1;
            organism.foodEatenCount++;
            energyDelta += energyGain;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'MOVE_NORTH':
        case 'MOVE_SOUTH':
        case 'MOVE_EAST':
        case 'MOVE_WEST':
        case 'MOVE_NORTHEAST':
        case 'MOVE_NORTHWEST':
        case 'MOVE_SOUTHEAST':
        case 'MOVE_SOUTHWEST':
        case 'LEAP_NORTH':
        case 'LEAP_SOUTH':
        case 'LEAP_EAST':
        case 'LEAP_WEST': {
          // Diagonals cost more (longer step); squeezing past a stranger and
          // leaping cost more again. Nothing is paid for a move that fails.
          const { moveCost } = this.config;
          const cost = isLeapAction(chosenAction.type)
            ? moveCost * this.config.leapCostMultiplier
            : moveCost *
              (isDiagonalMove(chosenAction.type) ? this.config.diagonalMoveCost : 1) *
              (chosenAction.swapRelation === 'squeeze' ? this.config.squeezeCostMultiplier : 1);
          if (approved && item.swapWithId) {
            // Trade places with the other organism after all actions (see below).
            organism.energy -= cost;
            energyDelta -= cost;
            pendingSwaps.set([organism.id, item.swapWithId].sort().join('|'), {
              mover: organism,
              otherId: item.swapWithId,
            });
            outcome = 'success';
          } else if (approved && chosenAction.target) {
            organism.x = chosenAction.target.x;
            organism.y = chosenAction.target.y;
            organism.energy -= cost;
            energyDelta -= cost;
            outcome = 'success';
          }
          // If not approved, no move cost is paid.
          break;
        }

        case 'REPRODUCE_NORTH':
        case 'REPRODUCE_SOUTH':
        case 'REPRODUCE_EAST':
        case 'REPRODUCE_WEST': {
          if (approved && chosenAction.target) {
            const childEnergy = Math.floor(
              organism.energy * this.config.reproductionEnergyFraction
            );
            const totalReproCost = childEnergy + this.config.reproductionMetabolismTax;

            if (organism.energy > totalReproCost && childEnergy > 0) {
              // Where the child lands: next to the parent, or (with
              // dispersal) any free cell up to the parent's dispersal
              // distance it can afford, picked at random.
              const birth = this.birthCell(organism, chosenAction.target, organism.energy - totalReproCost, birthBlocked);
              const birthCost = totalReproCost + birth.extraCost;
              organism.energy -= birthCost;
              organism.offspringCount++;
              energyDelta -= birthCost;
              birthBlocked.add(`${birth.x},${birth.y}`);
              this.birthDistanceSum += birth.distance;

              this.nextOrganismSeq++;
              const childId = `org-${this.nextOrganismSeq}`;
              const childPolicy = mutatePolicy(
                organism.policy,
                this.config,
                this.prng
              );
              const childTag = inheritTag(organism.tag, this.config, this.prng);
              const childCapacity = inheritCarryCapacity(
                organism.carryCapacity,
                this.config,
                this.prng
              );
              const childBrain = mutateBrain(organism.brain, this.config, this.prng);
              const childAbilities = inheritAbilities(organism.abilities, this.config, this.prng);
              const childDispersal = inheritDispersal(organism.dispersal, this.config, this.prng);
              const childMemorySpan = inheritMemorySpan(organism.memorySpan, this.config, this.prng);
              const childMemoryWeights = inheritMemoryWeights(organism.memoryWeights, this.config, this.prng);

              const child: Organism = {
                id: childId,
                x: birth.x,
                y: birth.y,
                energy: childEnergy,
                policy: childPolicy,
                tag: childTag,
                carryCapacity: childCapacity,
                abilities: childAbilities,
                dispersal: childDispersal,
                memorySpan: childMemorySpan,
                memoryWeights: childMemoryWeights,
                memory: newMemory(birth.x, birth.y),
                brain: childBrain,
                lineage: {
                  id: organism.lineage.id,
                  parentId: organism.id,
                  generation: organism.lineage.generation + 1,
                  birthTick: this.tick,
                },
                age: 0,
                offspringCount: 0,
                foodEatenCount: 0,
                carriedFood: 0,
                foodGiven: 0,
                foodReceived: 0,
                signalTick: -1,
                recentHistory: [],
              };

              newBorns.push(child);
              this.birthsTotal++;
              outcome = 'success';
            } else {
              outcome = 'energy_too_low';
            }
          }
          break;
        }

        case 'PICK_UP': {
          const patch = this.foodPatches.get(`${organism.x},${organism.y}`);
          if (patch && patch.stock > 0 && organism.carriedFood < organism.carryCapacity) {
            patch.stock -= 1;
            grazePlant(patch, this.tick, this.plantCounters);
            organism.carriedFood += 1;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'GIVE_NORTH':
        case 'GIVE_SOUTH':
        case 'GIVE_EAST':
        case 'GIVE_WEST': {
          if (chosenAction.recipientId && organism.carriedFood > 0) {
            organism.carriedFood -= 1;
            organism.foodGiven += 1;
            pendingGifts.push({ recipientId: chosenAction.recipientId });
            this.sharesTotal++;
            if (chosenAction.recipientIsKin) this.kinSharesTotal++;
            if (chosenAction.recipientIsChild) this.parentalSharesTotal++;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'SIGNAL': {
          organism.energy -= this.config.signalCost;
          energyDelta -= this.config.signalCost;
          organism.signalTick = this.tick;
          this.signalsTotal++;
          if (sensed.currentCellFood > 0) this.signalsOnFoodTotal++;
          outcome = 'success';
          break;
        }

        case 'REST': {
          outcome = 'rested';
          break;
        }
      }

      // Memory takes in what was sensed at the start of this tick.
      if (this.config.memoryEnabled && organism.memorySpan > 0) {
        updateMemory(organism.memory, organism.memoryWeights, sensed, organism.carryCapacity, startCell, this.tick);
      }

      // Clamp energy [0, maxEnergy]
      organism.energy = Math.max(0, Math.min(this.config.maxEnergy, organism.energy));
      organism.age++;

      // Record decision history
      const decisionRecord: DecisionRecord = {
        tick: this.tick,
        sensed,
        scores,
        chosenAction,
        outcome,
        energyDelta: Number(energyDelta.toFixed(2)),
        energyAfter: Number(organism.energy.toFixed(2)),
      };

      // Only the latest decision keeps its full scoring breakdown (the
      // inspector shows it); older entries keep the summary, saving memory.
      const previous = organism.recentHistory[0];
      if (previous && previous.scores.length > 0) {
        organism.recentHistory[0] = { ...previous, scores: [] };
      }
      organism.recentHistory.unshift(decisionRecord);
      if (organism.recentHistory.length > 8) {
        organism.recentHistory.pop();
      }
    }

    // Family members trade places (only the mover pays the move cost)
    for (const { mover, otherId } of pendingSwaps.values()) {
      const other = this.organisms.get(otherId);
      if (!other) continue;
      const [mx, my] = [mover.x, mover.y];
      mover.x = other.x;
      mover.y = other.y;
      other.x = mx;
      other.y = my;
    }

    // Deliver food gifts: the recipient eats each one (energy capped at the
    // maximum; any excess from that unit is lost).
    for (const gift of pendingGifts) {
      const recipient = this.organisms.get(gift.recipientId);
      if (!recipient) continue;
      const gain = Math.min(this.config.maxEnergy - recipient.energy, this.config.foodEnergyYield);
      recipient.energy += gain;
      recipient.foodReceived += 1;
      recipient.foodEatenCount++;
    }

    // Add newborns to population
    for (const child of newBorns) {
      this.organisms.set(child.id, child);
    }

    // Phase 5: Deaths
    for (const [id, org] of Array.from(this.organisms.entries())) {
      if (org.energy <= 0) {
        this.deceasedCount++;
        this.deceasedLifespanSum += org.age;
        this.deathsTotal++;
        this.organisms.delete(id);
      }
    }

    // Increment simulation tick
    this.tick++;

    // Phase 6: Food regeneration and spawning
    this.updateEnvironment();

    // Recompute world metrics
    this.updateMetrics();
  }

  /**
   * A windfall: a cluster of up to windfallPatches patches around a random
   * free cell, sharing windfallUnits between them, rotting after
   * windfallLifetime ticks. Gives up quietly if no free spot turns up.
   */
  private placeWindfall(): void {
    const { gridWidth, gridHeight, windfallUnits, windfallPatches, windfallLifetime } = this.config;
    const free = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < gridWidth && y < gridHeight && !this.obstacles.has(`${x},${y}`) && !this.foodPatches.has(`${x},${y}`);
    for (let attempt = 0; attempt < 30; attempt++) {
      const cx = this.prng.nextInt(0, gridWidth - 1);
      const cy = this.prng.nextInt(0, gridHeight - 1);
      if (!free(cx, cy)) continue;
      const offsets: [number, number][] = [];
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (dx || dy) offsets.push([dx, dy]);
      this.prng.shuffle(offsets);
      const cells: [number, number][] = [[cx, cy]];
      for (const [dx, dy] of offsets) {
        if (cells.length >= windfallPatches) break;
        if (free(cx + dx, cy + dy)) cells.push([cx + dx, cy + dy]);
      }
      // Share the units out evenly; the first patches take any remainder.
      const each = Math.floor(windfallUnits / cells.length);
      let extra = windfallUnits - each * cells.length;
      for (const [x, y] of cells) {
        const stock = each + (extra-- > 0 ? 1 : 0);
        this.foodPatches.set(`${x},${y}`, { x, y, stock, capacity: stock, expiresAt: this.tick + windfallLifetime });
      }
      this.windfallsTotal++;
      this.windfallUnitsPlaced += windfallUnits;
      return;
    }
  }

  /**
   * Where a child is born. Without dispersal (or with distance 1) it is the
   * chosen adjacent cell. Otherwise a random free cell within the parent's
   * dispersal distance (in steps), limited to what the parent can afford at
   * dispersalCost per step beyond the first; the adjacent target is always a
   * candidate, so a birth never fails for lack of room further away.
   */
  private birthCell(
    parent: Readonly<Organism>,
    target: { x: number; y: number },
    spare: number,
    blocked: ReadonlySet<string>
  ): { x: number; y: number; distance: number; extraCost: number } {
    const { dispersalEnabled, dispersalCost, gridWidth, gridHeight } = this.config;
    const adjacent = { x: target.x, y: target.y, distance: 1, extraCost: 0 };
    if (!dispersalEnabled || parent.dispersal <= 1) return adjacent;
    const affordable = dispersalCost > 0 ? 1 + Math.floor(spare / dispersalCost) : parent.dispersal;
    const reach = Math.min(parent.dispersal, affordable);
    if (reach <= 1) return adjacent;
    const candidates: { x: number; y: number; distance: number }[] = [];
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const distance = Math.abs(dx) + Math.abs(dy);
        if (distance === 0 || distance > reach) continue;
        const x = parent.x + dx;
        const y = parent.y + dy;
        if (x === target.x && y === target.y) {
          candidates.push({ x, y, distance });
          continue;
        }
        if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) continue;
        const key = `${x},${y}`;
        if (this.obstacles.has(key) || blocked.has(key)) continue;
        candidates.push({ x, y, distance });
      }
    }
    const pick = this.prng.choice(candidates);
    return { ...pick, extraCost: (pick.distance - 1) * dispersalCost };
  }

  /**
   * Regenerates existing food patches and periodically spawns new ones.
   */
  private updateEnvironment(): void {
    const {
      foodRegenInterval,
      foodRegenAmount,
      foodSpawnInterval,
      foodSpawnCount,
      maxFoodPatches,
      gridWidth,
      gridHeight,
    } = this.config;

    // Lean times: food regrows more slowly and no new patches appear. With
    // regions, each region may be in its own season.
    const leanRegrowInterval = foodRegenInterval * Math.max(1, this.config.leanSlowdown);
    const worldLean = seasonAt(this.tick, this.config)?.season === 'lean';
    const regionLean = this.foodRegions.map(
      (r) => regionSeasonAt(this.tick, r, this.config)?.season === 'lean'
    );

    // 0. Windfall leftovers rot away
    let windfallPatchCount = 0;
    for (const [key, patch] of this.foodPatches) {
      if (patch.expiresAt === undefined) continue;
      if (patch.expiresAt <= this.tick) {
        this.windfallUnitsRotted += patch.stock;
        this.foodPatches.delete(key);
      } else {
        windfallPatchCount++;
      }
    }

    // 1a. Plants grow, seed and die in place of classic regrowth and spawning.
    if (this.config.plantsEnabled) {
      stepPlants({
        config: this.config,
        tick: this.tick,
        prng: this.prng,
        obstacles: this.obstacles,
        patches: this.foodPatches,
        field: this.soil(),
        regionLean,
        worldLean,
        counters: this.plantCounters,
      });
    }

    // 1b. Food patch stock regeneration (windfalls never regrow)
    // Lean regrowth ticks are a subset of plenty ones (a multiple of the interval).
    if (!this.config.plantsEnabled && this.tick > 0 && this.tick % foodRegenInterval === 0) {
      const regrowsLean = this.tick % leanRegrowInterval === 0;
      for (const patch of this.foodPatches.values()) {
        if (patch.expiresAt !== undefined) continue;
        const lean = patch.region === undefined ? worldLean : regionLean[patch.region];
        if ((!lean || regrowsLean) && patch.stock < patch.capacity) {
          patch.stock = Math.min(patch.capacity, patch.stock + foodRegenAmount);
        }
      }
    }

    // 2. Food patch spawning (only where it is not lean)
    const anyPlenty = this.foodRegions.length > 0 ? regionLean.includes(false) : !worldLean;
    if (!this.config.plantsEnabled && anyPlenty && this.tick > 0 && this.tick % foodSpawnInterval === 0) {
      let spawned = 0;
      let attempts = 0;
      while (
        spawned < foodSpawnCount &&
        // Windfalls don't count against the limit on ordinary patches.
        this.foodPatches.size - windfallPatchCount < maxFoodPatches &&
        attempts < 50
      ) {
        attempts++;
        if (this.tryPlacePatch(true)) spawned++;
      }
    }

    // 2b. Windfalls: now and then a rich, short-lived burst of food lands
    // anywhere, whatever the season. Draws nothing from the PRNG when off.
    const { windfallsEnabled, windfallInterval } = this.config;
    if (windfallsEnabled && windfallInterval > 0 && this.tick > 0 && this.tick % windfallInterval === 0) {
      this.placeWindfall();
    }

    // 3. Immigration: newcomers with random tags and policies arrive in
    // random free cells, so look-alike groups are not just families.
    const { immigrationInterval, immigrationCount } = this.config;
    if (immigrationInterval > 0 && this.tick > 0 && this.tick % immigrationInterval === 0) {
      const occupied = new Set<string>();
      for (const o of this.organisms.values()) occupied.add(`${o.x},${o.y}`);
      let arrived = 0;
      let attempts = 0;
      while (arrived < immigrationCount && attempts < 50) {
        attempts++;
        const x = this.prng.nextInt(0, gridWidth - 1);
        const y = this.prng.nextInt(0, gridHeight - 1);
        const key = `${x},${y}`;
        if (this.obstacles.has(key) || occupied.has(key)) continue;
        const immigrant = this.createFounder(x, y);
        this.organisms.set(immigrant.id, immigrant);
        occupied.add(key);
        this.immigrantsTotal++;
        arrived++;
      }
    }
  }

  /**
   * Called at the end of every tick. Metrics are computed lazily (they never
   * affect the simulation), so this only invalidates the cache and computes
   * them when the history wants a sample this tick.
   */
  public updateMetrics(): void {
    this.cachedMetrics = null;
    if (this.history.wantsSample(this.tick)) {
      this.history.record(this.getMetrics(), Array.from(this.organisms.values()));
    }
  }

  private computeMetrics(): WorldMetrics {
    let totalFoodStock = 0;
    let activePatchCount = 0;

    for (const patch of this.foodPatches.values()) {
      if (patch.stock > 0) {
        activePatchCount++;
        totalFoodStock += patch.stock;
      }
    }

    const organisms = Array.from(this.organisms.values());
    return {
      ...computeWorldMetrics(
        this.tick,
        organisms,
        totalFoodStock,
        activePatchCount,
        this.birthsTotal,
        this.deathsTotal,
        { count: this.deceasedCount, lifespanSum: this.deceasedLifespanSum },
        this.sharesTotal,
        this.kinSharesTotal,
        this.parentalSharesTotal,
        this.immigrantsTotal,
        this.config
      ),
      signalsTotal: this.signalsTotal,
      signalsOnFoodTotal: this.signalsOnFoodTotal,
      season: this.worldSeason(),
      plants: this.config.plantsEnabled ? computePlantMetrics(this.foodPatches, this.plantCounters) : null,
    };
  }

  /**
   * The season shared by the whole world, or null when seasons are off or
   * staggered by region (then each region has its own).
   */
  public worldSeason(): 'plenty' | 'lean' | null {
    if (this.config.staggeredSeasons && this.foodRegions.length > 0) return null;
    return seasonAt(this.tick, this.config)?.season ?? null;
  }

  public getOrganism(id: string): Organism | undefined {
    return this.organisms.get(id);
  }

  /** Same as getMetrics(). */
  public get metrics(): WorldMetrics {
    return this.getMetrics();
  }

  public getMetrics(): WorldMetrics {
    this.cachedMetrics ??= this.computeMetrics();
    return this.cachedMetrics;
  }

  public getOrganismAt(x: number, y: number): Organism | undefined {
    for (const org of this.organisms.values()) {
      if (org.x === x && org.y === y) {
        return org;
      }
    }
    return undefined;
  }

  public selectOrganism(id: string | null): void {
    this.selectedOrganismId = id;
  }

  public getSelectedOrganism(): Organism | undefined {
    if (!this.selectedOrganismId) return undefined;
    return this.organisms.get(this.selectedOrganismId);
  }
}
