import { POLICY_WEIGHT_KEYS, type HistorySample, type PolicyWeightKey } from '../sim/history';
import { WEIGHT_MAX, WEIGHT_MIN } from '../sim/policy';

// Chart ink. The series blue is validated against the card surface
// (#141d26) for lightness, chroma, and >= 3:1 contrast.
const SERIES = '#3987e5';
const SERIES_BAND = 'rgba(57, 135, 229, 0.18)';
const GRID = '#263645';
const AXIS_TEXT = '#94a3b8';
const CROSSHAIR = '#94a3b8';
const SURFACE = '#141d26';

const WEIGHT_LABELS: Record<PolicyWeightKey, string> = {
  foodAttraction: 'Food attraction',
  obstacleAvoidance: 'Obstacle avoidance',
  crowdingAvoidance: 'Crowd avoidance',
  exploreTendency: 'Explore tendency',
  eatDrive: 'Eat drive',
  reproduceDrive: 'Reproduce drive',
};

interface Panel {
  readonly label: string;
  /** Fixed y-range, or null to scale from 0 to a rounded maximum. */
  readonly fixedRange: readonly [number, number] | null;
  readonly value: (s: HistorySample) => number;
  readonly spread?: (s: HistorySample) => number;
  readonly format: (s: HistorySample) => string;
  canvas?: HTMLCanvasElement;
  valueEl?: HTMLElement;
}

/** Rounds up to a clean axis maximum, e.g. 213 -> 250, 48 -> 50. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/**
 * Small-multiple trend charts: population, food, and the mean ± 1 SD of each
 * inherited policy weight over the run. Press and drag to read any tick.
 */
export class HistoryView {
  private readonly panels: Panel[];
  private readonly readout: HTMLElement;
  private samples: readonly HistorySample[] = [];
  private hoverIndex: number | null = null;

