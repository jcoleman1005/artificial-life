import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';

// The ledger balances the energy the animals hold (organisms, fat, eggs, carrion):
// change in stored energy = in − out. It is an observer, so these tests check that the
// books balance in worlds that use every path energy takes, that a leak is caught, and
// that switching it off changes nothing.

const TOLERANCE = (r: { totalIn: number; totalOut: number; stored: number }) => 1e-6 * (1 + r.totalIn + r.totalOut + r.stored);

describe('Energy ledger', () => {
  it('balances every tick in a world that lays eggs, mates, hunts, scavenges and takes in immigrants', () => {
    // eggFounder and immigration are raised so the egg and immigrant paths are exercised.
    const w = new World({ seed: 5, ledgerCheckInterval: 1, eggFounder: 0.6, immigrationEnabled: true });
    for (let t = 0; t < 700; t++) {
      w.step();
      const r = w.ledgerReport()!;
      expect(Math.abs(r.residual)).toBeLessThanOrEqual(TOLERANCE(r));
    }
    const r = w.ledgerReport()!;
    expect(r.checks).toBe(700);
    expect(r.violations).toBe(0);
    // The paths were really used, so a zero residual means something.
    expect(w.eggsLaidTotal).toBeGreaterThan(0);
    expect(w.eggsHatchedTotal).toBeGreaterThan(0);
    expect(w.matingsTotal).toBeGreaterThan(0);
    expect(w.carrionEatenTotal).toBeGreaterThan(0);
    expect(w.killsTotal).toBeGreaterThan(0);
    expect(w.deathsTotal).toBeGreaterThan(0);
  }, 120_000);

  it('balances for the dials controller, with carrion off, and with sex off', () => {
    for (const overrides of [{ controller: 'dials' as const }, { carrionEnabled: false }, { sexEnabled: false }]) {
      const w = new World({ seed: 7, ledgerCheckInterval: 1, ...overrides });
      for (let t = 0; t < 400; t++) w.step();
      expect(w.ledgerReport()!.violations).toBe(0);
    }
  }, 120_000);

  it('balances over longer windows too (the check only sums stored energy every interval)', () => {
    const w = new World({ seed: 3, ledgerCheckInterval: 25 });
    for (let t = 0; t < 500; t++) w.step();
    const r = w.ledgerReport()!;
    expect(r.checks).toBe(20);
    expect(r.windTicks).toBe(25);
    expect(r.violations).toBe(0);
  }, 120_000);

  it('catches energy created from nothing', () => {
    const w = new World({ seed: 5, ledgerCheckInterval: 1 });
    for (let t = 0; t < 50; t++) w.step();
    expect(w.ledgerReport()!.violations).toBe(0);
    [...w.organisms.values()][0].energy += 50; // a leak
    w.step();
    const r = w.ledgerReport()!;
    expect(r.residual).toBeCloseTo(50, 6);
    expect(r.violations).toBe(1);
  });

  it('is an observer: switched off, the world is identical', () => {
    const run = (ledgerEnabled: boolean) => {
      const w = new World({ seed: 11, ledgerEnabled });
      for (let t = 0; t < 300; t++) w.step();
      const { config: _config, ...state } = w.exportState();
      return JSON.stringify(state);
    };
    expect(run(false)).toBe(run(true));
  }, 120_000);

  it('starts fresh from a saved world and still balances', () => {
    const a = new World({ seed: 2, ledgerCheckInterval: 1 });
    for (let t = 0; t < 120; t++) a.step();
    const b = World.fromState(a.exportState());
    expect(b.ledgerReport()).toBeNull();
    for (let t = 0; t < 120; t++) b.step();
    expect(b.ledgerReport()!.checks).toBe(120);
    expect(b.ledgerReport()!.violations).toBe(0);
  }, 120_000);
});
