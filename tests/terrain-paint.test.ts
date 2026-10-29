import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/sim/config';
import { generateTerrain } from '../src/sim/terrain';
import { paintTerrain } from '../src/render/terrain-paint';

// The terrain painter is display only: it reads the fields, never changes them, and is deterministic.

function field() {
  return generateTerrain(createConfig({ seed: 3, gridWidth: 20, gridHeight: 20 }));
}

describe('paintTerrain', () => {
  it('is deterministic and leaves the fields untouched', () => {
    const t = field();
    const before = Array.from(t.roughness).concat(Array.from(t.cover));
    const a = paintTerrain(t, 4, false);
    const b = paintTerrain(t, 4, false);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(t.roughness).concat(Array.from(t.cover))).toEqual(before);
    expect(a.width).toBe(80);
  });

  it('counts worn cells and paints the data map differently from the natural look', () => {
    const config = createConfig({ seed: 3, gridWidth: 20, gridHeight: 20 });
    const t = generateTerrain(config);
    expect(paintTerrain(t, 4, true).worn).toBe(0);
    for (let i = 0; i < 30; i++) t.trample(5 * 20 + 5, 1, config);
    const natural = paintTerrain(t, 4, false);
    const map = paintTerrain(t, 4, true);
    expect(natural.worn).toBeGreaterThan(0);
    expect(Array.from(natural.data)).not.toEqual(Array.from(map.data));
  });
});

describe('paintTerrain over water', () => {
  it('leaves cells that hold water clear', () => {
    const t = field();
    const water = new Uint8Array(400);
    water[5 * 20 + 5] = 120;
    const p = paintTerrain(t, 4, false, water);
    const o = ((5 * 4 + 1) * p.width + (5 * 4 + 1)) * 4;
    expect(p.data[o + 3]).toBe(0);
    expect(p.data[((9 * 4 + 1) * p.width + 9 * 4 + 1) * 4 + 3]).toBeGreaterThan(0);
  });
});
