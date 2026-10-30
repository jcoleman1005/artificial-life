import type { PRNG } from './prng';
import { isDiagonalMove, isLeapAction, isMoveAction, unitDirectionOf } from './directions';
import { carrionYield } from './traits';
import { maxEnergyOf, thresholdOf } from './lifehistory';
import { carryCapacityOf, maturityOf } from './growth';
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
  'isSignal',
  'signalOnFood',
  'signalHunger',
  'moveSignal',
  'moveSignalAlike',
  'moveOccupied',
  'isLeap',
  'isDiagonal',
  // Memory (zero when memory is off): remembered places, and the free registers
  'moveRememberedFood',
  'moveRememberedSignal',
  'moveHome',
  'register0',
  'register1',
  'register2',
  // Carrion and predation. New inputs always go at the end, so brains in
  // older saves can be upgraded (see upgradeBrain).
  'isEatCarrion',
  'eatCarrionHunger',
  'moveCarrion',
  'isAttack',
  'attackKillChance',
  'attackAlike',
  'attackFamily',
  'attackHunger',
  // Mating (brain only): asking an adjacent organism, who must ask back.
  'isMate',
  'mateFullness',
  'mateAlike',
  'mateFamily',
  'mateReady',
  // Weather systems (append-only)
  'weatherTemp',
  'weatherRain',
  'moveWindAlignment',
  // Red Queen: Trophic feedback (append-only)
  'lastBiteYield',
  // Growth (growthEnabled, append-only): how grown the body is, 0..1 (1 when grown, and with growth off).
  'maturity',
  // Land sensing (landSensingEnabled, append-only): the slope, water and roughness of the cell a move enters, and the cover underfoot.
  'moveSlope',
  'moveWater',
  'moveRough',
  'cover',
] as const;

export type BrainInput = (typeof BRAIN_INPUTS)[number];

export const BASE_BRAIN_INPUT_COUNT = 52;
export const BRAIN_INPUT_COUNT = BRAIN_INPUTS.length;
/** Index of the first weather input, and of the plant-defense and growth inputs (each appended in turn). */
const WEATHER_INPUT_START = BASE_BRAIN_INPUT_COUNT;
const DEFENSE_INPUT_START = BASE_BRAIN_INPUT_COUNT + 3;
export const MATURITY_INPUT = BRAIN_INPUTS.indexOf('maturity');
/** First of the four land-sensing inputs: slope and water need elevation, roughness and cover need terrain. */
export const LAND_INPUT_START = MATURITY_INPUT + 1;

/**
 * Whether input i has weights in a world with this config. Brains always have
 * all BRAIN_INPUT_COUNT inputs; an input whose feature switch is off gets zero
 * weights that are never drawn, mutated or encoded as genes, so that world is
 * bit-identical to one built before the input existed. (No config: all active.)
 */
export function brainInputActive(
  i: number,
  config?: Readonly<Pick<SimulationConfig, 'weatherEnabled' | 'plantDefenseEnabled' | 'growthEnabled' | 'landSensingEnabled' | 'elevationEnabled' | 'terrainEnabled'>>
): boolean {
  if (i < WEATHER_INPUT_START) return true;
  if (i < DEFENSE_INPUT_START) return config?.weatherEnabled !== false;
  if (i < MATURITY_INPUT) return config?.plantDefenseEnabled !== false;
  if (i === MATURITY_INPUT) return config?.growthEnabled !== false;
  if (config?.landSensingEnabled === false) return false;
  return i < LAND_INPUT_START + 2 ? config?.elevationEnabled !== false : config?.terrainEnabled !== false;
}
export const BRAIN_HIDDEN = 6;
export const WEIGHT_LIMIT = 40;

/**
 * The brain inputs whose feature value is the same for every legal action
 * within one decision (brainFeatures reads them from the organism's state
 * and senses only, never from the action): the constant bias, energy,
 * carried food, crowding and the three free memory registers. A hidden unit
 * fed only by these adds the same offset to every action's score, so it
 * cannot change which action wins (checked by a test).
 */
export const ACTION_INVARIANT_INPUTS: readonly BrainInput[] = [
  'bias',
  'energy',
  'carried',
  'crowding',
  'register0',
  'register1',
  'register2',
  'weatherTemp',
  'weatherRain',
  'lastBiteYield',
  'cover',
];

