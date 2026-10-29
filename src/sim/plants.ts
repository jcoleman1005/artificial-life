import type { PRNG } from './prng';
import { founderGenes, geneTableKeys, inheritGenes, type GeneTable } from './genes';
import type {
  FoodPatch,
  FoodRegion,
  Plant,
  PlantDeathCause,
  PlantGenome,
  PlantMetrics,
  PlantTrait,
  SimulationConfig,
} from './types';

/**
 * Plants: food as a population of evolving individuals. Plants make no
 * decisions; fixed physical rules apply to everyone, and only the genome's
 * life-history numbers are inherited and mutate. Which strategy pays is left
 * to selection. See docs/specs/plants.md.
 */

export type BasePlantTrait = Exclude<PlantTrait, 'defense'>;

export const BASE_PLANT_TRAITS: GeneTable<BasePlantTrait> = {
  growthRate: { min: 0.01, max: 1, founderMin: 0.1, founderMax: 0.35 },
  maxBiomass: { min: 1, max: 20, founderMin: 5, founderMax: 11 },
  seedSize: { min: 0.2, max: 4, founderMin: 0.5, founderMax: 2 },
  seedThreshold: { min: 0.1, max: 1, founderMin: 0.3, founderMax: 0.8 },
  dispersal: { min: 1, max: 10, founderMin: 1, founderMax: 5 },
  rootShare: { min: 0, max: 0.9, founderMin: 0, founderMax: 0.4 },
  leanDormancy: { min: 0, max: 1, founderMin: 0, founderMax: 0.5 },
};

/** Bounds of each trait, and the founder ranges (centred near the classic food supply). */
export const PLANT_TRAITS: GeneTable<PlantTrait> = {
  ...BASE_PLANT_TRAITS,
  defense: { min: 0, max: 1, founderMin: 0.05, founderMax: 0.25, locked: 0.0 },
};

export const PLANT_TRAIT_KEYS = geneTableKeys(PLANT_TRAITS);

export const PLANT_DEATH_CAUSES: readonly PlantDeathCause[] = ['grazed', 'shaded', 'lean', 'starved'];

/** A plant whose biomass and roots together fall below this is dead. */
export const MIN_PLANT_MASS = 0.05;
/** Share of edible biomass a fully dormant plant moves into its roots each lean tick. */
export const DORMANCY_TRANSFER = 0.05;
/** Share of upkeep a fully dormant plant saves. */
export const DORMANCY_SAVING = 0.8;
/** A plant that dies within this many ticks of being eaten counts as grazed out. */
const GRAZED_WINDOW = 2;

const round4 = (v: number) => Number(v.toFixed(4));

export function founderGenome(prng: PRNG, config?: Readonly<SimulationConfig>): PlantGenome {
  const base = founderGenes(BASE_PLANT_TRAITS, prng);
  if (config?.plantDefenseEnabled !== false) {
    const defense = round4(prng.nextFloat(0.05, 0.25));
    return { ...base, defense };
  }
  return { ...base };
}

/** A seed's genome: the parent's, each trait shifted now and then and kept in range. */
export function inheritGenome(parent: PlantGenome, config: Readonly<SimulationConfig>, prng: PRNG): PlantGenome {
  const base = inheritGenes(BASE_PLANT_TRAITS, parent, prng, { rate: config.plantMutationRate, sd: config.plantMutationStdDev });
  if (config.plantDefenseEnabled && parent.defense !== undefined) {
    let def = parent.defense;
    if (prng.next() < config.plantMutationRate) {
      def += prng.nextGaussian(0, config.plantMutationStdDev * 1.0);
    }
    return { ...base, defense: round4(Math.max(0, Math.min(1, def))) };
  }
  return { ...base };
}

/**
 * Soil fertility per cell (1 inside a fertile region, marginFertility outside,
 * 0 on obstacles; 1 everywhere off obstacles when there are no regions) and
 * the region whose season each cell follows (the nearest one, or -1).
 */
