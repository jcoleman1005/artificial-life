import type { AbilityName, Organism, PlantTrait, PolicyWeights, SimulationConfig, WorldMetrics } from './types';
import { PLANT_TRAIT_KEYS } from './plants';
import { BRAIN_HIDDEN, BRAIN_INPUT_COUNT, brainDrift, hiddenStrength } from './brain';
import { LIFE_GENES, type LifeField } from './lifehistory';
import { genomeStats } from './dna';
import { carrionYield, plantYield } from './traits';

export const POLICY_WEIGHT_KEYS = [
  'foodAttraction',
  'obstacleAvoidance',
  'crowdingAvoidance',
  'exploreTendency',
  'eatDrive',
  'reproduceDrive',
  'kinAffinity',
  'shareWithKin',
  'shareWithStrangers',
  'careForChildren',
  'forageDrive',
  'eatPriority',
  'hungerUrgency',
  'followFoodParent',
  'signalOnFood',
  'signalWhenHungry',
  'followSignal',
  'restDrive',
  'avoidOccupied',
  'leapEagerness',
] as const satisfies readonly (keyof PolicyWeights)[];

export type PolicyWeightKey = (typeof POLICY_WEIGHT_KEYS)[number];

export interface WeightStat {
  readonly mean: number;
  readonly sd: number;
}

export interface HistorySample {
  readonly tick: number;
  readonly population: number;
  readonly foodStock: number;
  readonly birthsTotal: number;
  readonly deathsTotal: number;
  readonly maxGeneration: number;
  readonly lineages: number;
  readonly tribeCount: number;
  readonly largestTribe: number;
  readonly inTribeFraction: number;
  /** Share of neighbours that are kin, and the share expected by chance. */
  readonly localKinFraction: number;
  readonly globalKinFraction: number;
  readonly sharesTotal: number;
  readonly kinSharesTotal: number;
  readonly parentalSharesTotal: number;
  readonly immigrantsTotal: number;
  readonly signalsTotal: number;
  readonly signalsOnFoodTotal: number;
  /** Whether this sample fell in a lean season. */
  readonly lean: boolean;
  /** Population mean and standard deviation of each inherited policy weight. */
  readonly weights: Readonly<Record<PolicyWeightKey, WeightStat>>;
  /** Population mean and standard deviation of the carry-capacity body trait. */
  readonly carryCapacity: WeightStat;
  /** Population mean and standard deviation of the dispersal distance trait. */
  readonly dispersal: WeightStat;
  /** Population mean and standard deviation of the memory span trait. */
  readonly memorySpan: WeightStat;
  /** Share of the population with each movement ability, and with none (0..1). */
  readonly abilities: Readonly<Record<AbilityName | 'none', number>>;
  /** Brains: how far direct connections moved from the head start, and hidden-layer strength. */
  readonly brainDrift: WeightStat;
  readonly hiddenStrength: WeightStat;
  /** Diet (absent in samples saved before carrion). */
  readonly carnivory?: WeightStat;
  /** Kills so far, and how many of the prey looked like strangers to their killer. */
  readonly killsTotal?: number;
  readonly killsOfStrangersTotal?: number;
  /** Carrion meals eaten so far (absent in older samples). */
  readonly carrionEatenTotal?: number;
  /** Children of mating so far, and how many of the pairs looked alike / like strangers (absent before sex). */
  readonly matingsTotal?: number;
  readonly matingsAlikeTotal?: number;
  readonly matingsOfStrangersTotal?: number;
  /** Children of mating born, and matings whose clutch failed (absent before clutches). */
  readonly matingChildrenTotal?: number;
  readonly clutchesFailedTotal?: number;
  /** Plants (absent when plants are off, and in samples from before plants). */
  readonly plants?: PlantSample;
  /** Growth and ageing (absent when both are off, and in samples from before they existed). */
  readonly growth?: GrowthSample;
  /**
   * Life-history genes that are switched on (absent fields: switched off), as mean and SD over the
   * living, plus `fat`, the fat actually held now (against `fatCapacity`). Absent in older samples.
   */
  readonly life?: Readonly<Partial<Record<LifeField | 'fat', WeightStat>>>;
  /** Plant-eating efficiency (split diets only). */
  readonly herbivory?: WeightStat;
  /** Energy one plant meal / one carrion meal gives, over the living (what the diet trade-off leaves them). */
  readonly yields?: { readonly plant: WeightStat; readonly carrion: WeightStat };
  /** Brain wiring in use: connections with a non-zero weight, and hidden units that take input and drive the output. */
  readonly topology?: { readonly connections: WeightStat; readonly hiddenUnits: WeightStat };
  /** Genome measurements (only with DNA; see genomeStats). */
  readonly genome?: GenomeSample;
  /** How many organisms fall in each fifth of a trait's range (see DIST_TRAITS), lowest fifth first. */
  readonly bins?: Readonly<Partial<Record<DistTrait, readonly number[]>>>;
}

