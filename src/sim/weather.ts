import type { PRNG } from './prng';
import type {
  SimulationConfig,
  WeatherFront,
  WeatherFrontType,
  WeatherMetrics,
  WeatherSnapshot,
} from './types';

export interface WeatherExportState {
  readonly fronts: readonly WeatherFront[];
  readonly wind: { readonly wx: number; readonly wy: number };
  readonly moisture: readonly number[]; // Compact array of non-zero [index, value] or packed
  readonly nextFrontId: number;
}

/**
 * Analytical multi-front weather simulation for the 60x60 grid.
 * Governs dynamic temperature, moving rainstorms, soil moisture, and prevailing wind.
 */
export class WeatherSimulation {
  public fronts: WeatherFront[] = [];
  public wind: { wx: number; wy: number } = { wx: 0.3, wy: 0.1 };
  public readonly moisture: Uint8Array;
  public nextFrontId = 1;
  private readonly width: number;
  private readonly height: number;

  constructor(
    width: number,
    height: number,
    fronts: WeatherFront[] = [],
    wind = { wx: 0.3, wy: 0.1 },
    moisture?: Uint8Array,
    nextFrontId = 1
  ) {
    this.width = width;
    this.height = height;
    this.fronts = fronts;
    this.wind = wind;
    this.moisture = moisture ?? new Uint8Array(width * height).fill(128);
    this.nextFrontId = nextFrontId;
  }