export class SoilField {
  /** The fertility growth, germination and seed rain read; live when fertilityDynamicEnabled. */
  public readonly fertility: Float32Array;
  /** The original map (1 / marginFertility / 0). The same array as `fertility` when the feature is off. */
  public readonly baseFertility: Float32Array;
  /** Bumped whenever fertility changes, so the host can send an update only when needed. Not saved. */
  public version = 0;
  private readonly wearPending: Float64Array | null; // integer millionths: exact sums, so order never matters
  private wearTouched: number[] = [];
  public readonly region: Int16Array;
  public readonly nutrients: Float32Array;
  private readonly diffBuffer: Float32Array;
  public readonly regionCells: number[][];
  public readonly regionNutrients: Float32Array;
  public meanFertileNutrients: number = 1.0;

  constructor(
    config: Readonly<SimulationConfig>,
    regions: readonly FoodRegion[],
    obstacles: ReadonlySet<string>
  ) {
    const { gridWidth: w, gridHeight: h } = config;
    this.fertility = new Float32Array(w * h);
    this.region = new Int16Array(w * h).fill(-1);
    this.nutrients = new Float32Array(w * h);
    this.diffBuffer = new Float32Array(w * h);
    this.regionCells = Array.from({ length: regions.length }, () => []);
    this.regionNutrients = new Float32Array(Math.max(1, regions.length)).fill(1.0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (obstacles.has(`${x},${y}`)) continue;
        if (regions.length === 0) {
          this.fertility[i] = 1;
          this.nutrients[i] = 1;
          continue;
        }
        let nearest = 0;
        let nearestGap = Infinity;
        let inside = false;
        regions.forEach((r, k) => {
          const d = Math.hypot(r.x - x, r.y - y);
          if (d <= r.radius) {
            inside = true;
            this.regionCells[k].push(i);
          }
          if (d - r.radius < nearestGap) {
            nearestGap = d - r.radius;
            nearest = k;
          }
        });
        const f = inside ? 1 : config.marginFertility;
        this.fertility[i] = f;
        this.nutrients[i] = f;
        this.region[i] = nearest;
      }
    }
    // The original map, kept apart only while fertility can change (off: one array, nothing extra).
    this.baseFertility = config.fertilityDynamicEnabled ? this.fertility.slice() : this.fertility;
    this.wearPending = config.fertilityDynamicEnabled ? new Float64Array(w * h) : null;
  }

  /**
   * Records wear on a cell, in millionths of fertility. Integer sums are exact and do not depend on the order
   * bodies acted in; `applyWear` turns them into fertility after all actions.
   */
  public addWear(index: number, micro: number): void {
    const pending = this.wearPending;
    if (!pending || micro <= 0) return;
    if (pending[index] === 0) this.wearTouched.push(index);
    pending[index] += micro;
  }

  /** Takes the recorded wear off fertility (never below the floor, never on rock) and clears it. */
  public applyWear(config: Readonly<SimulationConfig>): void {
    const pending = this.wearPending;
    if (!pending || this.wearTouched.length === 0) return;
    const floor = config.marginFertility;
    for (const i of this.wearTouched) {
      if (this.baseFertility[i] > 0) this.fertility[i] = Math.max(floor, this.fertility[i] - pending[i] * 1e-6);
      pending[i] = 0;
    }
    this.wearTouched = [];
    this.version++;
  }

  /**
   * Fertility follows the soil's nutrient level, slowly, and gains where it has been raining. A pass over the whole
   * grid every `fertilityInterval` ticks: no random draws, a fixed order, bounded by the floor and the cap.
   * Without the nutrient cycle it recovers toward the original map instead.
   */
  public stepFertility(config: Readonly<SimulationConfig>, moisture: Uint8Array | null): void {
    if (!config.fertilityDynamicEnabled) return;
    const interval = Math.max(1, Math.floor(config.fertilityInterval));
    const floor = config.marginFertility;
    const cap = config.fertilityMax;
    const rebuild = interval * config.fertilityRebuildRate;
    const wetRate = interval * config.fertilityMoistureRate;
    const f = this.fertility;
    for (let i = 0; i < f.length; i++) {
      if (this.baseFertility[i] <= 0) continue;
      const nutrient = config.nutrientCycleEnabled ? this.nutrients[i] : this.baseFertility[i];
      const target = Math.max(floor, Math.min(cap, nutrient));
      const wet = moisture ? Math.max(0, (moisture[i] - 128) / 127) : 0;
      const next = f[i] + rebuild * (target - f[i]) + wetRate * wet * (cap - f[i]);
      f[i] = Math.max(floor, Math.min(cap, next));
    }
    this.version++;
  }

  /** Copies a saved fertility field in (the original map is rebuilt from the regions, never saved). */
  public restoreFertility(values: readonly number[]): void {
    for (let i = 0; i < this.fertility.length && i < values.length; i++) this.fertility[i] = values[i];
    this.version++;
  }

  public stepNutrients(config: Readonly<SimulationConfig>, fertileIndices: readonly number[]): void {
    if (!config.nutrientCycleEnabled) return;
    const { gridWidth: w, gridHeight: h, nutrientCapacity: cap, nutrientRegenRate: rRegen, nutrientDiffusionRate: dRate } = config;
    const n = this.nutrients;

    // 1. Abiotic equilibrium relaxation
    if (rRegen > 0) {
      for (let i = 0; i < n.length; i++) {
        const target = this.baseFertility[i];
        if (target <= 0) continue;
        const diff = target - n[i];
        n[i] = Math.min(cap, Math.max(0, n[i] + rRegen * diff));
      }
    }

    // 2. Spatial diffusion (4-neighbor)
    if (dRate > 0) {
      this.diffBuffer.set(n);
      const buf = this.diffBuffer;
      const fert = this.baseFertility;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (fert[idx] <= 0) continue;
          const curr = buf[idx];
          let flux = 0;
          let validNeighbors = 0;

          if (x > 0 && fert[idx - 1] > 0) {
            flux += buf[idx - 1] - curr;
            validNeighbors++;
          }
          if (x < w - 1 && fert[idx + 1] > 0) {
            flux += buf[idx + 1] - curr;
            validNeighbors++;
          }
          if (y > 0 && fert[idx - w] > 0) {
            flux += buf[idx - w] - curr;
            validNeighbors++;
          }
          if (y < h - 1 && fert[idx + w] > 0) {
            flux += buf[idx + w] - curr;
            validNeighbors++;
          }

          if (validNeighbors > 0) {
            n[idx] = Math.min(cap, Math.max(0, n[idx] + (dRate * flux) / 4));
          }
        }
      }
    }

    // 3. Compute region aggregates
    this.updateAggregates(fertileIndices);
  }

  public updateAggregates(fertileIndices: readonly number[]): void {
    if (fertileIndices.length > 0) {
      let sum = 0;
      for (let k = 0; k < fertileIndices.length; k++) {
        sum += this.nutrients[fertileIndices[k]];
      }
      this.meanFertileNutrients = sum / fertileIndices.length;
    } else {
      let sum = 0;
      for (let i = 0; i < this.nutrients.length; i++) sum += this.nutrients[i];
      this.meanFertileNutrients = sum / Math.max(1, this.nutrients.length);
    }

    if (this.regionCells && this.regionCells.length > 0) {
      for (let r = 0; r < this.regionCells.length; r++) {
        const cells = this.regionCells[r];
        if (cells.length === 0) continue;
        let rSum = 0;
        for (let k = 0; k < cells.length; k++) {
          rSum += this.nutrients[cells[k]];
        }
        this.regionNutrients[r] = rSum / cells.length;
      }
    }
  }
}