/** The last fresh brain-wiring and genome measurements, and when they were taken (see MetricsHistory). */
export interface SlowStats {
  readonly tick: number;
  readonly topology: NonNullable<HistorySample['topology']>;
  readonly genome?: GenomeSample;
}

export interface GenomeSample {
  /** Genes per genome. */
  readonly length: WeightStat;
  /** Mean number of slots carried by two or more genes, per genome (duplicate gene dosage). */
  readonly duplicatedSlots: number;
  /** Of the duplicated weight slots, the share whose copies are all identical (1 when there are none). */
  readonly identicalShare: number;
  /** Mean genes per genome that point at nothing this build decodes. */
  readonly silent: number;
}

/** Traits whose population distribution is kept as a five-bin histogram in each sample. */
export const DIST_TRAITS = ['carnivory', 'reproThreshold', 'clutchSize', 'metabolicRate', 'growthDuration'] as const;
export type DistTrait = (typeof DIST_TRAITS)[number];
export const DIST_BIN_COUNT = 5;
/** Ticks between fresh brain-wiring and genome measurements; samples in between repeat the last (they move slowly). */
export const SLOW_STATS_TICKS = 25;

/** The range a trait's bins divide into fifths, or null when this world has no such trait. */
export function distRange(trait: DistTrait, config: Readonly<SimulationConfig>): readonly [number, number] | null {
  if (trait === 'carnivory') return [0, 1];
  const gene = LIFE_GENES.find((g) => g.field === trait);
  return gene && gene.enabled(config) ? [gene.min(config), gene.max(config)] : null;
}

/** Which fifth of [min, max] a value falls in (0..4); a degenerate range puts everything in the first. */
export function binOf(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.max(0, Math.min(DIST_BIN_COUNT - 1, Math.floor(((value - min) / (max - min)) * DIST_BIN_COUNT)));
}

/** Five-bin counts of each distribution trait that exists in this world. Read-only over the organisms. */
export function computeBins(
  organisms: readonly Organism[],
  config: Readonly<SimulationConfig>
): Partial<Record<DistTrait, number[]>> {
  const out: Partial<Record<DistTrait, number[]>> = {};
  for (const trait of DIST_TRAITS) {
    const range = distRange(trait, config);
    if (!range) continue;
    const counts = new Array<number>(DIST_BIN_COUNT).fill(0);
    for (const o of organisms) {
      const v = o[trait];
      if (v !== undefined) counts[binOf(v, range[0], range[1])]++;
    }
    out[trait] = counts;
  }
  return out;
}

/** Mean and SD of each switched-on life-history gene, and of the fat held. */
export function computeLifeStats(organisms: readonly Organism[]): Partial<Record<LifeField | 'fat', WeightStat>> {
  const out: Partial<Record<LifeField | 'fat', WeightStat>> = {};
  for (const g of LIFE_GENES) {
    const values: number[] = [];
    for (const o of organisms) {
      const v = o[g.field];
      if (v !== undefined) values.push(v);
    }
    if (values.length > 0) out[g.field] = meanAndSd(values);
  }
  const fat: number[] = [];
  for (const o of organisms) if (o.fat !== undefined) fat.push(o.fat);
  if (fat.length > 0) out.fat = meanAndSd(fat);
  return out;
}

