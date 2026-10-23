import type { Organism, PolicyWeights, WorldMetrics } from './types';

export const POLICY_WEIGHT_KEYS = [
  'foodAttraction',
  'obstacleAvoidance',
  'crowdingAvoidance',
  'exploreTendency',
  'eatDrive',
  'reproduceDrive',
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
  /** Population mean and standard deviation of each inherited policy weight. */
  readonly weights: Readonly<Record<PolicyWeightKey, WeightStat>>;
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
      weights: computeWeightStats(organisms),
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
        ...POLICY_WEIGHT_KEYS.flatMap((k) => [
          s.weights[k].mean.toFixed(4),
          s.weights[k].sd.toFixed(4),
        ]),
      ].join(',')
    );
    return [header.join(','), ...rows].join('\n') + '\n';
  }
}
