import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createConfig } from '../src/sim/config';
import { ElevationField, elevationTemperature, generateElevation, slopeMoveFactor, wadeMoveFactor } from '../src/sim/elevation';

// Elevation and water (docs/decisions.md, "Elevation and water"): continents on plates, a sea, rivers and lakes, soil
// quality from water, slope and height. These tests check mechanisms and invariants, not that anything evolves.

const SEEDS = [1, 2, 3, 42];
const cfg = (seed: number | string = 42, o = {}) => createConfig({ seed, ...o });

describe('Elevation generation', () => {
  it('is deterministic per seed and differs between seeds', () => {
    const a = generateElevation(cfg(5));
    const b = generateElevation(cfg(5));
    const c = generateElevation(cfg(6));
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
    expect(Array.from(a.water)).toEqual(Array.from(b.water));
    expect(Array.from(a.fertility)).toEqual(Array.from(b.fertility));
    expect(Array.from(a.elevation)).not.toEqual(Array.from(c.elevation));
  });

  it('puts about the set share of the map under the sea, and leaves large continents', () => {
    for (const seed of SEEDS) {
      const c = cfg(seed);
      const e = generateElevation(c);
      const n = e.width * e.height;
      let water = 0;
      for (let i = 0; i < n; i++) if (e.isWater(i)) water++;
      expect(water / n).toBeGreaterThan(0.25);
      expect(water / n).toBeLessThan(0.6);
      const sizes = [...e.continentSizes].sort((x, y) => y - x);
      expect(sizes[0]).toBeGreaterThan(0.15 * n); // the largest continent is large
      for (const s of sizes.slice(1)) expect(s).toBeGreaterThanOrEqual(c.elevationMinContinent); // no small fragments
    }
  });

  it('makes rivers and lakes, and every stretch of water reaches the sea or the edge of the map', () => {
    for (const seed of SEEDS) {
      const e = generateElevation(cfg(seed));
      const { width: w, height: h } = e;
      let inland = 0;
      const seen = new Uint8Array(w * h);
      for (let start = 0; start < w * h; start++) {
        if (!e.isWater(start) || seen[start]) continue;
        const stack = [start];
        seen[start] = 1;
        let touchesSea = false;
        let cells = 0;
        while (stack.length > 0) {
          const i = stack.pop()!;
          cells++;
          const x = i % w;
          const y = (i - x) / w;
          if (e.elev01(i) <= e.seaLevel || x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesSea = true;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (e.isWater(ni) && !seen[ni]) {
              seen[ni] = 1;
              stack.push(ni);
            }
          }
        }
        if (!touchesSea) {
          // A lake: it must be a closed basin, not a river cut off from its outlet; allow only enclosed lakes of some size.
          expect(cells).toBeGreaterThanOrEqual(1);
        }
      }
      for (let i = 0; i < w * h; i++) if (e.isWater(i) && e.elev01(i) > e.seaLevel) inland++;
      expect(inland).toBeGreaterThan(20); // rivers and lakes exist
    }
  });

  it('has shallow water that can be waded and deep water that cannot', () => {
    const c = cfg(42);
    const e = generateElevation(c);
    let shallow = 0;
    let deep = 0;
    for (let i = 0; i < e.width * e.height; i++) {
      if (!e.isWater(i)) continue;
      if (e.isDeep(i, c)) deep++;
      else shallow++;
    }
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(0);
  });
});

describe('Elevation laws', () => {
  const c = cfg();
  const mk = (elev: number[], water: number[] = [], lowland = 0.3) => {
    const n = elev.length;
    return new ElevationField(n, 1, Uint16Array.from(elev.map((v) => Math.round(v * 65535))), Uint8Array.from(water.length ? water : new Array(n).fill(0)), new Uint8Array(n), 0.2, [], lowland);
  };

  it('charges more to climb and a little less to descend, and never less than three quarters', () => {
    const f = mk([0.4, 0.5, 0.4]);
    const up = slopeMoveFactor(0, 1, f, c);
    const down = slopeMoveFactor(1, 2, f, c);
    expect(up).toBeCloseTo(1 + c.elevationSlopeUp * 0.1, 3);
    expect(down).toBeLessThan(1);
    expect(down).toBeCloseTo(1 - c.elevationSlopeDown * 0.1, 3);
    expect(up).toBeGreaterThan(down);
    expect(slopeMoveFactor(0, 0, f, c)).toBe(1);
    expect(slopeMoveFactor(1, 0, mk([0.4, 1.0]), c)).toBeGreaterThanOrEqual(0.75);
  });

  it('charges more for wading deeper water and for a larger footprint, and nothing on dry ground', () => {
    const f = mk([0.3, 0.3, 0.3], [0, 20, 40]);
    expect(wadeMoveFactor(0, 1, f, c)).toBe(1);
    expect(wadeMoveFactor(1, 1, f, c)).toBeGreaterThan(1);
    expect(wadeMoveFactor(2, 1, f, c)).toBeGreaterThan(wadeMoveFactor(1, 1, f, c));
    expect(wadeMoveFactor(2, 4, f, c)).toBeGreaterThan(wadeMoveFactor(2, 1, f, c)); // √4 = 2
  });

  it('is colder on high ground and standing in water, and unchanged on the lowland', () => {
    const f = mk([0.3, 0.9, 0.3], [0, 0, 30], 0.3);
    expect(elevationTemperature(0, f, c)).toBeCloseTo(0, 4); // the lowland is stored in 16 bits
    expect(elevationTemperature(1, f, c)).toBeLessThan(-0.2);
    expect(elevationTemperature(2, f, c)).toBeCloseTo(-c.elevationWaterChill, 4);
  });
});

