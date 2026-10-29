import type { PRNG } from './prng';
import type { OvergrazingMetrics, SimulationConfig } from './types';
import type { SoilField } from './plants';

/** Never bitten: far enough back that every cell starts rested. */
const NEVER = -1_000_000;

/** A cell below this health counts as degraded in the metrics. */
export const DEGRADED_BELOW = 0.5;

/** What a world saves of cell health (plain arrays; older saves lack it and start every cell at 1). */
export interface CellHealthState {
  readonly health: readonly number[];
  readonly lastBite: readonly number[];
  readonly carry: readonly number[];
  readonly pendingBites: number;
}

/**
 * Overgrazing: every cell has a health in [0, 1] (start 1). A bite lowers it by
 * overgrazingDamagePerBite; it recovers by overgrazingRecoveryRate per tick, but
 * only once the cell has had no bite for overgrazingRestTicks. Regrowth is the
 * normal rate times health. Health belongs to the cell, not to the plant or patch
 * standing on it, so a grazed-out cell stays poor when its plant dies and a seed
 * takes root again. With overgrazingMatchedRandom the bites do no damage where
 * they land; the same damage lands on random fertile cells instead.
 */
export class CellHealth {
  public readonly health: Float32Array;
  private readonly lastBite: Int32Array;
  /** Fractional regrowth owed to classic (non-plant) patches, whose stock is whole units. */
  private readonly carry: Float32Array;
  /** Bites since the last step (the matched-random control spends them as random damage). */
  private pendingBites = 0;

  constructor(cells: number) {
    this.health = new Float32Array(cells).fill(1);
    this.lastBite = new Int32Array(cells).fill(NEVER);
    this.carry = new Float32Array(cells);
  }

  /** Someone ate or picked up one unit in this cell. */
  public bite(index: number, tick: number, config: Readonly<SimulationConfig>): void {
    if (config.overgrazingMatchedRandom) this.pendingBites++;
    else this.damage(index, tick, config);
  }

  private damage(index: number, tick: number, config: Readonly<SimulationConfig>): void {
    this.health[index] = Math.max(0, this.health[index] - config.overgrazingDamagePerBite);
    this.lastBite[index] = tick;
  }

  /**
   * Once per tick, before plants grow: spend the matched-random damage, then let
   * rested cells recover. `fertile` lists the cell indices the control may hit.
   */
  public step(tick: number, config: Readonly<SimulationConfig>, prng: PRNG, fertile: readonly number[]): void {
    for (let i = 0; i < this.pendingBites && fertile.length > 0; i++) {
      this.damage(fertile[prng.nextInt(0, fertile.length - 1)], tick, config);
    }
    this.pendingBites = 0;
    const { overgrazingRecoveryRate: rate, overgrazingRestTicks: rest } = config;
    for (let i = 0; i < this.health.length; i++) {
      if (this.health[i] < 1 && tick - this.lastBite[i] >= rest) {
        this.health[i] = Math.min(1, this.health[i] + rate);
      }
    }
  }

  /**
   * Classic regrowth owed to a cell: the whole units of `amount` × health,
   * keeping the fraction for later ticks.
   */
  public regrow(index: number, amount: number): number {
    this.carry[index] += amount * this.health[index];
    const whole = Math.floor(this.carry[index]);
    this.carry[index] -= whole;
    return whole;
  }

  /** A patch already full wastes no growth. */
  public clearCarry(index: number): void {
    this.carry[index] = 0;
  }

  /** Mean health per region, overall, and the degraded share, over the fertile cells. */
  public metrics(field: SoilField, regionCount: number, fertile: readonly number[]): OvergrazingMetrics {
    const groups = Math.max(1, regionCount);
    const sum = new Array<number>(groups).fill(0);
    const n = new Array<number>(groups).fill(0);
    let total = 0;
    let degraded = 0;
    for (const i of fertile) {
      const g = Math.max(0, field.region[i]);
      sum[g] += this.health[i];
      n[g]++;
      total += this.health[i];
      if (this.health[i] < DEGRADED_BELOW) degraded++;
    }
    const count = Math.max(1, fertile.length);
    return {
      meanHealth: sum.map((s, g) => (n[g] > 0 ? s / n[g] : 1)),
      meanHealthAll: fertile.length > 0 ? total / count : 1,
      fractionDegraded: degraded / count,
    };
  }

  public exportState(): CellHealthState {
    return {
      health: Array.from(this.health),
      lastBite: Array.from(this.lastBite),
      carry: Array.from(this.carry),
      pendingBites: this.pendingBites,
    };
  }

  public static fromState(state: CellHealthState): CellHealth {
    const cells = new CellHealth(state.health.length);
    cells.health.set(state.health);
    cells.lastBite.set(state.lastBite);
    cells.carry.set(state.carry);
    cells.pendingBites = state.pendingBites;
    return cells;
  }
}

/** The cells overgrazing metrics and the matched-random control use: fertile ground proper (not the thin margins). */
export function fertileCells(field: SoilField): number[] {
  const cells: number[] = [];
  for (let i = 0; i < field.baseFertility.length; i++) if (field.baseFertility[i] >= 1) cells.push(i);
  return cells;
}
