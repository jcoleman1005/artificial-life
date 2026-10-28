import { describe, expect, it } from 'vitest';
import { APP_VERSION, APP_CODENAME, APP_RELEASE_DATE } from '../src/version';
import pkg from '../package.json';
import { ecologicalSeasonAt, regionEcologicalSeasonAt } from '../src/sim/seasons';
import { seasonSummary, weatherPatternDescription } from '../src/ui/peek-view';
import { describeEvent } from '../src/ui/events-view';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { FoodRegion } from '../sim/types';

describe('Version numbering system', () => {
  it('institutes a standard SemVer version string', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.version).toBe(APP_VERSION);
    expect(APP_CODENAME).toBeTruthy();
    expect(APP_RELEASE_DATE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('Ecological seasons and weather patterns', () => {
  const config = { ...DEFAULT_CONFIG, seasonLength: 800, leanFraction: 0.25, staggeredSeasons: false };

  it('cycles through Spring, Summer, Autumn, and Winter across the season length', () => {
    const spring = ecologicalSeasonAt(100, config);
    expect(spring?.season).toBe('Spring');
    expect(spring?.icon).toBe('🌱');
    expect(spring?.phase).toBe('plenty');

    const summer = ecologicalSeasonAt(300, config);
    expect(summer?.season).toBe('Summer');
    expect(summer?.icon).toBe('☀️');
    expect(summer?.phase).toBe('plenty');

    const autumn = ecologicalSeasonAt(500, config);
    expect(autumn?.season).toBe('Autumn');
    expect(autumn?.icon).toBe('🍂');
    expect(autumn?.phase).toBe('plenty');

    const winter = ecologicalSeasonAt(700, config);
    expect(winter?.season).toBe('Winter');
    expect(winter?.icon).toBe('❄️');
    expect(winter?.phase).toBe('lean');
  });

  it('detects staggered regional seasons accurately', () => {
    const region: FoodRegion = { x: 10, y: 10, radius: 10, seasonPhase: 0.5 };
    const staggeredConfig = { ...config, staggeredSeasons: true };
    // At tick 100 + 400 = 500 => Autumn
    const res = regionEcologicalSeasonAt(100, region, staggeredConfig);
    expect(res?.season).toBe('Autumn');
  });

  it('generates rich weather pattern descriptors from atmospheric conditions', () => {
    expect(weatherPatternDescription(null)).toBeNull();
    expect(weatherPatternDescription({ fronts: [{ type: 'rain_storm' }] })).toBe('🌧️ Rainstorm');
    expect(weatherPatternDescription({ fronts: [{ type: 'cold_front' }] })).toBe('❄️ Cold snap');
    expect(weatherPatternDescription({ fronts: [{ type: 'heat_wave' }] })).toBe('☀️ Heatwave');
    expect(weatherPatternDescription({ wind: { wx: 0.5, wy: 0.2 } })).toBe('💨 Gale');
    expect(weatherPatternDescription({ wind: { wx: 0.2, wy: 0.1 } })).toBe('🍃 Breezy');
    expect(weatherPatternDescription({ wind: { wx: 0.05, wy: 0.05 } })).toBe('🌤️ Fair');
  });

  it('displays season and weather in seasonSummary instead of binary Plenty or Lean announcements', () => {
    const summary = seasonSummary(100, [], config, { fronts: [{ type: 'rain_storm' }] });
    expect(summary.text).toContain('Spring');
    expect(summary.text).toContain('🌧️ Rainstorm');
    expect(summary.text).not.toContain('Plenty');
    expect(summary.text).not.toContain('Lean');

    const winterSummary = seasonSummary(700, [], config, { fronts: [{ type: 'cold_front' }] });
    expect(winterSummary.text).toContain('Winter');
    expect(winterSummary.text).toContain('❄️ Cold snap');
    expect(winterSummary.lean).toBe(true);
    expect(winterSummary.text).not.toContain('Plenty');
    expect(winterSummary.text).not.toContain('Lean');
  });

  it('formats seasons display as NW:[season] NE:[season] SE:[season] SW:[season]', () => {
    const staggeredConfig = { ...DEFAULT_CONFIG, seasonLength: 800, leanFraction: 0.25, staggeredSeasons: true };
    const regions: FoodRegion[] = [
      { x: 15, y: 15, radius: 8, seasonPhase: 0 },    // NW -> Spring at tick 0
      { x: 45, y: 15, radius: 8, seasonPhase: 0.25 }, // NE -> Summer at tick 0
      { x: 45, y: 45, radius: 8, seasonPhase: 0.5 },  // SE -> Autumn at tick 0
      { x: 15, y: 45, radius: 8, seasonPhase: 0.75 }, // SW -> Winter at tick 0
    ];
    const summary = seasonSummary(0, regions, staggeredConfig);
    expect(summary.text).toBe('NW: Spring NE: Summer SE: Autumn SW: Winter');
    expect(summary.lean).toBe(true);

    // Advancing 200 ticks rotates all quadrants forward one quarter
    const rotated = seasonSummary(200, regions, staggeredConfig);
    expect(rotated.text).toBe('NW: Summer NE: Autumn SE: Winter SW: Spring');
  });

  it('describes events using ecological seasons and weather front arrivals', () => {
    const winterEvent = describeEvent({ seq: 1, tick: 700, kind: 'season', region: null, season: 'lean' }, [], config);
    expect(winterEvent.text).toBe('❄️ Winter begins');

    const springEvent = describeEvent({ seq: 2, tick: 100, kind: 'season', region: null, season: 'plenty' }, [], config);
    expect(springEvent.text).toBe('🌱 Spring arrives');

    const stormEvent = describeEvent({ seq: 3, tick: 150, kind: 'weather', frontType: 'rain_storm', intensity: 0.9, x: 5, y: 5 }, [], config);
    expect(stormEvent.text).toContain('Rainstorm');
    expect(stormEvent.text).toContain('north-west');
  });
});
