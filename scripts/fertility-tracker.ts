import type { World } from '../src/sim/world';

/**
 * Measurements for the dynamic fertility field (docs/decisions.md, "Dynamic fertility"): did the fertile ground
 * move, and did it cost the animals? Sampled every 50 ticks. "Disc" means the original fertile discs.
 */
export class FertilityTracker {
  private readonly w: number;
  private readonly base: Float32Array;
  private readonly floor: number;
  private readonly startMask: boolean[];
  private readonly startCentroid: [number, number];
  private plantStart: [number, number] | null = null;
  private plantLast: [number, number] | null = null;
  private plants = 0;
  private plantsOutside = 0;
  private biomass = 0;
  private biomassOutside = 0;
  private orgSamples = 0;
  private orgOnFertile = 0;
  private readonly series: { at: number; inside: number; outside: number }[] = [];
  private nextMark = 1;

  constructor(world: World, private readonly ticks: number) {
    const soil = world.soil();
    this.w = world.config.gridWidth;
    this.base = soil.baseFertility.slice();
    this.floor = world.config.marginFertility;
    this.startMask = Array.from(this.base, (b) => b >= 0.6);
    this.startCentroid = this.centroid(soil.fertility, (f) => f - this.floor);
  }

  private centroid(values: ArrayLike<number>, weight: (v: number) => number): [number, number] {
    let sx = 0;
    let sy = 0;
    let m = 0;
    for (let i = 0; i < this.base.length; i++) {
      if (this.base[i] <= 0) continue;
      const v = weight(values[i]);
      sx += v * (i % this.w);
      sy += v * Math.floor(i / this.w);
      m += v;
    }
    return m > 0 ? [sx / m, sy / m] : [0, 0];
  }

  private means(world: World): { inside: number; outside: number } {
    const f = world.soil().fertility;
    let inS = 0, inN = 0, outS = 0, outN = 0;
    for (let i = 0; i < this.base.length; i++) {
      if (this.base[i] <= 0) continue;
      if (this.base[i] >= 1) { inS += f[i]; inN++; } else { outS += f[i]; outN++; }
    }
    return { inside: inN ? inS / inN : 0, outside: outN ? outS / outN : 0 };
  }

  observe(world: World, t: number): void {
    if (t % 50 !== 0) return;
    const f = world.soil().fertility;
    let sx = 0, sy = 0, m = 0;
    for (const p of world.foodPatches.values()) {
      if (!p.plant) continue;
      const i = p.y * this.w + p.x;
      this.plants++;
      this.biomass += p.plant.biomass;
      if (this.base[i] < 1) { this.plantsOutside++; this.biomassOutside += p.plant.biomass; }
      sx += p.plant.biomass * p.x;
      sy += p.plant.biomass * p.y;
      m += p.plant.biomass;
    }
    if (m > 0) {
      this.plantLast = [sx / m, sy / m];
      this.plantStart ??= this.plantLast;
    }
    for (const o of world.organisms.values()) {
      this.orgSamples++;
      if (f[o.y * this.w + o.x] >= 0.6) this.orgOnFertile++;
    }
    while (this.nextMark <= 4 && t >= (this.ticks * this.nextMark) / 4) {
      const mean = this.means(world);
      this.series.push({ at: this.nextMark * 25, ...mean });
      this.nextMark++;
    }
  }

  results(world: World): Record<string, number> {
    const f = world.soil().fertility;
    let nowFertile = 0, startFertile = 0, both = 0, discCells = 0, discWorn = 0, marginCells = 0, marginRaised = 0;
    for (let i = 0; i < this.base.length; i++) {
      if (this.base[i] <= 0) continue;
      const now = f[i] >= 0.6;
      if (now) nowFertile++;
      if (this.startMask[i]) startFertile++;
      if (now && this.startMask[i]) both++;
      if (this.base[i] >= 1) { discCells++; if (f[i] < 0.8) discWorn++; }
      else { marginCells++; if (f[i] > this.floor + 0.05) marginRaised++; }
    }
    const c = this.centroid(f, (v) => v - this.floor);
    const mean = this.means(world);
    const out: Record<string, number> = {
      'plantsOutsideDisc%': (100 * this.plantsOutside) / Math.max(1, this.plants),
      'plantBiomassOutsideDisc%': (100 * this.biomassOutside) / Math.max(1e-9, this.biomass),
      fertilityCentroidShift: Math.hypot(c[0] - this.startCentroid[0], c[1] - this.startCentroid[1]),
      meanFertInsideDiscs: mean.inside,
      meanFertOutsideDiscs: mean.outside,
      'fertileCells>=0.6': nowFertile,
      'zoneOverlap%': (100 * both) / Math.max(1, nowFertile + startFertile - both),
      'onFertile%': (100 * this.orgOnFertile) / Math.max(1, this.orgSamples),
      'discWorn%': (100 * discWorn) / Math.max(1, discCells),
      'marginRaised%': (100 * marginRaised) / Math.max(1, marginCells),
    };
    if (this.plantStart && this.plantLast) out.plantCentroidShift = Math.hypot(this.plantLast[0] - this.plantStart[0], this.plantLast[1] - this.plantStart[1]);
    for (const s of this.series) {
      out[`fertInside@${s.at}%`] = s.inside;
      out[`fertOutside@${s.at}%`] = s.outside;
    }
    return out;
  }
}
