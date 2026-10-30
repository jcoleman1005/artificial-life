import type { PRNG } from './prng';
import { mutateWeight } from './brain';
import { wrapDx } from './globe';
import type { SensedEntity, SensedInputs, SimulationConfig } from './types';

/**
 * Memory (`memoryEnabled`). Two kinds, both read only by the brain:
 *
 * - Named memories: where food was last seen, where the last signal came
 *   from, and home (the birthplace). Recalled as a direction plus a
 *   freshness that fades to 0 over the organism's inherited memory span.
 * - Free registers: MEMORY_REGISTERS numbers in [-1, 1] carried from tick to
 *   tick, updated by inherited weights from what the organism senses and from
 *   their own previous values (a tiny recurrent net). Fed to the brain as
 *   inputs; they can only shape choices through its hidden layer.
 *
 * Memory span is an inherited body trait that costs memoryUpkeep per tick of
 * span, so memory only spreads if it pays. Updates happen after all actions,
 * so decisions within a tick stay simultaneous.
 */

export const MEMORY_REGISTERS = 3;
/** Organism-level senses that feed the registers, in this order. */
export const REGISTER_INPUTS = ['energy', 'carried', 'crowding', 'foodHere', 'foodSeen', 'signalHeard'] as const;
const REGISTER_FAN_IN = REGISTER_INPUTS.length + MEMORY_REGISTERS + 1; // senses, registers, bias
export const MEMORY_WEIGHT_COUNT = MEMORY_REGISTERS * REGISTER_FAN_IN;

export interface RememberedPlace {
  readonly x: number;
  readonly y: number;
  /** The tick it was last seen or heard. */
  readonly tick: number;
}

export interface MemoryState {
  food: RememberedPlace | null;
  signal: RememberedPlace | null;
  readonly home: { readonly x: number; readonly y: number };
  registers: number[];
}

/** A recalled place: direction and distance from here, and how fresh (1 = this tick, 0 = forgotten). */
export type Recalled = SensedEntity & { readonly freshness: number };

export function newMemory(x: number, y: number): MemoryState {
  return { food: null, signal: null, home: { x, y }, registers: new Array<number>(MEMORY_REGISTERS).fill(0) };
}

/** Founders start with short memories: 0–10 ticks. */
export function founderMemorySpan(config: Readonly<SimulationConfig>, prng: PRNG): number {
  return Math.min(config.maxMemorySpan, prng.nextInt(0, 10));
}

/** A child's memory span: usually the parent's, occasionally memorySpanStep more or less (0 to maxMemorySpan). */
export function inheritMemorySpan(parentSpan: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (prng.next() >= config.traitMutationRate) return parentSpan;
  const step = prng.next() < 0.5 ? -config.memorySpanStep : config.memorySpanStep;
  return Math.max(0, Math.min(config.maxMemorySpan, parentSpan + step));
}

/** Founders' register weights: small and random, so registers start near 0. */
export function founderMemoryWeights(prng: PRNG): number[] {
  return Array.from({ length: MEMORY_WEIGHT_COUNT }, () => Number(prng.nextGaussian(0, 0.1).toFixed(4)));
}

/** A child's register weights: each mutates with the brain's rate and size. */
export function inheritMemoryWeights(parent: readonly number[], config: Readonly<SimulationConfig>, prng: PRNG): number[] {
  return parent.map((w) => mutateWeight(w, config, prng));
}

function recallPlace(place: RememberedPlace | { x: number; y: number } | null, x: number, y: number, freshness: number, wrapWidth: number): Recalled | null {
  if (!place || freshness <= 0) return null;
  const dx = wrapDx(place.x - x, wrapWidth, wrapWidth > 0);
  const dy = place.y - y;
  return { x: place.x, y: place.y, dx, dy, distance: Math.abs(dx) + Math.abs(dy), freshness: Number(freshness.toFixed(3)) };
}

/** What an organism recalls this tick (all null / zero when memory is off or its span is 0). */
export function recall(
  memory: Readonly<MemoryState>,
  span: number,
  x: number,
  y: number,
  tick: number,
  config: Readonly<SimulationConfig>,
  wrapWidth = 0
): { food: Recalled | null; signal: Recalled | null; home: Recalled | null; registers: readonly number[] } {
  if (!config.memoryEnabled || span <= 0) {
    return { food: null, signal: null, home: null, registers: new Array<number>(MEMORY_REGISTERS).fill(0) };
  }
  const fresh = (place: RememberedPlace | null) => (place ? Math.max(0, 1 - (tick - place.tick) / span) : 0);
  return {
    food: recallPlace(memory.food, x, y, fresh(memory.food), wrapWidth),
    signal: recallPlace(memory.signal, x, y, fresh(memory.signal), wrapWidth),
    home: x === memory.home.x && y === memory.home.y ? null : recallPlace(memory.home, x, y, 1, wrapWidth),
    registers: memory.registers,
  };
}

/** The organism-level senses that feed the registers, in REGISTER_INPUTS order. */
function registerInputs(sensed: Readonly<SensedInputs>, carryCapacity: number): number[] {
  return [
    sensed.energyRatio,
    sensed.carriedFood / Math.max(1, carryCapacity),
    Math.min(1, sensed.surroundingOrganismCount / 8),
    sensed.currentCellFood > 0 ? 1 : 0,
    sensed.nearestFood ? 1 : 0,
    sensed.nearestSignal ? 1 : 0,
  ];
}

/**
 * Updates memory after the tick's actions, from what the organism sensed at
 * the start of the tick (`tick` is that tick). Remembers the nearest food and
 * the latest signal it noticed, forgets food it finds gone, and steps the
 * registers.
 */
export function updateMemory(
  memory: MemoryState,
  weights: readonly number[],
  sensed: Readonly<SensedInputs>,
  carryCapacity: number,
  at: { x: number; y: number },
  tick: number
): void {
  if (sensed.nearestFood) {
    memory.food = { x: sensed.nearestFood.x, y: sensed.nearestFood.y, tick };
  } else if (memory.food && memory.food.x === at.x && memory.food.y === at.y && sensed.currentCellFood === 0) {
    memory.food = null; // came back and it was gone
  }
  if (sensed.nearestSignal) memory.signal = { x: sensed.nearestSignal.x, y: sensed.nearestSignal.y, tick };

  const inputs = registerInputs(sensed, carryCapacity);
  const previous = memory.registers;
  const next = new Array<number>(MEMORY_REGISTERS);
  for (let r = 0; r < MEMORY_REGISTERS; r++) {
    const row = r * REGISTER_FAN_IN;
    let sum = weights[row + REGISTER_FAN_IN - 1]; // bias
    for (let i = 0; i < inputs.length; i++) sum += weights[row + i] * inputs[i];
    for (let j = 0; j < MEMORY_REGISTERS; j++) sum += weights[row + inputs.length + j] * previous[j];
    next[r] = Math.tanh(sum);
  }
  memory.registers = next;
}
