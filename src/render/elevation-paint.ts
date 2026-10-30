/**
 * Paints elevation and water to pixels (no canvas, so it is testable). Display only.
 *
 * It is an overlay for the terrain ground, not a replacement: on land it adds relief (hillshade lit from the
 * north-west) and bare rock where the ground is steep (a cliff is just a steep step in `elevation`, derived here;
 * there is no cliff field), as translucent pixels so the terrain shows through. On water it paints opaque water:
 * deeper is darker, ocean (water at or below sea level) is bluer than inland water (rivers, lakes), and the
 * coast gets a pale rim.
 *
 * Input is plain arrays so it does not depend on the sim's class; the field layout is the one in the elevation
 * contract: index `y * width + x`, elevation 0..65535 meaning 0..1, water 0 (dry) or 1..255 meaning depth 0..1.
 */

export interface ElevationInput {
  readonly width: number;
  readonly height: number;
  readonly elevation: ArrayLike<number>;
  readonly water: ArrayLike<number>;
  readonly seaLevel: number;
  /** Depth (0..1) from which water is deep, `config.elevationDeepThreshold`. */
  readonly deepThreshold: number;
  /** Elevation step per cell at which bare rock begins and is fully cliff (defaults below; tune to the real field). */
  readonly cliffFrom?: number;
  readonly cliffFull?: number;
}

export interface ElevationPixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

const CLIFF_FROM = 0.05;
const CLIFF_FULL = 0.075;

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

function grain(x: number, y: number, salt: number): number {
  const h = Math.imul(Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ salt, 2246822519) >>> 0;
  return ((h >>> 8) & 1023) / 511.5 - 1;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function paintElevation(input: ElevationInput, px: number): ElevationPixels {
  const { width, height, seaLevel, deepThreshold } = input;
  const cliffFrom = input.cliffFrom ?? CLIFF_FROM;
  const cliffFull = input.cliffFull ?? CLIFF_FULL;
  const n = width * height;
  const elev = new Float32Array(n);
  const depth = new Float32Array(n);
  const wet = new Float32Array(n); // 1 where a cell holds water
  for (let i = 0; i < n; i++) {
    elev[i] = input.elevation[i] / 65535;
    depth[i] = input.water[i] / 255;
    wet[i] = input.water[i] > 0 ? 1 : 0;
  }

  const W = width * px;
  const H = height * px;
  const data = new Uint8ClampedArray(W * H * 4);
  const e = 0.4; // cells: the step for slope
  for (let py = 0; py < H; py++) {
    for (let pxl = 0; pxl < W; pxl++) {
      const x = (pxl + 0.5) / px;
      const y = (py + 0.5) / px;
      const o = (py * W + pxl) * 4;

      // Smoothed coastline: the wet mask blurred by the bilinear sample, cut at one half.
      const wetness = sample(wet, width, height, x, y);
      const waterMix = smooth(0.42, 0.58, wetness); // 0 land .. 1 water, soft at the edge
      const rim = 1 - smooth(0.0, 0.16, Math.abs(wetness - 0.5)); // 1 on the coastline

      const dx = sample(elev, width, height, x + e, y) - sample(elev, width, height, x - e, y);
      const dy = sample(elev, width, height, x, y + e) - sample(elev, width, height, x, y - e);
      const slope = Math.hypot(dx, dy) / (2 * e); // elevation per cell
      const light = clamp01(0.5 + (-dx - dy) * 3.2) * 2 - 1; // -1 away from the light .. 1 toward it
      const g = grain(pxl, py, 7);

      // Land: relief and rock as a translucent overlay.
      const cliff = smooth(cliffFrom, cliffFull, slope);
      const shadeTone = light > 0 ? 255 : 0;
      const shadeAlpha = Math.abs(light) * 0.34;
      let lr = shadeTone;
      let lg = shadeTone;
      let lb = shadeTone;
      let la = shadeAlpha;
      // Shadow cast down the slope away from the light: ground with much higher ground just to its north-west.
      const here = sample(elev, width, height, x, y);
      const cast = smooth(0.025, 0.1, sample(elev, width, height, x - 1.1, y - 1.1) - here) * 0.4;
      if (cast > 0) {
        const aNew = la + cast * (1 - la);
        lr = (lr * la) / aNew;
        lg = (lg * la) / aNew;
        lb = (lb * la) / aNew;
        la = aNew;
      }
      if (cliff > 0) {
        // Flat rock: lit on the side facing the light with a warm pale crest, dark on the underside.
        const crest = Math.max(0, light) * 34 * cliff;
        const tone = 92 * (1 + light * 0.42 + g * 0.025) + crest;
        lr = tone * 1.03 + crest * 0.25;
        lg = tone * 0.97 + crest * 0.1;
        lb = tone * 0.88;
        la = mix(la, 0.92, cliff);
      }
      // A dark line along the foot, where the face meets the ground below it.
      const foot = smooth(0.02, 0.07, sample(elev, width, height, x - 0.9, y - 0.9) - here) * (1 - cliff);
      if (foot > 0.05) {
        lr = lg = lb = 12;
        la = Math.max(la, foot * 0.7);
      }
      // A pale rim of wet sand on the land side of the coast.
      if (rim > 0 && waterMix < 0.5) {
        lr = mix(lr, 232, rim * 0.7);
        lg = mix(lg, 214, rim * 0.7);
        lb = mix(lb, 160, rim * 0.7);
        la = Math.max(la, rim * 0.6);
      }

      // Water: opaque, deeper is darker, ocean bluer than inland water.
      const d = sample(depth, width, height, x, y) / Math.max(0.001, wetness); // depth over the wet cells only
      const deep = smooth(0.02, Math.max(0.05, deepThreshold * 1.6), d);
      const ocean = clamp01((seaLevel - sample(elev, width, height, x, y)) / 0.08 + 0.5);
      const shallowR = mix(86, 70, ocean);
      const shallowG = mix(176, 160, ocean);
      const shallowB = mix(170, 205, ocean);
      const deepR = mix(26, 16, ocean);
      const deepG = mix(86, 52, ocean);
      const deepB = mix(112, 128, ocean);
      let wr = mix(shallowR, deepR, deep);
      let wg = mix(shallowG, deepG, deep);
      let wb = mix(shallowB, deepB, deep);
      const ripple = 1 + g * 0.03 + Math.sin((x + y * 0.6) * 5.5 + grain(pxl >> 2, py >> 2, 3) * 2) * 0.025;
      wr *= ripple;
      wg *= ripple;
      wb *= ripple;
      // Foam along the water side of the coast.
      if (rim > 0) {
        wr = mix(wr, 226, rim * 0.55);
        wg = mix(wg, 244, rim * 0.55);
        wb = mix(wb, 246, rim * 0.55);
      }
      const wa = 0.94;

      // Blend land over water by the soft coast mask, in straight alpha.
      const aOut = la * (1 - waterMix) + wa * waterMix;
      if (aOut > 0) {
        const kl = (la * (1 - waterMix)) / aOut;
        const kw = (wa * waterMix) / aOut;
        data[o] = lr * kl + wr * kw;
        data[o + 1] = lg * kl + wg * kw;
        data[o + 2] = lb * kl + wb * kw;
      }
      data[o + 3] = Math.round(aOut * 255);
    }
  }
  return { width: W, height: H, data };
}
