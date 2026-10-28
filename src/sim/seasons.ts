import type { FoodRegion, SimulationConfig } from './types';

export type Season = 'plenty' | 'lean';

export interface SeasonState {
  readonly season: Season;
  /** Ticks until the season changes. */
  readonly ticksLeft: number;
}

/**
 * The season at a given tick. Each cycle of `seasonLength` ticks starts with
 * plenty and ends with a lean stretch of `leanFraction` of the cycle. The
 * schedule is fixed (no randomness), so seeds stay repeatable. Returns null
 * when seasons are off (`seasonLength` <= 0).
 */
export function seasonAt(tick: number, config: Readonly<SimulationConfig>): SeasonState | null {
  const length = config.seasonLength;
  if (length <= 0) return null;
  const leanStart = Math.round(length * (1 - config.leanFraction));
  const inCycle = tick % length;
  return inCycle < leanStart
    ? { season: 'plenty', ticksLeft: leanStart - inCycle }
    : { season: 'lean', ticksLeft: length - inCycle };
}

/**
 * The season in a food region. With staggered seasons each region's clock
 * runs ahead by its phase, so lean times sweep from region to region; without
 * a region (or with seasons in step) this is the world season.
 */
export function regionSeasonAt(
  tick: number,
  region: Readonly<FoodRegion> | undefined,
  config: Readonly<SimulationConfig>
): SeasonState | null {
  const offset =
    region && config.staggeredSeasons ? Math.round(region.seasonPhase * config.seasonLength) : 0;
  return seasonAt(tick + offset, config);
}

export type EcologicalSeason = 'Spring' | 'Summer' | 'Autumn' | 'Winter';

export interface EcologicalSeasonState {
  readonly season: EcologicalSeason;
  /** Underlying binary plenty/lean mechanic state. */
  readonly phase: Season;
  /** Icon glyph for UI display. */
  readonly icon: string;
  /** Ticks remaining in this ecological season quarter. */
  readonly ticksLeft: number;
}

/**
 * The four ecological seasons (Spring, Summer, Autumn, Winter).
 * Spring (0..25%): awakening, lush regrowth
 * Summer (25..50%): peak fertility and warmth
 * Autumn (50..75%): seed dispersal and cooling transition
 * Winter (75..100%): lean dormancy, cold fronts, and frost
 */
export function ecologicalSeasonAt(
  tick: number,
  config: Readonly<SimulationConfig>,
  offset = 0
): EcologicalSeasonState | null {
  const length = config.seasonLength;
  if (length <= 0) return null;
  const inCycle = ((tick + offset) % length + length) % length;
  const quarter = length / 4;
  const qIdx = Math.min(3, Math.floor(inCycle / quarter));

  const seasons: { name: EcologicalSeason; icon: string }[] = [
    { name: 'Spring', icon: '🌱' },
    { name: 'Summer', icon: '☀️' },
    { name: 'Autumn', icon: '🍂' },
    { name: 'Winter', icon: '❄️' },
  ];
  const item = seasons[qIdx];
  const leanStart = Math.round(length * (1 - config.leanFraction));
  const isLean = inCycle >= leanStart;
  const ticksLeft = Math.max(1, Math.round((qIdx + 1) * quarter - inCycle));

  return {
    season: item.name,
    icon: item.icon,
    phase: isLean ? 'lean' : 'plenty',
    ticksLeft,
  };
}

/**
 * Ecological season in a specific food region, factoring in staggered regional offsets.
 */
export function regionEcologicalSeasonAt(
  tick: number,
  region: Readonly<FoodRegion> | undefined,
  config: Readonly<SimulationConfig>
): EcologicalSeasonState | null {
  const offset =
    region && config.staggeredSeasons ? Math.round(region.seasonPhase * config.seasonLength) : 0;
  return ecologicalSeasonAt(tick, config, offset);
}