  constructor(container: HTMLElement, onDownloadCSV: () => void) {
    this.panels = [
      {
        label: 'Population',
        fixedRange: null,
        value: (s) => s.population,
        format: (s) => String(s.population),
      },
      {
        label: 'Food stock',
        fixedRange: null,
        value: (s) => s.foodStock,
        format: (s) => String(s.foodStock),
      },
      ...POLICY_WEIGHT_KEYS.map(
        (key): Panel => ({
          label: WEIGHT_LABELS[key],
          fixedRange: [WEIGHT_MIN, WEIGHT_MAX],
          value: (s) => s.weights[key].mean,
          spread: (s) => s.weights[key].sd,
          format: (s) => `${s.weights[key].mean.toFixed(2)} ± ${s.weights[key].sd.toFixed(2)}`,
        })
      ),
    ];

    container.innerHTML = `
      <details open class="trends-card">
        <summary class="trends-summary">
          <strong>Trends</strong>
          <span class="trends-hint">Weights: line = average, band = ±1 SD</span>
        </summary>
        <div class="trends-body">
          <div class="trends-toolbar">
            <span class="trends-readout"></span>
            <button type="button" class="btn btn-secondary btn-small btn-csv">Download CSV</button>
          </div>
          <div class="trends-grid">
            ${this.panels
              .map(
                (p) => `
              <figure class="trend-panel">
                <figcaption><span class="trend-label">${p.label}</span><span class="trend-value"></span></figcaption>
                <canvas></canvas>
              </figure>`
              )
              .join('')}
          </div>
        </div>
      </details>
    `;

    this.readout = container.querySelector<HTMLElement>('.trends-readout')!;
    const figures = container.querySelectorAll<HTMLElement>('.trend-panel');
    this.panels.forEach((p, i) => {
      p.canvas = figures[i].querySelector('canvas')!;
      p.valueEl = figures[i].querySelector<HTMLElement>('.trend-value')!;
    });

    container.querySelector('.btn-csv')!.addEventListener('click', onDownloadCSV);

    // Press-and-drag scrubbing. Horizontal drags scrub; vertical swipes
    // still scroll the page (touch-action: pan-y in CSS).
    const grid = container.querySelector<HTMLElement>('.trends-grid')!;
    const scrub = (e: PointerEvent) => {
      const canvas = (e.target as Element).closest('.trend-panel')?.querySelector('canvas');
      if (!canvas || this.samples.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      this.hoverIndex = Math.round(frac * (this.samples.length - 1));
      this.draw();
    };
    const clear = () => {
      this.hoverIndex = null;
      this.draw();
    };
    grid.addEventListener('pointerdown', scrub);
    grid.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.buttons > 0) scrub(e);
    });
    grid.addEventListener('pointerleave', clear);
    grid.addEventListener('pointercancel', clear);
    grid.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') clear();
    });

    new ResizeObserver(() => this.draw()).observe(grid);
  }

  public render(samples: readonly HistorySample[]): void {
    this.samples = samples;
    if (this.hoverIndex !== null && this.hoverIndex >= samples.length) {
      this.hoverIndex = null;
    }
    this.draw();
  }

  private draw(): void {
    const n = this.samples.length;
    const shown = n === 0 ? null : this.samples[this.hoverIndex ?? n - 1];

    if (shown) {
      const first = this.samples[0].tick;
      this.readout.textContent =
        this.hoverIndex === null
          ? `Ticks ${first}–${shown.tick} · drag a chart to inspect`
          : `At tick ${shown.tick}`;
    } else {
      this.readout.textContent = 'No data yet';
    }

    for (const panel of this.panels) {
      panel.valueEl!.textContent = shown ? panel.format(shown) : '–';
      this.drawPanel(panel);
    }
  }

  private drawPanel(panel: Panel): void {
    const canvas = panel.canvas!;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return; // collapsed or not laid out

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, width, height);

    const samples = this.samples;
    const n = samples.length;

    let [yMin, yMax] = panel.fixedRange ?? [0, 1];
    if (!panel.fixedRange) {
      let max = 0;
      for (const s of samples) max = Math.max(max, panel.value(s));
      yMax = niceMax(max);
    }

    // Plot area, leaving a left gutter for the y labels and room for the end dot.
    const left = 22;
    const right = width - 6;
    const top = 6;
    const bottom = height - 6;
    const x = (i: number) => (n <= 1 ? right : left + (i / (n - 1)) * (right - left));
    const y = (v: number) => bottom - ((v - yMin) / (yMax - yMin)) * (bottom - top);

    // Gridlines: top, bottom, and zero for signed ranges.
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    const gridValues = yMin < 0 ? [yMax, 0, yMin] : [yMax, yMin];
    ctx.fillStyle = AXIS_TEXT;
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of gridValues) {
      const gy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(right, gy);
      ctx.stroke();
      const label = v > 0 && yMin < 0 ? `+${v}` : String(v);
      ctx.fillText(label, left - 4, Math.min(Math.max(gy, top + 4), bottom - 4));
    }

    if (n === 0) return;

    // ±1 SD band.
    if (panel.spread) {
      const clampY = (v: number) => y(Math.min(yMax, Math.max(yMin, v)));
      ctx.fillStyle = SERIES_BAND;
      ctx.beginPath();
      samples.forEach((s, i) => {
        const py = clampY(panel.value(s) + panel.spread!(s));
        if (i === 0) ctx.moveTo(x(i), py);
        else ctx.lineTo(x(i), py);
      });
      for (let i = n - 1; i >= 0; i--) {
        ctx.lineTo(x(i), clampY(panel.value(samples[i]) - panel.spread(samples[i])));
      }
      ctx.closePath();
      ctx.fill();
    }

    // Series line.
    ctx.strokeStyle = SERIES;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    samples.forEach((s, i) => {
      if (i === 0) ctx.moveTo(x(i), y(panel.value(s)));
      else ctx.lineTo(x(i), y(panel.value(s)));
    });
    ctx.stroke();

    // Crosshair when scrubbing; otherwise mark the latest value.
    const markIndex = this.hoverIndex ?? n - 1;
    if (this.hoverIndex !== null) {
      ctx.strokeStyle = CROSSHAIR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(markIndex)) + 0.5, top);
      ctx.lineTo(Math.round(x(markIndex)) + 0.5, bottom);
      ctx.stroke();
    }
    const mx = x(markIndex);
    const my = y(panel.value(samples[markIndex]));
    ctx.fillStyle = SURFACE;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SERIES;
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