  /**
   * Advances the weather simulation by one tick using seeded PRNG.
   * Deterministic: only called when weatherEnabled is true.
   */
  public step(tick: number, prng: PRNG, config: Readonly<SimulationConfig>, season: 'plenty' | 'lean' | null): void {
    // 1. Prevailing wind drift (smooth pseudo-walk every 50 ticks)
    if (tick % 50 === 0) {
      let angle = Math.atan2(this.wind.wy, this.wind.wx);
      angle += prng.nextGaussian(0, 0.15); // gentle angular drift
      const speed = Math.max(0.15, Math.min(0.7, Math.hypot(this.wind.wx, this.wind.wy) + prng.nextGaussian(0, 0.05)));
      this.wind = {
        wx: Number((Math.cos(angle) * speed).toFixed(3)),
        wy: Number((Math.sin(angle) * speed).toFixed(3)),
      };
    }

    // 2. Advance active weather fronts
    const surviving: WeatherFront[] = [];
    for (const f of this.fronts) {
      f.x += f.vx;
      f.y += f.vy;
      f.lifetime--;

      // Check bounds: keep if still alive and within proximity of grid
      const margin = f.radius + 5;
      if (
        f.lifetime > 0 &&
        f.x >= -margin &&
        f.x <= this.width + margin &&
        f.y >= -margin &&
        f.y <= this.height + margin
      ) {
        surviving.push(f);
      }
    }
    this.fronts = surviving;

    // 3. Spawn new fronts if below capacity
    if (
      this.fronts.length < config.weatherMaxFronts &&
      prng.next() < 1 / Math.max(1, config.weatherSpawnInterval)
    ) {
      this.spawnFront(prng, season);
    }

    // 4. Precipitate rain into soil moisture grid
    for (const f of this.fronts) {
      if (f.type !== 'rain_storm') continue;
      const minX = Math.max(0, Math.floor(f.x - f.radius));
      const maxX = Math.min(this.width - 1, Math.ceil(f.x + f.radius));
      const minY = Math.max(0, Math.floor(f.y - f.radius));
      const maxY = Math.min(this.height - 1, Math.ceil(f.y + f.radius));
      const r2 = f.radius * f.radius;

      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          const dx = cx - f.x;
          const dy = cy - f.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2) {
            const d = Math.sqrt(d2);
            const intensity = f.intensity * (1 - d / f.radius);
            const cellIdx = cy * this.width + cx;
            const inc = Math.round(intensity * config.weatherAbsorptionRate * 255);
            this.moisture[cellIdx] = Math.min(255, this.moisture[cellIdx] + inc);
          }
        }
      }
    }

    // 5. Evaporate soil moisture toward baseline (128)
    if (tick % 5 === 0) {
      const evap = Math.max(1, Math.round(config.weatherEvapRate * 5 * 255));
      for (let i = 0; i < this.moisture.length; i++) {
        if (this.moisture[i] > 128) {
          this.moisture[i] = Math.max(128, this.moisture[i] - evap);
        } else if (this.moisture[i] < 128) {
          this.moisture[i] = Math.min(128, this.moisture[i] + 1);
        }
      }
    }
  }

  private spawnFront(prng: PRNG, season: 'plenty' | 'lean' | null): void {
    const edge = prng.nextInt(0, 3); // 0=North, 1=South, 2=East, 3=West
    let x = 0;
    let y = 0;
    const r = prng.nextFloat(10, 18);

    if (edge === 0) {
      x = prng.nextFloat(0, this.width);
      y = -r + 1;
    } else if (edge === 1) {
      x = prng.nextFloat(0, this.width);
      y = this.height + r - 1;
    } else if (edge === 2) {
      x = this.width + r - 1;
      y = prng.nextFloat(0, this.height);
    } else {
      x = -r + 1;
      y = prng.nextFloat(0, this.height);
    }

    // Aim toward center region
    const targetX = prng.nextFloat(this.width * 0.25, this.width * 0.75);
    const targetY = prng.nextFloat(this.height * 0.25, this.height * 0.75);
    const angle = Math.atan2(targetY - y, targetX - x);
    const speed = prng.nextFloat(0.15, 0.35);

    // Front type distribution influenced by season
    const roll = prng.next();
    let type: WeatherFrontType = 'rain_storm';
    if (season === 'lean') {
      if (roll < 0.5) type = 'cold_front';
      else if (roll < 0.8) type = 'rain_storm';
      else type = 'heat_wave';
    } else {
      if (roll < 0.5) type = 'rain_storm';
      else if (roll < 0.8) type = 'heat_wave';
      else type = 'cold_front';
    }

    this.fronts.push({
      id: this.nextFrontId++,
      type,
      x: Number(x.toFixed(2)),
      y: Number(y.toFixed(2)),
      vx: Number((Math.cos(angle) * speed).toFixed(3)),
      vy: Number((Math.sin(angle) * speed).toFixed(3)),
      radius: Number(r.toFixed(1)),
      intensity: Number(prng.nextFloat(0.6, 1.0).toFixed(2)),
      lifetime: Math.round(prng.nextFloat(180, 350)),
    });
  }

  /**
   * Local temperature at (x, y) in [-1.0, 1.0].
   */
  public getTemperature(x: number, y: number, season: 'plenty' | 'lean' | null): number {
    let t = season === 'lean' ? -0.1 : 0.1;
    for (const f of this.fronts) {
      const dx = x - f.x;
      const dy = y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= f.radius * f.radius) {
        const inf = f.intensity * (1 - Math.sqrt(d2) / f.radius);
        if (f.type === 'cold_front') t -= 0.8 * inf;
        else if (f.type === 'heat_wave') t += 0.8 * inf;
        else if (f.type === 'rain_storm') t -= 0.2 * inf;
      }
    }
    return Math.max(-1.0, Math.min(1.0, t));
  }

  /**
   * Local precipitation / rain at (x, y) in [0.0, 1.0].
   */
  public getRain(x: number, y: number): number {
    let rain = 0;
    for (const f of this.fronts) {
      if (f.type !== 'rain_storm') continue;
      const dx = x - f.x;
      const dy = y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= f.radius * f.radius) {
        const inf = f.intensity * (1 - Math.sqrt(d2) / f.radius);
        if (inf > rain) rain = inf;
      }
    }
    return Math.max(0.0, Math.min(1.0, rain));
  }

  /**
   * Local soil moisture at (x, y) in [0.0, 1.0].
   */
  public getSoilMoisture(x: number, y: number): number {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return 0;
    return this.moisture[y * this.width + x] / 255.0;
  }

  /**
   * Local wind vector at (x, y). Combines prevailing macro wind with front perturbations.
   */
  public getWind(x: number, y: number): { wx: number; wy: number } {
    let wx = this.wind.wx;
    let wy = this.wind.wy;
    for (const f of this.fronts) {
      const dx = x - f.x;
      const dy = y - f.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= f.radius * f.radius) {
        const dist = Math.sqrt(d2);
        const inf = f.intensity * (1 - dist / f.radius);
        // Tangential circulation around storm center
        if (dist > 0.1) {
          wx += (-dy / dist) * 0.2 * inf;
          wy += (dx / dist) * 0.2 * inf;
        }
      }
    }
    const speed = Math.hypot(wx, wy);
    if (speed > 1.0) {
      wx /= speed;
      wy /= speed;
    }
    return { wx, wy };
  }

  public getMetrics(season: 'plenty' | 'lean' | null): WeatherMetrics {
    const centerT = this.getTemperature(this.width / 2, this.height / 2, season);
    const speed = Math.hypot(this.wind.wx, this.wind.wy);
    const angle = Math.round((Math.atan2(this.wind.wy, this.wind.wx) * 180) / Math.PI);
    return {
      frontCount: this.fronts.length,
      avgTemp: Number(centerT.toFixed(2)),
      windSpeed: Number(speed.toFixed(2)),
      windAngle: (angle + 360) % 360,
    };
  }

  public getSnapshot(): WeatherSnapshot {
    return {
      fronts: this.fronts.map((f) => ({ ...f })),
      wind: { ...this.wind },
      moistureGrid: this.moisture.slice(),
    };
  }

  public exportState(): WeatherExportState {
    const moisturePairs: number[] = [];
    for (let i = 0; i < this.moisture.length; i++) {
      if (this.moisture[i] > 0) {
        moisturePairs.push(i, this.moisture[i]);
      }
    }
    return {
      fronts: this.fronts.map((f) => ({ ...f })),
      wind: { ...this.wind },
      moisture: moisturePairs,
      nextFrontId: this.nextFrontId,
    };
  }

  public static fromState(state: WeatherExportState, width: number, height: number): WeatherSimulation {
    const moisture = new Uint8Array(width * height);
    if (state.moisture) {
      for (let i = 0; i < state.moisture.length; i += 2) {
        const idx = state.moisture[i];
        const val = state.moisture[i + 1];
        if (idx < moisture.length) moisture[idx] = val;
      }
    }
    return new WeatherSimulation(
      width,
      height,
      state.fronts.map((f) => ({ ...f })),
      { ...state.wind },
      moisture,
      state.nextFrontId
    );
  }
}
