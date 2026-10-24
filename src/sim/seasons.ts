import type { SimulationConfig } from './types';

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
