import { describe, expect, it } from 'vitest';
import { paintElevation, type ElevationInput } from '../src/render/elevation-paint';

// The elevation painter is display only and deterministic. The field here is made by hand: a plateau with a
// steep west edge (a cliff is only a steep step in elevation) and a lake of deep water in the east.

function field(): ElevationInput {
  const width = 24;
  const height = 16;
  const elevation = new Array<number>(width * height);
  const water = new Array<number>(width * height).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      elevation[i] = x < 8 ? 0.3 * 65535 : 0.7 * 65535; // a step between x=7 and x=8
      if (x >= 16 && x < 21 && y >= 4 && y < 12) {
        water[i] = 255;
        elevation[i] = 0.5 * 65535;
      }
    }
  }
  return { width, height, elevation, water, seaLevel: 0.2, deepThreshold: 0.2 };
}

const px = 6;
const at = (p: { width: number; data: Uint8ClampedArray }, cx: number, cy: number) => {
  const o = (Math.floor(cy * px) * p.width + Math.floor(cx * px)) * 4;
  return { r: p.data[o], g: p.data[o + 1], b: p.data[o + 2], a: p.data[o + 3] };
};

describe('paintElevation', () => {
  it('is deterministic', () => {
    const a = paintElevation(field(), px);
    const b = paintElevation(field(), px);
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(a.width).toBe(24 * px);
  });

  it('paints water opaque and blue, and flat dry ground nearly clear', () => {
    const p = paintElevation(field(), px);
    const lake = at(p, 18.5, 8);
    const flat = at(p, 3, 8);
    expect(lake.a).toBeGreaterThan(200);
    expect(lake.b).toBeGreaterThan(lake.r);
    expect(flat.a).toBeLessThan(10);
  });

  it('shows bare rock on a steep step and not on a gentle one', () => {
    const steep = paintElevation(field(), px);
    const gentle = (() => {
      const f = field();
      const flatter = f.elevation.map((v, i) => (f.water[i] > 0 ? v : 0.3 * 65535 + (i % f.width) * 40));
      return paintElevation({ ...f, elevation: flatter }, px);
    })();
    expect(at(steep, 8, 8).a).toBeGreaterThan(120);
    expect(at(gentle, 8, 8).a).toBeLessThan(40);
  });

  it('paints deep water darker than shallow', () => {
    const f = field();
    const shallow = { ...f, water: f.water.map((v) => (v > 0 ? 20 : 0)) };
    const deep = at(paintElevation(f, px), 18.5, 8);
    const shal = at(paintElevation(shallow, px), 18.5, 8);
    expect(deep.g).toBeLessThan(shal.g);
  });
});
