import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { ElevationField, generateElevation } from '../src/sim/elevation';
import { createConfig } from '../src/sim/config';

// Dynamic water (docs/specs/dynamic-water.md): tides lift the sea over low coast, floods put the wet fringe of rivers
// under water. Mechanisms and invariants only.

const world = (o = {}) => new World({ seed: 3, ...o });
const standing = (e: ElevationField) => e.dynDepth.reduce((n, d) => n + (d > 0 ? 1 : 0), 0);

describe('Tide map', () => {
  it('is made with the field: ocean is 0, unreachable ground is the maximum, and reach rises with height', () => {
    const c = createConfig({ seed: 3 });
    const e = generateElevation(c);
    expect(e.tideRise).toHaveLength(e.width * e.height);
    let ocean = 0;
    let reachable = 0;
    for (let i = 0; i < e.tideRise.length; i++) {
      if (e.water[i] > 0 && e.elevation[i] <= e.seaLevel * 65535) {
        expect(e.tideRise[i]).toBe(0);
        ocean++;
      }
      if (e.water[i] === 0 && e.tideRise[i] < 65535) {
        reachable++;
        // The sea must climb at least to the cell's own height above sea level.
        expect(e.tideRise[i] + 1).toBeGreaterThanOrEqual(e.elevation[i] - e.seaLevel * 65535);
      }
    }
    expect(ocean).toBeGreaterThan(0);
    expect(reachable).toBeGreaterThan(0);
  });

  it('leaves high ground dry however high the tide', () => {
    const c = createConfig({ seed: 3 });
    const e = generateElevation(c);
    const peak = c.tideAmplitude * 65535;
    for (let i = 0; i < e.tideRise.length; i++) if (e.elev01(i) > e.seaLevel + 2 * c.tideAmplitude && e.water[i] === 0) expect(e.tideRise[i]).toBeGreaterThan(peak);
  });
});

describe('Dynamic water in a world', () => {
  it('puts shallow water on dry coast at high tide and takes it away at low tide, never deep and never on permanent water', () => {
    const w = world({ weatherEnabled: false, tidePeriod: 100, waterInterval: 1 });
    const e = w.getElevation()!;
    const c = w.config;
    let high = 0;
    let low = Infinity;
    for (let t = 0; t < 100; t++) {
      w.step();
      const n = standing(e);
      high = Math.max(high, n);
      low = Math.min(low, n);
      for (let i = 0; i < e.dynDepth.length; i++) {
        if (e.dynDepth[i] === 0) continue;
        expect(e.water[i]).toBe(0); // only dry ground
        expect(e.dynDepth[i] / 255).toBeLessThanOrEqual(c.tideMaxDepth + 1 / 255);
        expect(e.isDeep(i, c)).toBe(false); // wadeable, never a wall
      }
    }
    expect(high).toBeGreaterThan(0);
    expect(low).toBe(0);
  }, 60_000);

  it('counts the water as water: wading cost, chill and isWater follow it', () => {
    const w = world({ weatherEnabled: false, tidePeriod: 100, waterInterval: 1 });
    const e = w.getElevation()!;
    for (let t = 0; t < 60; t++) w.step();
    const i = Array.from(e.dynDepth).findIndex((d) => d > 0);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(e.isWater(i)).toBe(true);
    expect(e.isPermanentWater(i)).toBe(false);
    expect(e.depth01(i)).toBeGreaterThan(0);
    expect(w.isWet(i % e.width, Math.floor(i / e.width))).toBe(true);
  });

  it('floods the wet fringe of rivers only after rain swells them, and drains again', () => {
    const w = world({ tideAmplitude: 0, waterInterval: 1 });
    const e = w.getElevation()!;
    const c = w.config;
    expect(standing(e)).toBe(0);
    // Force a high flood stage as heavy rain would, then step: water appears on riparian ground only.
    (w as unknown as { floodStage: number }).floodStage = 1;
    (w as unknown as { weather: null }).weather = null; // hold the stage: no rain to follow
    w.step();
    const n = standing(e);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < e.dynDepth.length; i++) if (e.dynDepth[i] > 0) {
      expect(e.riparian[i]).toBeGreaterThanOrEqual(Math.floor(255 * (1 - c.floodReach)));
      expect(e.upland01(i)).toBeLessThan(0.2);
    }
    (w as unknown as { floodStage: number }).floodStage = 0;
    w.step();
    expect(standing(e)).toBe(0);
  });

  it('is off when the switch is off: nothing ever stands on dry ground', () => {
    const w = world({ dynamicWaterEnabled: false });
    const e = w.getElevation()!;
    for (let t = 0; t < 300; t++) w.step();
    expect(standing(e)).toBe(0);
    expect(e.version).toBe(0);
  }, 60_000);

  it('restores bit-identically and continues identically (tick, stage and standing water)', () => {
    const a = world();
    for (let t = 0; t < 237; t++) a.step(); // not a multiple of the water interval
    const b = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    expect(Array.from(b.getElevation()!.dynDepth)).toEqual(Array.from(a.getElevation()!.dynDepth));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 60; t++) {
      a.step();
      b.step();
    }
    expect(Array.from(b.getElevation()!.dynDepth)).toEqual(Array.from(a.getElevation()!.dynDepth));
    expect(b.stateHash()).toBe(a.stateHash());
  }, 120_000);

  it('loads an old save with dynamic water off', () => {
    const a = world({ dynamicWaterEnabled: false });
    const state = JSON.parse(JSON.stringify(a.exportState()));
    delete state.config.dynamicWaterEnabled;
    const b = World.fromState(state);
    expect(b.config.dynamicWaterEnabled).toBe(false);
  });

  it('keeps the energy ledger balanced', () => {
    const w = world({ ledgerCheckInterval: 1 });
    for (let t = 0; t < 250; t++) w.step();
    expect(w.ledgerReport()!.violations).toBe(0);
  }, 60_000);

  it('hands a page the standing water and redraws only when it changes', () => {
    const w = world({ waterInterval: 1 });
    const e = w.getElevation()!;
    for (let t = 0; t < 150; t++) w.step();
    const view = ElevationField.forView(e.exportView());
    expect(Array.from(view.dynDepth)).toEqual(Array.from(e.dynDepth));
    const v = view.version;
    expect(view.setDynamic(e.dynDepth)).toBe(false);
    expect(view.version).toBe(v);
    const flipped = Uint8Array.from(e.dynDepth, (d) => (d > 0 ? 0 : d));
    if (flipped.some((_, i) => flipped[i] !== e.dynDepth[i])) expect(view.setDynamic(flipped)).toBe(true);
  }, 60_000);
});
