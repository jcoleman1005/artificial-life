/**
 * Energy ledger (docs/decisions.md, "Energy ledger"). An observer: it never
 * changes the world, draws no random numbers, and is not part of the saved
 * state or stateHash(), so a world with it off is bit-identical.
 *
 * The system it balances is the energy the animals hold: every organism's
 * energy and fat, the energy inside eggs, and the energy lying as carrion.
 * Plants are outside it (their food enters the system at the mouth, as a meal).
 * Between two checks:
 *
 *   change in stored energy = in − out
 *
 * `in` is energy crossing the boundary into the system (meals, the fixed part
 * of a corpse, overdrafts forgiven at zero, immigrants). `out` is energy that
 * leaves it (upkeep, actions, birth costs, losses at the mouth, rot, energy
 * above the cap). Moving energy between organisms, eggs and carrion is
 * internal and is not recorded. Whatever the books cannot explain is the
 * residual, and every new gene must leave it at zero.
 *
 * Flows are plain numbers added to as things happen; the stored energy is only
 * summed at each check, so the check interval sets the cost.
 */

export interface LedgerFlows {
  // in
  readonly plantMeal: number; // energy and fat gained from plant food (eaten, carried or given)
  readonly carrionCreated: number; // energy in a corpse laid down at a death
  readonly overdraft: number; // energy forgiven when spending took a body below zero
  readonly immigrants: number; // energy and fat of newcomers
  // out
  readonly upkeep: number; // base metabolism and body upkeep
  readonly wake: number; // cost of acting right after a rest
  readonly malaise: number; // toxin damage from plant defences
  readonly move: number; // moves, swaps and leaps
  readonly attack: number; // cost of attacking
  readonly signal: number; // cost of signalling
  readonly birthCosts: number; // tax, egg extra, dispersal travel (not the child's own energy)
  readonly matingHeat: number; // the pool of a mating not handed to children
  readonly birthClamp: number; // energy a newborn could not hold
  readonly hatchLoss: number; // energy lost (or, if negative, gained) when an egg hatches
  readonly eggDecay: number; // energy in an egg that decayed
  readonly eggMealLoss: number; // part of an eaten egg the eater did not absorb
  readonly carrionMealLoss: number; // part of a carrion bite the eater did not absorb
  readonly carrionRot: number; // carrion that rotted away
  readonly killed: number; // energy of a body that moved into carrion at a kill (carrion adds it back in carrionCreated)
  readonly deathFat: number; // fat that died with its owner
  readonly overCap: number; // energy above a body's cap, discarded
}

export type LedgerFlowName = keyof LedgerFlows;

export const LEDGER_IN: readonly LedgerFlowName[] = ['plantMeal', 'carrionCreated', 'overdraft', 'immigrants'];
export const LEDGER_OUT: readonly LedgerFlowName[] = [
  'upkeep',
  'wake',
  'malaise',
  'move',
  'attack',
  'signal',
  'birthCosts',
  'matingHeat',
  'birthClamp',
  'hatchLoss',
  'eggDecay',
  'eggMealLoss',
  'carrionMealLoss',
  'carrionRot',
  'killed',
  'deathFat',
  'overCap',
];

export interface LedgerReport {
  /** Whether a baseline has been taken (the first check is the second one). */
  readonly started: boolean;
  /** Tick of the last check, and the number of ticks it covered. */
  readonly lastCheckTick: number;
  readonly windTicks: number;
  readonly stored: number;
  readonly storedChange: number;
  readonly totalIn: number;
  readonly totalOut: number;
  /** storedChange − (in − out); zero when the books balance. */
  readonly residual: number;
  /** Largest |residual| and the number of checks beyond tolerance since the start. */
  readonly maxAbsResidual: number;
  readonly checks: number;
  readonly violations: number;
  readonly flows: LedgerFlows;
}