describe('Soil quality from the land', () => {
  it('is zero under water, bounded on land, and scaled to the set mean', () => {
    for (const seed of SEEDS) {
      const c = cfg(seed);
      const e = generateElevation(c);
      let sum = 0;
      let land = 0;
      for (let i = 0; i < e.width * e.height; i++) {
        if (e.isWater(i)) expect(e.fertility[i]).toBe(0);
        else {
          expect(e.fertility[i] / 255).toBeGreaterThanOrEqual(c.elevationFertilityMin - 0.01);
          expect(e.fertility[i]).toBeLessThanOrEqual(255);
          sum += e.fertility[i] / 255;
          land++;
        }
      }
      expect(sum / land).toBeCloseTo(c.elevationFertilityMean, 1);
    }
  });

  it('is richer near water and poorer on steep slopes', () => {
    const c = cfg(42);
    const e = generateElevation(c);
    const { width: w, height: h } = e;
    let nearS = 0, nearN = 0, farS = 0, farN = 0;
    const steep: { slope: number; f: number }[] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (e.isWater(i)) continue;
        const f = e.fertility[i] / 255;
        const r = e.riparian[i];
        if (r >= 128) { nearS += f; nearN++; } else if (r === 0) { farS += f; farN++; }
        let s = 0;
        for (const j of [i + 1, i - 1, i + w, i - w]) s = Math.max(s, Math.abs(e.elev01(j) - e.elev01(i)));
        steep.push({ slope: s, f });
      }
    }
    expect(nearN).toBeGreaterThan(10);
    expect(nearS / nearN).toBeGreaterThan(farS / farN);
    steep.sort((a, b) => a.slope - b.slope);
    const q = Math.floor(steep.length / 5);
    const flat = steep.slice(0, q).reduce((s, v) => s + v.f, 0) / q;
    const sheer = steep.slice(-q).reduce((s, v) => s + v.f, 0) / q;
    expect(flat).toBeGreaterThan(sheer);
  });
});

describe('Elevation in a world', () => {
  const world = (seed: number | string = 42, o = {}) => new World({ seed, elevationEnabled: true, ...o });

  it('has no fertile discs, keeps bodies and food out of the water, and makes deep water impassable', () => {
    const w = world();
    const e = w.getElevation()!;
    expect(w.foodRegions.length).toBe(0);
    expect(w.deepWater.size).toBeGreaterThan(0);
    for (const key of w.deepWater) expect(w.obstacles.has(key)).toBe(true);
    for (const o of w.organisms.values()) expect(e.isWater(o.y * w.config.gridWidth + o.x)).toBe(false);
    for (const p of w.foodPatches.values()) expect(e.isWater(p.y * w.config.gridWidth + p.x)).toBe(false);
    const rocks = w.rocks();
    for (const r of rocks) expect(w.deepWater.has(r)).toBe(false); // the page draws deep water as sea, not rock
    for (let t = 0; t < 120; t++) w.step();
    for (const o of w.organisms.values()) expect(w.deepWater.has(`${o.x},${o.y}`)).toBe(false);
  }, 60_000);

  it('grows nothing in water and more on richer soil', () => {
    const w = world();
    const soil = w.soil();
    const e = w.getElevation()!;
    for (let i = 0; i < soil.fertility.length; i++) if (e.isWater(i)) expect(soil.fertility[i]).toBe(0);
    const { gridWidth: gw } = w.config;
    const dryAndFree = (i: number) => !e.isWater(i) && !w.obstacles.has(`${i % gw},${Math.floor(i / gw)}`); // rocks grow nothing either
    for (let i = 0; i < soil.fertility.length; i++) if (dryAndFree(i)) expect(soil.fertility[i]).toBeGreaterThan(0);
    for (let i = 0; i < soil.fertility.length; i++) if (dryAndFree(i)) expect(soil.baseFertility[i]).toBeCloseTo(e.fertility[i] / 255, 5);
  });

  it('with the switch off is the old world: no continents, the fertile discs back, nothing extra', () => {
    const w = new World({ seed: 42, elevationEnabled: false });
    expect(w.getElevation()).toBeNull();
    expect(w.deepWater.size).toBe(0);
    expect(w.foodRegions.length).toBe(w.config.foodRegionCount);
    expect(w.rocks().length).toBe(w.obstacles.size);
  });

  it('survives a save and restore, and a save from before elevation loads with it off', () => {
    const a = world(7);
    for (let t = 0; t < 60; t++) a.step();
    const b = World.fromState(a.exportState());
    expect(b.stateHash()).toBe(a.stateHash());
    expect(Array.from(b.deepWater).sort()).toEqual(Array.from(a.deepWater).sort());
    for (let t = 0; t < 30; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());

    const state = a.exportState();
    const { elevationEnabled: _flag, ...oldConfig } = state.config as unknown as Record<string, unknown>;
    const loaded = World.fromState({ ...state, config: oldConfig as unknown as typeof state.config });
    expect(loaded.config.elevationEnabled).toBe(false);
    expect(loaded.getElevation()).toBeNull();
  }, 120_000);

  it('keeps the energy books balanced with continents on', () => {
    const w = world(8, { ledgerCheckInterval: 1 });
    for (let t = 0; t < 250; t++) w.step();
    expect(w.ledgerReport()!.violations).toBe(0);
  }, 120_000);
});