/** Wiring in use per brain: non-zero connections (direct plus hidden-layer inputs), and hidden units that are wired in and out. */
export function computeTopology(organisms: readonly Organism[]): { connections: WeightStat; hiddenUnits: WeightStat } {
  const connections: number[] = [];
  const units: number[] = [];
  for (const o of organisms) {
    const { skip, hidden, out } = o.brain;
    let n = 0;
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) if (skip[i] !== 0) n++;
    let recruited = 0;
    for (let h = 0; h < BRAIN_HIDDEN; h++) {
      let fanIn = 0;
      for (let i = 0; i < BRAIN_INPUT_COUNT; i++) if (hidden[h * BRAIN_INPUT_COUNT + i] !== 0) fanIn++;
      n += fanIn;
      if (fanIn > 0 && out[h] !== 0) recruited++;
    }
    connections.push(n);
    units.push(recruited);
  }
  return { connections: meanAndSd(connections), hiddenUnits: meanAndSd(units) };
}

/** An evenly spaced subset of at most `max` items (every k-th, no randomness); the whole list when it is short enough. */
export function evenSubset<T>(items: readonly T[], max: number): readonly T[] {
  if (items.length <= max) return items;
  const stride = Math.ceil(items.length / max);
  const out: T[] = [];
  for (let i = 0; i < items.length; i += stride) out.push(items[i]);
  return out;
}

/** Most genomes read per sample: the stats are means over an evenly spaced subset, so a sample's cost stays flat in the population. */
export const GENOME_SAMPLE_MAX = 48;

/**
 * Genome length, duplicate dosage and silent genes, or undefined when no one carries a genome. Measured on up to
 * GENOME_SAMPLE_MAX genomes taken at an even stride through the population (no randomness), since reading every
 * gene of every organism on each sample would cost far more than the rest of the history put together.
 */
export function computeGenomeSample(organisms: readonly Organism[], config: Readonly<SimulationConfig>): GenomeSample | undefined {
  const withGenome = organisms.filter((o) => o.genome);
  if (withGenome.length === 0) return undefined;
  const genomes = evenSubset(withGenome, GENOME_SAMPLE_MAX).map((o) => o.genome!);
  const g = genomeStats(genomes, config);
  return {
    length: { mean: g.meanLength, sd: g.sdLength },
    duplicatedSlots: g.multiCopySlots,
    identicalShare: g.identicalShare,
    silent: g.meanByType.silent,
  };
}

export interface GrowthSample {
  readonly meanMaturity: number;
  readonly juvenileFraction: number;
  readonly senescentFraction: number;
  readonly deathsOldAgeTotal: number;
  readonly meanLifespan: number;
}

export interface PlantSample {
  readonly count: number;
  readonly edibleBiomass: number;
  readonly roots: number;
  readonly dormant: number;
  /** Cumulative plant deaths by cause. */
  readonly deathsGrazed: number;
  readonly deathsShaded: number;
  readonly deathsLean: number;
  readonly deathsStarved: number;
  readonly traits: Readonly<Record<PlantTrait, WeightStat>>;
}

/** Share of organisms holding each movement ability, and holding none. */
export function abilityShares(organisms: readonly Organism[]): Record<AbilityName | 'none', number> {
  const counts = { diagonal: 0, squeeze: 0, leap: 0, none: 0 };
  for (const o of organisms) {
    const { diagonal, squeeze, leap } = o.abilities;
    counts.diagonal += diagonal;
    counts.squeeze += squeeze;
    counts.leap += leap;
    if (diagonal + squeeze + leap === 0) counts.none++;
  }
  const n = organisms.length || 1;
  return { diagonal: counts.diagonal / n, squeeze: counts.squeeze / n, leap: counts.leap / n, none: counts.none / n };
}

function meanAndSd(values: readonly number[]): WeightStat {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((a, v) => a + v, 0) / values.length;
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
  return { mean, sd: Math.sqrt(variance) };
}

/** Mean and (population) standard deviation of each policy weight. */
export function computeWeightStats(
  organisms: readonly Organism[]
): Record<PolicyWeightKey, WeightStat> {
  const stats = {} as Record<PolicyWeightKey, WeightStat>;
  for (const key of POLICY_WEIGHT_KEYS) {
    if (organisms.length === 0) {
      stats[key] = { mean: 0, sd: 0 };
      continue;
    }
    let sum = 0;
    for (const o of organisms) sum += o.policy[key];
    const mean = sum / organisms.length;
    let sq = 0;
    for (const o of organisms) sq += (o.policy[key] - mean) ** 2;
    stats[key] = { mean, sd: Math.sqrt(sq / organisms.length) };
  }
  return stats;
}

const CSV_LIFE_FIELDS = [...LIFE_GENES.map((g) => g.field), 'fat'] as const;

