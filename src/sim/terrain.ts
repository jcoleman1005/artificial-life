import { PRNG } from './prng';
import type { SimulationConfig } from './types';

/**
 * Terrain fields (docs/decisions.md, "Terrain fields"). Two per-cell values from smooth seeded
 * noise, made once per world and static for the run:
 *
 * - roughness: raises the cost of entering the cell (scaled by the mover's footprint, √size);
 * - cover: shelter, which cuts the temperature a body feels and its exposure to rain and wind.
 *
 * Each is a 16-bit fixed-point value (0..65535 meaning 0..1) so a lookup is one array read. Walls stay as they are
 * (`World.obstacles`); terrain is independent of them and of the food regions, so habitat and
 * food can differ. Bodies wear it (see TerrainField) and worn ground recovers toward the original. The noise comes from its own random stream, derived from the world's seed, so
 * making it draws nothing from the simulation's stream.
 */

/** Cell values are 16-bit fixed point, 0..FULL meaning 0..1: wear steps are smaller than a byte. */
export const TERRAIN_FULL = 65535;

export interface TerrainState {
  readonly width: number;
  readonly height: number;
  /** 2: values 0..65535. Absent (older saves): bytes 0..255. */
  readonly format?: 2;
  readonly roughness: readonly number[];
  readonly cover: readonly number[];
  /** The terrain before any wear, for a page that shows what has worn (sent once with the static data; never saved). */
  readonly original?: { readonly roughness: readonly number[]; readonly cover: readonly number[] };
}

/**
 * The terrain now and the terrain it came from. Bodies wear the current fields (trampling lowers
 * roughness and cover, grazing lowers cover) and worn cells drift back toward the original, which
 * is regenerated from the seed and so is never saved. `dirty` lists the cells that differ from it,
 * so wear and recovery cost nothing where nothing has happened.
 */
export class TerrainField {
  /** Bumped whenever a value changes; lets the host send the page an update only when needed. Not saved. */
  public version = 0;
  private readonly dirty = new Set<number>();

  constructor(
    public readonly width: number,
    public readonly height: number,
    public readonly roughness: Uint16Array,
    public readonly cover: Uint16Array,
    private readonly baseRoughness: Uint16Array,
    private readonly baseCover: Uint16Array
  ) {
    for (let i = 0; i < roughness.length; i++) if (roughness[i] !== baseRoughness[i] || cover[i] !== baseCover[i]) this.dirty.add(i);
  }

