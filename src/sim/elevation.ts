import { PRNG } from './prng';
import { valueNoise } from './terrain';
import type { SimulationConfig } from './types';

/**
 * Elevation and water (docs/decisions.md, "Elevation and water"). One height field made once from tectonic-style
 * plates, a sea level, and water that runs downhill:
 *
 * - Plates: a few continental plates (high) and oceanic plates (low), found by the nearest of several centres with
 *   ragged borders. Where two continental plates meet they pile up mountains; where one meets an ocean plate a
 *   coastal range rises. The plates are kept on the field so a later step can move them and remake the height.
 * - Sea level sits at a quantile of the heights, so a fixed share of the map is ocean; tiny land fragments are
 *   flooded, leaving large continents separated by ocean.
 * - Water runs downhill (priority flood): depressions fill into lakes, the strongest flows become rivers, and what
 *   lies below sea level is ocean. Water has a depth; shallow water can be waded, deep water cannot be crossed.
 * - Ground near water is wetter: a riparian lift that raises soil fertility.
 *
 * It uses a random stream of its own, derived from the world's seed, so it draws nothing from the simulation's
 * stream. Static for the run.
 */

export interface Plate {
  readonly x: number;
  readonly y: number;
  readonly type: 'continental' | 'oceanic';
  readonly base: number;
}

export const ELEVATION_FULL = 65535;

export interface ElevationState {
  readonly width: number;
  readonly height: number;
  readonly seaLevel: number;
  readonly lowland?: number;
  readonly elevation: readonly number[];
  readonly water: readonly number[];
}

export class ElevationField {
  constructor(
    public readonly width: number,
    public readonly height: number,
    /** 0..65535 meaning 0..1. */
    public readonly elevation: Uint16Array,
    /** 0 on dry land, otherwise depth 1..255 meaning 0..1. */
    public readonly water: Uint8Array,
    /** 0..255: 255 on the shore, falling to 0 at `elevationRiparianReach` cells from water. */
    public readonly riparian: Uint8Array,
    /** Sea level, 0..1. */
    public readonly seaLevel: number,
    public readonly plates: readonly Plate[],
    /** The height of the typical lowland (the median of the land), 0..1: the temperature drop is measured above it. */
    public readonly lowland: number = 0,
    /** The continent (connected land) each cell belongs to, -1 on water-free-sea cells; with the continents' sizes. */
    public readonly continent: Int32Array = new Int32Array(0),
    public readonly continentSizes: readonly number[] = [],
    /** Soil quality 0..255 meaning 0..1 (0 under water): wet, flat, low, good ground is rich. */
    public readonly fertility: Uint8Array = new Uint8Array(0)
  ) {}

  public isWater(index: number): boolean {
    return this.water[index] > 0;
  }

  /** Water depth 0..1 (0 on land). */
  public depth01(index: number): number {
    return this.water[index] / 255;
  }

  /** Deep water cannot be crossed (until a body can swim). */
  public isDeep(index: number, config: Readonly<SimulationConfig>): boolean {
    return this.water[index] > 0 && this.water[index] / 255 >= config.elevationDeepThreshold;
  }

  /** Height above sea level as 0..1 of the way to the highest peak (0 at or below the sea). */
  public above01(index: number): number {
    const e = this.elevation[index] / ELEVATION_FULL;
    return e > this.seaLevel ? (e - this.seaLevel) / Math.max(1e-9, 1 - this.seaLevel) : 0;
  }

  /** Height above the typical lowland, 0..1 of the way to the highest peak (0 at or below the lowland). */
  public upland01(index: number): number {
    const e = this.elevation[index] / ELEVATION_FULL;
    return e > this.lowland ? (e - this.lowland) / Math.max(1e-9, 1 - this.lowland) : 0;
  }

  public elev01(index: number): number {
    return this.elevation[index] / ELEVATION_FULL;
  }

  public exportView(): ElevationState {
    return {
      width: this.width,
      height: this.height,
      seaLevel: this.seaLevel,
      lowland: this.lowland,
      elevation: Array.from(this.elevation),
      water: Array.from(this.water),
    };
  }

  /** A page only draws the field: the riparian lift and plates are not needed there. */
  public static forView(state: ElevationState): ElevationField {
    return new ElevationField(
      state.width,
      state.height,
      Uint16Array.from(state.elevation),
      Uint8Array.from(state.water),
      new Uint8Array(state.width * state.height),
      state.seaLevel,
      [],
      state.lowland ?? 0
    );
  }
}

