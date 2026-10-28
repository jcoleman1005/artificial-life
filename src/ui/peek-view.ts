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

export interface SeasonSummary {
  readonly text: string;
  readonly lean: boolean;
  readonly season?: EcologicalSeason;
}

/**
 * World ecological seasons (Spring, Summer, Autumn, Winter) coupled with dynamic
 * weather patterns (Rainstorm, Cold snap, Heatwave, Breezy, Fair), replacing binary
 * 'plenty' / 'lean' announcements with realistic environmental tracking.
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

  const seasonText = `${eco.icon} ${eco.season}`;
  const isStaggered = config.staggeredSeasons && regions.length > 0;

  if (!isStaggered) {
    const suffix = pattern ? ` · ${pattern}` : ` · ${eco.ticksLeft} left`;
    return {
      text: `${seasonText}${suffix}`,
      lean: eco.phase === 'lean',
      season: eco.season,
    };
  }

  const winterRegions = regions.filter(
    (r) => regionEcologicalSeasonAt(tick, r, config)?.season === 'Winter'
  );

  if (winterRegions.length === 0) {
    const suffix = pattern ? ` · ${pattern}` : '';
    return {
      text: `${seasonText}${suffix}`,
      lean: false,
      season: eco.season,
    };
  }

  const names = [...new Set(winterRegions.map((r) => compass(r, config)))];
  const short = (n: string) => (n === 'centre' ? 'C' : n.split('-').map((w) => w[0].toUpperCase()).join(''));
  const tag = names.length === 1 ? `❄️ Winter: ${names[0]}` : `❄️ Winter: ${names.map(short).join(',')}`;
  const text = pattern ? `${seasonText} · ${pattern} (${tag})` : `${seasonText} (${tag})`;

  return {
    text,
    lean: true,
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
    if (this.seasonEl.textContent !== season.text) this.seasonEl.textContent = season.text;
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