/** Running plant totals kept by the world (and saved with it). */
export interface PlantCounters {
  nextPlantSeq: number;
  seedsReleasedTotal: number;
  seedsGerminatedTotal: number;
  seedRainTotal: number;
  grazedTotal: number;
  /** Edible biomass grown (before upkeep): the plants' food production. */
  edibleGrownTotal: number;
  deathsGrazed: number;
  deathsShaded: number;
  deathsLean: number;
  deathsStarved: number;
}

export function newPlantCounters(): PlantCounters {
  return {
    nextPlantSeq: 0,
    seedsReleasedTotal: 0,
    seedsGerminatedTotal: 0,
    seedRainTotal: 0,
    grazedTotal: 0,
    edibleGrownTotal: 0,
    deathsGrazed: 0,
    deathsShaded: 0,
    deathsLean: 0,
    deathsStarved: 0,
  };
}

const DEATH_COUNTER: Record<PlantDeathCause, keyof PlantCounters> = {
  grazed: 'deathsGrazed',
  shaded: 'deathsShaded',
  lean: 'deathsLean',
  starved: 'deathsStarved',
};

/** The patch a plant lives in: stock is its whole edible units. */
function plantPatch(x: number, y: number, plant: Plant, region: number): FoodPatch {
  return {
    x,
    y,
    stock: Math.floor(plant.biomass),
    capacity: Math.max(1, Math.floor(plant.genome.maxBiomass)),
    ...(region < 0 ? {} : { region }),
    plant,
  };
}

