/**
 * Live brain viewer (docs/specs/brain-viewer.md): the BrainTrace is a pure
 * observer. These tests check mechanisms and invariants only: the trace equals
 * a manual calculation, its choice equals the policy's, inspecting changes
 * neither stateHash() nor later ticks (including the brain.ts module scratch),
 * and the pure UI helpers. Nothing asserts any evolved behaviour.
 */
import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createConfig } from '../src/sim/config';
import {
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_INPUT_COUNT,
  createHeadStartBrain,
  lastCircuitDirect,
  lastCircuitHidden,
  scoreCircuit,
  type Brain,
} from '../src/sim/brain';
import { DEFAULT_TOP_INPUTS, topContributions, traceBrain } from '../src/sim/brain-trace';
import { SimulationHost, type HostEnvironment } from '../src/sim/host';
import type { FromWorker } from '../src/sim/protocol';
import { familyCounts, inputFamily, pickActionRows, shownInputs } from '../src/ui/brain-view';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

const ZERO_POLICY = Object.fromEntries(
  ['foodAttraction', 'obstacleAvoidance', 'crowdingAvoidance', 'exploreTendency', 'eatDrive', 'reproduceDrive', 'kinAffinity', 'shareWithKin', 'shareWithStrangers', 'careForChildren', 'forageDrive', 'eatPriority', 'hungerUrgency', 'followFoodParent', 'signalOnFood', 'signalWhenHungry', 'followSignal', 'restDrive', 'avoidOccupied', 'leapEagerness'].map((k) => [k, 0])
) as unknown as PolicyWeights;

function emptyWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 11, gridWidth: 10, gridHeight: 10, initialOrganisms: 0, initialFoodPatches: 0, obstacleDensity: 0,
    immigrationInterval: 0, seasonLength: 0, tickMetabolismCost: 0, carryUpkeep: 0, foodRegenInterval: 9999,
    foodSpawnInterval: 9999, controller: 'brain', ...overrides,
  });
}

function organism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id, x, y, energy: 50, policy: ZERO_POLICY, tag: 0, carryCapacity: 2, dispersal: 1, memorySpan: 0, carnivory: 0, kills: 0,
    memoryWeights: [], memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 }, brain: createHeadStartBrain(new PRNG(1)),
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 }, age: 100, offspringCount: 0,
    foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1, recentHistory: [], ...overrides,
  } as Organism;
}

/** A copy of the world's PRNG at its current state (for reproducing a real decision exactly). */
function cloneRng(world: World): PRNG {
  const c = new PRNG(1);
  c.setState(world.prng.getState());
  return c;
}

