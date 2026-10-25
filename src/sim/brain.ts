import type { PRNG } from './prng';
import type {
  ActionScore,
  LegalAction,
  Organism,
  SensedInputs,
  SimulationConfig,
} from './types';

/**
 * An evolvable controller: a tiny neural network that scores each legal
 * action from features describing that action and the organism's state.
 *
 *   score = skip · x  +  out · tanh(hidden · x + hiddenBias)  +  outBias
 *
 * The direct "skip" connections start as a head start that roughly mirrors
 * the hand-written dial policy (food first, hunger steering to food, parents
 * feeding hungry children). The hidden layer starts small and random, so it
 * can evolve combinations of inputs no single dial expresses.
 */

export const BRAIN_INPUTS = [
  'bias',
  'isMove',
  'isEat',
  'isPickUp',
  'isReproduce',
  'isGive',
  'isRest',
  'energy',
  'carried',
  'crowding',
  'eatHunger',
  'pickUpRoom',
  'reproFullness',
  'giveNeed',
  'giveNeedAlike',
  'giveNeedChild',
  'moveFood',
  'moveFoodHungry',
  'moveObstacle',
  'moveCrowd',
  'moveKin',
  'moveParentFood',
  'moveFamilySwap',
  'moveNoise',
  'pushedByEating',
] as const;

export type BrainInput = (typeof BRAIN_INPUTS)[number];

export const BRAIN_INPUT_COUNT = BRAIN_INPUTS.length;
export const BRAIN_HIDDEN = 6;
const WEIGHT_LIMIT = 40;

export interface Brain {
  readonly skip: readonly number[]; // BRAIN_INPUT_COUNT
  readonly hidden: readonly number[]; // BRAIN_HIDDEN × BRAIN_INPUT_COUNT, row-major
  readonly hiddenBias: readonly number[]; // BRAIN_HIDDEN
  readonly out: readonly number[]; // BRAIN_HIDDEN
  readonly outBias: number;
}

/** Direct-connection weights at birth for founders: a dial-like head start. */
const HEAD_START: Readonly<Partial<Record<BrainInput, number>>> = {
  isEat: 0.5,
  eatHunger: 3,
  isPickUp: -0.1,
  pickUpRoom: 0.5,
  isReproduce: 0.2,
  reproFullness: 3.5,
  isGive: -0.1,
  giveNeedChild: 3,
  moveFood: 1.5,
  moveFoodHungry: 17,
  moveObstacle: -0.7,
  moveCrowd: -0.3,
  moveParentFood: 3,
  moveNoise: 0.4,
  pushedByEating: -35,
};

export const HEAD_START_SKIP: readonly number[] = BRAIN_INPUTS.map((name) => HEAD_START[name] ?? 0);

export function createHeadStartBrain(prng: PRNG): Brain {
  const small = () => Number(prng.nextGaussian(0, 0.1).toFixed(4));
  return {
    skip: [...HEAD_START_SKIP],
    hidden: Array.from({ length: BRAIN_HIDDEN * BRAIN_INPUT_COUNT }, small),
    hiddenBias: Array.from({ length: BRAIN_HIDDEN }, small),
    out: Array.from({ length: BRAIN_HIDDEN }, small),
    outBias: 0,
  };
}

/** A child's brain: each weight mutates with probability brainMutationRate. */
export function mutateBrain(parent: Brain, config: Readonly<SimulationConfig>, prng: PRNG): Brain {
  const mutate = (w: number): number => {
    if (prng.next() >= config.brainMutationRate) return w;
    const next = w + prng.nextGaussian(0, config.brainMutationStdDev);
    return Number(Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, next)).toFixed(4));
  };
  return {
    skip: parent.skip.map(mutate),
    hidden: parent.hidden.map(mutate),
    hiddenBias: parent.hiddenBias.map(mutate),
    out: parent.out.map(mutate),
    outBias: mutate(parent.outBias),
  };
}

function directionOf(type: string): [number, number] {
  if (type.endsWith('_NORTH')) return [0, -1];
  if (type.endsWith('_SOUTH')) return [0, 1];
  if (type.endsWith('_EAST')) return [1, 0];
  if (type.endsWith('_WEST')) return [-1, 0];
  return [0, 0];
}

/** Alignment of a unit move with an offset, scaled down with distance. */
function aligned(dx: number, dy: number, target: { dx: number; dy: number; distance: number } | null, falloff: number) {
  if (!target) return 0;
  const norm = Math.hypot(target.dx, target.dy) || 1;
  const dot = (dx * target.dx + dy * target.dy) / norm;
  return dot / (1 + falloff * target.distance);
}

