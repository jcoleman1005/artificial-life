import { PRNG } from './prng';
import { DIRECTION_OFFSETS } from './types';
import type {
  ActionScore,
  CarrionPatch,
  DecisionOutcome,
  DecisionRecord,
  Egg,
  FoodPatch,
  FoodRegion,
  LegalAction,
  Organism,
  LifeMetrics,
  SimulationConfig,
  WorldMetrics,
  WorldSnapshot,
} from './types';
import { createConfig } from './config';
import { isParentOrChild } from './family';
import { heritableOf, mixPolicies, recombine } from './sex';
import { hashString } from './state-hash';
import { senseEnvironment } from './sensors';
import {
  createRandomPolicy,
  evaluatePolicy,
  getLegalActions,
  mutatePolicy,
} from './policy';
import { computeWorldMetrics } from './metrics';
import { MetricsHistory, type HistorySample } from './history';
import { inheritTag, tagSimilarity } from './tags';
import { regionSeasonAt, seasonAt } from './seasons';
import { CellHealth, fertileCells, type CellHealthState } from './grazing';
import {
  carrionFromBody,
  founderAbilities,
  founderCarnivory,
  founderCarryCapacity,
  founderDispersal,
  inheritAbilities,
  inheritCarnivory,
  inheritCarryCapacity,
  inheritDispersal,
  metabolismCost,
  plantYield,
  moveEnergyCost,
  splitDiets,
  herbivoryOf,
} from './traits';
import { isDiagonalMove, isLeapAction, isMoveAction } from './directions';
import {
  birthCooldownOf,
  clutchSizeOf,
  thresholdOf,
  fatRoom,
  founderLife,
  inheritLife,
  investmentOf,
  lifeForConfig,
  lifeMatchesConfig,
  torporUpkeepFactor,
  LIFE_GENES,
  maxEnergyOf,
  metabolicRateOf,
  sizeOf,
} from './lifehistory';
import { createHeadStartBrain, evaluateBrain, mutateBrain, upgradeBrain } from './brain';
import { capGenome, compileCircuit, crossGenomes, decodeOrganismDNA, encodeOrganismDNA, growableBrain, internalUnits, mutateGenome, mutateGenomeVariation, phenotypeOf, upgradeGenome, type Phenotype } from './dna';
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
  /** Absent in saves from before carrion. */
  readonly carrion?: readonly CarrionPatch[];
  /** Eggs waiting to hatch (absent in saves from before eggs). */
  readonly eggs?: readonly SavedEgg[];
  readonly organisms: readonly SavedOrganism[];
  readonly history: { readonly samples: readonly HistorySample[]; readonly interval: number };
  /** Plant totals (absent in saves from before plants). */
  readonly plantCounters?: PlantCounters;
  /** Cell health (absent in saves from before overgrazing, or with it off). */
  readonly cellHealth?: CellHealthState;
}

/** An organism in a WorldState: its genome as plain numbers, so the state survives JSON. */
export type SavedOrganism = Omit<Organism, 'genome' | 'circuit'> & { readonly genome?: readonly number[] };

/** An egg in a WorldState (its child saved like any organism). */
export type SavedEgg = Omit<Egg, 'child'> & { readonly child: SavedOrganism };

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
  'killsTotal',
  'killsOfStrangersTotal',
  'killsOfKinTotal',
  'matingsTotal',
  'matingsAlikeTotal',
  'matingsOfStrangersTotal',
  'matingsInFamilyTotal',
  'matingChildrenTotal',
  'clutchesFailedTotal',
  'matingChildrenLostTotal',
  'matingEnergyLostTotal',
  'carrionEatenTotal',
  'carrionUnitsRotted',
  'eggsLaidTotal',
  'eggsHatchedTotal',
  'eggsDecayedTotal',
] as const;
type WorldCounter = (typeof WORLD_COUNTERS)[number];

const clone = <T>(value: T): T => structuredClone(value);

export class World {
  public readonly config: SimulationConfig;
  public readonly prng: PRNG;
  public tick = 0;

