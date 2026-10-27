/**
 * DNA Stage 3: the growable brain (`dnaGrowableBrain`). Mechanism and
 * invariant tests only: decode arithmetic, pruning, bounds, neutrality of the
 * switch for founder genomes, serialization, crossover grouping, insertion
 * range, upkeep and the ablation helper. Nothing here asserts that any
 * evolved behaviour or topology appears.
 */
import { describe, expect, it } from 'vitest';
import { World, type WorldState } from '../src/sim/world';
import { createConfig } from '../src/sim/config';
import { hashString } from '../src/sim/state-hash';
import { PRNG } from '../src/sim/prng';
import { metabolismCost } from '../src/sim/traits';
import { getLegalActions } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
import {
  ACTION_INVARIANT_INPUTS,
  ACTION_INVARIANT_MASK,
  BRAIN_HIDDEN,
  BRAIN_INPUTS,
  BRAIN_INPUT_COUNT,
  brainFeatures,
  brainScore,
  evaluateBrain,
  growableBrain,
  lastCircuitDirect,
  lastCircuitHidden,
  scoreCircuit,
  type Circuit,
} from '../src/sim/brain';
import {
  GENE_WORDS,
  GeneClass,
  compileCircuit,
  crossGenomes,
  decodeOrganismDNA,
  geneClassOf,
  geneCount,
  geneDose,
  geneIndexOf,
  geneKey,
  internalUnits,
  isExpressed,
  mutateOnce,
  stripAcquiredTopology,
} from '../src/sim/dna';
import type { Organism } from '../src/sim/types';

const SMALL = { gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22, maxFoodPatches: 36 };
const I = BRAIN_INPUT_COUNT;
const on = createConfig({ dnaGrowableBrain: true }); // M = 16
const off = createConfig({ dnaGrowableBrain: false });

/** A genome of the given (key, dose) genes. */
function genomeOf(genes: readonly (readonly [number, number])[]): Uint32Array {
  const view = new DataView(new ArrayBuffer(8));
  const dna = new Uint32Array(genes.length * GENE_WORDS);
  genes.forEach(([key, dose], g) => {
    view.setFloat64(0, dose, true);
    dna.set([key, view.getUint32(0, true), view.getUint32(4, true)], g * GENE_WORDS);
  });
  return dna;
}
const genesOf = (dna: ArrayLike<number>): [number, number][] =>
  Array.from({ length: geneCount(dna) }, (_, g) => [dna[g * GENE_WORDS], geneDose(dna, g * GENE_WORDS)]);

const skipK = (i: number) => geneKey(GeneClass.brainSkip, i);
const hidK = (u: number, i: number) => geneKey(GeneClass.brainHidden, (u << 8) | i);
const biasK = (u: number) => geneKey(GeneClass.brainHiddenBias, u);
const outK = (u: number) => geneKey(GeneClass.brainOut, u);
const outBiasK = (i = 0) => geneKey(GeneClass.brainOutBias, i);

/** Equal up to the sign of a zero. */
const same = (a: number, b: number) => Object.is(a + 0, b + 0);

/** The specified unit mapping: founders as is, higher unit fields wrap onto units 6..M-1 only, or -1 (silent) with M = 6. */
const refUnit = (u: number, M: number) => (u < 6 ? u : M > 6 ? 6 + ((u - 6) % (M - 6)) : -1);

/**
 * Reference: an independent dense evaluator over M units. Slots fill exactly
 * as specified (first gene as is, later genes added; non-finite doses 0;
 * unit fields mapped by refUnit; skip index >= 52, hidden input >= 52 and
 * output-bias index != 0 silent), then every unit and input is evaluated in
 * order, zeros included.
 */
function referenceScore(dna: ArrayLike<number>, M: number, x: ArrayLike<number>): number {
  const skip = new Array<number>(I).fill(0);
  const W = new Array<number>(M * I).fill(0);
  const bias = new Array<number>(M).fill(0);
  const out = new Array<number>(M).fill(0);
  const ob = [0];
  const seen = new Set<string>();
  const put = (arr: number[], name: string, i: number, d: number) => {
    const k = `${name}${i}`;
    arr[i] = seen.has(k) ? arr[i] + d : d;
    seen.add(k);
  };
  for (const [key, raw] of genesOf(dna)) {
    const d = Number.isFinite(raw) ? raw : 0;
    const idx = geneIndexOf(key);
    switch (geneClassOf(key)) {
      case GeneClass.brainSkip: if (idx < I) put(skip, 's', idx, d); break;
      case GeneClass.brainHidden: {
        const u = refUnit(idx >>> 8, M);
        if (u >= 0 && (idx & 0xff) < I) put(W, 'w', u * I + (idx & 0xff), d);
        break;
      }
      case GeneClass.brainHiddenBias: if (refUnit(idx, M) >= 0) put(bias, 'b', refUnit(idx, M), d); break;
      case GeneClass.brainOut: if (refUnit(idx, M) >= 0) put(out, 'o', refUnit(idx, M), d); break;
      case GeneClass.brainOutBias: if (idx === 0) put(ob, 'ob', 0, d); break;
      default: break;
    }
  }
  let direct = 0;
  for (let i = 0; i < I; i++) direct += x[i] * skip[i];
  let hidden = ob[0];
  for (let h = 0; h < M; h++) {
    let sum = bias[h];
    for (let i = 0; i < I; i++) sum += W[h * I + i] * x[i];
    hidden += out[h] * Math.tanh(sum);
  }
  return direct + hidden;
}

const randomX = (prng: PRNG): number[] => Array.from({ length: I }, () => (prng.next() < 0.2 ? 0 : prng.nextFloat(-2, 2)));