/** A binary min-heap of (height, index) pairs, ties broken by index so the result is deterministic. */
class MinHeap {
  private h: number[] = [];
  private k: number[] = [];
  get size(): number {
    return this.h.length;
  }
  private less(a: number, b: number): boolean {
    return this.h[a] < this.h[b] || (this.h[a] === this.h[b] && this.k[a] < this.k[b]);
  }
  private swap(a: number, b: number): void {
    [this.h[a], this.h[b]] = [this.h[b], this.h[a]];
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
  }
  push(height: number, index: number): void {
    this.h.push(height);
    this.k.push(index);
    let i = this.h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const top: [number, number] = [this.h[0], this.k[0]];
    const lastH = this.h.pop()!;
    const lastK = this.k.pop()!;
    if (this.h.length > 0) {
      this.h[0] = lastH;
      this.k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.h.length && this.less(l, m)) m = l;
        if (r < this.h.length && this.less(r, m)) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Connected land (4-neighbour) labelled; returns each cell's component (-1 for water) and the sizes. */
function labelLand(isLand: Uint8Array, w: number, h: number): { label: Int32Array; sizes: number[] } {
  const label = new Int32Array(w * h).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < label.length; start++) {
    if (!isLand[start] || label[start] >= 0) continue;
    const id = sizes.length;
    const stack = [start];
    label[start] = id;
    let n = 0;
    while (stack.length > 0) {
      const c = stack.pop()!;
      n++;
      const x = c % w;
      const y = (c - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (isLand[ni] && label[ni] < 0) {
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

/** The elevation, water and riparian lift for a world, from its seed. */
export function generateElevation(config: Readonly<SimulationConfig>): ElevationField {
  const { gridWidth: w, gridHeight: h } = config;
  const n = w * h;
  const prng = new PRNG(`elevation:${String(config.seed)}`);

  // 1. Plates: centres spread over the map, about half of them continental.
  const count = Math.max(2, Math.floor(config.elevationPlateCount));
  const centres: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    let best = { x: 0, y: 0 };
    let bestGap = -Infinity;
    for (let attempt = 0; attempt < 30; attempt++) {
      const x = prng.nextFloat(0, w);
      const y = prng.nextFloat(0, h);
      let gap = Infinity;
      for (const c of centres) gap = Math.min(gap, Math.hypot(c.x - x, c.y - y));
      if (gap > bestGap) {
        best = { x, y };
        bestGap = gap;
      }
    }
    centres.push(best);
  }
  const order = prng.shuffle(Array.from({ length: count }, (_, i) => i));
  const continentalCount = Math.max(1, Math.min(count - 1, Math.round(count * config.elevationContinentalShare)));
  const isContinental = new Set(order.slice(0, continentalCount));
  const plates: Plate[] = centres.map((c, i) => ({
    ...c,
    type: isContinental.has(i) ? 'continental' : 'oceanic',
    base: isContinental.has(i) ? 0.62 : 0.18,
  }));

  // 2. Height: a soft blend of the plates' bases (nearest wins, borders ragged), mountains where plates meet, noise.
  const warpX = valueNoise(w, h, 12, prng);
  const warpY = valueNoise(w, h, 12, prng);
  const rough = valueNoise(w, h, 9, prng);
  const fine = valueNoise(w, h, 4, prng);
  const height = new Float64Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const px = x + (warpX[i] - 0.5) * 12;
      const py = y + (warpY[i] - 0.5) * 12;
      const d = plates.map((p, k) => ({ k, d: Math.hypot(px - p.x, py - p.y) })).sort((a, b) => a.d - b.d || a.k - b.k);
      const d1 = d[0].d;
      let sum = 0;
      let weight = 0;
      for (const e of d) {
        const wk = Math.exp(-(e.d - d1) / 3.5);
        sum += wk * plates[e.k].base;
        weight += wk;
      }
      let v = sum / weight;
      const a = plates[d[0].k];
      const b = plates[d[1].k];
      const gap = d[1].d - d1;
      if (a.type === 'continental' && b.type === 'continental') v += config.elevationRidge * Math.exp(-gap / 4);
      else if (a.type === 'continental' && b.type === 'oceanic') v += 0.4 * config.elevationRidge * Math.exp(-gap / 3);
      v += (rough[i] - 0.5) * 2 * config.elevationNoise + (fine[i] - 0.5) * 2 * 0.4 * config.elevationNoise;
      height[i] = v;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    lo = Math.min(lo, height[i]);
    hi = Math.max(hi, height[i]);
  }
  for (let i = 0; i < n; i++) height[i] = (height[i] - lo) / Math.max(1e-9, hi - lo);

  // 3. Sea level at a quantile, so a fixed share of the map is ocean; flood land fragments too small to be continents.
  const sorted = Float64Array.from(height).sort();
  const seaFraction = Math.max(0.05, Math.min(0.9, config.elevationSeaFraction));
  let sea = sorted[Math.min(n - 1, Math.floor(seaFraction * n))];
  const isLand = new Uint8Array(n);
  for (let i = 0; i < n; i++) isLand[i] = height[i] > sea ? 1 : 0;
  const { label, sizes } = labelLand(isLand, w, h);
  const largest = sizes.length > 0 ? sizes.indexOf(Math.max(...sizes)) : -1;
  for (let i = 0; i < n; i++) {
    if (isLand[i] && sizes[label[i]] < config.elevationMinContinent && label[i] !== largest) {
      height[i] = sea - 0.02; // flooded fragment
      isLand[i] = 0;
    }
  }
  sea = Math.max(1e-6, sea);

  // 4. Water runs downhill. Priority flood from the sea and the map edge: depressions fill into lakes.
  const filled = new Float64Array(n).fill(Infinity);
  const flowTo = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const heap = new MinHeap();
  const popped: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i % w;
    const y = (i - x) / w;
    const onEdge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    if (!isLand[i] || onEdge) {
      filled[i] = height[i];
      seen[i] = 1;
      heap.push(filled[i], i);
    }
  }
  while (heap.size > 0) {
    const [fh, c] = heap.pop();
    popped.push(c);
    const x = c % w;
    const y = (c - x) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      filled[ni] = Math.max(height[ni], fh);
      flowTo[ni] = c;
      heap.push(filled[ni], ni);
    }
  }
  const flow = new Float64Array(n).fill(1);
  for (let k = popped.length - 1; k >= 0; k--) {
    const c = popped[k];
    if (flowTo[c] >= 0) flow[flowTo[c]] += flow[c];
  }

  // 5. Water depth: ocean below the sea, lakes in the filled depressions, rivers on the strongest flows.
  const water = new Uint8Array(n);
  const landFlows: number[] = [];
  for (let i = 0; i < n; i++) if (isLand[i]) landFlows.push(flow[i]);
  landFlows.sort((a, b) => a - b);
  const riverCut = landFlows.length
    ? Math.max(12, landFlows[Math.min(landFlows.length - 1, Math.floor((1 - config.elevationRiverFraction) * landFlows.length))])
    : Infinity;
  for (let i = 0; i < n; i++) {
    if (!isLand[i]) {
      const depth = Math.min(1, Math.max(0.02, (sea - height[i]) / (0.5 * sea)));
      water[i] = Math.max(1, Math.round(depth * 255));
      continue;
    }
    const lake = filled[i] - height[i];
    if (lake >= 0.012) water[i] = Math.round(Math.min(1, 0.08 + lake * 6) * 255);
    else if (flow[i] >= riverCut) water[i] = Math.round(0.06 * 255);
  }

  // 6. Riparian lift: land near water is wetter (4-neighbour distance from any water cell, up to the reach).
  const reach = Math.max(1, Math.floor(config.elevationRiparianReach));
  const dist = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (water[i] > 0) { dist[i] = 0; frontier.push(i); }
  for (let step = 1; step <= reach; step++) {
    const next: number[] = [];
    for (const c of frontier) {
      const x = c % w;
      const y = (c - x) / w;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (dist[ni] < 0) { dist[ni] = step; next.push(ni); }
      }
    }
    frontier = next;
  }
  const riparian = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (water[i] === 0 && dist[i] > 0) riparian[i] = Math.round(255 * (1 - (dist[i] - 1) / reach));

  const elevation = new Uint16Array(n);
  for (let i = 0; i < n; i++) elevation[i] = Math.round(Math.max(0, Math.min(1, height[i])) * ELEVATION_FULL);
  const landHeights: number[] = [];
  for (let i = 0; i < n; i++) if (isLand[i]) landHeights.push(height[i]);
  landHeights.sort((a, b) => a - b);
  const lowland = landHeights.length ? Math.max(0, Math.min(1, landHeights[Math.floor(landHeights.length / 2)])) : sea;
  const continents = labelLand(isLand, w, h);

  // 7. Soil quality: wet ground (near water, and where flow gathers on flat land), thin on steep slopes, poorer when
  // high and cold, with patches of better and worse parent material. Scaled so dry land averages elevationFertilityMean.
  const maxFlow = Math.max(2, ...landFlows);
  const soilNoise = valueNoise(w, h, 7, prng);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (water[i] > 0) continue;
    const x = i % w;
    const y = (i - x) / w;
    const e = height[i];
    let steep = 0;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = Math.max(0, Math.min(w - 1, x + dx));
      const ny = Math.max(0, Math.min(h - 1, y + dy));
      steep = Math.max(steep, Math.abs(height[ny * w + nx] - e));
    }
    const slope = Math.min(1, steep / 0.12);
    const shore = riparian[i] / 255;
    const gather = Math.pow(Math.log(flow[i]) / Math.log(maxFlow), 1.5) * (1 - slope);
    const wet = 0.25 + 0.75 * Math.max(shore, gather);
    const upland = lowland < 1 ? Math.max(0, (e - lowland) / (1 - lowland)) : 0;
    raw[i] = wet * (1 - 0.85 * slope) * (1 - 0.45 * upland) * (0.55 + 0.45 * soilNoise[i]);
  }
  const fmin = config.elevationFertilityMin;
  const meanFor = (k: number): number => {
    let s = 0;
    let c = 0;
    for (let i = 0; i < n; i++) if (water[i] === 0) { s += Math.min(1, fmin + k * raw[i]); c++; }
    return c ? s / c : 0;
  };
  let klo = 0;
  let khi = 100;
  for (let it = 0; it < 40; it++) {
    const mid = (klo + khi) / 2;
    if (meanFor(mid) < config.elevationFertilityMean) klo = mid;
    else khi = mid;
  }
  const fertility = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (water[i] === 0) fertility[i] = Math.round(Math.min(1, fmin + ((klo + khi) / 2) * raw[i]) * 255);
  return new ElevationField(w, h, elevation, water, riparian, sea, plates, lowland, continents.label, continents.sizes, fertility);
}