/** A new plant: a founder (no parent) or a seedling. */
export function createPlant(
  counters: PlantCounters,
  genome: PlantGenome,
  biomass: number,
  tick: number,
  parent: Plant | null
): Plant {
  counters.nextPlantSeq++;
  return {
    id: `plant-${counters.nextPlantSeq}`,
    lineageId: parent ? parent.lineageId : `plant-lineage-${counters.nextPlantSeq}`,
    parentId: parent ? parent.id : null,
    generation: parent ? parent.generation + 1 : 1,
    birthTick: tick,
    genome,
    biomass: Math.min(biomass, genome.maxBiomass),
    roots: 0,
    seedBudget: 0,
    seedsReleased: 0,
    lastGrazedTick: -1,
    dormant: false,
  };
}

/** Places a plant in a cell (the caller checks the cell is free and fertile). */
export function plantAt(
  patches: Map<string, FoodPatch>,
  field: SoilField,
  width: number,
  x: number,
  y: number,
  plant: Plant
): void {
  patches.set(`${x},${y}`, plantPatch(x, y, plant, field.region[y * width + x]));
}

/** An organism ate or picked up one unit. */
export function grazePlant(patch: FoodPatch, tick: number, counters: PlantCounters): void {
  if (!patch.plant) return;
  patch.plant.biomass = Math.max(0, patch.plant.biomass - 1);
  patch.plant.lastGrazedTick = tick;
  counters.grazedTotal++;
}

export interface PlantStepContext {
  readonly config: Readonly<SimulationConfig>;
  readonly tick: number;
  readonly prng: PRNG;
  readonly obstacles: ReadonlySet<string>;
  readonly patches: Map<string, FoodPatch>;
  readonly field: SoilField;
  /** Lean season per region, and for the whole world (used when there are no regions). */
  readonly regionLean: readonly boolean[];
  readonly worldLean: boolean;
  readonly counters: PlantCounters;
  /** Overgrazing: cell health per cell, scaling growth (absent: no scaling). */
  readonly health?: Float32Array;
  /** Active weather simulation (absent when weather is off). */
  readonly weather?: {
    getSoilMoisture(x: number, y: number): number;
    getWind(x: number, y: number): { wx: number; wy: number };
  };
}

/** Whether a seed can take root here: on the grid, fertile, no obstacle and no plant or other food. */
function canGerminate(ctx: PlantStepContext, x: number, y: number): boolean {
  const { gridWidth: w, gridHeight: h } = ctx.config;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;
  return ctx.field.fertility[y * w + x] > 0 && !ctx.patches.has(`${x},${y}`);
}

/**
 * One tick of plant life, after all organism actions: every plant grows,
 * pays upkeep, sets seed and maybe dies, in grid order; then the seeds land.
 */
