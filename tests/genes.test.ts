import { describe, expect, it } from 'vitest';
import { PRNG } from '../src/sim/prng';
import { applyBudgets, founderGenes, inheritGenes, lockedGenes, type GeneTable } from '../src/sim/genes';
import { hashString } from '../src/sim/state-hash';
import { World } from '../src/sim/world';

type Key = 'a' | 'b' | 'c' | 'free';
const TABLE: GeneTable<Key> = {
  a: { min: 0, max: 1, founderMin: 0.2, founderMax: 0.8, budgetGroup: 'g' },
  b: { min: 0, max: 1, founderMin: 0.2, founderMax: 0.8, budgetGroup: 'g' },
  c: { min: 0.1, max: 1, founderMin: 0.2, founderMax: 0.8, budgetGroup: 'g', locked: 0.3 },
  free: { min: -1, max: 1, founderMin: -1, founderMax: 1 },
};
const BUDGET = { g: 1.2 };
const groupSum = (g: Record<Key, number>) => g.a + g.b + g.c;

describe('Gene registry', () => {
  it('keeps every gene in range and every budget group under its cap', () => {
    const prng = new PRNG('genes');
    let genes = founderGenes(TABLE, prng, { budgets: BUDGET });
    for (let i = 0; i < 2000; i++) {
      genes = inheritGenes(TABLE, genes, prng, { rate: 1, sd: 0.5, budgets: BUDGET });
      for (const [k, d] of Object.entries(TABLE)) {
        expect(genes[k as Key]).toBeGreaterThanOrEqual(d.min);
        expect(genes[k as Key]).toBeLessThanOrEqual(d.max);
      }
      expect(groupSum(genes)).toBeLessThanOrEqual(BUDGET.g + 1e-9);
    }
  });

  it('scales an over-budget group down in proportion and leaves other genes alone', () => {
    const genes = { a: 0.8, b: 0.4, c: 0.6, free: 0.9 };
    applyBudgets(TABLE, genes, BUDGET);
    expect(groupSum(genes)).toBeCloseTo(1.2, 3);
    expect(genes.a / genes.b).toBeCloseTo(2, 2); // proportions above each gene's minimum kept
    expect(genes.free).toBe(0.9);
    const under = { a: 0.1, b: 0.1, c: 0.2, free: 0 };
    applyBudgets(TABLE, under, BUDGET);
    expect(under).toEqual({ a: 0.1, b: 0.1, c: 0.2, free: 0 });
  });

  it('locked genes take their locked value, never change and draw no randomness', () => {
    const prng = new PRNG('locked');
    const state = prng.getState();
    const genes = founderGenes(TABLE, prng, { locked: true });
    expect(genes).toEqual({ a: 0.5, b: 0.5, c: 0.3, free: 0 });
    expect(lockedGenes(TABLE)).toEqual(genes);
    expect(inheritGenes(TABLE, genes, prng, { rate: 1, sd: 1, locked: true })).toEqual(genes);
    expect(prng.getState()).toBe(state);
  });

  it('inherits unchanged with mutation off', () => {
    const prng = new PRNG('copy');
    const parent = founderGenes(TABLE, prng);
    expect(inheritGenes(TABLE, parent, prng, { rate: 0, sd: 1 })).toEqual(parent);
  });
});

describe('stateHash', () => {
  const SMALL = { gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22 };

  it('is a stable 16-character hash', () => {
    expect(hashString('alife')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString('alife')).toBe(hashString('alife'));
    expect(hashString('alife')).not.toBe(hashString('alifE'));
  });

  // Two 30×30 worlds for 800 ticks: up to a minute or two when the population grows large, so it
  // yields to the event loop now and then (vitest's worker RPC) and has a longer timeout.
  it('matches for the same seed, differs for another, and survives a snapshot round trip', async () => {
    const breathe = () => new Promise((resolve) => setImmediate(resolve));
    const a = new World({ ...SMALL, seed: 'hash' });
    const b = new World({ ...SMALL, seed: 'hash' });
    const other = new World({ ...SMALL, seed: 'hash-2' });
    expect(a.stateHash()).not.toBe(other.stateHash());
    for (let t = 1; t <= 600; t++) {
      a.step();
      b.step();
      if (t % 200 === 0) expect(a.stateHash()).toBe(b.stateHash());
      if (t % 50 === 0) await breathe();
    }
    const restored = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    expect(restored.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 200; t++) {
      a.step();
      restored.step();
      if (t % 50 === 0) await breathe();
    }
    expect(restored.stateHash()).toBe(a.stateHash());
    b.step();
    expect(b.stateHash()).not.toBe(a.stateHash());
  }, 180_000);
});