/** A mean and SD as two CSV cells, blank when the statistic does not exist. */
function optionalStat(stat: WeightStat | undefined): string[] {
  return stat ? [stat.mean.toFixed(4), stat.sd.toFixed(4)] : ['', ''];
}

/**
 * Bounded record of world metrics over the whole run.
 *
 * Samples are taken every `sampleInterval` ticks. When the buffer is full,
 * every other sample is dropped and the interval doubles, so memory stays
 * fixed while the samples remain evenly spaced from tick 0 to the present.
 */
export class MetricsHistory {
  private samples: HistorySample[] = [];
  private interval = 1;
  /**
   * The costlier wiring and genome measurements, reused by the samples in between so a run that samples every
   * tick (the first 240 ticks) does not pay for them every tick. Saved with the history, so a restored world
   * goes on sampling exactly as the original would have.
   */
  private slow: SlowStats | null = null;

  constructor(public readonly capacity = 240) {}

  public get sampleInterval(): number {
    return this.interval;
  }

  public getSamples(): readonly HistorySample[] {
    return this.samples;
  }

  public clear(): void {
    this.samples = [];
    this.interval = 1;
    this.slow = null;
  }

  /** Plain data for a snapshot. */
  public exportState(): { samples: HistorySample[]; interval: number; slow?: SlowStats } {
    return { samples: [...this.samples], interval: this.interval, ...(this.slow ? { slow: this.slow } : {}) };
  }

  public importState(state: { samples: readonly HistorySample[]; interval: number; slow?: SlowStats }): void {
    this.samples = [...state.samples];
    this.interval = state.interval;
    this.slow = state.slow ?? null;
  }

  /** Whether a sample is due at this tick (so callers can skip computing metrics). */
  public wantsSample(tick: number): boolean {
    if (tick % this.interval !== 0) return false;
    const last = this.samples[this.samples.length - 1];
    return !last || last.tick < tick;
  }

  /**
   * Takes a sample if one is due. `config` adds the measurements that need the world's rules (genome,
   * yields, trait histograms); without it those are left out. Read-only over the organisms.
   */
  public record(metrics: WorldMetrics, organisms: readonly Organism[], config?: Readonly<SimulationConfig>): void {
    if (!this.wantsSample(metrics.tick)) return;
    if (!this.slow || metrics.tick < this.slow.tick || metrics.tick - this.slow.tick >= SLOW_STATS_TICKS) {
      this.slow = {
        tick: metrics.tick,
        topology: computeTopology(evenSubset(organisms, GENOME_SAMPLE_MAX)),
        ...(config ? { genome: computeGenomeSample(organisms, config) } : {}),
      };
    }
    const { topology, genome } = this.slow;

