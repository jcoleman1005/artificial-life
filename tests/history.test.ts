import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { computeWeightStats, MetricsHistory, POLICY_WEIGHT_KEYS } from '../src/sim/history';
import type { Organism, WorldMetrics } from '../src/sim/types';

function fakeMetrics(tick: number): WorldMetrics {
  return {
    tick,
    population: 0,
    totalFoodStock: 0,
    tribes: { tribeCount: 0, largestTribe: 0, inTribeFraction: 0, localKinFraction: 0, globalKinFraction: 0 },
  } as WorldMetrics;
}

describe('Metrics history', () => {
  it('stays bounded and evenly spaced over a long run', () => {
    const history = new MetricsHistory(10);
    for (let tick = 0; tick <= 1000; tick++) {
      history.record(fakeMetrics(tick), []);
    }
    const ticks = history.getSamples().map((s) => s.tick);

    expect(ticks.length).toBeLessThanOrEqual(10);
    expect(ticks[0]).toBe(0);
    const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
    expect(new Set(gaps)).toEqual(new Set([history.sampleInterval]));
    // The newest sample is never more than one interval behind the present.
    expect(1000 - ticks[ticks.length - 1]).toBeLessThan(history.sampleInterval);
  });

  it('ignores repeat samples for the same tick', () => {
    const history = new MetricsHistory();
    history.record(fakeMetrics(0), []);
    history.record(fakeMetrics(0), []);
    expect(history.getSamples()).toHaveLength(1);
  });

  it('computes the mean and population standard deviation of each weight', () => {
    const withWeight = (v: number) =>
      ({
        policy: Object.fromEntries(POLICY_WEIGHT_KEYS.map((k) => [k, v])),
      }) as unknown as Organism;
    const stats = computeWeightStats([withWeight(1), withWeight(3)]);
    for (const key of POLICY_WEIGHT_KEYS) {
      expect(stats[key].mean).toBeCloseTo(2);
      expect(stats[key].sd).toBeCloseTo(1);
    }
    expect(computeWeightStats([]).foodAttraction).toEqual({ mean: 0, sd: 0 });
  });

  it('is recorded by the world, matches its metrics, and clears on reset', () => {
    const world = new World({ seed: 99 });
    for (let i = 0; i < 50; i++) world.step();

    const samples = world.history.getSamples();
    expect(samples[0].tick).toBe(0);
    const last = samples[samples.length - 1];
    expect(last.tick).toBe(50);
    expect(last.population).toBe(world.getMetrics().population);
    expect(last.foodStock).toBe(world.getMetrics().totalFoodStock);

    world.reset();
    expect(world.history.getSamples().map((s) => s.tick)).toEqual([0]);
  });

  it('is identical for two worlds with the same seed', () => {
    const a = new World({ seed: 'repeatable' });
    const b = new World({ seed: 'repeatable' });
    for (let i = 0; i < 300; i++) {
      a.step();
      b.step();
    }
    expect(a.history.toCSV()).toBe(b.history.toCSV());
  }, 60_000);

  it('exports one CSV row per sample with a header', () => {
    const world = new World({ seed: 5 });
    for (let i = 0; i < 10; i++) world.step();
    const lines = world.history.toCSV().trim().split('\n');
    expect(lines[0].startsWith('tick,population,food_stock')).toBe(true);
    expect(lines).toHaveLength(world.history.getSamples().length + 1);
    expect(lines[1].split(',')).toHaveLength(lines[0].split(',').length);
  });
});