export function stepPlants(ctx: PlantStepContext): void {
  const { config, tick, prng, patches, field, counters } = ctx;
  const { gridWidth: w, gridHeight: h } = config;
  const lightLean = 1 / Math.max(1, config.leanSlowdown);

  const living: { key: string; index: number; patch: FoodPatch; plant: Plant }[] = [];
  const occupied = new Uint8Array(w * h);
  for (const [key, patch] of patches) {
    if (!patch.plant) continue;
    const index = patch.y * w + patch.x;
    occupied[index] = 1;
    living.push({ key, index, patch, plant: patch.plant });
  }
  living.sort((a, b) => a.index - b.index);

  const seeds: { x: number; y: number; parent: Plant }[] = [];
  for (const { key, index, patch, plant } of living) {
    const g = plant.genome;
    const { x, y } = patch;
    let neighbours = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && occupied[ny * w + nx]) neighbours++;
      }
    }
    const shade = neighbours / 8;
    const region = field.region[index];
    const lean = config.nutrientCycleEnabled
      ? (field.nutrients[index] < config.nutrientLeanThreshold)
      : (region >= 0 ? (ctx.regionLean[region] ?? false) : ctx.worldLean);
    const dormancy = lean ? g.leanDormancy : 0;
    plant.dormant = lean && g.leanDormancy >= 0.5;

    // Dormancy: edible biomass retreats into the roots.
    if (dormancy > 0) {
      const moved = plant.biomass * dormancy * DORMANCY_TRANSFER;
      plant.biomass -= moved;
      plant.roots += moved;
    }

    // Small plants grow slowly (vigour); growth machinery costs upkeep
    // whatever the light, so fast growth pays only in good conditions.
    const size = plant.biomass + plant.roots;
    const vigour = size / (size + 1);
    const moisture = ctx.weather ? ctx.weather.getSoilMoisture(x, y) : 0.5;
    const moistureFactor = ctx.weather ? 0.8 + 0.4 * moisture : 1;
    const nutrientFactor = config.nutrientCycleEnabled
      ? Math.max(0.1, Math.min(1.5, field.nutrients[index]))
      : 1;
    const lightFactor = lean ? lightLean : 1;
    const growth =
      g.growthRate *
      vigour *
      field.fertility[index] *
      nutrientFactor *
      lightFactor *
      Math.max(0, 1 - config.shadeStrength * shade) *
      (1 - dormancy) *
      moistureFactor *
      (ctx.health ? ctx.health[index] : 1);
    const defenseUpkeep =
      config.plantDefenseEnabled && g.defense
        ? config.plantUpkeep * size * (config.plantDefenseCostFactor ?? 0.5) * g.defense
        : 0;
    const upkeep =
      (config.plantUpkeep * size + defenseUpkeep + config.growthCostFactor * g.growthRate * vigour) *
      (1 - DORMANCY_SAVING * dormancy);

    // If nutrient cycle is on, draw consumed nutrients from soil
    if (config.nutrientCycleEnabled && growth > 0) {
      const uptake = Math.min(field.nutrients[index], growth * config.nutrientPlantUptake);
      field.nutrients[index] -= uptake;
    }

    // Growth: a mature plant puts a share into seeds; growth past its maximum
    // size goes into seeds too.
    const mature = size >= g.seedThreshold * g.maxBiomass;
    let toSeed = mature ? growth * config.seedAllocation : 0;
    let toBody = growth - toSeed;
    const room = Math.max(0, g.maxBiomass - size);
    if (toBody > room) {
      if (mature) toSeed += toBody - room;
      toBody = room;
    }
    plant.roots += toBody * g.rootShare;
    plant.biomass += toBody * (1 - g.rootShare);
    counters.edibleGrownTotal += toBody * (1 - g.rootShare);

    // Upkeep comes out of edible biomass and roots in proportion to their size.
    const total = plant.biomass + plant.roots;
    if (total > 0) {
      const keep = Math.max(0, 1 - upkeep / total);
      if (config.nutrientCycleEnabled && keep < 1) {
        const shed = total * (1 - keep);
        field.nutrients[index] = Math.min(config.nutrientCapacity, field.nutrients[index] + shed * config.nutrientPlantDecomp * 0.5);
      }
      plant.biomass *= keep;
      plant.roots *= keep;
    }

    if (plant.biomass + plant.roots < MIN_PLANT_MASS) {
      if (config.nutrientCycleEnabled) {
        const returned = (plant.biomass + plant.roots) * config.nutrientPlantDecomp;
        field.nutrients[index] = Math.min(config.nutrientCapacity, field.nutrients[index] + returned);
      }
      const cause: PlantDeathCause =
        plant.lastGrazedTick >= 0 && tick - plant.lastGrazedTick <= GRAZED_WINDOW
          ? 'grazed'
          : lean
            ? 'lean'
            : neighbours > 0
              ? 'shaded'
              : 'starved';
      counters[DEATH_COUNTER[cause]]++;
      patches.delete(key);
      continue;
    }

    plant.seedBudget += toSeed;
    while (plant.seedBudget >= g.seedSize) {
      plant.seedBudget -= g.seedSize;
      plant.seedsReleased++;
      counters.seedsReleasedTotal++;
      const reach = Math.max(1, Math.round(g.dispersal));
      let dx = 0;
      let dy = 0;
      while (dx === 0 && dy === 0) {
        dx = prng.nextInt(-reach, reach);
        dy = prng.nextInt(-reach, reach);
      }
      let sx = x + dx;
      let sy = y + dy;
      if (ctx.weather && config.weatherSeedDrift > 0) {
        const wind = ctx.weather.getWind(x, y);
        sx += Math.round(wind.wx * config.weatherSeedDrift);
        sy += Math.round(wind.wy * config.weatherSeedDrift);
      }
      seeds.push({ x: sx, y: sy, parent: plant });
    }
    patch.stock = Math.floor(plant.biomass);
  }

  // Seeds land after every plant has grown, so they shade nobody this tick.
  for (const seed of seeds) {
    if (!canGerminate(ctx, seed.x, seed.y)) continue;
    const genome = inheritGenome(seed.parent.genome, config, prng);
    const child = createPlant(counters, genome, seed.parent.genome.seedSize, tick, seed.parent);
    plantAt(patches, field, w, seed.x, seed.y, child);
    counters.seedsGerminatedTotal++;
  }

  // Seed rain: seeds with random genomes, landing more often on richer soil.
  if (config.seedRainInterval > 0 && tick > 0 && tick % config.seedRainInterval === 0) {
    for (let i = 0; i < config.seedRainCount; i++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const x = prng.nextInt(0, w - 1);
        const y = prng.nextInt(0, h - 1);
        if (!canGerminate(ctx, x, y) || prng.next() >= field.fertility[y * w + x]) continue;
        const genome = founderGenome(prng, config);
        plantAt(patches, field, w, x, y, createPlant(counters, genome, genome.seedSize, tick, null));
        counters.seedRainTotal++;
        break;
      }
    }
  }
}