/** 1 at the BRAIN_INPUTS index of each ACTION_INVARIANT_INPUTS entry. */
export const ACTION_INVARIANT_MASK: Readonly<Uint8Array> = Uint8Array.from(BRAIN_INPUTS, (name) => (ACTION_INVARIANT_INPUTS.includes(name) ? 1 : 0));

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
  isSignal: -0.1, // signals start meaningless: only a small cost
  moveOccupied: -2.25, // like the avoidOccupied dial's head start
  // Carrion is eaten like food and sought like food, in proportion to how
  // much the diet gets from it.
  isEatCarrion: 0.5,
  eatCarrionHunger: 3,
  moveCarrion: 1.5,
  // Attacks start uncommon: a cost, eased for hungry meat eaters and good
  // odds. Which prey (by look) is left to evolve; family starts protected,
  // as parents start caring, and that can evolve away too.
  isAttack: -0.5,
  attackKillChance: 1,
  attackFamily: -2,
  attackHunger: 2,
  // Mating starts a little behind cloning (same pull from a full belly, 0.2
  // lower overall), so day one is unchanged and whether sex pays is left to
  // evolve. Who to ask (by look, family, readiness) starts neutral.
  isMate: 0,
  mateFullness: 3.5,
};

export const HEAD_START_SKIP: readonly number[] = BRAIN_INPUTS.map((name) => HEAD_START[name] ?? 0);

export function createHeadStartBrain(prng: PRNG, config?: Readonly<SimulationConfig>): Brain {
  const small = () => Number(prng.nextGaussian(0, 0.1).toFixed(4));
  const hidden: number[] = [];
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) {
      hidden.push(brainInputActive(i, config) ? small() : 0);
    }
  }
  return {
    skip: [...HEAD_START_SKIP],
    hidden,
    hiddenBias: Array.from({ length: BRAIN_HIDDEN }, small),
    out: Array.from({ length: BRAIN_HIDDEN }, small),
    outBias: 0,
  };
}

/**
 * A brain from a save made before the newest inputs existed. Inputs are only
 * ever appended, so the old ones keep their place: new direct connections get
 * the head start, and new hidden-layer connections start at zero (so the
 * hidden layer behaves exactly as before).
 */
export function upgradeBrain(brain: Brain): Brain {
  const old = brain.skip.length;
  if (old >= BRAIN_INPUT_COUNT) return brain;
  const added = BRAIN_INPUT_COUNT - old;
  const hidden: number[] = [];
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    hidden.push(...brain.hidden.slice(h * old, (h + 1) * old), ...new Array<number>(added).fill(0));
  }
  return { ...brain, skip: [...brain.skip, ...HEAD_START_SKIP.slice(old)], hidden };
}

/** One inherited weight (brain or memory register): mutates with probability brainMutationRate. */
export function mutateWeight(w: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (prng.next() >= config.brainMutationRate) return w;
  const next = w + prng.nextGaussian(0, config.brainMutationStdDev);
  return Number(Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, next)).toFixed(4));
}

/** A child's brain: each weight mutates with probability brainMutationRate. */
export function mutateBrain(parent: Brain, config: Readonly<SimulationConfig>, prng: PRNG): Brain {
  const weatherOn = config.weatherEnabled !== false;
  const growthOn = config.growthEnabled !== false;
  const mutate = (w: number): number => mutateWeight(w, config, prng);
  // Appended inputs are frozen while weather is off (as before); the growth input also while growth is off.
  const frozen = (i: number): boolean =>
    i >= BASE_BRAIN_INPUT_COUNT && (!weatherOn || (i === MATURITY_INPUT && !growthOn) || (i >= LAND_INPUT_START && !brainInputActive(i, config)));
  const skip = parent.skip.map((w, i) => (frozen(i) ? w : mutate(w)));
  const hidden = parent.hidden.map((w, k) => (frozen(k % BRAIN_INPUT_COUNT) ? w : mutate(w)));
  return {
    skip,
    hidden,
    hiddenBias: parent.hiddenBias.map(mutate),
    out: parent.out.map(mutate),
    outBias: mutate(parent.outBias),
  };
}

/**
 * A child brain from two parents: each direct connection from one parent or
 * the other, and each hidden unit (its input weights, bias and output weight)
 * whole from one parent, so units that work together stay together.
 */