/** A random sparse genome: mostly canonical keys over M units, some wrapped keys, some zero doses and repeats. */
function randomGenome(prng: PRNG, M: number, genes: number): Uint32Array {
  const out: [number, number][] = [];
  for (let g = 0; g < genes; g++) {
    const dose = prng.next() < 0.15 ? 0 : prng.nextGaussian(0, 1.5);
    const wrapped = prng.next() < 0.1;
    const c = prng.nextInt(1, 5);
    let key: number;
    switch (c) {
      case 1: key = skipK(wrapped ? prng.nextInt(0, 0xffff) : prng.nextInt(0, I - 1)); break;
      case 2: key = wrapped ? geneKey(GeneClass.brainHidden, prng.nextInt(0, 0xffff)) : hidK(prng.nextInt(0, M - 1), prng.nextInt(0, I - 1)); break;
      case 3: key = biasK(wrapped ? prng.nextInt(0, 0xffff) : prng.nextInt(0, M - 1)); break;
      case 4: key = outK(wrapped ? prng.nextInt(0, 0xffff) : prng.nextInt(0, M - 1)); break;
      default: key = outBiasK(wrapped ? prng.nextInt(0, 0xffff) : 0); break;
    }
    out.push([key, dose]);
  }
  if (prng.next() < 0.5) out.push([geneKey(GeneClass.trait, 1), 3]); // a non-brain gene is ignored
  return genomeOf(out);
}

/** Structural invariants every compiled circuit must satisfy. */
function checkShape(c: Circuit, M: number): void {
  const U = c.unitStart.length - 1;
  expect(U).toBeGreaterThanOrEqual(0);
  expect(c.unitStart[0]).toBe(0);
  expect(c.unitStart[U]).toBe(c.srcIdx.length);
  expect(c.srcW.length).toBe(c.srcIdx.length);
  expect(c.skipW.length).toBe(c.skipIdx.length);
  expect(c.unitBias.length).toBe(U);
  expect(c.unitOut.length).toBe(U);
  expect(c.unitId.length).toBe(U);
  for (let u = 0; u < U; u++) {
    expect(c.unitStart[u + 1]).toBeGreaterThanOrEqual(c.unitStart[u]);
    expect(c.unitId[u]).toBeGreaterThanOrEqual(0);
    expect(c.unitId[u]).toBeLessThan(M);
    if (u > 0) expect(c.unitId[u]).toBeGreaterThan(c.unitId[u - 1]);
    for (let j = c.unitStart[u] + 1; j < c.unitStart[u + 1]; j++) expect(c.srcIdx[j]).toBeGreaterThan(c.srcIdx[j - 1]);
  }
  for (const i of c.srcIdx) expect(i >= 0 && i < I).toBe(true);
  for (let k = 0; k < c.skipIdx.length; k++) {
    expect(c.skipIdx[k] >= 0 && c.skipIdx[k] < I).toBe(true);
    if (k > 0) expect(c.skipIdx[k]).toBeGreaterThan(c.skipIdx[k - 1]);
    expect(c.skipW[k]).not.toBe(0);
  }
}

/** Typed arrays and numbers equal bit for bit. */
function expectCircuitEqual(a: Circuit | undefined, b: Circuit | undefined): void {
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  const fields = ['skipIdx', 'skipW', 'unitStart', 'unitBias', 'unitOut', 'unitId', 'srcIdx', 'srcW'] as const;
  for (const f of fields) {
    const x = a![f];
    const y = b![f];
    expect(y.constructor).toBe(x.constructor);
    expect(y.length).toBe(x.length);
    for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) expect(`${f}[${i}] ${y[i]}`).toBe(`${f}[${i}] ${x[i]}`);
  }
  for (const f of ['bias0', 'connections', 'acquiredConnections', 'acquiredUnits', 'effectiveAcquiredUnits', 'effectiveAcquiredConnections'] as const) expect(Object.is(a![f], b![f])).toBe(true);
}

/** Hash of a world's state without trend history, with dnaGrowableBrain normalised (the snapshot holds the config). */
const neutralHash = (w: World) => {
  const { history: _h, config: _c, ...s } = w.exportState();
  return hashString(JSON.stringify({ ...s, config: { ...w.config, dnaGrowableBrain: false } }));
};