/** Plant population statistics, for metrics, trends and experiments. */
export function computePlantMetrics(patches: ReadonlyMap<string, FoodPatch>, counters: PlantCounters): PlantMetrics {
  const plants: Plant[] = [];
  for (const p of patches.values()) if (p.plant) plants.push(p.plant);
  const n = plants.length;
  let seedlings = 0;
  let dormant = 0;
  let edibleBiomass = 0;
  let roots = 0;
  for (const p of plants) {
    if (p.biomass < 1) seedlings++;
    if (p.dormant) dormant++;
    edibleBiomass += p.biomass;
    roots += p.roots;
  }
  const traits = {} as PlantMetrics['traits'];
  for (const key of PLANT_TRAIT_KEYS) {
    if (n === 0) {
      traits[key] = { mean: 0, sd: 0 };
      continue;
    }
    let sum = 0;
    for (const p of plants) sum += p.genome[key] ?? 0;
    const mean = sum / n;
    let sq = 0;
    for (const p of plants) sq += ((p.genome[key] ?? 0) - mean) ** 2;
    traits[key] = { mean, sd: Math.sqrt(sq / n) };
  }
  return {
    count: n,
    seedlings,
    dormant,
    edibleBiomass,
    roots,
    traits,
    deaths: {
      grazed: counters.deathsGrazed,
      shaded: counters.deathsShaded,
      lean: counters.deathsLean,
      starved: counters.deathsStarved,
    },
    seedsReleasedTotal: counters.seedsReleasedTotal,
    seedRainTotal: counters.seedRainTotal,
    grazedTotal: counters.grazedTotal,
  };
}

/**
 * A hue for a plant's strategy, for display: fast growers are yellow-green,
 * root-heavy stress-tolerators turn blue-green, and dormancy pushes toward teal.
 */
export function plantHue(genome: PlantGenome): number {
  const fast = Math.min(1, genome.growthRate / 0.5);
  const roots = genome.rootShare / PLANT_TRAITS.rootShare.max;
  return 75 + 90 * roots + 25 * genome.leanDormancy - 30 * fast;
}
