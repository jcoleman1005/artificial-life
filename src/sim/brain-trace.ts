/**
 * Live brain viewer data (docs/specs/brain-viewer.md): how a selected organism
 * would decide right now. A read-only OBSERVER, like WorldEventDetector.
 *
 * It re-runs the decision on the current world state, from the organism's own
 * senses, with three guarantees:
 *   - nothing is written to the world: it reads a snapshot copy, and the live
 *     organism only through Readonly parameters;
 *   - the world's PRNG is never touched: moveNoise and tie-breaks use a PRNG
 *     of its own, seeded from (tick, organism id), so the same tick shows the
 *     same trace;
 *   - the module scratch in brain.ts (scoreCircuit's DIRECT / lastHidden) is
 *     saved before and restored after.
 * The trace is therefore what the policy would score for the current state;
 * the real next tick can differ only through the world PRNG's draws (move
 * noise, exact ties). `lastAction` is what the organism actually did.
 */
import {
  BRAIN_INPUTS,
  BRAIN_HIDDEN,
  BRAIN_INPUT_COUNT,
  brainFeatures,
  brainScore,
  growableBrain,
  restoreCircuitScratch,
  saveCircuitScratch,
  scoreCircuit,
} from './brain';
import { getLegalActions, evaluatePolicy } from './policy';
import { senseEnvironment } from './sensors';
import { PRNG } from './prng';
import type { Circuit } from './brain';
import type { Organism } from './types';
import type { World } from './world';

/** One legal action as scored this tick. */
export interface TraceAction {
  readonly type: string;
  readonly target?: { readonly x: number; readonly y: number };
  readonly score: number;
  /** Brain: the hidden layer's total contribution to the score. */
  readonly hidden: number;
  /** Brain: input × skip weight for every input (BRAIN_INPUTS order). Dials: empty. */
  readonly direct: readonly number[];
  /** Dials: named components of the score. Brain: empty. */
  readonly components: Readonly<Record<string, number>>;
}

export interface TraceHiddenUnit {
  /** The unit's id (>= BRAIN_HIDDEN means acquired through Stage 3 gene insertion; dense brains have 0..5). */
  readonly id: number;
  readonly acquired: boolean;
  readonly bias: number;
  readonly out: number;
  /** tanh activation for the chosen action's inputs. */
  readonly activation: number;
  /** Nonzero input weights as [input index, weight]. */
  readonly weights: readonly (readonly [number, number])[];
}

export interface TraceInput {
  readonly index: number;
  readonly name: string;
  /** Change in the chosen action's score if this input were zero (direct and hidden paths together). */
  readonly contribution: number;
}

export interface BrainTrace {
  readonly organismId: string;
  readonly tick: number;
  readonly controller: 'brain' | 'dials';
  /** True when the circuit was compiled from the genome (dnaGrowableBrain). */
  readonly growable: boolean;
  readonly inputNames: readonly string[];
  readonly actions: readonly TraceAction[];
  /** Index into `actions` (-1 if no action was legal). */
  readonly chosenIndex: number;
  readonly runnerUpIndex: number;
  /** Brain: the chosen action's input vector (BRAIN_INPUTS order). */
  readonly inputs: readonly number[];
  readonly hiddenUnits: readonly TraceHiddenUnit[];
  /** Nonzero direct connections as [input index, weight]. */
  readonly skip: readonly (readonly [number, number])[];
  readonly outBias: number;
  /** Top inputs by |contribution| to the chosen action (default 8). */
  readonly topInputs: readonly TraceInput[];
  /** Dials: the organism's dial values. */
  readonly dials: Readonly<Record<string, number>>;
  /** The organism's previous real decision, if any. */
  readonly lastAction: { readonly tick: number; readonly type: string; readonly outcome: string } | null;
}

export const DEFAULT_TOP_INPUTS = 8;