describe('DNA Stage 3: decode correctness', () => {
  it('a hand-built sparse genome scores exactly the hand-computed value (units >= 6 included)', () => {
    const t = Math.tanh;
    const dna = genomeOf([
      [skipK(0), 0.5],
      [skipK(2), -0.25],
      [outBiasK(), 0.1],
      [hidK(2, 3), 0.5],
      [hidK(2, 7), -1.2],
      [biasK(2), -0.1],
      [outK(2), 0.7],
      [hidK(7, 0), 0.2],
      [hidK(7, 1), 0.3],
      [outK(7), 0.8],
      [biasK(11), 0.4],
      [hidK(11, 9), 1.5],
      [outK(11), -0.6],
    ]);
    const c = compileCircuit(dna, on);
    const prng = new PRNG('hand');
    for (let n = 0; n < 200; n++) {
      const x = randomX(prng);
      let d = 0;
      d += x[0] * 0.5;
      d += x[2] * -0.25;
      let hid = 0.1;
      hid += 0.7 * t(-0.1 + 0.5 * x[3] + -1.2 * x[7]);
      hid += 0.8 * t(0 + 0.2 * x[0] + 0.3 * x[1]);
      hid += -0.6 * t(0.4 + 1.5 * x[9]);
      const expected = d + hid;
      const got = scoreCircuit(c, x);
      expect(got).toBe(expected);
      expect(lastCircuitHidden()).toBe(hid);
      expect(lastCircuitDirect(0)).toBe(x[0] * 0.5);
      expect(lastCircuitDirect(1)).toBe(x[2] * -0.25);
    }
    expect(Array.from(c.unitId)).toEqual([2, 7, 11]);
  });

  it('repeated keys sum into their slot; wrapped skip, hidden-input and output-bias keys are silent (M = 16)', () => {
    const dna = genomeOf([
      [skipK(3), 0.5],
      [skipK(3), 0.25], // repeat: sums
      [skipK(3 + I), 9], // skip index >= 52: silent (not input 3)
      [hidK(22, 8), 0.75], // unit 22 -> 6 + (16 % 10) = 12, input 8
      [geneKey(GeneClass.brainHidden, (22 << 8) | (I + 8)), 9], // hidden input >= 52: silent
      [outK(22), 0.5], // unit 12
      [outBiasK(), 0.125],
      [outBiasK(5), 9], // output-bias index != 0: silent
    ]);
    const c = compileCircuit(dna, on);
    expect(Array.from(c.skipIdx)).toEqual([3]);
    expect(c.skipW[0]).toBe(0.75);
    expect(Array.from(c.unitId)).toEqual([12]);
    expect(Array.from(c.srcIdx)).toEqual([8]);
    expect(c.bias0).toBe(0.125);
    const x = new Array<number>(I).fill(0).map((_, i) => i / 10);
    expect(scoreCircuit(c, x)).toBe(0 + x[3] * 0.75 + (0.125 + 0.5 * Math.tanh(0 + 0.75 * x[8])));
  });

  it('a genome of only silent wrapped genes compiles to the empty circuit, and isExpressed says so', () => {
    const silent = [skipK(I), skipK(0xffff), geneKey(GeneClass.brainHidden, (2 << 8) | I), geneKey(GeneClass.brainHidden, (9 << 8) | 0xff), outBiasK(1), outBiasK(0xffff)];
    const c = compileCircuit(genomeOf(silent.map((k) => [k, 1.5])), on);
    expect(c.skipIdx.length).toBe(0);
    expect(c.unitId.length).toBe(0);
    expect(c.bias0).toBe(0);
    expect(c.connections).toBe(0);
    for (const k of silent) {
      expect(isExpressed(k, on)).toBe(false);
      expect(isExpressed(k, off)).toBe(false);
    }
    // Canonical keys are expressed either way; units >= 6 only with the switch on.
    for (const k of [skipK(0), skipK(I - 1), hidK(5, I - 1), biasK(5), outK(0), outBiasK()]) {
      expect(isExpressed(k, on)).toBe(true);
      expect(isExpressed(k, off)).toBe(true);
    }
    for (const k of [hidK(6, 0), hidK(255, I - 1), biasK(1027), outK(0xffff)]) {
      expect(isExpressed(k, on)).toBe(true);
      expect(isExpressed(k, off)).toBe(false);
    }
  });

  it('a unit field >= 6 lands on an acquired unit 6 + ((u - 6) mod (M - 6)), never a founder unit', () => {
    const unitOf = (key: number, cfg: ReturnType<typeof createConfig>) => {
      // The one unit a lone (input gene + out gene) pair builds.
      const u = geneClassOf(key) === GeneClass.brainHidden ? geneIndexOf(key) >>> 8 : geneIndexOf(key);
      const genes: [number, number][] = geneClassOf(key) === GeneClass.brainHidden ? [[key, 1], [outK(u), 1]] : [[hidK(u & 0xff, 0), 1], [key, 1]];
      const c = compileCircuit(genomeOf(genes), cfg);
      return Array.from(c.unitId);
    };
    expect(unitOf(hidK(22, 0), on)).toEqual([12]);
    expect(unitOf(outK(22), on)).toEqual([12]);
    // Bias/out genes use the whole 16-bit index: 1027 = 3 + 4 * 256 lands on 6 + (1021 % 10) = 7, not founder 3.
    const c1027 = compileCircuit(genomeOf([[hidK(7, 0), 1], [outK(1027), 1], [biasK(1027), 0.5]]), on);
    expect(Array.from(c1027.unitId)).toEqual([7]);
    expect(c1027.unitBias[0]).toBe(0.5);
    const founderOnly = compileCircuit(genomeOf([[hidK(3, 0), 1], [outK(1027), 1]]), on);
    expect(Array.from(founderOnly.unitId)).toEqual([]); // unit 3 has no out gene: 1027 did not land there
    // Every unit field maps into [6, M) for M = 7, 16, 40, 256.
    for (const M of [7, 16, 40, 256]) {
      const cfg = createConfig({ dnaGrowableBrain: true, dnaMaxInternal: M });
      for (let u = 6; u <= 0xffff; u += u < 600 ? 1 : 97) {
        const ids = Array.from(compileCircuit(genomeOf([[hidK(refUnit(u, M), 0), 1], [outK(u), 1]]), cfg).unitId);
        expect(ids).toEqual([6 + ((u - 6) % (M - 6))]);
      }
    }
  });

  it('M = 6: every unit field >= 6 is silent', () => {
    const cfg = createConfig({ dnaGrowableBrain: true, dnaMaxInternal: 6 });
    const genes: [number, number][] = [];
    for (let u = 6; u < 256; u++) genes.push([hidK(u, u % I), 1], [biasK(u), 1], [outK(u), 1]);
    genes.push([outK(1027), 1], [biasK(0xffff), 1]);
    const c = compileCircuit(genomeOf(genes), cfg);
    expect(c.unitId.length).toBe(0);
    expect(c.connections).toBe(0);
    expect(c.bias0).toBe(0);
    for (const [k] of genes) expect(isExpressed(k, cfg)).toBe(false);
  });

  it('random genomes score as the reference dense evaluator over M units, new mapping (1,000 inputs each)', () => {
    const prng = new PRNG('dense-ref');
    for (const M of [6, 16, 40]) {
      const cfg = createConfig({ dnaGrowableBrain: true, dnaMaxInternal: M });
      expect(internalUnits(cfg)).toBe(M);
      for (let g = 0; g < 8; g++) {
        const dna = randomGenome(prng, M, 30 + g * 40);
        const c = compileCircuit(dna, cfg);
        checkShape(c, M);
        for (let n = 0; n < 1000; n++) {
          const x = randomX(prng);
          const a = scoreCircuit(c, x);
          const b = referenceScore(dna, M, x);
          if (!same(a, b)) expect(a).toBe(b);
        }
      }
    }
  }, 30_000);
});