  /** Roughness of a cell in 0..1 (0 off the grid). */
  public roughnessAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.roughness[y * this.width + x] / TERRAIN_FULL;
  }

  /** Cover of a cell in 0..1 (0 off the grid). */
  public coverAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
    return this.cover[y * this.width + x] / TERRAIN_FULL;
  }

  /** How many cells are worn (differ from the original). */
  public wornCells(): number {
    return this.dirty.size;
  }

  /** A body of `size` entered a cell: roughness and cover wear down, more for a bigger footprint (√size). */
  public trample(index: number, size: number, config: Readonly<SimulationConfig>): void {
    const weight = Math.sqrt(size);
    this.wear(index, config.terrainTrampleRoughness * weight, config.terrainTrampleCover * weight);
  }

  /** A plant bite at a cell: its cover wears down. */
  public graze(index: number, config: Readonly<SimulationConfig>): void {
    this.wear(index, 0, config.terrainGrazeCover);
  }

  private wear(index: number, roughnessShare: number, coverShare: number): void {
    const r = this.roughness[index];
    const c = this.cover[index];
    const nr = roughnessShare > 0 ? Math.round(r * (1 - Math.min(1, roughnessShare))) : r;
    const nc = coverShare > 0 ? Math.round(c * (1 - Math.min(1, coverShare))) : c;
    if (nr === r && nc === c) return;
    this.roughness[index] = nr;
    this.cover[index] = nc;
    this.dirty.add(index);
    this.version++;
  }

  /**
   * Worn cells drift back toward the original: each step closes `1 − (1 − terrainRecoveryRate)^ticks` of the
   * gap (ticks since the last step), and a cell within a hair of the original snaps back and is no longer worn.
   */
  public recover(ticks: number, config: Readonly<SimulationConfig>): void {
    if (this.dirty.size === 0) return;
    const share = 1 - Math.pow(1 - Math.min(1, config.terrainRecoveryRate), ticks);
    for (const i of this.dirty) {
      const r = this.roughness[i];
      const c = this.cover[i];
      const br = this.baseRoughness[i];
      const bc = this.baseCover[i];
      let nr = r + recoveryStep(br - r, share);
      let nc = c + recoveryStep(bc - c, share);
      if (Math.abs(br - nr) < 3) nr = br;
      if (Math.abs(bc - nc) < 3) nc = bc;
      this.roughness[i] = nr;
      this.cover[i] = nc;
      if (nr === br && nc === bc) this.dirty.delete(i);
    }
    this.version++;
  }

  /** The current fields only (saves); the original is regenerated from the seed. With `withOriginal`, the original too (for the page). */
  public exportState(withOriginal = false): TerrainState {
    return {
      width: this.width,
      height: this.height,
      format: 2,
      roughness: Array.from(this.roughness),
      cover: Array.from(this.cover),
      ...(withOriginal ? { original: { roughness: Array.from(this.baseRoughness), cover: Array.from(this.baseCover) } } : {}),
    };
  }

  /** How worn a cell is, 0 (as first made) to 1 (all of its roughness and cover gone): the larger of the two losses, each as a share of the original. */
  public wear01(index: number): number {
    const br = this.baseRoughness[index];
    const bc = this.baseCover[index];
    const lr = br > 0 ? (br - this.roughness[index]) / br : 0;
    const lc = bc > 0 ? (bc - this.cover[index]) / bc : 0;
    return Math.max(0, Math.min(1, Math.max(lr, lc)));
  }

  /** Current fields from a saved state, with the original regenerated from the world's seed. */
  public static fromState(state: TerrainState, config: Readonly<SimulationConfig>): TerrainField {
    const scale = state.format === 2 ? 1 : 257; // older saves held bytes
    const original = generateTerrain({ ...config, gridWidth: state.width, gridHeight: state.height });
    return new TerrainField(
      state.width,
      state.height,
      Uint16Array.from(state.roughness, (v) => v * scale),
      Uint16Array.from(state.cover, (v) => v * scale),
      original.baseRoughness,
      original.baseCover
    );
  }

  /** The current fields for a page that only draws them (no original kept, so no recovery to run). */
  public static forView(state: TerrainState, original?: { readonly roughness: Uint16Array; readonly cover: Uint16Array }): TerrainField {
    const scale = state.format === 2 ? 1 : 257;
    const roughness = Uint16Array.from(state.roughness, (v) => v * scale);
    const cover = Uint16Array.from(state.cover, (v) => v * scale);
    const given = state.original;
    const baseRoughness = given ? Uint16Array.from(given.roughness, (v) => v * scale) : (original?.roughness ?? roughness.slice());
    const baseCover = given ? Uint16Array.from(given.cover, (v) => v * scale) : (original?.cover ?? cover.slice());
    return new TerrainField(state.width, state.height, roughness, cover, baseRoughness, baseCover);
  }

  /** The original fields, so a page can keep them across updates that carry only the current ones. */
  public originalFields(): { readonly roughness: Uint16Array; readonly cover: Uint16Array } {
    return { roughness: this.baseRoughness, cover: this.baseCover };
  }

  /** Fresh terrain: the original, with a separate copy as the current. */
  public static fresh(width: number, height: number, roughness: Uint16Array, cover: Uint16Array): TerrainField {
    return new TerrainField(width, height, roughness.slice(), cover.slice(), roughness, cover);
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

/** One recovery step across a gap: the share of it, but at least one unit, so a cell near its original cannot stall short. */
function recoveryStep(gap: number, share: number): number {
  const step = Math.round(gap * share);
  return step === 0 ? Math.sign(gap) : step;
}

/** Noise in 0..1 mapped so cells below `threshold` are 0 (open ground) and the rest rise to 1, as fixed point. */
function toFixed(noise: Float64Array, threshold: number): Uint16Array {
  const out = new Uint16Array(noise.length);
  const span = Math.max(1e-9, 1 - threshold);
  for (let i = 0; i < noise.length; i++) {
    const v = Math.max(0, Math.min(1, (noise[i] - threshold) / span));
    out[i] = Math.round(v * TERRAIN_FULL);
  }
  return out;
}

/** The terrain for a world: roughness then cover, from a stream of their own. */
export function generateTerrain(config: Readonly<SimulationConfig>): TerrainField {
  const { gridWidth: width, gridHeight: height } = config;
  const prng = new PRNG(`terrain:${String(config.seed)}`);
  const scale = Math.max(2, config.terrainScale);
  const roughness = toFixed(valueNoise(width, height, scale, prng), config.terrainThreshold);
  const cover = toFixed(valueNoise(width, height, scale, prng), config.terrainThreshold);
  return TerrainField.fresh(width, height, roughness, cover);
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