describe('BrainTrace: values', () => {
  it('equals a manual dot-product calculation for a hand-built brain', () => {
    const world = emptyWorld();
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
    const skip = new Array<number>(BRAIN_INPUT_COUNT).fill(0);
    skip[BRAIN_INPUTS.indexOf('isEat')] = 2;
    skip[BRAIN_INPUTS.indexOf('eatHunger')] = 4;
    skip[BRAIN_INPUTS.indexOf('energy')] = 0.5;
    const hidden = new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(0);
    hidden[BRAIN_INPUTS.indexOf('isEat')] = 1.5; // unit 0
    hidden[BRAIN_INPUT_COUNT + BRAIN_INPUTS.indexOf('energy')] = -2; // unit 1
    const brain: Brain = { skip, hidden, hiddenBias: [0.1, 0.2, 0, 0, 0, 0], out: [3, 1, 0, 0, 0, 0], outBias: 0.25 };
    const o = organism('o', 5, 5, { energy: 20, brain });
    world.organisms.set(o.id, o);
    const t = traceBrain(world, 'o')!;
    const eat = t.actions.findIndex((a) => a.type === 'EAT');
    expect(eat).toBeGreaterThanOrEqual(0);
    // Manual: x for EAT is isEat 1, eatHunger = hunger, energy = ratio.
    const er = 20 / world.config.maxEnergy;
    const hunger = 1 - er;
    const direct = 2 * 1 + 4 * hunger + 0.5 * er;
    const hid = 3 * Math.tanh(0.1 + 1.5) + 1 * Math.tanh(0.2 + -2 * er) + 0.25;
    expect(t.actions[eat].score).toBeCloseTo(direct + hid, 3);
    expect(t.actions[eat].hidden).toBeCloseTo(hid, 6);
    expect(t.actions[eat].direct[BRAIN_INPUTS.indexOf('eatHunger')]).toBeCloseTo(4 * hunger, 9);
    // Per-action direct contributions sum with the hidden total to the score.
    for (const a of t.actions) expect(a.direct.reduce((s, v) => s + v, 0) + a.hidden).toBeCloseTo(a.score, 3);
    // The chosen action's units match the manual activations.
    expect(t.chosenIndex).toBe(eat);
    expect(t.hiddenUnits[0].activation).toBeCloseTo(Math.tanh(1.6), 9);
    expect(t.hiddenUnits[1].activation).toBeCloseTo(Math.tanh(0.2 - 2 * er), 9);
    expect(t.inputs[BRAIN_INPUTS.indexOf('energy')]).toBeCloseTo(er, 9);
    // Contribution = score change if the input were zero (direct and hidden paths): isEat = 2 + 3 (tanh 1.6 - tanh 0.1).
    const isEatContribution = 2 + 3 * (Math.tanh(1.6) - Math.tanh(0.1));
    expect(t.topInputs[0].name).toBe('isEat');
    expect(t.topInputs[0].contribution).toBeCloseTo(isEatContribution, 6);
    expect(t.topInputs[1].name).toBe('eatHunger');
    expect(t.topInputs[1].contribution).toBeCloseTo(4 * hunger, 6);
    expect(t.topInputs.length).toBeLessThanOrEqual(DEFAULT_TOP_INPUTS);
  });

  it('its chosen action equals the action the policy really chose that tick', () => {
    for (const seed of [3, 4, 5, 6]) {
      const world = emptyWorld({ seed });
      world.foodPatches.set('7,5', { x: 7, y: 5, stock: 3, capacity: 3 });
      world.foodPatches.set('2,2', { x: 2, y: 2, stock: 3, capacity: 3 });
      const brain = createHeadStartBrain(new PRNG(seed));
      const o = organism('o', 5, 5, { energy: 40, brain: { ...brain, hidden: brain.hidden.map((w, i) => w * 5 + (i % 3)) } });
      world.organisms.set(o.id, o);
      for (let i = 0; i < 25 && world.organisms.size === 1; i++) {
        const t = traceBrain(world, 'o', { prng: cloneRng(world) })!;
        world.step();
        const real = world.organisms.get('o')?.recentHistory[0];
        if (!real) break;
        expect(t.actions[t.chosenIndex].type).toBe(real.chosenAction.type);
        expect(t.actions[t.chosenIndex].target).toEqual(real.chosenAction.target);
        expect(t.actions.map((a) => a.score)).toEqual(real.scores.map((s) => s.totalScore));
      }
    }
  });

  it('the dials controller gives a score per legal action and the dial values', () => {
    const world = emptyWorld({ controller: 'dials' });
    world.foodPatches.set('5,5', { x: 5, y: 5, stock: 3, capacity: 3 });
    world.organisms.set('o', organism('o', 5, 5, { energy: 20 }));
    const t = traceBrain(world, 'o')!;
    expect(t.controller).toBe('dials');
    expect(t.chosenIndex).toBeGreaterThanOrEqual(0);
    expect(Object.keys(t.dials)).toContain('eatPriority');
    expect(t.actions.every((a) => Object.keys(a.components).length > 0)).toBe(true);
    expect(traceBrain(world, 'nobody')).toBeNull();
  });
});