export function crossBrains(a: Brain, b: Brain, prng: PRNG): Brain {
  const skip = a.skip.map((w, i) => (prng.next() < 0.5 ? w : b.skip[i]));
  const hidden: number[] = [];
  const hiddenBias: number[] = [];
  const out: number[] = [];
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    const from = prng.next() < 0.5 ? a : b;
    hidden.push(...from.hidden.slice(h * BRAIN_INPUT_COUNT, (h + 1) * BRAIN_INPUT_COUNT));
    hiddenBias.push(from.hiddenBias[h]);
    out.push(from.out[h]);
  }
  return { skip, hidden, hiddenBias, out, outBias: prng.next() < 0.5 ? a.outBias : b.outBias };
}

/** Alignment of a unit move with an offset, scaled down with distance. */
function aligned(dx: number, dy: number, target: { dx: number; dy: number; distance: number } | null, falloff: number) {
  if (!target) return 0;
  const norm = Math.sqrt(target.dx * target.dx + target.dy * target.dy) || 1;
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
  const out = new Float64Array(BRAIN_INPUT_COUNT);
  fillBrainFeatures(out, 0, action, organism, sensed, config, canEatNow, prng);
  return Array.from(out);
}

/** brainFeatures written into out at offset, so the hot path allocates one buffer per organism instead of one array per action. */
function fillBrainFeatures(
  out: Float64Array,
  offset: number,
  action: LegalAction,
  organism: Readonly<Organism>,
  sensed: Readonly<SensedInputs>,
  config: Readonly<SimulationConfig>,
  canEatNow: boolean,
  prng: PRNG
): void {
  const type = action.type;
  // Leaps count as movement: they share the directional inputs.
  const isMove = isMoveAction(type) || isLeapAction(type);
  const isGive = type.startsWith('GIVE_');
  const isReproduce = type.startsWith('REPRODUCE_');
  const isSignal = type === 'SIGNAL';
  const isAttack = type.startsWith('ATTACK_');
  const isMate = type.startsWith('MATE_');
  const hunger = 1 - sensed.energyRatio;
  const hungry = sensed.energyRatio < 0.5;
  const need = action.recipientNeed ?? 0;
  const [dx, dy] = isMove ? unitDirectionOf(type) : [0, 0];

  let moveKin = 0;
  if (isMove && sensed.kinPull) {
    const { dx: px, dy: py } = sensed.kinPull;
    moveKin = (dx * px + dy * py) / Math.max(1, Math.sqrt(px * px + py * py));
  }
  const threshold = thresholdOf(organism, config);
  const headroom = Math.max(1, maxEnergyOf(organism, config) - threshold);

  // Order must match BRAIN_INPUTS (checked by a test).
  let o = offset;
  out[o++] = 1;
  out[o++] = isMove ? 1 : 0; // isMove
  out[o++] = type === 'EAT' ? 1 : 0; // isEat
  out[o++] = type === 'PICK_UP' ? 1 : 0; // isPickUp
  out[o++] = isReproduce ? 1 : 0; // isReproduce
  out[o++] = isGive ? 1 : 0; // isGive
  out[o++] = type === 'REST' ? 1 : 0; // isRest
  out[o++] = sensed.energyRatio; // energy
  out[o++] = sensed.carriedFood / Math.max(1, carryCapacityOf(organism, config)); // carried
  out[o++] = Math.min(1, sensed.surroundingOrganismCount / 8); // crowding
  out[o++] = type === 'EAT' ? hunger : 0; // eatHunger
  out[o++] = type === 'PICK_UP' ? 1 - sensed.carriedFood / Math.max(1, carryCapacityOf(organism, config)) : 0; // pickUpRoom
  out[o++] = isReproduce ? Math.max(0, organism.energy - threshold) / headroom : 0; // reproFullness
  out[o++] = isGive && !action.recipientIsChild ? need : 0; // giveNeed
  out[o++] = isGive && !action.recipientIsChild ? need * (action.recipientSimilarity ?? 0) : 0; // giveNeedAlike
  out[o++] = isGive && action.recipientIsChild ? need : 0; // giveNeedChild
  out[o++] = isMove ? aligned(dx, dy, sensed.nearestFood, 0.25) : 0; // moveFood
  out[o++] = isMove && hungry ? aligned(dx, dy, sensed.nearestFood, 0) : 0; // moveFoodHungry
  out[o++] = isMove ? aligned(dx, dy, sensed.nearestObstacle, 0.5) : 0; // moveObstacle
  out[o++] = isMove ? aligned(dx, dy, sensed.nearestOrganism, 0.3) : 0; // moveCrowd
  out[o++] = moveKin; // moveKin
  out[o++] = isMove ? aligned(dx, dy, sensed.parentWithFood, 0) : 0; // moveParentFood
  out[o++] = isMove && (action.swapRelation === 'child' || action.swapRelation === 'parent') ? 1 : 0; // moveFamilySwap
  out[o++] = isMove ? prng.nextFloat(-1, 1) : 0; // moveNoise
  out[o++] = canEatNow && type !== 'EAT' && !action.recipientIsChild ? 1 : 0; // pushedByEating
  out[o++] = isSignal ? 1 : 0; // isSignal
  out[o++] = isSignal && sensed.currentCellFood > 0 ? 1 : 0; // signalOnFood
  out[o++] = isSignal ? hunger : 0; // signalHunger
  out[o++] = isMove ? aligned(dx, dy, sensed.nearestSignal, 0.15) : 0; // moveSignal
  out[o++] = isMove ? aligned(dx, dy, sensed.nearestSignal, 0.15) * (sensed.nearestSignal?.value ?? 0) : 0; // moveSignalAlike
  out[o++] = action.targetOccupied ? 1 : 0; // moveOccupied
  out[o++] = isLeapAction(type) ? 1 : 0; // isLeap
  out[o++] = isDiagonalMove(type) ? 1 : 0; // isDiagonal
  out[o++] = isMove && sensed.rememberedFood ? aligned(dx, dy, sensed.rememberedFood, 0.1) * sensed.rememberedFood.freshness : 0; // moveRememberedFood
  out[o++] = isMove && sensed.rememberedSignal ? aligned(dx, dy, sensed.rememberedSignal, 0.1) * sensed.rememberedSignal.freshness : 0; // moveRememberedSignal
  out[o++] = isMove ? aligned(dx, dy, sensed.home, 0.1) : 0; // moveHome
  out[o++] = sensed.registers[0] ?? 0; // register0
  out[o++] = sensed.registers[1] ?? 0; // register1
  out[o++] = sensed.registers[2] ?? 0; // register2
  out[o++] = type === 'EAT_CARRION' ? 1 : 0; // isEatCarrion
  out[o++] = type === 'EAT_CARRION' ? hunger * (carrionYield(organism, config) / config.foodEnergyYield) : 0; // eatCarrionHunger
  out[o++] = isMove ? aligned(dx, dy, sensed.nearestCarrion, 0.25) * (config.predationDefenseEnabled !== false ? 1 : organism.carnivory) : 0; // moveCarrion
  out[o++] = isAttack ? 1 : 0; // isAttack
  out[o++] = isAttack ? (action.preyKillChance ?? 0) : 0; // attackKillChance
  out[o++] = isAttack ? (action.preySimilarity ?? 0) : 0; // attackAlike
  out[o++] = isAttack && action.preyIsFamily ? 1 : 0; // attackFamily
  out[o++] = isAttack ? hunger * organism.carnivory : 0; // attackHunger
  out[o++] = isMate ? 1 : 0; // isMate
  out[o++] = isMate ? Math.max(0, organism.energy - threshold) / headroom : 0; // mateFullness
  out[o++] = isMate ? (action.mateSimilarity ?? 0) : 0; // mateAlike
  out[o++] = isMate && action.mateIsFamily ? 1 : 0; // mateFamily
  out[o++] = isMate && action.mateReady ? 1 : 0; // mateReady
  out[o++] = sensed.weatherTemp ?? 0; // weatherTemp
  out[o++] = sensed.weatherRain ?? 0; // weatherRain
  out[o++] =
    isMove && sensed.weatherWind
      ? (dx * sensed.weatherWind.wx + dy * sensed.weatherWind.wy) / Math.max(1, Math.hypot(dx, dy))
      : 0; // moveWindAlignment
  out[o++] = organism.lastBiteYield ?? 1; // lastBiteYield
  out[o++] = maturityOf(organism, config); // maturity (1 for a grown body, and with growth off)
  // Land sensing: what the cell a move enters is like, and what is underfoot (all 0 when their field is off).
  let moveSlope = 0;
  let moveWater = 0;
  let moveRough = 0;
  let cover = 0;
  const land = sensed.land;
  if (land) {
    const target = isMove ? action.target : undefined;
    const elevation = land.elevation;
    if (elevation && target) {
      const from = organism.y * elevation.width + organism.x;
      const to = target.y * elevation.width + target.x;
      moveSlope = Math.max(-1, Math.min(1, (elevation.elev01(to) - elevation.elev01(from)) * 10));
      moveWater = Math.min(1, elevation.depth01(to) / Math.max(1e-9, config.elevationDeepThreshold));
    }
    if (land.terrain) {
      if (target) moveRough = land.terrain.roughnessAt(target.x, target.y);
      cover = land.terrain.coverAt(organism.x, organism.y);
    }
  }
  out[o++] = moveSlope; // moveSlope (climbing positive)
  out[o++] = moveWater; // moveWater (0 land .. 1 deep)
  out[o++] = moveRough; // moveRough
  out[o++] = cover; // cover
}