/** The PRNG a trace uses: never the world's. */
export function tracePrng(tick: number, organismId: string): PRNG {
  return new PRNG(PRNG.hashString(`trace:${tick}:${organismId}`));
}

/** The n inputs with the largest |contribution| (ties by lower index), skipping zeros. Pure. */
export function topContributions(contributions: readonly number[], names: readonly string[], n = DEFAULT_TOP_INPUTS): TraceInput[] {
  return contributions
    .map((contribution, index) => ({ index, name: names[index] ?? String(index), contribution }))
    .filter((c) => Math.abs(c.contribution) > 1e-9)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution) || a.index - b.index)
    .slice(0, n);
}

/**
 * How `organismId` would decide on the world's current state, or null if it is
 * not alive. Pass `prng` only in tests (to reproduce a real decision exactly).
 */
export function traceBrain(world: World, organismId: string, options: { topN?: number; prng?: PRNG } = {}): BrainTrace | null {
  const organism = world.getOrganism(organismId);
  if (!organism) return null;
  const { config } = world;
  const prng = options.prng ?? tracePrng(world.tick, organismId);
  const snapshot = world.getSnapshot();
  const sensed = senseEnvironment(organism, snapshot, config);
  const legal = getLegalActions(organism, snapshot, config, sensed);
  const last = organism.recentHistory[0];
  const lastAction = last ? { tick: last.tick, type: last.chosenAction.type, outcome: last.outcome } : null;
  const base = { organismId, tick: world.tick, inputNames: [...BRAIN_INPUTS] as string[], lastAction };

  if (config.controller !== 'brain') {
    const { chosenAction, scores } = evaluatePolicy(organism, legal, sensed, config, prng);
    const actions: TraceAction[] = scores.map((s) => ({
      type: s.action.type,
      ...(s.action.target ? { target: { x: s.action.target.x, y: s.action.target.y } } : {}),
      score: s.totalScore,
      hidden: 0,
      direct: [],
      components: { ...s.components },
    }));
    const chosenIndex = scores.findIndex((s) => s.action === chosenAction);
    return {
      ...base,
      controller: 'dials',
      growable: false,
      inputNames: [],
      actions,
      chosenIndex,
      runnerUpIndex: runnerUp(actions, chosenIndex),
      inputs: [],
      hiddenUnits: [],
      skip: [],
      outBias: 0,
      topInputs: [],
      dials: { ...organism.policy },
    };
  }

  const circuit: Circuit | undefined = growableBrain(config) ? organism.circuit : undefined;
  const scratch = saveCircuitScratch();
  try {
    const canEatNow = legal.some((a) => a.type === 'EAT');
    const xs: number[][] = [];
    const actions: TraceAction[] = legal.map((action) => {
      const x = brainFeatures(action, organism, sensed, config, canEatNow, prng);
      xs.push(x);
      const direct = new Array<number>(BRAIN_INPUT_COUNT).fill(0);
      let score: number;
      let hidden: number;
      if (circuit) {
        score = scoreCircuit(circuit, x);
        for (let k = 0; k < circuit.skipIdx.length; k++) direct[circuit.skipIdx[k]] = x[circuit.skipIdx[k]] * circuit.skipW[k];
        hidden = score - direct.reduce((a, v) => a + v, 0);
      } else {
        const r = brainScore(organism.brain, x);
        score = r.score;
        hidden = r.hidden;
        for (let i = 0; i < BRAIN_INPUT_COUNT; i++) direct[i] = r.direct[i];
      }
      return {
        type: action.type,
        ...(action.target ? { target: { x: action.target.x, y: action.target.y } } : {}),
        score: Number(score.toFixed(3)),
        hidden,
        direct,
        components: {},
      };
    });

    // The same choice rule as evaluateBrain (same tolerance, same tie-break draw).
    let chosenIndex = -1;
    if (actions.length > 0) {
      let best = -Infinity;
      let candidates: number[] = [];
      actions.forEach((a, i) => {
        if (a.score > best + 1e-6) {
          best = a.score;
          candidates = [i];
        } else if (Math.abs(a.score - best) <= 1e-6) {
          candidates.push(i);
        }
      });
      chosenIndex = candidates.length === 1 ? candidates[0] : prng.choice(candidates);
    }

    const scoreOf = (x: readonly number[]): number => (circuit ? scoreCircuit(circuit, x) : brainScore(organism.brain, x).score);
    const inputs = chosenIndex >= 0 ? xs[chosenIndex] : new Array<number>(BRAIN_INPUT_COUNT).fill(0);
    const contributions: number[] = [];
    if (chosenIndex >= 0) {
      const full = scoreOf(inputs);
      for (let i = 0; i < BRAIN_INPUT_COUNT; i++) {
        if (inputs[i] === 0) {
          contributions.push(0);
          continue;
        }
        const zeroed = inputs.slice();
        zeroed[i] = 0;
        contributions.push(full - scoreOf(zeroed));
      }
    }

    return {
      ...base,
      controller: 'brain',
      growable: circuit !== undefined,
      actions,
      chosenIndex,
      runnerUpIndex: runnerUp(actions, chosenIndex),
      inputs: [...inputs],
      hiddenUnits: chosenIndex >= 0 ? hiddenUnitsOf(organism, circuit, inputs) : [],
      skip: skipOf(organism, circuit),
      outBias: circuit ? circuit.bias0 : organism.brain.outBias,
      topInputs: topContributions(contributions, BRAIN_INPUTS, options.topN ?? DEFAULT_TOP_INPUTS),
      dials: {},
    };
  } finally {
    restoreCircuitScratch(scratch);
  }
}