/** Features for one legal action, in BRAIN_INPUTS order. */
export function brainFeatures(
  action: LegalAction,
  organism: Readonly<Organism>,
  sensed: Readonly<SensedInputs>,
  config: Readonly<SimulationConfig>,
  canEatNow: boolean,
  prng: PRNG
): number[] {
  const type = action.type;
  const isMove = type.startsWith('MOVE_');
  const isGive = type.startsWith('GIVE_');
  const isReproduce = type.startsWith('REPRODUCE_');
  const hunger = 1 - sensed.energyRatio;
  const hungry = sensed.energyRatio < 0.5;
  const need = action.recipientNeed ?? 0;
  const [dx, dy] = isMove ? directionOf(type) : [0, 0];

  let moveKin = 0;
  if (isMove && sensed.kinPull) {
    const { dx: px, dy: py } = sensed.kinPull;
    moveKin = (dx * px + dy * py) / Math.max(1, Math.hypot(px, py));
  }
  const headroom = Math.max(1, config.maxEnergy - config.reproductionThreshold);

  const f: Record<BrainInput, number> = {
    bias: 1,
    isMove: isMove ? 1 : 0,
    isEat: type === 'EAT' ? 1 : 0,
    isPickUp: type === 'PICK_UP' ? 1 : 0,
    isReproduce: isReproduce ? 1 : 0,
    isGive: isGive ? 1 : 0,
    isRest: type === 'REST' ? 1 : 0,
    energy: sensed.energyRatio,
    carried: sensed.carriedFood / Math.max(1, organism.carryCapacity),
    crowding: Math.min(1, sensed.surroundingOrganismCount / 8),
    eatHunger: type === 'EAT' ? hunger : 0,
    pickUpRoom: type === 'PICK_UP' ? 1 - sensed.carriedFood / Math.max(1, organism.carryCapacity) : 0,
    reproFullness: isReproduce ? Math.max(0, organism.energy - config.reproductionThreshold) / headroom : 0,
    giveNeed: isGive && !action.recipientIsChild ? need : 0,
    giveNeedAlike: isGive && !action.recipientIsChild ? need * (action.recipientSimilarity ?? 0) : 0,
    giveNeedChild: isGive && action.recipientIsChild ? need : 0,
    moveFood: isMove ? aligned(dx, dy, sensed.nearestFood, 0.25) : 0,
    moveFoodHungry: isMove && hungry ? aligned(dx, dy, sensed.nearestFood, 0) : 0,
    moveObstacle: isMove ? aligned(dx, dy, sensed.nearestObstacle, 0.5) : 0,
    moveCrowd: isMove ? aligned(dx, dy, sensed.nearestOrganism, 0.3) : 0,
    moveKin,
    moveParentFood: isMove ? aligned(dx, dy, sensed.parentWithFood, 0) : 0,
    moveFamilySwap: isMove && action.swapWithId ? 1 : 0,
    moveNoise: isMove ? prng.nextFloat(-1, 1) : 0,
    pushedByEating: canEatNow && type !== 'EAT' && !action.recipientIsChild ? 1 : 0,
  };
  return BRAIN_INPUTS.map((name) => f[name]);
}

/** Score for one feature vector, with the per-input direct contributions. */
export function brainScore(brain: Brain, x: readonly number[]): { score: number; direct: number[]; hidden: number } {
  const direct = x.map((v, i) => v * brain.skip[i]);
  let hidden = brain.outBias;
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    let sum = brain.hiddenBias[h];
    const row = h * BRAIN_INPUT_COUNT;
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) sum += brain.hidden[row + i] * x[i];
    hidden += brain.out[h] * Math.tanh(sum);
  }
  const score = direct.reduce((a, v) => a + v, 0) + hidden;
  return { score, direct, hidden };
}

/**
 * Chooses among legal actions with the organism's brain. Scores carry the
 * nonzero direct contributions plus the hidden layer's total, so the
 * inspector can show what drove each choice.
 */
export function evaluateBrain(
  organism: Readonly<Organism>,
  legalActions: readonly LegalAction[],
  sensed: Readonly<SensedInputs>,
  config: Readonly<SimulationConfig>,
  prng: PRNG
): { chosenAction: LegalAction; scores: ActionScore[] } {
  const canEatNow = legalActions.some((a) => a.type === 'EAT');
  const scores: ActionScore[] = legalActions.map((action) => {
    const x = brainFeatures(action, organism, sensed, config, canEatNow, prng);
    const { score, direct, hidden } = brainScore(organism.brain, x);
    const components: Record<string, number> = {};
    direct.forEach((v, i) => {
      if (Math.abs(v) >= 0.001) components[BRAIN_INPUTS[i]] = Number(v.toFixed(3));
    });
    components['hiddenLayer'] = Number(hidden.toFixed(3));
    return { action, totalScore: Number(score.toFixed(3)), components };
  });

  let best = -Infinity;
  let candidates: ActionScore[] = [];
  for (const s of scores) {
    if (s.totalScore > best + 1e-6) {
      best = s.totalScore;
      candidates = [s];
    } else if (Math.abs(s.totalScore - best) <= 1e-6) {
      candidates.push(s);
    }
  }
  const winner = candidates.length === 1 ? candidates[0] : prng.choice(candidates);
  return { chosenAction: winner.action, scores };
}

/** How far a brain's direct connections have moved from the head start (mean |Δ|). */
export function brainDrift(brain: Brain): number {
  let sum = 0;
  for (let i = 0; i < BRAIN_INPUT_COUNT; i++) sum += Math.abs(brain.skip[i] - HEAD_START_SKIP[i]);
  return sum / BRAIN_INPUT_COUNT;
}

/** Overall strength of the hidden layer's output (mean |out weight|). */
export function hiddenStrength(brain: Brain): number {
  return brain.out.reduce((a, w) => a + Math.abs(w), 0) / BRAIN_HIDDEN;
}
