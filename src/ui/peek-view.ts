import type { FoodRegion, SimulationConfig } from '../sim/types';
import { regionSeasonAt, seasonAt } from '../sim/seasons';
import type { ColourGroup } from './groups';

/** Compass name of a region's place in the world, e.g. "north-west". */
function compass(region: FoodRegion, config: SimulationConfig): string {
  const dx = (region.x + 0.5) / config.gridWidth - 0.5;
  const dy = (region.y + 0.5) / config.gridHeight - 0.5;
  if (Math.hypot(dx, dy) < 0.12) return 'centre';
  const ns = dy < -0.12 ? 'north' : dy > 0.12 ? 'south' : '';
  const ew = dx < -0.12 ? 'west' : dx > 0.12 ? 'east' : '';
  return ns && ew ? `${ns}-${ew}` : ns || ew;
}

export interface SeasonSummary {
  readonly text: string;
  readonly lean: boolean;
}

/** The world season, or which regions are lean when seasons are staggered. */
export function seasonSummary(tick: number, regions: readonly FoodRegion[], config: SimulationConfig): SeasonSummary {
  const season = seasonAt(tick, config);
  if (!season) return { text: 'No seasons', lean: false };
  if (!(config.staggeredSeasons && regions.length > 0)) {
    const lean = season.season === 'lean';
    return { text: `${lean ? 'Lean' : 'Plenty'} · ${season.ticksLeft} left`, lean };
  }
  const leanRegions = regions.filter((r) => regionSeasonAt(tick, r, config)?.season === 'lean');
  if (leanRegions.length === 0) return { text: 'Plenty everywhere', lean: false };
  const names = [...new Set(leanRegions.map((r) => compass(r, config)))];
  if (names.length === 1) return { text: `Lean in the ${names[0]}`, lean: true };
  // Several regions: short compass codes so the peek strip stays one line.
  const short = (n: string) => (n === 'centre' ? 'C' : n.split('-').map((w) => w[0].toUpperCase()).join(''));
  return { text: `Lean: ${names.map(short).join(', ')}`, lean: true };
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