/** Score for one feature vector, with the per-input direct contributions. */
export function brainScore(brain: Brain, x: readonly number[]): { score: number; direct: number[]; hidden: number } {
  const direct = new Array<number>(BRAIN_INPUT_COUNT);
  let directSum = 0;
  for (let i = 0; i < BRAIN_INPUT_COUNT; i++) {
    direct[i] = x[i] * brain.skip[i];
  }
  // Summed left to right, like the reduce it replaces, so scores are unchanged.
  for (let i = 0; i < BRAIN_INPUT_COUNT; i++) directSum += direct[i];
  let hidden = brain.outBias;
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    let sum = brain.hiddenBias[h];
    const row = h * BRAIN_INPUT_COUNT;
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) sum += brain.hidden[row + i] * x[i];
    hidden += brain.out[h] * Math.tanh(sum);
  }
  const score = directSum + hidden;
  return { score, direct, hidden };
}

let denseHidden = 0;

/** brainScore over one feature row of a buffer, allocating nothing; the hidden total is left in denseHidden. Sums in brainScore's order. */
function scoreDense(brain: Brain, x: Float64Array, off: number): number {
  let directSum = 0;
  for (let i = 0; i < BRAIN_INPUT_COUNT; i++) directSum += x[off + i] * brain.skip[i];
  let hidden = brain.outBias;
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    let sum = brain.hiddenBias[h];
    const row = h * BRAIN_INPUT_COUNT;
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) sum += brain.hidden[row + i] * x[off + i];
    hidden += brain.out[h] * Math.tanh(sum);
  }
  denseHidden = hidden;
  return directSum + hidden;
}