export class EnergyLedger {
  public plantMeal = 0;
  public carrionCreated = 0;
  public overdraft = 0;
  public immigrants = 0;
  public upkeep = 0;
  public wake = 0;
  public malaise = 0;
  public move = 0;
  public attack = 0;
  public signal = 0;
  public birthCosts = 0;
  public matingHeat = 0;
  public birthClamp = 0;
  public hatchLoss = 0;
  public eggDecay = 0;
  public eggMealLoss = 0;
  public carrionMealLoss = 0;
  public carrionRot = 0;
  public killed = 0;
  public deathFat = 0;
  public overCap = 0;

  private baseline: number | null = null;
  private baselineTick = 0;
  private last: LedgerReport | null = null;
  private maxAbs = 0;
  private checks = 0;
  private violations = 0;

  /** Whether the stored energy at the start of the current window has been taken. */
  public get started(): boolean {
    return this.baseline !== null;
  }

  /** Forget everything and take a new baseline at the next opportunity (after loading a saved world). */
  public reset(): void {
    this.clearFlows();
    this.baseline = null;
    this.last = null;
    this.maxAbs = 0;
    this.checks = 0;
    this.violations = 0;
  }

  /** Take the stored energy as the start of a window; flows already added are dropped. */
  public begin(stored: number, tick: number): void {
    this.clearFlows();
    this.baseline = stored;
    this.baselineTick = tick;
  }

  /** Close the window: compare the change in stored energy with the flows, then start a new window. */
  public check(stored: number, tick: number): LedgerReport {
    const flows = this.snapshotFlows();
    let totalIn = 0;
    for (const k of LEDGER_IN) totalIn += flows[k];
    let totalOut = 0;
    for (const k of LEDGER_OUT) totalOut += flows[k];
    const storedChange = stored - (this.baseline ?? stored);
    const residual = storedChange - (totalIn - totalOut);
    // Floating-point sums of thousands of terms: allow a relative slack.
    const tolerance = 1e-6 * (1 + totalIn + Math.abs(totalOut) + Math.abs(stored));
    this.checks++;
    if (Math.abs(residual) > tolerance) this.violations++;
    this.maxAbs = Math.max(this.maxAbs, Math.abs(residual));
    const report: LedgerReport = {
      started: true,
      lastCheckTick: tick,
      windTicks: tick - this.baselineTick,
      stored,
      storedChange,
      totalIn,
      totalOut,
      residual,
      maxAbsResidual: this.maxAbs,
      checks: this.checks,
      violations: this.violations,
      flows,
    };
    this.last = report;
    this.begin(stored, tick);
    return report;
  }

  /** The last completed check, if any. */
  public report(): LedgerReport | null {
    return this.last;
  }

  private snapshotFlows(): LedgerFlows {
    return {
      plantMeal: this.plantMeal,
      carrionCreated: this.carrionCreated,
      overdraft: this.overdraft,
      immigrants: this.immigrants,
      upkeep: this.upkeep,
      wake: this.wake,
      malaise: this.malaise,
      move: this.move,
      attack: this.attack,
      signal: this.signal,
      birthCosts: this.birthCosts,
      matingHeat: this.matingHeat,
      birthClamp: this.birthClamp,
      hatchLoss: this.hatchLoss,
      eggDecay: this.eggDecay,
      eggMealLoss: this.eggMealLoss,
      carrionMealLoss: this.carrionMealLoss,
      carrionRot: this.carrionRot,
      killed: this.killed,
      deathFat: this.deathFat,
      overCap: this.overCap,
    };
  }

  private clearFlows(): void {
    this.plantMeal = 0;
    this.carrionCreated = 0;
    this.overdraft = 0;
    this.immigrants = 0;
    this.upkeep = 0;
    this.wake = 0;
    this.malaise = 0;
    this.move = 0;
    this.attack = 0;
    this.signal = 0;
    this.birthCosts = 0;
    this.matingHeat = 0;
    this.birthClamp = 0;
    this.hatchLoss = 0;
    this.eggDecay = 0;
    this.eggMealLoss = 0;
    this.carrionMealLoss = 0;
    this.carrionRot = 0;
    this.killed = 0;
    this.deathFat = 0;
    this.overCap = 0;
  }
}
