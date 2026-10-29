import { PRNG } from './prng';
import type { SimulationConfig } from './types';

/**
 * Terrain fields (docs/decisions.md, "Terrain fields"). Two per-cell values from smooth seeded
 * noise, made once per world and static for the run:
 *
 * - roughness: raises the cost of entering the cell (scaled by the mover's footprint, √size);
 * - cover: shelter, which cuts the temperature a body feels and its exposure to rain and wind.
 *
 * Each is a byte (0..255 meaning 0..1) so a lookup is one array read. Walls stay as they are
 * (`World.obstacles`); terrain is independent of them and of the food regions, so habitat and
 * food can differ. The noise comes from its own random stream, derived from the world's seed, so
 * making it draws nothing from the simulation's stream.
 */

export interface TerrainState {
  readonly width: number;
  readonly height: number;
  readonly roughness: readonly number[];
  readonly cover: readonly number[];
}

export class TerrainField {
  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly roughness: Uint8Array,
    public readonly cover: Uint8Array
  ) {}

  /** Roughness of a cell in 0..1 (0 off the grid). */
  public roughnessAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.roughness[y * this.width + x] / 255;
  }

  /** Cover of a cell in 0..1 (0 off the grid). */
  public coverAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cover[y * this.width + x] / 255;
  }

  public exportState(): TerrainState {
    return { width: this.width, height: this.height, roughness: Array.from(this.roughness), cover: Array.from(this.cover) };
  }

  public static fromState(state: TerrainState): TerrainField {
    return new TerrainField(state.width, state.height, Uint8Array.from(state.roughness), Uint8Array.from(state.cover));
  }
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** One field of smooth value noise in 0..1: random values on a coarse lattice, blended with a smoothstep. */
function valueNoise(width: number, height: number, scale: number, prng: PRNG): Float64Array {
  const cols = Math.ceil(width / scale) + 2;
  const rows = Math.ceil(height / scale) + 2;
  const lattice = new Float64Array(cols * rows);
  for (let i = 0; i < lattice.length; i++) lattice[i] = prng.next();
  const out = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = y / scale;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    for (let x = 0; x < width; x++) {
      const fx = x / scale;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const a = lattice[y0 * cols + x0];
      const b = lattice[y0 * cols + x0 + 1];
      const c = lattice[(y0 + 1) * cols + x0];
      const d = lattice[(y0 + 1) * cols + x0 + 1];
      out[y * width + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Noise in 0..1 mapped so cells below `threshold` are 0 (open ground) and the rest rise to 1, as bytes. */
function toBytes(noise: Float64Array, threshold: number): Uint8Array {
  const bytes = new Uint8Array(noise.length);
  const span = Math.max(1e-9, 1 - threshold);
  for (let i = 0; i < noise.length; i++) {
    const v = Math.max(0, Math.min(1, (noise[i] - threshold) / span));
    bytes[i] = Math.round(v * 255);
  }
  return bytes;
}

/** The terrain for a world: roughness then cover, from a stream of their own. */
export function generateTerrain(config: Readonly<SimulationConfig>): TerrainField {
  const { gridWidth: width, gridHeight: height } = config;
  const prng = new PRNG(`terrain:${String(config.seed)}`);
  const scale = Math.max(2, config.terrainScale);
  const roughness = toBytes(valueNoise(width, height, scale, prng), config.terrainThreshold);
  const cover = toBytes(valueNoise(width, height, scale, prng), config.terrainThreshold);
  return new TerrainField(width, height, roughness, cover);
}

/**
 * The factor on a move's cost for entering a cell: 1 on open ground, up to 1 + terrainRoughnessCoeff
 * for a size-1 body on the roughest cell; a larger footprint (√size) feels it more.
 */
export function roughnessMoveFactor(roughness01: number, size: number, config: Readonly<SimulationConfig>): number {
  return 1 + config.terrainRoughnessCoeff * roughness01 * Math.sqrt(size);
}

/** The share of weather exposure that gets through cover: 1 in the open, down to 1 − terrainCoverShelter. */
export function coverExposure(cover01: number, config: Readonly<SimulationConfig>): number {
  return 1 - config.terrainCoverShelter * cover01;
}
