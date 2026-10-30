import { TERRAIN_FULL, type TerrainField } from '../sim/terrain';

/**
 * Paints the terrain fields to pixels (no canvas needed, so it is testable). Two looks:
 *
 * - natural: continuous ground. Loam that turns stony with roughness and is lit from the north-west so rough ground
 *   reads as raised; grass that follows cover; packed pale earth where bodies have worn the ground away.
 * - data map (the Terrain layer): roughness on a brown ramp or cover on a green ramp, whichever is stronger in
 *   that spot, with contour lines at quarter steps and a bright outline round worn ground.
 *
 * Display only: it reads the fields and never changes them.
 */

export interface TerrainPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  /** Cells worn by more than 2% (the legend's count). */
  readonly worn: number;
}

/** Fields as 0..1 floats, one per cell. */
interface Fields {
  readonly r: Float32Array;
  readonly c: Float32Array;
  readonly w: Float32Array;
}

const WORN_THRESHOLD = 0.02;

function readFields(terrain: TerrainField): { fields: Fields; worn: number } {
  const n = terrain.roughness.length;
  const r = new Float32Array(n);
  const c = new Float32Array(n);
  const w = new Float32Array(n);
  let worn = 0;
  for (let i = 0; i < n; i++) {
    r[i] = terrain.roughness[i] / TERRAIN_FULL;
    c[i] = terrain.cover[i] / TERRAIN_FULL;
    w[i] = terrain.wear01(i);
    if (w[i] > WORN_THRESHOLD) worn++;
  }
  return { fields: { r, c, w }, worn };
}