    this.samples.push({
      tick: metrics.tick,
      population: metrics.population,
      foodStock: metrics.totalFoodStock,
      birthsTotal: metrics.birthsTotal,
      deathsTotal: metrics.deathsTotal,
      maxGeneration: metrics.maxGeneration,
      lineages: metrics.activeLineageCount,
      tribeCount: metrics.tribes.tribeCount,
      largestTribe: metrics.tribes.largestTribe,
      inTribeFraction: metrics.tribes.inTribeFraction,
      localKinFraction: metrics.tribes.localKinFraction,
      globalKinFraction: metrics.tribes.globalKinFraction,
      sharesTotal: metrics.sharesTotal,
      kinSharesTotal: metrics.kinSharesTotal,
      parentalSharesTotal: metrics.parentalSharesTotal,
      immigrantsTotal: metrics.immigrantsTotal,
      signalsTotal: metrics.signalsTotal,
      signalsOnFoodTotal: metrics.signalsOnFoodTotal,
      lean: metrics.season === 'lean',
      weights: computeWeightStats(organisms),
      carryCapacity: meanAndSd(organisms.map((o) => o.carryCapacity)),
      dispersal: meanAndSd(organisms.map((o) => o.dispersal)),
      memorySpan: meanAndSd(organisms.map((o) => o.memorySpan)),
      abilities: abilityShares(organisms),
      brainDrift: meanAndSd(organisms.map((o) => brainDrift(o.brain))),
      hiddenStrength: meanAndSd(organisms.map((o) => hiddenStrength(o.brain))),
      carnivory: meanAndSd(organisms.map((o) => o.carnivory)),
      killsTotal: metrics.killsTotal,
      killsOfStrangersTotal: metrics.killsOfStrangersTotal,
      carrionEatenTotal: metrics.carrionEatenTotal,
      matingsTotal: metrics.matingsTotal,
      matingsAlikeTotal: metrics.matingsAlikeTotal,
      matingsOfStrangersTotal: metrics.matingsOfStrangersTotal,
      matingChildrenTotal: metrics.matingChildrenTotal,
      clutchesFailedTotal: metrics.clutchesFailedTotal,
      life: computeLifeStats(organisms),
      topology,
      ...(organisms.some((o) => o.herbivory !== undefined)
        ? { herbivory: meanAndSd(organisms.map((o) => o.herbivory ?? 0)) }
        : {}),
      ...(config
        ? {
            yields: {
              plant: meanAndSd(organisms.map((o) => plantYield(o, config))),
              carrion: meanAndSd(organisms.map((o) => carrionYield(o, config))),
            },
            bins: computeBins(organisms, config),
            ...(genome ? { genome } : {}),
          }
        : {}),
      ...(metrics.growth
        ? {
            growth: {
              meanMaturity: metrics.growth.meanMaturity,
              juvenileFraction: metrics.growth.juvenileFraction,
              senescentFraction: metrics.growth.senescentFraction,
              deathsOldAgeTotal: metrics.growth.deathsOldAgeTotal,
              meanLifespan: metrics.growth.meanLifespan,
            },
          }
        : {}),
      ...(metrics.plants
        ? {
            plants: {
              count: metrics.plants.count,
              edibleBiomass: metrics.plants.edibleBiomass,
              roots: metrics.plants.roots,
              dormant: metrics.plants.dormant,
              deathsGrazed: metrics.plants.deaths.grazed,
              deathsShaded: metrics.plants.deaths.shaded,
              deathsLean: metrics.plants.deaths.lean,
              deathsStarved: metrics.plants.deaths.starved,
              traits: { ...metrics.plants.traits },
            },
          }
        : {}),
    });

    if (this.samples.length > this.capacity) {
      this.interval *= 2;
      this.samples = this.samples.filter((s) => s.tick % this.interval === 0);
    }
  }