// ---------------------------------------------------------------------------
// DNA Stage 3: the growable brain (`dnaGrowableBrain`; docs/specs/dna.md)
// ---------------------------------------------------------------------------

/** Whether brains are compiled from the genome as growable circuits (Stage 3; needs DNA). */
export const growableBrain = (config: Readonly<SimulationConfig>): boolean => config.dnaEnabled && config.dnaGrowableBrain;

/**
 * A sparse brain compiled from a genome (compileCircuit in dna.ts): skip
 * connections plus one hidden layer of any number of units, with zero
 * weights pruned. Scores exactly as the dense brain of the same weights
 * (scoreCircuit vs brainScore, up to the sign of a zero). Derived from the
 * genome, never saved.
 */
export interface Circuit {
  /** Input indices with a nonzero skip weight, ascending. */
  readonly skipIdx: Int32Array;
  readonly skipW: Float64Array;
  /** The output bias, plus the constant units folded in while no live unit precedes them. */
  readonly bias0: number;
  /** Length U + 1, CSR offsets into srcIdx/srcW; start === end marks a constant unit. */
  readonly unitStart: Int32Array;
  readonly unitBias: Float64Array;
  /** Output weight; for a constant unit, the precomputed out × tanh(bias). */
  readonly unitOut: Float64Array;
  /** The (mapped) hidden unit index each entry came from. */
  readonly unitId: Int32Array;
  /** Input index per in-edge, ascending within each unit. */
  readonly srcIdx: Int32Array;
  readonly srcW: Float64Array;
  /** Skip connections + in-edges + one out edge per evaluated or folded unit. */
  readonly connections: number;
  /** The same count restricted to units with unitId >= BRAIN_HIDDEN. */
  readonly acquiredConnections: number;
  /** Evaluated or folded units with unitId >= BRAIN_HIDDEN. */
  readonly acquiredUnits: number;
  /**
   * Acquired units (unitId >= BRAIN_HIDDEN) that are not choice-invariant: a
   * unit is choice-invariant when it is constant (no live in-edge) or every
   * live in-edge comes from ACTION_INVARIANT_INPUTS, since it then adds the
   * same offset to every action's score.
   */
  readonly effectiveAcquiredUnits: number;
  /** In-edges plus the out edge of the effective acquired units. */
  readonly effectiveAcquiredConnections: number;
}

