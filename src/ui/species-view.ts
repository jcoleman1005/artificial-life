import { speciesHue, speciesName, type SpeciesInfo, type SpeciesSnapshot } from '../sim/species';

/** Species list for the Stats tab and the stacked population chart for Trends. Display only. */

const GRID = '#263645';
const AXIS_TEXT = '#94a3b8';
const SURFACE = '#141d26';

const colourOf = (id: number) => `hsl(${Math.round(speciesHue(id))}, 70%, 58%)`;
const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** The species list: one tappable row per living species (tap to highlight its members), extinct ones folded away. */
export function speciesListHTML(snapshot: SpeciesSnapshot | null, highlight: number | null): string {
  if (!snapshot) return '<p class="muted">Species detection is off (Settings).</p>';
  const alive = snapshot.species.filter((s) => s.extinct === null && s.count > 0);
  const gone = snapshot.species.filter((s) => s.extinct !== null);
  const byId = new Map(snapshot.species.map((s) => [s.id, s]));
  if (alive.length === 0) return '<p class="muted">No species yet.</p>';
  const total = alive.reduce((n, s) => n + s.count, 0);
  const row = (s: SpeciesInfo) => {
    const parent = s.parentId !== null ? byId.get(s.parentId) : undefined;
    const sub = parent ? `split from ${escape(parent.name)}` : s.parentId !== null ? 'split from an older species' : 'founder';
    return `
      <li>
        <button type="button" class="species-row${highlight === s.id ? ' active' : ''}" data-species="${s.id}" aria-pressed="${highlight === s.id}">
          <span class="group-swatch" style="background:${colourOf(s.id)}"></span>
          <span class="species-name">${escape(s.name)}<small>${sub} · t ${s.born}</small></span>
          <span class="group-bar"><span style="width:${(s.count / total) * 100}%;background:${colourOf(s.id)}"></span></span>
          <span class="group-count">${s.count}</span>
        </button>
      </li>`;
  };
  const goneHTML =
    gone.length === 0
      ? ''
      : `<details class="species-extinct"><summary>Extinct (${gone.length})</summary><ul class="species-list">${gone
          .map(
            (s) =>
              `<li class="species-gone"><span class="group-swatch" style="background:${colourOf(s.id)}"></span><span class="species-name">${escape(s.name)}<small>t ${s.born} to ${s.extinct} · peak ${s.peak}</small></span></li>`
          )
          .join('')}</ul></details>`;
  return `<ul class="species-list">${alive.map(row).join('')}</ul>${goneHTML}`;
}

/** The inspector line for the selected organism's species. */
export function selectedSpeciesHTML(
  snapshot: SpeciesSnapshot | null,
  selected: { speciesId: number; distance: number } | null
): string {
  if (!snapshot) return '';
  const sp = selected ? snapshot.species.find((s) => s.id === selected.speciesId) : undefined;
  if (!selected || !sp) return '<div class="species-line"><span class="muted">Species: none yet (not close enough to any species)</span></div>';
  return `<div class="species-line"><span class="group-swatch" style="background:${colourOf(sp.id)}"></span><span>Species <strong>${escape(sp.name)}</strong> · distance to its representative ${selected.distance.toFixed(3)}</span></div>`;
}

/** Stacked area chart of species populations over time (one sample per species run). */
export class SpeciesChart {
  private readonly canvas: HTMLCanvasElement;
  private readonly legend: HTMLElement;
  private lastKey = '';

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <h4 class="trends-section">Species</h4>
      <figure class="species-chart">
        <canvas role="img" aria-label="Stacked chart of species populations over time"></canvas>
        <figcaption class="species-legend muted"></figcaption>
      </figure>`;
    this.canvas = container.querySelector('canvas')!;
    this.legend = container.querySelector('.species-legend')!;
  }

  public render(snapshot: SpeciesSnapshot | null): void {
    const history = snapshot?.history ?? [];
    const key = `${history.length}:${history[history.length - 1]?.tick ?? -1}:${this.canvas.clientWidth}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    const cssW = this.canvas.clientWidth || 320;
    const cssH = 150;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.canvas.style.height = `${cssH}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, cssW, cssH);
    if (history.length < 2) {
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillText('Waiting for species history…', 12, cssH / 2);
      this.legend.textContent = '';
      return;
    }
    const ids = [...new Set(history.flatMap((h) => h.counts.map(([id]) => id)))].sort((a, b) => a - b);
    const padL = 34;
    const padB = 16;
    const plotW = cssW - padL - 6;
    const plotH = cssH - padB - 6;
    const totals = history.map((h) => h.counts.reduce((n, [, c]) => n + c, 0));
    const max = Math.max(1, ...totals);
    const t0 = history[0].tick;
    const t1 = history[history.length - 1].tick;
    const x = (tick: number) => padL + (t1 === t0 ? 0 : ((tick - t0) / (t1 - t0)) * plotW);
    const y = (v: number) => 6 + plotH - (v / max) * plotH;
    // Stack in id order (oldest at the bottom) so layers keep their place.
    const below = history.map(() => 0);
    for (const id of ids) {
      const tops = history.map((h, i) => below[i] + (h.counts.find(([sid]) => sid === id)?.[1] ?? 0));
      ctx.beginPath();
      history.forEach((h, i) => (i === 0 ? ctx.moveTo(x(h.tick), y(tops[i])) : ctx.lineTo(x(h.tick), y(tops[i]))));
      for (let i = history.length - 1; i >= 0; i--) ctx.lineTo(x(history[i].tick), y(below[i]));
      ctx.closePath();
      ctx.fillStyle = colourOf(id);
      ctx.fill();
      tops.forEach((v, i) => (below[i] = v));
    }
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.strokeRect(padL + 0.5, 6.5, plotW, plotH);
    ctx.fillStyle = AXIS_TEXT;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(String(max), padL - 4, 14);
    ctx.fillText('0', padL - 4, 6 + plotH);
    ctx.textAlign = 'left';
    ctx.fillText(`t ${t0}`, padL, cssH - 3);
    ctx.textAlign = 'right';
    ctx.fillText(`t ${t1}`, cssW - 6, cssH - 3);
    ctx.textAlign = 'left';
    const names = new Map((snapshot?.species ?? []).map((s) => [s.id, s.name]));
    this.legend.innerHTML = `${ids.length} species seen in this window. ${[...ids]
      .reverse()
      .slice(0, 6)
      .map((id) => `<span class="species-key"><span class="group-swatch" style="background:${colourOf(id)}"></span>${escape(names.get(id) ?? speciesName(id))}</span>`)
      .join(' ')}`;
  }
}
