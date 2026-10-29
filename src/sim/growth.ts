import type { Organism, SimulationConfig } from './types';

/**
 * Growth and ageing (docs/specs/growth.md). Two independent switches:
 *
 * - growthEnabled: organisms hatch small (maturity hatchMaturity), grow to
 *   adult size over about growthTicks if fed, and cannot breed below matureAt.
 *   Maturity scales the body (bodyScale): reserves, base upkeep, move cost,
 *   bite size and carry capacity. The adult-size genes stay as inherited.
 * - ageingEnabled: past senescenceAge upkeep rises with age, and at maxAge the
 *   organism dies of old age.
 *
 * With a switch off these helpers return the neutral value (maturity 1,
 * scale 1, factor 1), so the world is bit-identical to one without the feature.
 */

/** How grown the organism is, 0..1; always 1 with growth off (and for organisms from before it existed). */
export const maturityOf = (o: Readonly<Pick<Organism, 'maturity'>>, c: Readonly<SimulationConfig>): number =>
  c.growthEnabled ? (o.maturity ?? 1) : 1;

/** Body-size multiplier on the effective size: hatchScale at maturity 0 up to 1 when grown. */
export function bodyScaleOf(o: Readonly<Pick<Organism, 'maturity'>>, c: Readonly<SimulationConfig>): number {
  if (!c.growthEnabled) return 1;
  const m = o.maturity ?? 1;
  return m >= 1 ? 1 : c.hatchScale + (1 - c.hatchScale) * m;
}

/** Whether the organism is grown enough to reproduce or mate (always, with growth off). */
export const isMature = (o: Readonly<Pick<Organism, 'maturity'>>, c: Readonly<SimulationConfig>): boolean =>
  !c.growthEnabled || (o.maturity ?? 1) >= c.matureAt;

/** Food units an organism can hold now: its inherited capacity, scaled by body size while growing (never below 1 for a carrier). */
export function carryCapacityOf(o: Readonly<Pick<Organism, 'maturity' | 'carryCapacity'>>, c: Readonly<SimulationConfig>): number {
  const scale = bodyScaleOf(o, c);
  if (scale >= 1 || o.carryCapacity <= 0) return o.carryCapacity;
  return Math.max(1, Math.round(o.carryCapacity * scale));
}

/**
 * Fed ticks to grow from maturity 0 to 1. The organism's inherited growthDuration
 * while the gene is on (growthGeneEnabled), otherwise the fixed growthTicks (also
 * the fallback for an organism that carries no such gene, e.g. one from an older save).
 */
export function growthDurationOf(o: Readonly<Pick<Organism, 'growthDuration'>>, c: Readonly<SimulationConfig>): number {
  const d = c.growthGeneEnabled ? (o.growthDuration ?? c.growthTicks) : c.growthTicks;
  return Math.max(1, d);
}

/** Maturity gained on each tick the organism is fed enough to grow. */
export const growthRateOf = (o: Readonly<Pick<Organism, 'growthDuration'>>, c: Readonly<SimulationConfig>): number =>
  1 / growthDurationOf(o, c);

/**
 * Heat paid on each growing tick: growthCostPerTick × (growthTicks / duration)^exponent.
 * Growing from 0 to 1 takes `duration` such ticks, so the total is
 * growthCostPerTick × growthTicks^e × duration^(1 - e): with the default exponent
 * (1.5) a body that grows 4x faster pays 2x the heat in all, one that grows 4x
 * slower pays half, but stays juvenile (small, unable to breed) for longer. The
 * duration the organism carries is the only input; no duration is rewarded. At
 * the reference duration (and with the gene off) this is exactly growthCostPerTick.
 */
export function growthCostOf(o: Readonly<Pick<Organism, 'growthDuration'>>, c: Readonly<SimulationConfig>): number {
  const d = growthDurationOf(o, c);
  if (d === c.growthTicks) return c.growthCostPerTick;
  return c.growthCostPerTick * Math.pow(c.growthTicks / d, c.growthDurationCostExponent);
}

/** Multiplier on upkeep from age: 1 until senescenceAge, then rising by senescenceRate per tick. */
export function senescenceFactorOf(o: Readonly<Pick<Organism, 'age'>>, c: Readonly<SimulationConfig>): number {
  const age = o.age ?? 0; // partial organisms (tests, previews) may lack it
  if (!c.ageingEnabled || age <= c.senescenceAge) return 1;
  return 1 + c.senescenceRate * (age - c.senescenceAge);
}

/** Whether the organism has reached the age at which it dies (ageing on only). */
export const diesOfOldAge = (o: Readonly<Pick<Organism, 'age'>>, c: Readonly<SimulationConfig>): boolean =>
  c.ageingEnabled && o.age >= c.maxAge;

export type LifeStage = 'juvenile' | 'adult' | 'senescent';

/** For display: juvenile below matureAt, senescent past senescenceAge, adult between (with a switch off that stage never shows). */
export function lifeStageOf(o: Readonly<Pick<Organism, 'maturity' | 'age'>>, c: Readonly<SimulationConfig>): LifeStage {
  if (!isMature(o, c)) return 'juvenile';
  if (c.ageingEnabled && o.age > c.senescenceAge) return 'senescent';
  return 'adult';
}

/**
 * The maturity this organism's newborns start at: its inherited hatchMaturity
 * gene while that is on (hatchMaturityGeneEnabled), otherwise the fixed
 * hatchMaturity (also the fallback for an organism with no such gene, e.g. from
 * an older save). Meaningful only with growth on.
 */
export function hatchMaturityOf(o: Readonly<Pick<Organism, 'hatchMaturity'>>, c: Readonly<SimulationConfig>): number {
  return c.hatchMaturityGeneEnabled ? (o.hatchMaturity ?? c.hatchMaturity) : c.hatchMaturity;
}

/** Whether a newborn's launch cost follows its own hatch maturity (growth and the gene both on). */
export const hatchCostActive = (c: Readonly<SimulationConfig>): boolean => c.growthEnabled && c.hatchMaturityGeneEnabled;

/**
 * Provisioning ratio of a newborn born at maturity `h`: its body scale relative to
 * the reference newborn (the world's hatchMaturity). Exactly 1 at the reference
 * (and with the gene or growth off), so a founder-like child costs what it
 * always did; a precocial child costs proportionally more, an altricial one less.
 * The ratio is a property of the body being launched, not a reward: nothing here
 * names a preferred hatch maturity.
 */
export function launchRatioOf(h: number, c: Readonly<SimulationConfig>): number {
  if (!hatchCostActive(c)) return 1;
  const scale = (m: number) => c.hatchScale + (1 - c.hatchScale) * m;
  return scale(h) / scale(c.hatchMaturity);
}

/** Minimum energy a child born at maturity `h` needs to be launched: minViableChildEnergy x launchRatio. */
export const minViableEnergyAt = (h: number, c: Readonly<SimulationConfig>): number => c.minViableChildEnergy * launchRatioOf(h, c);