describe('DNA Stage 3: pruning', () => {
  // unit 0: constant, before any live unit (folded); unit 1: no out gene (dropped); unit 2: live, one zero in-edge pruned;
  // unit 3: out 0 (dropped); unit 4: constant after a live unit (kept as an entry); unit 7: live, acquired;
  // unit 9: constant, acquired; skip 1 has weight 0 (not listed).
  const dna = genomeOf([
    [skipK(0), 0.5],
    [skipK(1), 0],
    [skipK(2), -0.25],
    [outBiasK(), 0.1],
    [outK(0), 0.3],
    [biasK(0), 0.2],
    [hidK(1, 4), 0.9],
    [biasK(1), 0.4],
    [outK(2), 0.7],
    [biasK(2), -0.1],
    [hidK(2, 3), 0.5],
    [hidK(2, 5), 0],
    [hidK(2, 7), -1.2],
    [outK(3), 0],
    [hidK(3, 1), 0.6],
    [outK(4), 0.4],
    [biasK(4), 0.3],
    [outK(7), 0.8],
    [hidK(7, 0), 0.2],
    [hidK(7, 1), 0.3],
    [outK(9), 0.5],
    [biasK(9), 0.25],
  ]);

  it('drops dead units and zero weights, folds leading constants, keeps later constants as entries', () => {
    const c = compileCircuit(dna, on);
    checkShape(c, 16);
    expect(Array.from(c.skipIdx)).toEqual([0, 2]);
    expect(Array.from(c.skipW)).toEqual([0.5, -0.25]);
    expect(c.bias0).toBe(0.1 + 0.3 * Math.tanh(0.2));
    expect(Array.from(c.unitId)).toEqual([2, 4, 7, 9]);
    expect(Array.from(c.unitStart)).toEqual([0, 2, 2, 4, 4]);
    expect(Array.from(c.srcIdx)).toEqual([3, 7, 0, 1]);
    expect(Array.from(c.srcW)).toEqual([0.5, -1.2, 0.2, 0.3]);
    expect(c.unitOut[0]).toBe(0.7);
    expect(c.unitOut[1]).toBe(0.4 * Math.tanh(0.3));
    expect(c.unitOut[2]).toBe(0.8);
    expect(c.unitOut[3]).toBe(0.5 * Math.tanh(0.25));
    // 2 skips + unit0 (0+1) + unit2 (2+1) + unit4 (0+1) + unit7 (2+1) + unit9 (0+1)
    expect(c.connections).toBe(11);
    expect(c.acquiredConnections).toBe(4);
    expect(c.acquiredUnits).toBe(2);
  });

  it('pruning leaves scores unchanged (vs the dense reference, and vs the hand formula)', () => {
    const c = compileCircuit(dna, on);
    const t = Math.tanh;
    const prng = new PRNG('prune');
    for (let n = 0; n < 1000; n++) {
      const x = randomX(prng);
      const got = scoreCircuit(c, x);
      const ref = referenceScore(dna, 16, x);
      if (!same(got, ref)) expect(got).toBe(ref);
      let hid = 0.1 + 0.3 * t(0.2);
      hid += 0.7 * t(-0.1 + 0.5 * x[3] + -1.2 * x[7]);
      hid += 0.4 * t(0.3);
      hid += 0.8 * t(0 + 0.2 * x[0] + 0.3 * x[1]);
      hid += 0.5 * t(0.25);
      expect(got).toBe(0 + x[0] * 0.5 + x[2] * -0.25 + hid);
    }
  });
});

describe('DNA Stage 3: clamp and boundedness', () => {
  it('dnaMaxInternal is clamped to [6, 256]', () => {
    const units = (v: number) => internalUnits(createConfig({ dnaGrowableBrain: true, dnaMaxInternal: v }));
    expect(units(3)).toBe(BRAIN_HIDDEN);
    expect(units(-5)).toBe(BRAIN_HIDDEN);
    expect(units(6)).toBe(6);
    expect(units(16.9)).toBe(16);
    expect(units(1000)).toBe(256);
    expect(units(Number.NaN)).toBe(BRAIN_HIDDEN);
    expect(units(Number.POSITIVE_INFINITY)).toBe(BRAIN_HIDDEN);
  });

  it('every 16-bit index of every brain class, with NaN, ±Infinity and huge doses, compiles inside the bounds', () => {
    const doses = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e300, -1e300, 0.5, -0, 0];
    const genes: [number, number][] = [];
    for (const cls of [GeneClass.brainSkip, GeneClass.brainHidden, GeneClass.brainHiddenBias, GeneClass.brainOut, GeneClass.brainOutBias]) {
      for (let idx = 0; idx <= 0xffff; idx++) genes.push([geneKey(cls, idx), doses[(idx * 7 + cls) % doses.length]]);
    }
    const dna = genomeOf(genes);
    const prng = new PRNG('bounds');
    for (const maxInternal of [3, 16, 1000]) {
      const cfg = createConfig({ dnaGrowableBrain: true, dnaMaxInternal: maxInternal });
      const M = internalUnits(cfg);
      let c: Circuit | undefined;
      expect(() => (c = compileCircuit(dna, cfg))).not.toThrow();
      checkShape(c!, M);
      expect(c!.unitStart.length - 1).toBeLessThanOrEqual(M);
      expect(c!.srcIdx.length).toBeLessThanOrEqual(M * I);
      expect(c!.acquiredUnits).toBeLessThanOrEqual(M - BRAIN_HIDDEN);
      expect(Number.isFinite(c!.bias0)).toBe(true);
      for (let n = 0; n < 50; n++) {
        const x = Array.from({ length: I }, () => prng.nextFloat(-1, 1));
        expect(Number.isFinite(scoreCircuit(c!, x))).toBe(true);
      }
    }
  });

  it('decodeOrganismDNA on random wrapped genomes never throws and its circuit stays in bounds', () => {
    const prng = new PRNG('bounds-decode');
    for (let g = 0; g < 50; g++) {
      const p = decodeOrganismDNA(randomGenome(prng, 256, 200), on);
      checkShape(p.circuit!, 16);
    }
  });
});