  public readonly obstacles = new Set<string>(); // "x,y"
  public readonly foodPatches = new Map<string, FoodPatch>(); // "x,y" -> FoodPatch
  /** What dead organisms left behind, "x,y" -> CarrionPatch (separate from plant food; a cell can hold both). */
  public readonly carrion = new Map<string, CarrionPatch>();
  /** Eggs waiting for food, keyed by the id the child will have, in the order they were laid. */
  public readonly eggs = new Map<string, Egg>();
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
  /** Kills so far (and by how the prey looked to its killer), carrion meals eaten and carrion energy that rotted. */
  public killsTotal = 0;
  public killsOfStrangersTotal = 0;
  public killsOfKinTotal = 0;
  /** Children made by mating, and how the pairs looked to each other (alike, strangers) or were related (parent and child). */
  public matingsTotal = 0;
  public matingsAlikeTotal = 0;
  public matingsOfStrangersTotal = 0;
  public matingsInFamilyTotal = 0;
  /** Children of mating born; clutches that failed the viability gate; children of mating not born, and the energy paid for them. */
  public matingChildrenTotal = 0;
  public clutchesFailedTotal = 0;
  public matingChildrenLostTotal = 0;
  public matingEnergyLostTotal = 0;
  public carrionEatenTotal = 0;
  public carrionUnitsRotted = 0;
  /** Eggs laid, hatched and failed so far. */
  public eggsLaidTotal = 0;
  public eggsHatchedTotal = 0;
  public eggsDecayedTotal = 0;
  /** The latest kill, for observers (not saved). */
  public lastKill: { readonly tick: number; readonly killerTag: number; readonly preyTag: number } | null = null;
  /** The latest mating, for observers (not saved). */
  public lastMating: { readonly tick: number; readonly tags: readonly [number, number] } | null = null;
  /** Plant totals (births, seeds, deaths by cause); used when plantsEnabled. */
  public plantCounters: PlantCounters = newPlantCounters();
  /** Soil fertility and season region per cell, built on first use (terrain and regions never change). */
  private soilField: SoilField | null = null;
  private fertileList: number[] | null = null;
  /** Overgrazing: per-cell health (null when overgrazingEnabled is off). */
  public cellHealth: CellHealth | null = null;

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
    this.killsTotal = 0;
    this.killsOfStrangersTotal = 0;
    this.killsOfKinTotal = 0;
    this.matingsTotal = 0;
    this.matingsAlikeTotal = 0;
    this.matingsOfStrangersTotal = 0;
    this.matingsInFamilyTotal = 0;
    this.matingChildrenTotal = 0;
    this.clutchesFailedTotal = 0;
    this.matingChildrenLostTotal = 0;
    this.matingEnergyLostTotal = 0;
    this.carrionEatenTotal = 0;
    this.carrionUnitsRotted = 0;
    this.eggsLaidTotal = 0;
    this.eggsHatchedTotal = 0;
    this.eggsDecayedTotal = 0;
    this.lastKill = null;
    this.lastMating = null;
    this.plantCounters = newPlantCounters();
    this.soilField = null;
    this.fertileList = null;
    this.cellHealth = this.config.overgrazingEnabled ? new CellHealth(this.config.gridWidth * this.config.gridHeight) : null;
    this.nextOrganismSeq = 0;
    this.obstacles.clear();
    this.foodPatches.clear();
    this.carrion.clear();
    this.eggs.clear();
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
   * Places food regions as discs spread over the world: each centre is the
   * one of 30 random candidates farthest from the regions already placed,
   * and centres keep a radius (at most a quarter of the world) from the edge
   * so no region is cut off. Each gets an evenly spaced season phase, used
   * when seasons are staggered. Draws nothing from the PRNG when regions are off.
   */
  private createFoodRegions(): void {
    const { foodRegionCount: count, foodRegionRadius: radius, gridWidth, gridHeight } = this.config;
    const marginX = Math.floor(Math.min(radius, gridWidth / 4));
    const marginY = Math.floor(Math.min(radius, gridHeight / 4));
    for (let i = 0; i < count; i++) {
      let best: { x: number; y: number } | null = null;
      let bestGap = -Infinity;
      for (let attempt = 0; attempt < 30; attempt++) {
        const x = this.prng.nextInt(marginX, gridWidth - 1 - marginX);
        const y = this.prng.nextInt(marginY, gridHeight - 1 - marginY);
        let gap = Infinity;
        for (const r of this.foodRegions) gap = Math.min(gap, Math.hypot(r.x - x, r.y - y));
        if (gap > bestGap) {
          best = { x, y };
          bestGap = gap;
        }
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

  /** A bite from a patch of fertile ground lowers its cell's health (windfalls are not fertile ground). */
  private biteCell(patch: FoodPatch): void {
    if (this.cellHealth && patch.expiresAt === undefined) {
      this.cellHealth.bite(patch.y * this.config.gridWidth + patch.x, this.tick, this.config);
    }
  }

  /** Soil fertility and season regions, built once the terrain and regions exist. */
  private soil(): SoilField {
    this.soilField ??= new SoilField(this.config, this.foodRegions, this.obstacles);
    return this.soilField;
  }

  /** Indices of the fertile cells (overgrazing metrics and its matched-random control). */
  private fertile(): number[] {
    this.fertileList ??= fertileCells(this.soil());
    return this.fertileList;
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
    // Split diets: founders are full plant eaters with no taste for meat.
    const split = splitDiets(this.config);
    const carnivory = split ? 0 : founderCarnivory(this.prng);
    const drawn: Phenotype = {
      tag, carryCapacity, brain, abilities, dispersal, memorySpan, memoryWeights, carnivory,
      ...(split ? { herbivory: 1 } : {}),
      ...founderLife(this.config),
    };
    // With DNA, the founder is what its encoded genome decodes to.
    const genome = this.config.dnaEnabled ? encodeOrganismDNA(drawn) : undefined;
    const phenotype = genome ? decodeOrganismDNA(genome, this.config) : drawn;
    return {
      id: `org-${this.nextOrganismSeq}`,
      x,
      y,
      energy: this.config.initialEnergy * sizeOf(phenotype, this.config),
      policy,
      ...phenotype,
      ...(genome ? { genome } : {}),
      memory: newMemory(x, y),
      kills: 0,
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
   * An organism's genome as a parent passes it on: its own, or encoded on the
   * spot if it has none yet (DNA switched on mid-run). A parent from before
   * split diets were on gets a herbivory gene that keeps its plant yield;
   * likewise a parent from before a life-history switch changed gets those
   * genes at their starting value (or loses them).
   */
  private parentGenome(o: Readonly<Organism>): Uint32Array {
    const needsHerbivory = splitDiets(this.config) && o.herbivory === undefined;
    const lifeStale = !lifeMatchesConfig(o, this.config);
    if (o.genome && !needsHerbivory && !lifeStale) return o.genome;
    return encodeOrganismDNA(this.freshPhenotype(o, needsHerbivory));
  }

  /**
   * A child's inherited body and brain. With DNA: the parent's genome (or,
   * for a child of mating, the two parents' genomes crossed by key, see
   * crossGenomes) goes through the clone mutation path, is capped at
   * dnaMaxGenes, and the child is what it decodes to. Without DNA each trait
   * is inherited directly, for a child of mating from the two parents'
   * traits mixed by recombine. Both paths draw from the PRNG in the same
   * order (with Stage 2 off), so they give the same child.
   */
  private inheritBody(parent: Readonly<Organism>, mate: Readonly<Organism> | null = null): Phenotype & { genome?: Uint32Array } {
    const { config, prng } = this;
    if (config.dnaEnabled) {
      // Stage 3: crossover groups follow the hidden unit a gene maps to (canonical keys group as before).
      const units = growableBrain(config) ? internalUnits(config) : 0;
      const start = mate ? crossGenomes(this.parentGenome(parent), this.parentGenome(mate), prng, units) : this.parentGenome(parent);
      const mutated = config.dnaVariationEnabled ? mutateGenomeVariation(start, config, prng) : mutateGenome(start, config, prng);
      const genome = capGenome(mutated, config.dnaMaxGenes);
      return { ...decodeOrganismDNA(genome, config), genome };
    }
    let genes: Readonly<Organism> = parent;
    if (mate) {
      const { life, ...mixed } = recombine(heritableOf(parent, config), heritableOf(mate, config), prng);
      genes = { ...parent, ...mixed, ...life };
    }
    return {
      tag: inheritTag(genes.tag, config, prng),
      carryCapacity: inheritCarryCapacity(genes.carryCapacity, config, prng),
      brain: mutateBrain(genes.brain, config, prng),
      abilities: inheritAbilities(genes.abilities, config, prng),
      dispersal: inheritDispersal(genes.dispersal, config, prng),
      memorySpan: inheritMemorySpan(genes.memorySpan, config, prng),
      memoryWeights: inheritMemoryWeights(genes.memoryWeights, config, prng),
      carnivory: inheritCarnivory(genes.carnivory, config, prng),
      ...inheritLife(genes, config, prng),
    };
  }

  /** A parent's phenotype with its life-history genes matched to the switches (see inheritBody). */
  private freshPhenotype(parent: Readonly<Organism>, needsHerbivory: boolean): Phenotype {
    const p: Phenotype & Record<string, unknown> = { ...phenotypeOf(parent) };
    for (const g of LIFE_GENES) delete p[g.field];
    return { ...p, ...(needsHerbivory ? { herbivory: herbivoryOf(parent, this.config) } : {}), ...lifeForConfig(parent, this.config) };
  }

  /** A saved organism back as a live one (with the growable brain, its circuit recompiled from the genome). */
  private static restoreOrganism({ genome, ...o }: SavedOrganism, config: Readonly<SimulationConfig>): Organism {
    const upgraded = genome ? upgradeGenome(genome, o.brain.skip.length) : undefined;
    return {
      ...clone(o),
      ...(upgraded ? { genome: upgraded } : {}),
      ...(upgraded && growableBrain(config) ? { circuit: compileCircuit(upgraded, config) } : {}),
      brain: upgradeBrain(clone(o.brain)),
      carnivory: o.carnivory ?? 0,
      kills: o.kills ?? 0,
      dispersal: o.dispersal ?? 1,
      memorySpan: o.memorySpan ?? 0,
      memoryWeights: o.memoryWeights ? [...o.memoryWeights] : new Array<number>(MEMORY_WEIGHT_COUNT).fill(0),
      memory: o.memory ? clone(o.memory) : newMemory(o.x, o.y),
    };
  }

  /** An organism as plain data (its genome as numbers, only its latest decision). */
  private static saveOrganism(o: Readonly<Organism>): SavedOrganism {
    const { genome, circuit: _circuit, ...rest } = o; // the circuit is derived from the genome, never saved
    return { ...clone({ ...rest, recentHistory: o.recentHistory.slice(0, 1) }), ...(genome ? { genome: Array.from(genome) } : {}) };
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
      carrion: Array.from(this.carrion.values(), (c) => ({ ...c })),
      eggs: Array.from(this.eggs.values(), (e) => ({ x: e.x, y: e.y, laidTick: e.laidTick, shell: e.shell ?? 0, child: World.saveOrganism(e.child) })),
      organisms: Array.from(this.organisms.values(), (o) => World.saveOrganism(o)),
      history: this.history.exportState(),
      plantCounters: { ...this.plantCounters },
      ...(this.cellHealth ? { cellHealth: this.cellHealth.exportState() } : {}),
    };
  }

  /**
   * A hash of everything that decides the world's future: settings, random
   * number generator, counters, terrain, food and plants, and organisms.
   * Two worlds with the same hash continue identically. The trend history is
   * left out (it only records the past). Costs about as much as a snapshot,
   * so call it now and then, not every tick.
   */
  public stateHash(): string {
    const { history: _history, ...state } = this.exportState();
    return hashString(JSON.stringify(state));
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
    world.fertileList = null;
    world.cellHealth = state.cellHealth
      ? CellHealth.fromState(state.cellHealth)
      : world.config.overgrazingEnabled
        ? new CellHealth(world.config.gridWidth * world.config.gridHeight)
        : null;
    world.carrion.clear();
    for (const c of state.carrion ?? []) world.carrion.set(`${c.x},${c.y}`, { ...c });
    world.organisms.clear();
    for (const o of state.organisms) world.organisms.set(o.id, World.restoreOrganism(o, world.config));
    world.eggs.clear();
    for (const e of state.eggs ?? []) {
      const child = World.restoreOrganism(e.child, world.config);
      world.eggs.set(child.id, { x: e.x, y: e.y, laidTick: e.laidTick, shell: e.shell ?? 0, child });
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
    const carrionGrid = new Float32Array(gridWidth * gridHeight);
    for (const c of this.carrion.values()) carrionGrid[c.y * gridWidth + c.x] = c.stock;
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
      carrionGrid,
      organismGrid,
      signallers,
    };
  }

  /**
   * Resolves a tie between multiple contenders for the same cell, weighted
   * by each contender's metabolic rate when the metabolism gene is enabled.
   */
  private pickContenderByMetabolicRate<T extends { organism: Organism }>(contenders: T[]): T {
    if (!this.config.metabolismGeneEnabled || contenders.length === 1) {
      return this.prng.choice(contenders);
    }
    let total = 0;
    for (const c of contenders) total += metabolicRateOf(c.organism, this.config);
    let roll = this.prng.nextFloat(0, total);
    for (const c of contenders) {
      roll -= metabolicRateOf(c.organism, this.config);
      if (roll <= 0) return c;
    }
    return contenders[contenders.length - 1];
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
        // Pick one winner using seeded PRNG (weighted by metabolicRate when gene is enabled)
        const winner = this.pickContenderByMetabolicRate(contenders);
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
        const winner = this.pickContenderByMetabolicRate(contenders);
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
    // Attacks land after all actions too, so prey that moved away escapes.
    const pendingAttacks: { attacker: Organism; preyId: string; chance: number }[] = [];
    // Requests to mate, matched up after all actions: a child needs both to ask each other.
    const pendingMatings: { organism: Organism; mateId: string }[] = [];

    for (const item of intentions.values()) {
      const { organism, sensed, scores, chosenAction, approved } = item;
      const startCell = { x: organism.x, y: organism.y };
      let outcome = item.outcome;
      // Base metabolism, plus the upkeep of carry capacity
      let metabolism = metabolismCost(organism, this.config);
      // Resting saves upkeep in proportion to torpor depth.
      if (this.config.torporEnabled && chosenAction.type === 'REST') metabolism *= torporUpkeepFactor(organism, this.config);
      let energyDelta = -metabolism;
      organism.energy -= metabolism;
      if (this.config.torporEnabled && organism.rested && chosenAction.type !== 'REST') {
        // Acting right after a rest costs energy to wake, more the deeper the rest.
        const wakeCost = this.config.torporWakeCost * (organism.torporDepth ?? 0);
        organism.energy -= wakeCost;
        energyDelta -= wakeCost;
      }

      switch (chosenAction.type) {
        case 'EAT': {
          const key = `${organism.x},${organism.y}`;
          const patch = this.foodPatches.get(key);
          // Eat from the patch underfoot if there is one, otherwise from carried food.
          const fromPatch = patch !== undefined && patch.stock > 0;
          const maxEnergy = maxEnergyOf(organism, this.config);
          if (
            (fromPatch || organism.carriedFood > 0) &&
            (organism.energy < maxEnergy || fatRoom(organism, this.config) >= 1)
          ) {
            const meal = plantYield(organism, this.config);
            const energyGain = Math.min(maxEnergy - organism.energy, meal);
            organism.energy += energyGain;
            this.storeSurplus(organism, meal - energyGain);
            if (fromPatch) {
              patch.stock -= 1;
              grazePlant(patch, this.tick, this.plantCounters);
              this.biteCell(patch);
            } else organism.carriedFood -= 1;
            organism.foodEatenCount++;
            energyDelta += energyGain;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'EAT_CARRION': {
          // A meal takes up to carrionBite of the carrion's energy; the eater
          // gets its carnivory share of that (the rest is lost).
          const patch = this.carrion.get(`${organism.x},${organism.y}`);
          if (patch && patch.stock > 0 && organism.carnivory > 0 && this.config.carrionEnabled) {
            const taken = Math.min(patch.stock, this.config.carrionBite);
            const meal = taken * organism.carnivory;
            const maxEnergy = maxEnergyOf(organism, this.config);
            const energyGain = Math.min(maxEnergy - organism.energy, meal);
            organism.energy += energyGain;
            this.storeSurplus(organism, meal - energyGain);
            patch.stock -= taken;
            if (patch.stock <= 1e-9) this.carrion.delete(`${patch.x},${patch.y}`);
            organism.foodEatenCount++;
            this.carrionEatenTotal++;
            energyDelta += energyGain;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'ATTACK_NORTH':
        case 'ATTACK_SOUTH':
        case 'ATTACK_EAST':
        case 'ATTACK_WEST': {
          // The bite lands after all actions (below), if the prey is still
          // within reach; the cost is paid either way.
          organism.energy -= this.config.attackCost;
          energyDelta -= this.config.attackCost;
          if (chosenAction.preyId) {
            pendingAttacks.push({ attacker: organism, preyId: chosenAction.preyId, chance: chosenAction.preyKillChance ?? 0 });
          }
          outcome = 'missed'; // until the bite lands
          break;
        }

        case 'MATE_NORTH':
        case 'MATE_SOUTH':
        case 'MATE_EAST':
        case 'MATE_WEST': {
          // Costs nothing unless the partner asks back (resolved below).
          if (chosenAction.mateId) pendingMatings.push({ organism, mateId: chosenAction.mateId });
          outcome = 'no_partner'; // until the partner asks back
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
          const cost = moveEnergyCost(
            organism,
            {
              leap: isLeapAction(chosenAction.type),
              diagonal: isDiagonalMove(chosenAction.type),
              squeeze: chosenAction.swapRelation === 'squeeze',
            },
            this.config
          );
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
            const childEnergy = Math.floor(organism.energy * investmentOf(organism, this.config));
            const eggAlloc = this.config.eggsEnabled ? (organism.eggAllocation ?? organism.eggRate ?? 0) : 0;
            const lays = eggAlloc > 0;
            const eggCost = lays ? Math.round(this.config.eggExtraCost * eggAlloc) : 0;
            const totalReproCost = childEnergy + this.config.reproductionMetabolismTax + eggCost;

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

              const child = this.makeChild(organism, null, birth, childEnergy);

              if (this.config.metabolismGeneEnabled) organism.nextBirthTick = this.tick + birthCooldownOf(organism, this.config);
              if (lays) {
                // Counted as a birth when it hatches.
                this.eggs.set(child.id, { x: birth.x, y: birth.y, laidTick: this.tick, shell: eggCost, child });
                this.eggsLaidTotal++;
              } else {
                newBorns.push(child);
                this.birthsTotal++;
              }
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
            this.biteCell(patch);
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

      if (this.config.torporEnabled) organism.rested = chosenAction.type === 'REST';

      // Fat is drawn on when energy runs low.
      if (this.config.fatEnabled && (organism.fat ?? 0) > 0) {
        const floor = maxEnergyOf(organism, this.config) * this.config.fatReleaseLevel;
        if (organism.energy < floor) {
          const drawn = Math.min(organism.fat ?? 0, this.config.fatReleaseRate, floor - organism.energy);
          organism.fat = (organism.fat ?? 0) - drawn;
          organism.energy += drawn;
          energyDelta += drawn;
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

    // Matings: pairs who asked each other (in id order, once per pair). Both
    // stayed put this tick, so they are still side by side.
    const asked = new Map(pendingMatings.map((m) => [m.organism.id, m.mateId]));
    for (const { organism, mateId } of pendingMatings) {
      if (organism.id > mateId || asked.get(mateId) !== organism.id) continue;
      const partner = this.organisms.get(mateId);
      if (!partner) continue;
      if (!this.mate(organism, partner, birthBlocked, newBorns)) {
        for (const o of [organism, partner]) {
          const record = o.recentHistory[0];
          if (record && record.tick === this.tick) o.recentHistory[0] = { ...record, outcome: 'energy_too_low' };
        }
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
      const meal = plantYield(recipient, this.config);
      const maxEnergy = maxEnergyOf(recipient, this.config);
      const gain = Math.min(maxEnergy - recipient.energy, meal);
      recipient.energy += gain;
      this.storeSurplus(recipient, meal - gain);
      recipient.foodReceived += 1;
      recipient.foodEatenCount++;
    }

    // Attacks, in a seeded random order: a bite kills with the chance worked
    // out at decision time, if the prey is still alive and within one cell
    // (diagonals included) after this tick's moves. The killer's own death
    // this tick (an earlier bite, or its own spending) stops its bite.
    const bodies = new Map<string, number>(); // prey id -> energy its body still had
    for (const attack of this.prng.shuffle(pendingAttacks)) {
      const { attacker } = attack;
      const prey = this.organisms.get(attack.preyId);
      const roll = this.prng.next(); // drawn for every attack, so outcomes don't shift the stream
      if (!prey || prey.energy <= 0 || attacker.energy <= 0 || bodies.has(attacker.id)) continue;
      if (Math.max(Math.abs(prey.x - attacker.x), Math.abs(prey.y - attacker.y)) > 1) continue;
      if (roll >= attack.chance) continue;
      bodies.set(prey.id, prey.energy);
      prey.energy = 0;
      this.lastKill = { tick: this.tick, killerTag: attacker.tag, preyTag: prey.tag };
      attacker.kills++;
      this.killsTotal++;
      const similarity = tagSimilarity(attacker.tag, prey.tag);
      if (similarity <= this.config.strangerSimilarity) this.killsOfStrangersTotal++;
      if (similarity >= this.config.kinSimilarity) this.killsOfKinTotal++;
      const record = attacker.recentHistory[0];
      if (record && record.tick === this.tick) attacker.recentHistory[0] = { ...record, outcome: 'success' };
    }

    // Add newborns to population
    for (const child of newBorns) {
      this.organisms.set(child.id, child);
    }

    // Phase 5: Deaths. With carrion on, every body is left where it fell:
    // carrionBodyEnergy plus carrionEfficiency of the energy it still held (a
    // starved body holds none; a killed one usually some).
    for (const [id, org] of Array.from(this.organisms.entries())) {
      if (org.energy <= 0) {
        this.deceasedCount++;
        this.deceasedLifespanSum += org.age;
        this.deathsTotal++;
        this.organisms.delete(id);
        if (this.config.carrionEnabled) {
          const energy = carrionFromBody(bodies.get(id) ?? 0, this.config);
          if (energy > 0) this.addCarrion(org.x, org.y, energy);
        }
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
   * A newborn with energy `energy` at `birth`. A clone takes its parent's
   * genes. A child of mating takes each policy dial whole from one parent or
   * the other (mixPolicies); with DNA its body and brain come from the two
   * genomes crossed by key (crossGenomes), without DNA each trait whole from
   * one parent (recombine). Either way the genes then mutate as a clone's do. The child
   * belongs to the lineage of `parent`, the one it is born next to.
   */
  private makeChild(parent: Organism, mate: Organism | null, birth: { x: number; y: number }, energy: number): Organism {
    const policySource = mate ? mixPolicies(parent.policy, mate.policy, this.prng) : parent.policy;
    this.nextOrganismSeq++;
    const policy = mutatePolicy(policySource, this.config, this.prng);
    const inherited = this.inheritBody(parent, mate);
    return {
      id: `org-${this.nextOrganismSeq}`,
      x: birth.x,
      y: birth.y,
      energy: Math.min(energy, maxEnergyOf(inherited, this.config)),
      policy,
      ...inherited,
      memory: newMemory(birth.x, birth.y),
      kills: 0,
      lineage: {
        id: parent.lineage.id,
        parentId: parent.id,
        ...(mate ? { mateId: mate.id } : {}),
        generation: Math.max(parent.lineage.generation, mate?.lineage.generation ?? 0) + 1,
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
   * Two organisms that asked each other this tick mate (docs/decisions.md,
   * Mating). Consent: each must be at its own reproduction threshold and past
   * its own birth cooldown, or nothing happens. The children are born next to
   * one parent, the carrier, picked at random (the other if that one has no
   * free cell; if neither has one, nothing happens). Each parent then pays
   * its own share, floor(own energy × own investment), plus the birth tax.
   * The carrier's clutch gene sets how many children share the two shares
   * equally. If that is below minViableChildEnergy the clutch fails: both
   * still pay and the energy is lost. Otherwise each child gets its own
   * crossover and mutation and is placed like a clone's child (dispersing as
   * the carrier's do); a child with no free cell left is not born and its
   * energy is lost. Matings never lay eggs. Returns false when nothing
   * happened.
   */
  private mate(a: Organism, b: Organism, blocked: Set<string>, newBorns: Organism[]): boolean {
    const { config } = this;
    const tax = config.reproductionMetabolismTax;
    const ready = (o: Organism) => o.energy >= thresholdOf(o, config) && this.tick >= (o.nextBirthTick ?? 0);
    if (!ready(a) || !ready(b)) return false;
    const share = (o: Organism) => Math.floor(o.energy * investmentOf(o, config));
    const shareA = share(a);
    const shareB = share(b);
    if (a.energy <= shareA + tax || b.energy <= shareB + tax || shareA + shareB <= 0) return false;

    const free = (o: Organism) =>
      DIRECTION_OFFSETS.map(({ dx, dy }) => ({ x: o.x + dx, y: o.y + dy })).filter(
        (c) =>
          c.x >= 0 &&
          c.y >= 0 &&
          c.x < config.gridWidth &&
          c.y < config.gridHeight &&
          !this.obstacles.has(`${c.x},${c.y}`) &&
          !blocked.has(`${c.x},${c.y}`)
      );
    const first = this.prng.next() < 0.5 ? a : b;
    const second = first === a ? b : a;
    let carrier = first;
    let cells = free(first);
    if (cells.length === 0) {
      carrier = second;
      cells = free(second);
    }
    if (cells.length === 0) return false;
    const other = carrier === a ? b : a;

    // Both pay their own share and the tax, whatever becomes of the clutch.
    const pool = shareA + shareB;
    const paid = new Map<Organism, number>([
      [a, shareA + tax],
      [b, shareB + tax],
    ]);
    a.energy -= shareA + tax;
    b.energy -= shareB + tax;
    if (config.metabolismGeneEnabled) for (const o of [a, b]) o.nextBirthTick = this.tick + birthCooldownOf(o, config);
    this.matingsTotal++;
    const similarity = tagSimilarity(a.tag, b.tag);
    if (similarity >= config.kinSimilarity) this.matingsAlikeTotal++;
    if (similarity <= config.strangerSimilarity) this.matingsOfStrangersTotal++;
    if (isParentOrChild(a, b)) this.matingsInFamilyTotal++;
    this.lastMating = { tick: this.tick, tags: [a.tag, b.tag] };

    const f = clutchSizeOf(carrier, config);
    const N = Math.floor(f);
    const remainder = f - N;
    const targetCount = N + (remainder > 0 && this.prng.next() < remainder ? 1 : 0);

    const maxViable = Math.floor(pool / config.minViableChildEnergy);
    const viableCount = Math.min(targetCount, maxViable);

    let born = 0;
    if (viableCount === 0) {
      this.clutchesFailedTotal++;
      this.matingChildrenLostTotal += targetCount;
      this.matingEnergyLostTotal += pool;
    } else {
      const perChild = viableCount === targetCount ? pool / targetCount : config.minViableChildEnergy;
      const poolAllocated = perChild * viableCount;
      const heatSurplus = pool - poolAllocated;
      this.matingEnergyLostTotal += heatSurplus;

      for (let k = 0; k < viableCount; k++) {
        if (k > 0) cells = free(carrier);
        if (cells.length === 0) {
          const unplaced = viableCount - born;
          this.matingChildrenLostTotal += unplaced;
          this.matingEnergyLostTotal += perChild * unplaced;
          break; // no room for the rest
        }
        const target = this.prng.choice(cells);
        const birth = this.birthCell(carrier, target, carrier.energy, blocked);
        carrier.energy -= birth.extraCost;
        paid.set(carrier, (paid.get(carrier) ?? 0) + birth.extraCost);
        blocked.add(`${birth.x},${birth.y}`);
        this.birthDistanceSum += birth.distance;
        newBorns.push(this.makeChild(carrier, other, birth, perChild));
        born++;
      }
      this.matingChildrenLostTotal += (targetCount - viableCount);
    }
    this.birthsTotal += born;
    this.matingChildrenTotal += born;

    for (const parent of [carrier, other]) {
      parent.offspringCount += born;
      const record = parent.recentHistory[0];
      if (record && record.tick === this.tick) {
        parent.recentHistory[0] = {
          ...record,
          outcome: born > 0 ? 'success' : 'clutch_failed',
          energyDelta: Number((record.energyDelta - (paid.get(parent) ?? 0)).toFixed(2)),
          energyAfter: Number(parent.energy.toFixed(2)),
        };
      }
    }
    return true;
  }

  /** Food energy beyond what an organism can hold becomes fat, at a loss, up to its capacity. */
  private storeSurplus(organism: Organism, surplus: number): void {
    const room = fatRoom(organism, this.config);
    if (room <= 0 || surplus <= 0) return;
    organism.fat = (organism.fat ?? 0) + Math.min(room, surplus * this.config.fatStoreEfficiency);
  }

  /**
   * Eggs decay when their protective shell is depleted, and hatch when plenty
   * conditions and food patch stock are near. A hatchling starts with
   * eggHatchEfficiency of the egg's energy.
   */
  private stepEggs(): void {
    if (this.eggs.size === 0) return;
    const { eggDecayChance, eggHatchRadius, eggHatchEfficiency } = this.config;
    let occupied: Set<string> | null = null;
    for (const [id, egg] of Array.from(this.eggs)) {
      if (this.prng.next() < eggDecayChance) {
        if (egg.shell > 0) {
          egg.shell -= 1;
        } else {
          this.eggs.delete(id);
          this.eggsDecayedTotal++;
          continue;
        }
      }
      if (this.isCellLean(egg.x, egg.y)) continue;
      if (!this.foodWithin(egg.x, egg.y, eggHatchRadius)) continue;
      if (occupied === null) {
        occupied = new Set();
        for (const o of this.organisms.values()) occupied.add(`${o.x},${o.y}`);
      }
      const key = `${egg.x},${egg.y}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      this.eggs.delete(id);
      this.eggsHatchedTotal++;
      this.birthsTotal++;
      const { child } = egg;
      this.organisms.set(child.id, {
        ...child,
        energy: Math.max(1, Math.floor(child.energy * eggHatchEfficiency)),
        lineage: { ...child.lineage, birthTick: this.tick },
        memory: newMemory(egg.x, egg.y),
      });
    }
  }

  /** Whether the cell at (x, y) is currently in a lean season. */
  private isCellLean(x: number, y: number): boolean {
    if (this.config.seasonLength <= 0) return false;
    if (this.foodRegions.length === 0 || !this.config.staggeredSeasons) {
      return seasonAt(this.tick, this.config)?.season === 'lean';
    }
    const idx = y * this.config.gridWidth + x;
    const regIdx = this.soil().region[idx];
    const r = regIdx >= 0 ? this.foodRegions[regIdx] : undefined;
    return regionSeasonAt(this.tick, r, this.config)?.season === 'lean';
  }

  /** Whether any food patch with stock lies within `radius` cells (square) of a cell. */
  private foodWithin(x: number, y: number, radius: number): boolean {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if ((this.foodPatches.get(`${x + dx},${y + dy}`)?.stock ?? 0) > 0) return true;
      }
    }
    return false;
  }

  /** Adds carrion energy to a cell (piling onto any already there, which then rots later). */
  private addCarrion(x: number, y: number, energy: number): void {
    const key = `${x},${y}`;
    const expiresAt = this.tick + 1 + this.config.carrionLifetime;
    const existing = this.carrion.get(key);
    if (existing) {
      existing.stock += energy;
      existing.expiresAt = expiresAt;
    } else {
      this.carrion.set(key, { x, y, stock: energy, expiresAt });
    }
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

    // 0b. Carrion rots away (it never regrows)
    for (const [key, c] of this.carrion) {
      if (c.expiresAt <= this.tick) {
        this.carrionUnitsRotted += c.stock;
        this.carrion.delete(key);
      }
    }

    // 0c. Cells rest and recover (and the matched-random control spends its damage)
    const health = this.cellHealth;
    if (health) health.step(this.tick, this.config, this.prng, this.config.overgrazingMatchedRandom ? this.fertile() : []);

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
        ...(health ? { health: health.health } : {}),
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
          const index = patch.y * gridWidth + patch.x;
          patch.stock = Math.min(patch.capacity, patch.stock + (health ? health.regrow(index, foodRegenAmount) : foodRegenAmount));
          if (health && patch.stock >= patch.capacity) health.clearCarry(index);
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
    const { immigrationEnabled, immigrationInterval, immigrationCount } = this.config;
    if (immigrationEnabled && immigrationInterval > 0 && this.tick > 0 && this.tick % immigrationInterval === 0) {
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

    // 4. Eggs hatch where food has come back (draws nothing when there are none).
    this.stepEggs();
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
      killsTotal: this.killsTotal,
      killsOfStrangersTotal: this.killsOfStrangersTotal,
      killsOfKinTotal: this.killsOfKinTotal,
      matingsTotal: this.matingsTotal,
      matingsAlikeTotal: this.matingsAlikeTotal,
      matingsOfStrangersTotal: this.matingsOfStrangersTotal,
      matingsInFamilyTotal: this.matingsInFamilyTotal,
      matingChildrenTotal: this.matingChildrenTotal,
      clutchesFailedTotal: this.clutchesFailedTotal,
      matingChildrenLostTotal: this.matingChildrenLostTotal,
      matingEnergyLostTotal: Number(this.matingEnergyLostTotal.toFixed(2)),
      carrionEatenTotal: this.carrionEatenTotal,
      carrionStock: Math.round(Array.from(this.carrion.values()).reduce((a, c) => a + c.stock, 0)),
      averageCarnivory:
        organisms.length > 0 ? Number((organisms.reduce((a, o) => a + o.carnivory, 0) / organisms.length).toFixed(3)) : 0,
      meatEaters: organisms.filter((o) => o.carnivory >= 0.5).length,
      genomeLength: this.genomeLength(organisms),
      season: this.worldSeason(),
      plants: this.config.plantsEnabled ? computePlantMetrics(this.foodPatches, this.plantCounters) : null,
      overgrazing: this.cellHealth ? this.cellHealth.metrics(this.soil(), this.foodRegions.length, this.fertile()) : null,
      life: this.lifeMetrics(organisms),
    };
  }

  private lifeMetrics(organisms: readonly Organism[]): LifeMetrics | null {
    const c = this.config;
    if (!LIFE_GENES.some((g) => g.enabled(c))) return null;
    const mean = (on: boolean, value: (o: Organism) => number): number | null =>
      on ? (organisms.length > 0 ? Number((organisms.reduce((a, o) => a + value(o), 0) / organisms.length).toFixed(3)) : 0) : null;
    return {
      reproThreshold: mean(c.thresholdGeneEnabled, (o) => o.reproThreshold ?? c.reproductionThreshold),
      investment: mean(c.investmentGeneEnabled, (o) => o.investment ?? c.reproductionEnergyFraction),
      fatCapacity: mean(c.fatEnabled, (o) => o.fatCapacity ?? 0),
      torporDepth: mean(c.torporEnabled, (o) => o.torporDepth ?? 0),
      eggAllocation: mean(c.eggsEnabled, (o) => o.eggAllocation ?? o.eggRate ?? 0),
      eggRate: mean(c.eggsEnabled, (o) => o.eggAllocation ?? o.eggRate ?? 0),
      metabolicRate: mean(c.metabolismGeneEnabled, (o) => o.metabolicRate ?? 1),
      clutchSize: mean(c.clutchGeneEnabled, (o) => o.clutchSize ?? 1),
      size: mean(c.sizeGeneEnabled, (o) => o.size ?? 1),
      sensingRadius: mean(c.sensingGeneEnabled, (o) => o.sensingRadius ?? c.sensingRadius),
      digestiveEfficiency: mean(c.digestiveGeneEnabled, (o) => o.digestiveEfficiency ?? 1),
      fat: mean(c.fatEnabled, (o) => o.fat ?? 0),
      resting: c.torporEnabled ? organisms.filter((o) => o.rested).length : null,
      eggs: c.eggsEnabled ? this.eggs.size : null,
      eggsLaidTotal: this.eggsLaidTotal,
      eggsHatchedTotal: this.eggsHatchedTotal,
      eggsDecayedTotal: this.eggsDecayedTotal,
    };
  }

  /** Genes per genome (mean, spread, longest) over the living, or null when no one has a genome. */
  private genomeLength(organisms: readonly Organism[]): { mean: number; sd: number; max: number } | null {
    const lengths = organisms.flatMap((o) => (o.genome ? [o.genome.length / 3] : []));
    if (lengths.length === 0) return null;
    const mean = lengths.reduce((a, l) => a + l, 0) / lengths.length;
    const sd = Math.sqrt(lengths.reduce((a, l) => a + (l - mean) ** 2, 0) / lengths.length);
    return { mean: Number(mean.toFixed(1)), sd: Number(sd.toFixed(1)), max: Math.max(...lengths) };
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