/** Bilinear sample of a per-cell field at a position in cell units (cell centres at +0.5), clamped at the edges. */
function sample(field: Float32Array, width: number, height: number, x: number, y: number): number {
  const fx = Math.min(width - 1, Math.max(0, x - 0.5));
  const fy = Math.min(height - 1, Math.max(0, y - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx;
  const bottom = field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Deterministic noise in -1..1 from integer pixel coordinates. */
function grain(x: number, y: number, salt: number): number {
  const h = Math.imul(Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ salt, 2246822519) >>> 0;
  return ((h >>> 8) & 1023) / 511.5 - 1;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** `water` (the elevation field's depth per cell, 0 dry) leaves water cells clear, so the water layer paints them alone. */
export function paintTerrain(terrain: TerrainField, px: number, emphasis: boolean, water?: ArrayLike<number>): TerrainPixels {
  const { width, height } = terrain;
  const W = width * px;
  const H = height * px;
  const data = new Uint8ClampedArray(W * H * 4);
  const { fields, worn } = readFields(terrain);
  if (emphasis) paintDataMap(data, fields, width, height, px);
  else paintNatural(data, fields, width, height, px);
  if (water) {
    for (let py = 0; py < height * px; py++) {
      for (let pxl = 0; pxl < width * px; pxl++) {
        if (water[Math.floor(py / px) * width + Math.floor(pxl / px)] > 0) data[(py * width * px + pxl) * 4 + 3] = 0;
      }
    }
  }
  return { width: W, height: H, data, worn };
}

function paintNatural(data: Uint8ClampedArray, f: Fields, width: number, height: number, px: number): void {
  const W = width * px;
  const H = height * px;
  const e = 0.35; // cells: the step for the slope
  for (let py = 0; py < H; py++) {
    for (let pxl = 0; pxl < W; pxl++) {
      const x = (pxl + 0.5) / px;
      const y = (py + 0.5) / px;
      const rough = sample(f.r, width, height, x, y);
      const cover = sample(f.c, width, height, x, y);
      const wear = sample(f.w, width, height, x, y);

      // Slope of the roughness, lit from the north-west: ground rising toward the light is bright, away is dark.
      const gx = sample(f.r, width, height, x + e, y) - sample(f.r, width, height, x - e, y);
      const gy = sample(f.r, width, height, x, y + e) - sample(f.r, width, height, x, y - e);
      const light = Math.max(-1, Math.min(1, (-gx - gy) * 5));

      const g1 = grain(pxl, py, 17);
      const g2 = grain(pxl >> 1, py >> 1, 91); // coarser mottling

      // Loam to stony ground.
      let cr = mix(44, 104, rough);
      let cg = mix(38, 90, rough);
      let cb = mix(32, 72, rough);

      // Grass over it, mottled, thinner where it is worn away.
      const grassAmount = Math.max(0, Math.min(0.88, cover * (0.86 + 0.12 * g2) * 1.05));
      cr = mix(cr, 46 + g2 * 4, grassAmount);
      cg = mix(cg, 98 + g2 * 7, grassAmount);
      cb = mix(cb, 52 + g2 * 3, grassAmount);

      // Packed pale earth where bodies have worn it.
      const wornAmount = Math.sqrt(wear) * 0.78;
      cr = mix(cr, 168, wornAmount);
      cg = mix(cg, 148, wornAmount);
      cb = mix(cb, 112, wornAmount);

      const shade = 1 + light * 0.34 + g1 * 0.02;
      const o = (py * W + pxl) * 4;
      data[o] = cr * shade;
      data[o + 1] = cg * shade;
      data[o + 2] = cb * shade;
      data[o + 3] = 214;
    }
  }
}

const BANDS = 4;

function paintDataMap(data: Uint8ClampedArray, f: Fields, width: number, height: number, px: number): void {
  const W = width * px;
  const H = height * px;
  const value = new Float32Array(W * H);
  const kind = new Uint8Array(W * H); // 0 roughness, 1 cover
  const wearField = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let pxl = 0; pxl < W; pxl++) {
      const x = (pxl + 0.5) / px;
      const y = (py + 0.5) / px;
      const rough = sample(f.r, width, height, x, y);
      const cover = sample(f.c, width, height, x, y);
      const i = py * W + pxl;
      kind[i] = cover > rough ? 1 : 0;
      value[i] = Math.max(rough, cover);
      wearField[i] = sample(f.w, width, height, x, y);
    }
  }
  for (let py = 0; py < H; py++) {
    for (let pxl = 0; pxl < W; pxl++) {
      const i = py * W + pxl;
      const v = value[i];
      const o = i * 4;
      // Ramps from dark (none) to bright (full).
      let cr: number;
      let cg: number;
      let cb: number;
      if (kind[i] === 1) {
        cr = mix(26, 80, v);
        cg = mix(44, 205, v);
        cb = mix(34, 110, v);
      } else {
        cr = mix(36, 224, v);
        cg = mix(32, 150, v);
        cb = mix(28, 62, v);
      }
      // Contour: the band changes across the next pixel to the right or below, within the same field.
      const band = Math.floor(v * BANDS);
      const right = pxl + 1 < W ? i + 1 : i;
      const below = py + 1 < H ? i + W : i;
      const contour =
        (kind[right] === kind[i] && Math.floor(value[right] * BANDS) !== band) ||
        (kind[below] === kind[i] && Math.floor(value[below] * BANDS) !== band);
      if (contour) {
        cr *= 0.45;
        cg *= 0.45;
        cb *= 0.45;
      }
      // Worn ground: an outline where it crosses 10% wear, and a pale wash inside.
      const wornHere = wearField[i] > 0.1;
      const wornEdge = wornHere !== (wearField[right] > 0.1) || wornHere !== (wearField[below] > 0.1);
      if (wornHere) {
        cr = mix(cr, 240, 0.35);
        cg = mix(cg, 226, 0.35);
        cb = mix(cb, 180, 0.35);
      }
      if (wornEdge) {
        cr = 255;
        cg = 240;
        cb = 190;
      }
      data[o] = cr;
      data[o + 1] = cg;
      data[o + 2] = cb;
      data[o + 3] = 235;
    }
  }
}