describe('DNA Stage 3: absence and neutrality', () => {
  it('switch off (or DNA off): decode yields no circuit', () => {
    const dna = genomeOf([[outK(7), 1], [hidK(7, 0), 1], [skipK(0), 1]]);
    expect(decodeOrganismDNA(dna, off).circuit).toBeUndefined();
    expect(growableBrain(createConfig({ dnaEnabled: false, dnaGrowableBrain: true }))).toBe(false);
    expect(decodeOrganismDNA(dna, createConfig({ dnaEnabled: false, dnaGrowableBrain: true })).circuit).toBeUndefined();
    expect(decodeOrganismDNA(dna, on).circuit).toBeDefined();
  });

  it('switch off: insertions never address a hidden unit >= 6', () => {
    const cfg = createConfig({ dnaGrowableBrain: false, dnaVariationEnabled: true });
    const prng = new PRNG('insert-off');
    for (let n = 0; n < 5000; n++) {
      const [[key]] = genesOf(mutateOnce(new Uint32Array(0), 'insert', cfg, prng));
      const u = geneClassOf(key) === GeneClass.brainHidden ? geneIndexOf(key) >>> 8
        : geneClassOf(key) === GeneClass.brainHiddenBias || geneClassOf(key) === GeneClass.brainOut ? geneIndexOf(key) : -1;
      expect(u).toBeLessThan(BRAIN_HIDDEN);
    }
  });

  it('switch on with Stage 2 off: the world stays identical to the switch-off world (brain, sex on)', async () => {
    // Stage 2 off, so genomes stay canonical: the switch only changes how the same weights are scored.
    const base = { ...SMALL, seed: 'growable-neutral', controller: 'brain' as const, sexEnabled: true, dnaVariationEnabled: false };
    const a = new World({ ...base, dnaGrowableBrain: false });
    const b = new World({ ...base, dnaGrowableBrain: true });
    expect(Array.from(b.organisms.values()).every((o) => o.circuit && o.circuit.acquiredConnections === 0)).toBe(true);
    for (let t = 1; t <= 400; t++) {
      a.step();
      b.step();
      if (t % 50 === 0) {
        expect(neutralHash(b)).toBe(neutralHash(a));
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    expect(a.organisms.size).toBeGreaterThan(0);
    expect(Array.from(b.organisms.values()).every((o) => o.circuit !== undefined)).toBe(true);
  }, 180_000);
});

describe('DNA Stage 3: serialization', () => {
  it('saves no circuit, recompiles it bit-exactly on load, and the restored world continues identically', async () => {
    const cfg = {
      ...SMALL,
      seed: 'growable-save',
      controller: 'brain' as const,
      dnaGrowableBrain: true,
      dnaVariationEnabled: true,
      dnaInsertionRate: 0.02,
      dnaKeyFlipFraction: 0.5,
    };
    const world = new World(cfg);
    for (let t = 0; t < 150; t++) world.step();
    // Inject acquired topology into some organisms (consistent: the dense brain ignores these genes).
    const prng = new PRNG('inject');
    let injected = 0;
    for (const o of Array.from(world.organisms.values()).slice(0, 8)) {
      const extra = genomeOf([
        [hidK(prng.nextInt(6, 15), prng.nextInt(0, I - 1)), prng.nextGaussian(0, 1)],
        [outK(6 + (injected % 10)), prng.nextGaussian(0, 1)],
        [hidK(6 + (injected % 10), prng.nextInt(0, I - 1)), prng.nextGaussian(0, 1)],
        [geneKey(GeneClass.brainHidden, (40 << 8) | 70), 0.3], // wrapped
      ]);
      const genome = new Uint32Array([...o.genome!, ...extra]);
      world.organisms.set(o.id, { ...o, genome, circuit: compileCircuit(genome, world.config) } as Organism);
      injected++;
    }
    expect(Array.from(world.organisms.values()).some((o) => (o.circuit?.acquiredUnits ?? 0) > 0)).toBe(true);
    const json = JSON.stringify(world.exportState());
    expect(json).not.toContain('circuit');
    const restored = World.fromState(JSON.parse(json) as WorldState);
    expect(restored.organisms.size).toBe(world.organisms.size);
    for (const o of world.organisms.values()) expectCircuitEqual(o.circuit, restored.organisms.get(o.id)!.circuit);
    expect(restored.stateHash()).toBe(world.stateHash());
    for (let t = 1; t <= 120; t++) {
      world.step();
      restored.step();
      if (t % 40 === 0) {
        expect(restored.stateHash()).toBe(world.stateHash());
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }, 180_000);
});

describe('DNA Stage 3: crossover grouping', () => {
  const keys = [hidK(22, 3), outK(6), biasK(6), hidK(6, 1), skipK(4)];
  const a = genomeOf(keys.map((k) => [k, 1]));
  const b = genomeOf(keys.map((k) => [k, 2]));
  const parentOf = (child: Uint32Array, key: number) => genesOf(child).find(([k]) => k === key)![1];

  it('unitCount 16: genes group by the mapped unit (unit 22 -> 12, bias/out 1027 -> 7), never with a founder unit', () => {
    const ks = [hidK(22, 3), outK(12), biasK(12), hidK(12, 1), outK(1027), hidK(7, 2), biasK(7), outK(3), hidK(3, 0), outK(6), skipK(4)];
    const ga = genomeOf(ks.map((k) => [k, 1]));
    const gb = genomeOf(ks.map((k) => [k, 2]));
    const seen = new Set<number>();
    let split12vs6 = 0;
    let split7vs3 = 0;
    for (let s = 0; s < 200; s++) {
      const child = crossGenomes(ga, gb, new PRNG(s), 16);
      const p = parentOf(child, hidK(22, 3));
      expect(parentOf(child, outK(12))).toBe(p);
      expect(parentOf(child, biasK(12))).toBe(p);
      expect(parentOf(child, hidK(12, 1))).toBe(p);
      const q = parentOf(child, outK(1027));
      expect(parentOf(child, hidK(7, 2))).toBe(q);
      expect(parentOf(child, biasK(7))).toBe(q);
      if (parentOf(child, outK(6)) !== p) split12vs6++;
      if (parentOf(child, outK(3)) !== q) split7vs3++;
      seen.add(p);
    }
    expect(seen.size).toBe(2);
    expect(split12vs6).toBeGreaterThan(0);
    expect(split7vs3).toBeGreaterThan(0);
  });

  it('unitCount 16: a silent hidden gene (input >= 52) is its own group, not its unit\'s', () => {
    const silentK = geneKey(GeneClass.brainHidden, (2 << 8) | I);
    const ks = [silentK, outK(2), hidK(2, 0)];
    const ga = genomeOf(ks.map((k) => [k, 1]));
    const gb = genomeOf(ks.map((k) => [k, 2]));
    let split = 0;
    for (let s = 0; s < 200; s++) {
      const child = crossGenomes(ga, gb, new PRNG(s), 16);
      expect(parentOf(child, outK(2))).toBe(parentOf(child, hidK(2, 0)));
      if (parentOf(child, silentK) !== parentOf(child, outK(2))) split++;
    }
    expect(split).toBeGreaterThan(0);
  });

  it('unitCount 0 keeps the legacy grouping by raw unit number', () => {
    let split = 0;
    for (let s = 0; s < 200; s++) {
      const child = crossGenomes(a, b, new PRNG(s), 0);
      expect(parentOf(child, outK(6))).toBe(parentOf(child, biasK(6)));
      expect(parentOf(child, outK(6))).toBe(parentOf(child, hidK(6, 1)));
      if (parentOf(child, hidK(22, 3)) !== parentOf(child, outK(6))) split++;
    }
    expect(split).toBeGreaterThan(0);
    // The default argument is unitCount 0.
    expect(Array.from(crossGenomes(a, b, new PRNG(9)))).toEqual(Array.from(crossGenomes(a, b, new PRNG(9), 0)));
  });

  it('canonical genomes cross identically with unitCount 16 and 0 (same groups, same draws)', () => {
    const prng = new PRNG('cross-canon');
    for (let n = 0; n < 50; n++) {
      // Canonical: genes the dense decode reads (the ablation helper keeps them).
      const canon = (dna: Uint32Array) => stripAcquiredTopology(dna, on, 'all');
      const x = canon(randomGenome(prng, 6, 120));
      const y = canon(randomGenome(prng, 6, 120));
      expect(Array.from(crossGenomes(x, y, new PRNG(n), 16))).toEqual(Array.from(crossGenomes(x, y, new PRNG(n), 0)));
    }
  });
});

describe('DNA Stage 3: insertion range', () => {
  it('with the switch on, inserted hidden units cover [6, M) and never reach M', () => {
    const cfg = createConfig({ dnaGrowableBrain: true, dnaVariationEnabled: true, dnaMaxInternal: 16 });
    const prng = new PRNG('insert-on');
    const acquired = new Set<number>();
    for (let n = 0; n < 20000; n++) {
      const [[key]] = genesOf(mutateOnce(new Uint32Array(0), 'insert', cfg, prng));
      const cls = geneClassOf(key);
      const u = cls === GeneClass.brainHidden ? geneIndexOf(key) >>> 8
        : cls === GeneClass.brainHiddenBias || cls === GeneClass.brainOut ? geneIndexOf(key) : -1;
      expect(u).toBeLessThan(16);
      if (cls === GeneClass.brainHidden) expect(geneIndexOf(key) & 0xff).toBeLessThan(I);
      if (u >= BRAIN_HIDDEN) acquired.add(u);
    }
    expect([...acquired].sort((p, q) => p - q)).toEqual([6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});

describe('DNA Stage 3: upkeep', () => {
  // Stage 2 (dnaVariationEnabled) stays off here so the per-gene upkeep is out of the sum: only the connection term moves.
  const world = new World({ ...SMALL, seed: 'growable-upkeep', dnaGrowableBrain: true, dnaVariationEnabled: false });
  const founder = Array.from(world.organisms.values())[0];

  it('founders have no acquired connections', () => {
    for (const o of world.organisms.values()) {
      expect(o.circuit!.acquiredConnections).toBe(0);
      expect(o.circuit!.acquiredUnits).toBe(0);
    }
  });

  it('a unit-6 in-edge plus output gene costs exactly two connections of upkeep; switch off, nothing', () => {
    const cfg = world.config;
    const genome = new Uint32Array([...founder.genome!, ...genomeOf([[hidK(6, 0), 0.5], [outK(6), 0.7]])]);
    const grown = { ...founder, genome, circuit: compileCircuit(genome, cfg) } as Organism;
    expect(grown.circuit!.acquiredConnections).toBe(2);
    expect(grown.circuit!.acquiredUnits).toBe(1);
    expect(metabolismCost(founder, cfg) - metabolismCost({ ...founder, circuit: undefined }, cfg)).toBe(0);
    expect(metabolismCost(grown, cfg) - metabolismCost(founder, cfg)).toBeCloseTo(2 * cfg.dnaUpkeepPerConnection, 15);
    const big = { ...cfg, dnaUpkeepPerConnection: 0.25 };
    expect(metabolismCost(grown, big) - metabolismCost(founder, big)).toBe(0.5); // exact at a representable size
    const offCfg = { ...cfg, dnaGrowableBrain: false };
    expect(metabolismCost(grown, offCfg)).toBe(metabolismCost(founder, offCfg));
  });
});

describe('DNA Stage 3: ablation helper', () => {
  const world = new World({ ...SMALL, seed: 'growable-strip', dnaGrowableBrain: true });
  const founderGenome = Array.from(world.organisms.values())[0].genome!;

  it('is a no-op on a founder genome', () => {
    for (const level of ['all', 'units', 'effective'] as const) expect(Array.from(stripAcquiredTopology(founderGenome, on, level))).toEqual(Array.from(founderGenome));
  });

  it("'units' and 'all' each leave a circuit scoring exactly as the dense brain (no acquired unit); 'all' also drops the silent brain genes", () => {
    const prng = new PRNG('strip');
    for (const M of [6, 16, 40]) {
      const cfg = createConfig({ dnaGrowableBrain: true, dnaMaxInternal: M });
      for (let n = 0; n < 20; n++) {
        const extra = randomGenome(prng, 64, 40); // units up to 63 and wrapped keys
        const dna = new Uint32Array([...founderGenome, ...extra]);
        const brain = decodeOrganismDNA(dna, cfg).brain;
        const units = stripAcquiredTopology(dna, cfg, 'units');
        const all = stripAcquiredTopology(dna, cfg, 'all');
        for (const stripped of [units, all]) {
          const c = compileCircuit(stripped, cfg);
          expect(c.acquiredUnits).toBe(0);
          expect(c.acquiredConnections).toBe(0);
          expect(decodeOrganismDNA(stripped, cfg).brain).toEqual(brain);
          for (let k = 0; k < 50; k++) {
            const x = randomX(prng);
            const a = scoreCircuit(c, x);
            const b = brainScore(brain, x).score;
            if (!same(a, b)) expect(a).toBe(b);
          }
        }
        // 'units' keeps exactly the silent brain genes that 'all' drops.
        const isBrain = (k: number) => geneClassOf(k) >= GeneClass.brainSkip && geneClassOf(k) <= GeneClass.brainOutBias;
        for (const [k] of genesOf(units)) if (isBrain(k) && !isExpressed(k, cfg)) expect(genesOf(all).some(([j]) => j === k)).toBe(false);
        for (const [k] of genesOf(all)) if (isBrain(k)) expect(isExpressed(k, off)).toBe(true);
      }
    }
  });

  it("'effective' removes choice-variant acquired units only; choice-invariant acquired units stay, gene for gene", () => {
    const iEnergy = BRAIN_INPUTS.indexOf('energy');
    const iReg1 = BRAIN_INPUTS.indexOf('register1');
    const iEat = BRAIN_INPUTS.indexOf('isEat');
    const extra = genomeOf([
      [hidK(6, iEnergy), 0.5], [hidK(6, iReg1), -0.3], [biasK(6), 0.1], [outK(6), 0.7], // invariant (energy + register1)
      [hidK(7, iEat), 0.4], [hidK(7, iEnergy), 0.2], [biasK(7), 0.2], [outK(7), -0.6], // variant (isEat)
      [biasK(8), 0.3], [outK(8), 0.9], // constant: invariant
      [hidK(19, 0), 0.25], [outK(9), 0.5], // unit 19 -> 9; bias input only: invariant
      [hidK(11, iEat), 0], [outK(11), 0.5], // zero in-edge pruned: constant, invariant
      [hidK(22, iEat), 1.1], [outK(1032), 0.3], // 22 -> 12, 1032 -> 6 + (1026 % 10) = 12: variant
      [hidK(13, iEat), 1], // no out gene: not a unit
    ]);
    const dna = new Uint32Array([...founderGenome, ...extra]);
    const c = compileCircuit(dna, on);
    expect(Array.from(c.unitId).filter((u) => u >= BRAIN_HIDDEN)).toEqual([6, 7, 8, 9, 11, 12]);
    expect(c.acquiredUnits).toBe(6);
    expect(c.acquiredConnections).toBe(3 + 3 + 1 + 2 + 1 + 2);
    expect(c.effectiveAcquiredUnits).toBe(2);
    expect(c.effectiveAcquiredConnections).toBe(3 + 2);
    const stripped = stripAcquiredTopology(dna, on, 'effective');
    const removed = [hidK(7, iEat), hidK(7, iEnergy), biasK(7), outK(7), hidK(22, iEat), outK(1032)];
    const kept = genesOf(dna).filter(([k]) => !removed.includes(k));
    expect(genesOf(stripped)).toEqual(kept);
    const after = compileCircuit(stripped, on);
    expect(after.effectiveAcquiredUnits).toBe(0);
    expect(after.effectiveAcquiredConnections).toBe(0);
    expect(Array.from(after.unitId).filter((u) => u >= BRAIN_HIDDEN)).toEqual([6, 8, 9, 11]);
    expect(after.acquiredUnits).toBe(4);
    expect(after.acquiredConnections).toBe(3 + 1 + 2 + 1); // their upkeep stays
  });

  it("'effective' on random genomes: no effective unit left, invariant acquired units and the dense brain unchanged", () => {
    const prng = new PRNG('strip-effective');
    for (let n = 0; n < 40; n++) {
      const dna = new Uint32Array([...founderGenome, ...randomGenome(prng, 64, 60)]);
      const before = compileCircuit(dna, on);
      const after = compileCircuit(stripAcquiredTopology(dna, on, 'effective'), on);
      expect(after.effectiveAcquiredUnits).toBe(0);
      expect(after.acquiredUnits).toBe(before.acquiredUnits - before.effectiveAcquiredUnits);
      expect(after.acquiredConnections).toBe(before.acquiredConnections - before.effectiveAcquiredConnections);
      expect(decodeOrganismDNA(stripAcquiredTopology(dna, on, 'effective'), on).brain).toEqual(decodeOrganismDNA(dna, on).brain);
    }
  });
});

describe('DNA Stage 3: evaluateBrain with a circuit', () => {
  it('a founder picks the same action with the same component keys and values as on the dense path', () => {
    const world = new World({ ...SMALL, seed: 'growable-eval', controller: 'brain', dnaGrowableBrain: true });
    let checked = 0;
    for (let t = 0; t < 40; t++) {
      const snapshot = world.getSnapshot();
      for (const org of world.organisms.values()) {
        if (!org.circuit || org.circuit.acquiredConnections !== 0) continue;
        const sensed = senseEnvironment(org, snapshot, world.config);
        const legal = getLegalActions(org, snapshot, world.config, sensed);
        const viaCircuit = evaluateBrain(org, legal, sensed, world.config, new PRNG(`e${t}${org.id}`));
        const dense = evaluateBrain({ ...org, circuit: undefined } as Organism, legal, sensed, world.config, new PRNG(`e${t}${org.id}`));
        expect(viaCircuit.chosenAction).toEqual(dense.chosenAction);
        expect(viaCircuit.scores.length).toBe(dense.scores.length);
        viaCircuit.scores.forEach((s, i) => {
          const d = dense.scores[i];
          expect(s.totalScore).toBe(d.totalScore);
          expect(Object.keys(s.components)).toEqual(Object.keys(d.components));
          for (const k of Object.keys(s.components)) if (!same(s.components[k], d.components[k])) expect(s.components[k]).toBe(d.components[k]);
        });
        checked++;
      }
      world.step();
    }
    expect(checked).toBeGreaterThan(100);
  }, 60_000);
});

describe('DNA Stage 3: choice-invariant inputs', () => {
  it('ACTION_INVARIANT_INPUTS is the expected list and the mask marks exactly those inputs', () => {
    expect([...ACTION_INVARIANT_INPUTS]).toEqual([
      'bias',
      'energy',
      'carried',
      'crowding',
      'register0',
      'register1',
      'register2',
      'weatherTemp',
      'weatherRain',
    ]);
    expect(ACTION_INVARIANT_MASK.length).toBe(I);
    BRAIN_INPUTS.forEach((name, i) => expect(ACTION_INVARIANT_MASK[i]).toBe(ACTION_INVARIANT_INPUTS.includes(name) ? 1 : 0));
  });

  it('in a running brain world, brainFeatures over all legal actions agree at the invariant inputs (and others vary)', () => {
    // Defaults (memory, sex, predation, carrion as configured) so registers and the action-specific inputs are live.
    const world = new World({ ...SMALL, seed: 'invariant-inputs', controller: 'brain', initialOrganisms: 40 });
    const invariant = BRAIN_INPUTS.map((_, i) => i).filter((i) => ACTION_INVARIANT_MASK[i] === 1);
    const varied = new Set<number>();
    let decisions = 0;
    let registerNonZero = 0;
    for (let t = 0; t < 300 && world.organisms.size > 0; t++) {
      if (t % 3 === 0) {
        const snapshot = world.getSnapshot();
        for (const org of world.organisms.values()) {
          const sensed = senseEnvironment(org, snapshot, world.config);
          const legal = getLegalActions(org, snapshot, world.config, sensed);
          if (legal.length < 2) continue;
          const canEatNow = legal.some((a) => a.type === 'EAT');
          const prng = new PRNG(`f${t}${org.id}`);
          const rows = legal.map((a) => brainFeatures(a, org, sensed, world.config, canEatNow, prng));
          for (const row of rows) {
            for (const i of invariant) if (!Object.is(row[i], rows[0][i])) expect(`${BRAIN_INPUTS[i]} ${row[i]}`).toBe(`${BRAIN_INPUTS[i]} ${rows[0][i]}`);
            for (let i = 0; i < I; i++) if (row[i] !== rows[0][i]) varied.add(i);
          }
          if (rows[0][BRAIN_INPUTS.indexOf('register0')] !== 0) registerNonZero++;
          decisions++;
        }
      }
      world.step();
    }
    expect(decisions).toBeGreaterThan(500);
    for (const i of varied) expect(ACTION_INVARIANT_MASK[i]).toBe(0);
    expect(varied.size).toBeGreaterThanOrEqual(10);
    for (const name of ['isMove', 'isEat', 'moveFood', 'moveNoise', 'pushedByEating'] as const) expect(varied.has(BRAIN_INPUTS.indexOf(name))).toBe(true);
    expect(registerNonZero).toBeGreaterThan(0); // registers are live, so their invariance was actually exercised
  }, 120_000);
});