describe('BrainTrace: observer-only', () => {
  const SMALL = { gridWidth: 24, gridHeight: 24, initialOrganisms: 25, initialFoodPatches: 20, maxFoodPatches: 30 };

  function run(cfg: Partial<SimulationConfig>, inspect: boolean, ticks: number): string[] {
    const world = new World(createConfig({ seed: 77, ...SMALL, ...cfg }));
    const hashes: string[] = [];
    for (let i = 0; i < ticks; i++) {
      if (inspect) for (const id of [...world.organisms.keys()]) traceBrain(world, id);
      world.step();
      if (i % 10 === 0) hashes.push(world.stateHash());
    }
    hashes.push(world.stateHash());
    return hashes;
  }

  it('inspecting every organism every tick changes neither stateHash nor the next 200 ticks (dense brains)', () => {
    expect(run({}, true, 200)).toEqual(run({}, false, 200));
  });

  it('the same for growable circuits with Stage 2 variation (the module scratch path)', () => {
    const cfg = { dnaGrowableBrain: true, dnaVariationEnabled: true };
    expect(run(cfg, true, 200)).toEqual(run(cfg, false, 200));
  });

  it('draws nothing from the world PRNG and does not touch the world state', () => {
    const world = new World(createConfig({ seed: 5, ...SMALL }));
    for (let i = 0; i < 20; i++) world.step();
    const before = world.stateHash();
    const state = world.prng.getState();
    for (const id of world.organisms.keys()) traceBrain(world, id);
    expect(world.prng.getState()).toBe(state);
    expect(world.stateHash()).toBe(before);
    // Deterministic per tick: the same trace twice.
    const id = [...world.organisms.keys()][0];
    expect(JSON.stringify(traceBrain(world, id))).toBe(JSON.stringify(traceBrain(world, id)));
  });

  it('restores the scoreCircuit scratch (lastCircuitDirect / lastCircuitHidden)', () => {
    const world = new World(createConfig({ seed: 8, ...SMALL, dnaGrowableBrain: true, dnaVariationEnabled: true }));
    for (let i = 0; i < 30; i++) world.step();
    const withCircuit = [...world.organisms.values()].filter((o) => o.circuit);
    expect(withCircuit.length).toBeGreaterThan(1);
    const [a, b] = withCircuit;
    const x = Array.from({ length: BRAIN_INPUT_COUNT }, (_, i) => ((i * 7) % 5) / 5 - 0.3);
    scoreCircuit(a.circuit!, x);
    const n = a.circuit!.skipIdx.length;
    const direct = Array.from({ length: n }, (_, k) => lastCircuitDirect(k));
    const hidden = lastCircuitHidden();
    traceBrain(world, b.id);
    traceBrain(world, a.id);
    expect(Array.from({ length: n }, (_, k) => lastCircuitDirect(k))).toEqual(direct);
    expect(lastCircuitHidden()).toBe(hidden);
  });

  it('growable circuit: listed edges and units reproduce scoreCircuit', () => {
    const world = new World(createConfig({ seed: 9, ...SMALL, dnaGrowableBrain: true, dnaVariationEnabled: true }));
    for (let i = 0; i < 60; i++) world.step();
    let checked = 0;
    for (const o of world.organisms.values()) {
      const t = traceBrain(world, o.id)!;
      expect(t.growable).toBe(true);
      if (t.chosenIndex < 0) continue;
      const c = o.circuit!;
      expect(t.actions[t.chosenIndex].score).toBeCloseTo(scoreCircuit(c, t.inputs), 3);
      expect(t.skip.length).toBe(c.skipIdx.length);
      // Rebuild the score from the listed skip edges + unit activations + folded constants.
      let constants = c.bias0;
      for (let u = 0; u < c.unitStart.length - 1; u++) if (c.unitStart[u] === c.unitStart[u + 1]) constants += c.unitOut[u];
      const fromTrace =
        t.skip.reduce((s, [i, w]) => s + w * t.inputs[i], 0) + t.hiddenUnits.reduce((s, u) => s + u.out * u.activation, 0) + constants;
      expect(fromTrace).toBeCloseTo(t.actions[t.chosenIndex].score, 3);
      for (const u of t.hiddenUnits) expect(u.acquired).toBe(u.id >= BRAIN_HIDDEN);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('inspectBrain through the host (Worker and server share it)', () => {
  it('answers with a brainTrace for the viewer and leaves the world untouched', () => {
    const posted: FromWorker[] = [];
    const env: HostEnvironment = { post: (m) => posted.push(m), now: () => 0, schedule: () => 0, cancel: () => {} };
    const host = new SimulationHost(env, { seed: 'bt', gridWidth: 20, gridHeight: 20, initialOrganisms: 10, foodRegionCount: 0 });
    const id = [...host.world.organisms.keys()][0];
    const hash = host.world.stateHash();
    host.handle({ kind: 'inspectBrain', requestId: 7, organismId: id });
    host.handle({ kind: 'inspectBrain', requestId: 8, organismId: 'ghost' });
    const replies = posted.filter((m): m is Extract<FromWorker, { kind: 'brainTrace' }> => m.kind === 'brainTrace');
    expect(replies.map((r) => r.requestId)).toEqual([7, 8]);
    expect(replies[0].trace?.organismId).toBe(id);
    expect(replies[1].trace).toBeNull();
    expect(host.world.stateHash()).toBe(hash);
  });
});

describe('brain view helpers (pure)', () => {
  it('groups inputs into sense families and covers all current inputs', () => {
    expect(inputFamily('moveFood')).toBe('food');
    expect(inputFamily('eatHunger')).toBe('food');
    expect(inputFamily('moveSignalAlike')).toBe('signals');
    expect(inputFamily('moveRememberedFood')).toBe('memory');
    expect(inputFamily('register1')).toBe('memory');
    expect(inputFamily('moveKin')).toBe('kin');
    expect(inputFamily('mateReady')).toBe('kin');
    expect(inputFamily('attackKillChance')).toBe('hunting');
    expect(inputFamily('energy')).toBe('body');
    expect(inputFamily('moveObstacle')).toBe('movement');
    expect(inputFamily('lastBiteYield')).toBe('weather');
    const counts = familyCounts(BRAIN_INPUTS);
    expect(counts.reduce((s, c) => s + c.total, 0)).toBe(BRAIN_INPUT_COUNT);
  });

  it('top-N picks the largest |contribution|, ties by index, skipping zeros', () => {
    const names = ['a', 'b', 'c', 'd', 'e'];
    const top = topContributions([0, -3, 3, 0.5, 0], names, 3);
    expect(top.map((t) => t.name)).toEqual(['b', 'c', 'd']);
    expect(topContributions([0, 0], ['a', 'b'])).toEqual([]);
  });

  it('shownInputs = top contributors plus expanded families, grouped by family', () => {
    const names = ['isEat', 'moveFood', 'energy', 'moveSignal', 'moveKin'];
    const trace = { inputNames: names, topInputs: [{ index: 2, name: 'energy', contribution: 1 }] };
    expect(shownInputs(trace, new Set())).toEqual([2]);
    expect(shownInputs(trace, new Set(['food' as const]))).toEqual([0, 1, 2]);
    expect(shownInputs(trace, new Set(['signals' as const, 'kin' as const]))).toEqual([4, 3, 2]);
  });

  it('pickActionRows keeps the best actions and always the chosen one', () => {
    const actions = Array.from({ length: 12 }, () => ({ type: 'A', score: 0, hidden: 0, direct: [], components: {} })).map((a, i) => ({ ...a, score: i }));
    const rows = pickActionRows({ actions, chosenIndex: 0 }, 5).map((r) => r.index);
    expect(rows).toHaveLength(5);
    expect(rows).toContain(0);
    expect(rows).toContain(11);
  });
});
