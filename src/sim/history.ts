import type { Organism, PolicyWeights, WorldMetrics } from './types';

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
  /** Whether this sample fell in a lean season. */
  readonly lean: boolean;
  /** Population mean and standard deviation of each inherited policy weight. */
  readonly weights: Readonly<Record<PolicyWeightKey, WeightStat>>;
  /** Population mean and standard deviation of the carry-capacity body trait. */
  readonly carryCapacity: WeightStat;
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
  }

  public record(metrics: WorldMetrics, organisms: readonly Organism[]): void {
    if (metrics.tick % this.interval !== 0) return;
    const last = this.samples[this.samples.length - 1];
    if (last && last.tick >= metrics.tick) return; // already sampled this tick

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
      lean: metrics.season === 'lean',
      weights: computeWeightStats(organisms),
      carryCapacity: meanAndSd(organisms.map((o) => o.carryCapacity)),
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
      'lean_season',
      'carry_capacity_mean',
      'carry_capacity_sd',
      ...POLICY_WEIGHT_KEYS.flatMap((k) => [`${k}_mean`, `${k}_sd`]),
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
        s.lean ? 1 : 0,
        s.carryCapacity.mean.toFixed(4),
        s.carryCapacity.sd.toFixed(4),
        ...POLICY_WEIGHT_KEYS.flatMap((k) => [
          s.weights[k].mean.toFixed(4),
          s.weights[k].sd.toFixed(4),
        ]),
      ].join(',')
    );
    return [header.join(','), ...rows].join('\n') + '\n';
  }
}
