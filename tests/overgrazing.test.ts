import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { CellHealth } from '../src/sim/grazing';
import { PRNG } from '../src/sim/prng';
import { createConfig } from '../src/sim/config';

const small = { overgrazingEnabled: true, gridWidth: 30, gridHeight: 30, initialOrganisms: 15, initialFoodPatches: 20, seed: 7 } as const;
const state = (w: World) => JSON.stringify({ o: [...w.organisms.values()].map((o) => [o.id, o.x, o.y, o.energy]), f: [...w.foodPatches.values()] });

describe('Overgrazing', () => {
  it('bites lower health, and cells recover only after the rest period', () => {
    const config = createConfig({ overgrazingDamagePerBite: 0.25, overgrazingRecoveryRate: 0.1, overgrazingRestTicks: 5 });
    const cells = new CellHealth(4);
    const prng = new PRNG(1);
    cells.bite(0, 10, config);
    cells.bite(0, 10, config);
    expect(cells.health[0]).toBeCloseTo(0.5);
    for (let t = 11; t < 15; t++) cells.step(t, config, prng, []);
    expect(cells.health[0]).toBeCloseTo(0.5); // still resting
    cells.step(15, config, prng, []);
    expect(cells.health[0]).toBeCloseTo(0.6);
    for (let t = 16; t < 60; t++) cells.step(t, config, prng, []);
    expect(cells.health[0]).toBe(1);
    cells.bite(1, 60, createConfig({ overgrazingDamagePerBite: 5 }));
    expect(cells.health[1]).toBe(0); // bounded below
  });

  it('with damage 0 changes nothing against the switch off', () => {
    const run = (extra: object) => {
      const w = new World({ ...small, ...extra });
      for (let i = 0; i < 120; i++) w.step();
      return state(w);
    };
    expect(run({ overgrazingEnabled: true, overgrazingDamagePerBite: 0 })).toBe(run({ overgrazingEnabled: false }));
    expect(new World({ ...small, overgrazingEnabled: false }).exportState().cellHealth).toBeUndefined();
  });

  it('matched random spends exactly the damage the bites would have done, away from the bites', () => {
    const config = createConfig({ overgrazingMatchedRandom: true, overgrazingDamagePerBite: 0.01, overgrazingRecoveryRate: 0 });
    const cells = new CellHealth(100);
    const fertile = [10, 11, 12, 13];
    for (let i = 0; i < 20; i++) cells.bite(0, 1, config); // bites land on cell 0 ...
    cells.step(1, config, new PRNG(3), fertile);
    expect(cells.health[0]).toBe(1); // ... but do no damage there
    const lost = fertile.reduce((a, i) => a + (1 - cells.health[i]), 0);
    expect(lost).toBeCloseTo(0.2, 5);
  });

  it('keeps health in [0, 1] and stays deterministic, saved or not', () => {
    const make = () => new World({ ...small, overgrazingDamagePerBite: 0.1, overgrazingMatchedRandom: false });
    const a = make();
    const b = make();
    for (let i = 0; i < 100; i++) { a.step(); b.step(); }
    expect(state(a)).toBe(state(b));
    const restored = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    for (let i = 0; i < 60; i++) { a.step(); restored.step(); }
    expect(state(restored)).toBe(state(a));
    expect(restored.cellHealth!.exportState()).toEqual(a.cellHealth!.exportState());
    for (const h of a.cellHealth!.health) expect(h >= 0 && h <= 1).toBe(true);
    expect(Math.min(...a.cellHealth!.health)).toBeLessThan(1); // something was grazed
  });

  it('loads an older save (no cell health) with every cell healthy', () => {
    const w = new World({ ...small });
    for (let i = 0; i < 20; i++) w.step();
    const { cellHealth, ...old } = w.exportState();
    void cellHealth;
    const loaded = World.fromState(JSON.parse(JSON.stringify(old)));
    expect(Math.min(...loaded.cellHealth!.health)).toBe(1);
  });
});