/** Scratch for scoreCircuit: the direct contributions of the last call, by skip entry (no allocation per call). */
const DIRECT = new Float64Array(BRAIN_INPUT_COUNT);
let lastHidden = 0;

/**
 * A circuit's score for one feature vector. Allocates nothing; the direct
 * contributions are left in DIRECT (by skip entry) and the hidden total in
 * lastHidden, for evaluateBrain. Sums in the dense brain's order, so the
 * score equals brainScore's for the same weights.
 */
export function scoreCircuit(c: Readonly<Circuit>, x: ArrayLike<number>, off = 0): number {
  const skipIdx = c.skipIdx;
  const skipW = c.skipW;
  let d = 0;
  for (let k = 0; k < skipIdx.length; k++) {
    const v = x[off + skipIdx[k]] * skipW[k];
    DIRECT[k] = v;
    d += v;
  }
  const unitStart = c.unitStart;
  const srcIdx = c.srcIdx;
  const srcW = c.srcW;
  const units = unitStart.length - 1;
  let hid = c.bias0;
  for (let u = 0; u < units; u++) {
    const s = unitStart[u];
    const e = unitStart[u + 1];
    if (s === e) {
      hid += c.unitOut[u];
      continue;
    }
    let sum = c.unitBias[u];
    for (let j = s; j < e; j++) sum += srcW[j] * x[off + srcIdx[j]];
    hid += c.unitOut[u] * Math.tanh(sum);
  }
  lastHidden = hid;
  return d + hid;
}

/** The direct contribution of skip entry k and the hidden total from the latest scoreCircuit call. */
export function lastCircuitDirect(k: number): number {
  return DIRECT[k];
}
export function lastCircuitHidden(): number {
  return lastHidden;
}

/**
 * Copies and restores the scoreCircuit scratch (DIRECT, lastHidden). Only
 * read-only observers (the brain trace) use these: they score a circuit
 * between a tick's own scoreCircuit call and its reads of the scratch, so
 * they put the scratch back as they found it.
 */
export function saveCircuitScratch(): { readonly direct: Float64Array; readonly hidden: number } {
  return { direct: DIRECT.slice(), hidden: lastHidden };
}
export function restoreCircuitScratch(saved: { readonly direct: Float64Array; readonly hidden: number }): void {
  DIRECT.set(saved.direct);
  lastHidden = saved.hidden;
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
  // Stage 3: a growable circuit when the organism has one (born with the switch on); the dense brain otherwise.
  const circuit = growableBrain(config) ? organism.circuit : undefined;
  const brain = organism.brain;
  // One buffer holds every action's features; the inspector's `components` are derived from it only when read.
  const buf = new Float64Array(legalActions.length * BRAIN_INPUT_COUNT);
  const scores: ActionScore[] = new Array<ActionScore>(legalActions.length);
  for (let n = 0; n < legalActions.length; n++) {
    const action = legalActions[n];
    const off = n * BRAIN_INPUT_COUNT;
    fillBrainFeatures(buf, off, action, organism, sensed, config, canEatNow, prng);
    let score: number;
    let hidden: number;
    if (circuit) {
      score = scoreCircuit(circuit, buf, off);
      hidden = lastHidden;
    } else {
      score = scoreDense(brain, buf, off);
      hidden = denseHidden;
    }
    // Unrounded components (rounding is costly in this hot path); the inspector rounds for display.
    scores[n] = {
      action,
      totalScore: Number(score.toFixed(3)),
      get components(): Record<string, number> {
        const components: Record<string, number> = {};
        if (circuit) {
          const { skipIdx, skipW } = circuit;
          for (let k = 0; k < skipIdx.length; k++) {
            const v = buf[off + skipIdx[k]] * skipW[k];
            if (Math.abs(v) >= 0.001) components[BRAIN_INPUTS[skipIdx[k]]] = v;
          }
        } else {
          for (let i = 0; i < BRAIN_INPUT_COUNT; i++) {
            const v = buf[off + i] * brain.skip[i];
            if (Math.abs(v) >= 0.001) components[BRAIN_INPUTS[i]] = v;
          }
        }
        components['hiddenLayer'] = hidden;
        return components;
      },
    };
  }

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