/** The factor on a move's cost for the slope between two cells: uphill costs more, downhill a little less. */
export function slopeMoveFactor(from: number, to: number, field: ElevationField, config: Readonly<SimulationConfig>): number {
  const d = field.elev01(to) - field.elev01(from);
  return d >= 0 ? 1 + config.elevationSlopeUp * d : Math.max(0.75, 1 + config.elevationSlopeDown * d);
}

/** The factor on a move's cost for wading into shallow water: more for deeper water and a larger footprint. */
export function wadeMoveFactor(index: number, size: number, field: ElevationField, config: Readonly<SimulationConfig>, swim = 0): number {
  const depth = field.depth01(index);
  if (depth <= 0) return 1;
  // A swimmer is buoyant: the wading drag shrinks with swimming.
  return 1 + config.elevationWadeDrag * Math.min(1, depth / Math.max(1e-9, config.elevationDeepThreshold)) * Math.sqrt(size) * (1 - swim);
}

/**
 * What swimming does to the cost of entering a cell: dry land costs a swimmer
 * more (fins and bulk), deep water costs a weak swimmer more. 1 for swim 0.
 */
export function swimMoveFactor(index: number, swim: number, field: ElevationField, config: Readonly<SimulationConfig>): number {
  if (swim <= 0) return 1;
  if (!field.isWater(index)) return 1 + config.swimLandDrag * swim;
  return field.isDeep(index, config) ? 1 + config.swimDeepDrag * (1 - swim) : 1;
}

/** The temperature offset a body feels from its height and from standing in water (added to the weather temperature). */
export function elevationTemperature(index: number, field: ElevationField, config: Readonly<SimulationConfig>): number {
  const wet = field.isWater(index) ? config.elevationWaterChill : 0;
  return -config.elevationLapse * field.upland01(index) - wet;
}
