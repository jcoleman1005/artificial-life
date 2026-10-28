import type { FoodRegion, SimulationConfig } from '../sim/types';
import {
  ecologicalSeasonAt,
  regionEcologicalSeasonAt,
  type EcologicalSeason,
} from '../sim/seasons';
import type { ColourGroup } from '../sim/groups';

/** Compass position of any coordinate on the world grid, e.g. "north-west" or "centre". */
export function compassPoint(x: number, y: number, config: SimulationConfig): string {
  const dx = (x + 0.5) / config.gridWidth - 0.5;
  const dy = (y + 0.5) / config.gridHeight - 0.5;
  if (Math.hypot(dx, dy) < 0.15) return 'centre';
  const ns = dy < -0.12 ? 'north' : dy > 0.12 ? 'south' : '';
  const ew = dx < -0.12 ? 'west' : dx > 0.12 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew || 'centre';
}

/** Compass name of a region's place in the world, e.g. "north-west". */
export function compass(region: FoodRegion, config: SimulationConfig): string {
  return compassPoint(region.x, region.y, config);
}

export interface WeatherInfo {
  readonly fronts?: readonly { readonly type: string; readonly intensity?: number; readonly x?: number; readonly y?: number }[];
  readonly wind?: { readonly wx: number; readonly wy: number };
  readonly metrics?: { readonly avgTemp: number; readonly windSpeed: number };
}

/**
 * Concise weather pattern summary with illustrative unicode glyph and spatial map position.
 */
export function weatherPatternDescription(weather?: WeatherInfo | null, config?: SimulationConfig): string | null {
  if (!weather) return null;
  const fronts = weather.fronts ?? [];
  if (fronts.length > 0) {
    const f0 = fronts[0];
    const loc = f0.x !== undefined && f0.y !== undefined && config
      ? (compassPoint(f0.x, f0.y, config) === 'centre' ? 'C' : compassPoint(f0.x, f0.y, config).split('-').map((w) => w[0].toUpperCase()).join(''))
      : null;
    const locTag = loc ? ` (${loc})` : '';

    const rain = fronts.some((f) => f.type === 'rain_storm');
    const cold = fronts.some((f) => f.type === 'cold_front');
    const heat = fronts.some((f) => f.type === 'heat_wave');
    if (rain && cold) return `🌧️ Cold rain${locTag}`;
    if (rain) return `🌧️ Rainstorm${locTag}`;
    if (cold) return `❄️ Cold snap${locTag}`;
    if (heat) return `☀️ Heatwave${locTag}`;
  }
  const speed = weather.wind ? Math.hypot(weather.wind.wx, weather.wind.wy) : weather.metrics?.windSpeed ?? 0;
  if (speed >= 0.45) return '💨 Gale';
  if (speed >= 0.22) return '🍃 Breezy';
  const temp = weather.metrics?.avgTemp ?? 0;
  if (temp <= -0.35) return '❄️ Crisp';
  if (temp >= 0.35) return '☀️ Warm';
  return '🌤️ Fair';
}

export type QuadrantId = 'NW' | 'NE' | 'SE' | 'SW';

export interface QuadrantSeason {
  readonly id: QuadrantId;
  readonly season: EcologicalSeason;
  readonly icon: string;
  readonly phase: 'plenty' | 'lean';
}

const QUADRANT_CENTRES: readonly { readonly id: QuadrantId; readonly qx: number; readonly qy: number }[] = [
  { id: 'NW', qx: 0.25, qy: 0.25 },
  { id: 'NE', qx: 0.75, qy: 0.25 },
  { id: 'SE', qx: 0.75, qy: 0.75 },
  { id: 'SW', qx: 0.25, qy: 0.75 },
];

const QUADRANT_PERMUTATIONS: readonly (readonly number[])[] = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 2, 3, 1], [0, 3, 1, 2], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [1, 2, 0, 3], [1, 2, 3, 0], [1, 3, 0, 2], [1, 3, 2, 0],
  [2, 0, 1, 3], [2, 0, 3, 1], [2, 1, 0, 3], [2, 1, 3, 0], [2, 3, 0, 1], [2, 3, 1, 0],
  [3, 0, 1, 2], [3, 0, 2, 1], [3, 1, 0, 2], [3, 1, 2, 0], [3, 2, 0, 1], [3, 2, 1, 0],
];

/**
 * Calculates the ecological season for each of the four quadrants (NW, NE, SE, SW).
 * When staggered seasons are active, assigns regional clocks to their corresponding quadrant.
 */