  /** Comma-separated export of every sample, one row per sampled tick. */
  public toCSV(): string {
    const header = [
      'tick',
      'population',
      'food_stock',
      'births_total',
      'deaths_total',
      'max_generation',
      'lineages',
      'tribes',
      'largest_tribe',
      'in_tribe_fraction',
      'local_kin_fraction',
      'chance_kin_fraction',
      'shares_total',
      'kin_shares_total',
      'parental_shares_total',
      'immigrants_total',
      'signals_total',
      'signals_on_food_total',
      'lean_season',
      'carry_capacity_mean',
      'carry_capacity_sd',
      'dispersal_mean',
      'dispersal_sd',
      'memory_span_mean',
      'memory_span_sd',
      'diagonal_fraction',
      'squeeze_fraction',
      'leap_fraction',
      'no_ability_fraction',
      'brain_drift_mean',
      'brain_hidden_strength_mean',
      'carnivory_mean',
      'carnivory_sd',
      'kills_total',
      'kills_of_strangers_total',
      'matings_total',
      'matings_alike_total',
      'matings_of_strangers_total',
      'mating_children_total',
      'clutches_failed_total',
      ...POLICY_WEIGHT_KEYS.flatMap((k) => [`${k}_mean`, `${k}_sd`]),
      'plants',
      'plant_edible_biomass',
      'plant_roots',
      'plants_dormant',
      'plant_deaths_grazed_total',
      'plant_deaths_shaded_total',
      'plant_deaths_lean_total',
      'plant_deaths_starved_total',
      ...PLANT_TRAIT_KEYS.flatMap((k) => [`plant_${k}_mean`, `plant_${k}_sd`]),
      ...CSV_LIFE_FIELDS.flatMap((k) => [`${k}_mean`, `${k}_sd`]),
      'herbivory_mean',
      'herbivory_sd',
      'plant_meal_yield_mean',
      'carrion_meal_yield_mean',
      'carrion_eaten_total',
      'brain_connections_mean',
      'brain_connections_sd',
      'brain_hidden_units_mean',
      'genome_genes_mean',
      'genome_genes_sd',
      'genome_duplicated_slots_mean',
      'genome_identical_share',
      'genome_silent_genes_mean',
      ...DIST_TRAITS.flatMap((t) => Array.from({ length: DIST_BIN_COUNT }, (_, b) => `${t}_bin${b}`)),
      'mean_maturity',
      'juvenile_fraction',
      'senescent_fraction',
      'deaths_old_age_total',
      'mean_lifespan',
    ];
    const rows = this.samples.map((s) =>
      [
        s.tick,
        s.population,
        s.foodStock,
        s.birthsTotal,
        s.deathsTotal,
        s.maxGeneration,
        s.lineages,
        s.tribeCount,
        s.largestTribe,
        s.inTribeFraction,
        s.localKinFraction,
        s.globalKinFraction,
        s.sharesTotal,
        s.kinSharesTotal,
        s.parentalSharesTotal,
        s.immigrantsTotal,
        s.signalsTotal,
        s.signalsOnFoodTotal,
        s.lean ? 1 : 0,
        s.carryCapacity.mean.toFixed(4),
        s.carryCapacity.sd.toFixed(4),
        s.dispersal.mean.toFixed(4),
        s.dispersal.sd.toFixed(4),
        s.memorySpan.mean.toFixed(4),
        s.memorySpan.sd.toFixed(4),
        s.abilities.diagonal.toFixed(4),
        s.abilities.squeeze.toFixed(4),
        s.abilities.leap.toFixed(4),
        s.abilities.none.toFixed(4),
        s.brainDrift.mean.toFixed(4),
        s.hiddenStrength.mean.toFixed(4),
        (s.carnivory?.mean ?? 0).toFixed(4),
        (s.carnivory?.sd ?? 0).toFixed(4),
        s.killsTotal ?? 0,
        s.killsOfStrangersTotal ?? 0,
        s.matingsTotal ?? 0,
        s.matingsAlikeTotal ?? 0,
        s.matingsOfStrangersTotal ?? 0,
        s.matingChildrenTotal ?? s.matingsTotal ?? 0,
        s.clutchesFailedTotal ?? 0,
        ...POLICY_WEIGHT_KEYS.flatMap((k) => [
          s.weights[k].mean.toFixed(4),
          s.weights[k].sd.toFixed(4),
        ]),
        // Blank plant columns when plants are off.
        ...(s.plants
          ? [
              s.plants.count,
              s.plants.edibleBiomass.toFixed(2),
              s.plants.roots.toFixed(2),
              s.plants.dormant,
              s.plants.deathsGrazed,
              s.plants.deathsShaded,
              s.plants.deathsLean,
              s.plants.deathsStarved,
              ...PLANT_TRAIT_KEYS.flatMap((k) => [s.plants!.traits[k].mean.toFixed(4), s.plants!.traits[k].sd.toFixed(4)]),
            ]
          : new Array<string>(8 + PLANT_TRAIT_KEYS.length * 2).fill('')),
        // Genome and life-history columns, blank where the world has no such thing.
        ...CSV_LIFE_FIELDS.flatMap((k) => optionalStat(s.life?.[k])),
        ...optionalStat(s.herbivory),
        s.yields ? s.yields.plant.mean.toFixed(4) : '',
        s.yields ? s.yields.carrion.mean.toFixed(4) : '',
        s.carrionEatenTotal ?? '',
        ...optionalStat(s.topology?.connections),
        s.topology ? s.topology.hiddenUnits.mean.toFixed(4) : '',
        ...optionalStat(s.genome?.length),
        s.genome ? s.genome.duplicatedSlots.toFixed(4) : '',
        s.genome ? s.genome.identicalShare.toFixed(4) : '',
        s.genome ? s.genome.silent.toFixed(4) : '',
        ...DIST_TRAITS.flatMap((t) => Array.from({ length: DIST_BIN_COUNT }, (_, b) => s.bins?.[t]?.[b] ?? '')),
        // Growth columns, blank when growth and ageing are off.
        ...(s.growth
          ? [s.growth.meanMaturity, s.growth.juvenileFraction, s.growth.senescentFraction, s.growth.deathsOldAgeTotal, s.growth.meanLifespan]
          : ['', '', '', '', '']),
      ].join(',')
    );
    return [header.join(','), ...rows].join('\n') + '\n';
  }
}
