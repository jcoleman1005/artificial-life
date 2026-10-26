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

/** Bounds of each trait, and the founder ranges (centred near the classic food supply). */
export const PLANT_TRAITS: GeneTable<PlantTrait> = {
  growthRate: { min: 0.01, max: 1, founderMin: 0.1, founderMax: 0.35 },
  maxBiomass: { min: 1, max: 20, founderMin: 5, founderMax: 11 },
  seedSize: { min: 0.2, max: 4, founderMin: 0.5, founderMax: 2 },
  seedThreshold: { min: 0.1, max: 1, founderMin: 0.3, founderMax: 0.8 },
  dispersal: { min: 1, max: 10, founderMin: 1, founderMax: 5 },
  rootShare: { min: 0, max: 0.9, founderMin: 0, founderMax: 0.4 },
  leanDormancy: { min: 0, max: 1, founderMin: 0, founderMax: 0.5 },
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

export function founderGenome(prng: PRNG): PlantGenome {
  return founderGenes(PLANT_TRAITS, prng);
}

/** A seed's genome: the parent's, each trait shifted now and then and kept in range. */
export function inheritGenome(parent: PlantGenome, config: Readonly<SimulationConfig>, prng: PRNG): PlantGenome {
  return inheritGenes(PLANT_TRAITS, parent, prng, { rate: config.plantMutationRate, sd: config.plantMutationStdDev });
}

/**
 * Soil fertility per cell (1 inside a fertile region, marginFertility outside,
 * 0 on obstacles; 1 everywhere off obstacles when there are no regions) and
 * the region whose season each cell follows (the nearest one, or -1).
 */
export class SoilField {
  public readonly fertility: Float32Array;
  public readonly region: Int16Array;

  constructor(
    config: Readonly<SimulationConfig>,
    regions: readonly FoodRegion[],
    obstacles: ReadonlySet<string>
  ) {
    const { gridWidth: w, gridHeight: h } = config;
    this.fertility = new Float32Array(w * h);
    this.region = new Int16Array(w * h).fill(-1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (obstacles.has(`${x},${y}`)) continue;
        if (regions.length === 0) {
          this.fertility[i] = 1;
          continue;
        }
        let nearest = 0;
        let nearestGap = Infinity;
        let inside = false;
        regions.forEach((r, k) => {
          const d = Math.hypot(r.x - x, r.y - y);
          if (d <= r.radius) inside = true;
          if (d - r.radius < nearestGap) {
            nearestGap = d - r.radius;
            nearest = k;
          }
        });
        this.fertility[i] = inside ? 1 : config.marginFertility;
        this.region[i] = nearest;
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
    const lean = region >= 0 ? (ctx.regionLean[region] ?? false) : ctx.worldLean;
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
    const growth =
      g.growthRate *
      vigour *
      field.fertility[index] *
      (lean ? lightLean : 1) *
      Math.max(0, 1 - config.shadeStrength * shade) *
      (1 - dormancy);
    const upkeep =
      (config.plantUpkeep * size + config.growthCostFactor * g.growthRate * vigour) *
      (1 - DORMANCY_SAVING * dormancy);

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
      plant.biomass *= keep;
      plant.roots *= keep;
    }

    if (plant.biomass + plant.roots < MIN_PLANT_MASS) {
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
      seeds.push({ x: x + dx, y: y + dy, parent: plant });
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
        const genome = founderGenome(prng);
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
    for (const p of plants) sum += p.genome[key];
    const mean = sum / n;
    let sq = 0;
    for (const p of plants) sq += (p.genome[key] - mean) ** 2;
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