function runnerUp(actions: readonly TraceAction[], chosenIndex: number): number {
  let best = -1;
  actions.forEach((a, i) => {
    if (i !== chosenIndex && (best < 0 || a.score > actions[best].score)) best = i;
  });
  return best;
}

function skipOf(organism: Readonly<Organism>, circuit: Circuit | undefined): [number, number][] {
  const out: [number, number][] = [];
  if (circuit) {
    for (let k = 0; k < circuit.skipIdx.length; k++) out.push([circuit.skipIdx[k], circuit.skipW[k]]);
  } else {
    organism.brain.skip.forEach((w, i) => {
      if (w !== 0) out.push([i, w]);
    });
  }
  return out;
}

function hiddenUnitsOf(organism: Readonly<Organism>, circuit: Circuit | undefined, x: readonly number[]): TraceHiddenUnit[] {
  const units: TraceHiddenUnit[] = [];
  if (circuit) {
    // Constant units (no live in-edge) are folded into the output bias and not listed.
    for (let u = 0; u < circuit.unitStart.length - 1; u++) {
      const s = circuit.unitStart[u];
      const e = circuit.unitStart[u + 1];
      if (s === e) continue;
      let sum = circuit.unitBias[u];
      const weights: [number, number][] = [];
      for (let j = s; j < e; j++) {
        sum += circuit.srcW[j] * x[circuit.srcIdx[j]];
        weights.push([circuit.srcIdx[j], circuit.srcW[j]]);
      }
      const id = circuit.unitId[u];
      units.push({ id, acquired: id >= BRAIN_HIDDEN, bias: circuit.unitBias[u], out: circuit.unitOut[u], activation: Math.tanh(sum), weights });
    }
    return units;
  }
  const { brain } = organism;
  for (let h = 0; h < brain.hiddenBias.length; h++) {
    let sum = brain.hiddenBias[h];
    const weights: [number, number][] = [];
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) {
      const w = brain.hidden[h * BRAIN_INPUT_COUNT + i];
      sum += w * x[i];
      if (w !== 0) weights.push([i, w]);
    }
    units.push({ id: h, acquired: false, bias: brain.hiddenBias[h], out: brain.out[h], activation: Math.tanh(sum), weights });
  }
  return units;
}