export function quadrantSeasons(
  tick: number,
  regions: readonly FoodRegion[],
  config: SimulationConfig
): readonly QuadrantSeason[] {
  const globalEco = ecologicalSeasonAt(tick, config);
  if (!globalEco) {
    return QUADRANT_CENTRES.map((q) => ({
      id: q.id,
      season: 'Spring' as EcologicalSeason,
      icon: '🌱',
      phase: 'plenty' as const,
    }));
  }

  const isStaggered = config.staggeredSeasons && regions.length > 0;
  if (!isStaggered) {
    return QUADRANT_CENTRES.map((q) => ({
      id: q.id,
      season: globalEco.season,
      icon: globalEco.icon,
      phase: globalEco.phase,
    }));
  }

  const w = config.gridWidth;
  const h = config.gridHeight;

  // 1-to-1 optimal bipartite matching when there are exactly 4 regions
  if (regions.length === 4) {
    let bestPerm = QUADRANT_PERMUTATIONS[0];
    let bestDist = Infinity;
    for (const p of QUADRANT_PERMUTATIONS) {
      let dist = 0;
      for (let i = 0; i < 4; i++) {
        const reg = regions[p[i]];
        const q = QUADRANT_CENTRES[i];
        dist += Math.hypot(reg.x - q.qx * w, reg.y - q.qy * h);
      }
      if (dist < bestDist) {
        bestDist = dist;
        bestPerm = p;
      }
    }
    return QUADRANT_CENTRES.map((q, i) => {
      const reg = regions[bestPerm[i]];
      const eco = regionEcologicalSeasonAt(tick, reg, config) ?? globalEco;
      return {
        id: q.id,
        season: eco.season,
        icon: eco.icon,
        phase: eco.phase,
      };
    });
  }

  // Fallback for non-4 region counts: match each quadrant to closest region
  return QUADRANT_CENTRES.map((q) => {
    let bestReg = regions[0];
    let bestDist = Infinity;
    for (const reg of regions) {
      const d = Math.hypot(reg.x - q.qx * w, reg.y - q.qy * h);
      if (d < bestDist) {
        bestDist = d;
        bestReg = reg;
      }
    }
    const eco = regionEcologicalSeasonAt(tick, bestReg, config) ?? globalEco;
    return {
      id: q.id,
      season: eco.season,
      icon: eco.icon,
      phase: eco.phase,
    };
  });
}

export interface SeasonSummary {
  readonly text: string;
  readonly lean: boolean;
  readonly season?: EcologicalSeason;
}

/**
 * World ecological seasons formatted across the four map quadrants:
 * NW:[season] NE:[season] SE:[season] SW:[season]
 * coupled with dynamic atmospheric weather pattern summaries.
 */
export function seasonSummary(
  tick: number,
  regions: readonly FoodRegion[],
  config: SimulationConfig,
  weather?: WeatherInfo | null
): SeasonSummary {
  const eco = ecologicalSeasonAt(tick, config);
  const pattern = weatherPatternDescription(weather, config);

  if (!eco) {
    return {
      text: pattern ? `🌤️ ${pattern}` : 'Temperate',
      lean: false,
    };
  }

  const qs = quadrantSeasons(tick, regions, config);
  const seasonsText = qs.map((q) => `${q.id}: ${q.season}`).join(' ');
  const text = pattern ? `${seasonsText} · ${pattern}` : seasonsText;
  const anyLean = qs.some((q) => q.phase === 'lean');

  return {
    text,
    lean: anyLean,
    season: eco.season,
  };
}

const MAX_STRIP_GROUPS = 8;

/** The always-visible numbers in the sheet's peek strip. */
export class PeekView {
  private readonly popEl: HTMLElement;
  private readonly seasonEl: HTMLElement;
  private readonly stripEl: HTMLElement;
  private lastStrip = '';

  constructor(container: HTMLElement) {
    this.popEl = container.querySelector('.peek-pop')!;
    this.seasonEl = container.querySelector('.peek-season')!;
    this.stripEl = container.querySelector('.group-strip')!;
  }

  public render(population: number, season: SeasonSummary, groups: readonly ColourGroup[]): void {
    const pop = population === 0 ? 'Extinct' : `${population} alive`;
    if (this.popEl.textContent !== pop) this.popEl.textContent = pop;
    if (this.seasonEl.textContent !== season.text) {
      this.seasonEl.textContent = season.text;
      this.seasonEl.title = season.text;
    }
    this.seasonEl.classList.toggle('lean', season.lean);
    this.seasonEl.classList.toggle('spring', season.season === 'Spring');
    this.seasonEl.classList.toggle('summer', season.season === 'Summer');
    this.seasonEl.classList.toggle('autumn', season.season === 'Autumn');
    this.seasonEl.classList.toggle('winter', season.season === 'Winter');

    const shown = groups.slice(0, MAX_STRIP_GROUPS);
    const rest = groups.slice(MAX_STRIP_GROUPS).reduce((n, g) => n + g.count, 0);
    const html =
      shown
        .map((g) => `<span style="flex-grow:${g.count};background:hsl(${Math.round(g.hue)},80%,62%)" title="${g.name}: ${g.count}"></span>`)
        .join('') + (rest > 0 ? `<span class="other" style="flex-grow:${rest}" title="Others: ${rest}"></span>` : '');
    if (html !== this.lastStrip) {
      this.stripEl.innerHTML = html;
      this.lastStrip = html;
      this.stripEl.setAttribute(
        'aria-label',
        groups.length === 0 ? 'No colour groups' : `Colour groups: ${shown.map((g) => `${g.name} ${g.count}`).join(', ')}`
      );
    }
  }
}

/** The colour-group table for the Stats tab. */
export function groupsTableHTML(groups: readonly ColourGroup[], population: number): string {
  if (groups.length === 0) return '<p class="muted">Nobody is alive.</p>';
  return `
    <ul class="group-list">
      ${groups
        .map(
          (g) => `
        <li>
          <span class="group-swatch" style="background:hsl(${Math.round(g.hue)},80%,62%)"></span>
          <span class="group-name">${g.name}</span>
          <span class="group-bar"><span style="width:${(g.count / population) * 100}%;background:hsl(${Math.round(g.hue)},80%,62%)"></span></span>
          <span class="group-count">${g.count}</span>
        </li>`
        )
        .join('')}
    </ul>`;
}
