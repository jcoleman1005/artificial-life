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
  kinAffinity: 'Kin affinity',
  shareWithKin: 'Share with kin',
  shareWithStrangers: 'Share with strangers',
  careForChildren: 'Care for children',
  forageDrive: 'Forage drive',
  eatPriority: 'Eat priority',
  hungerUrgency: 'Hunger urgency',
  followFoodParent: 'Follow food parent',
  avoidOccupied: 'Avoid occupied cells',
  leapEagerness: 'Leap eagerness',
};

const REFERENCE = '#64748b';
const LEAN_WASH = 'rgba(251, 191, 36, 0.09)';

interface Panel {
  readonly section: string;
  readonly label: string;
  /** Fixed y-range, or null to scale from 0 to a rounded maximum. */
  readonly fixedRange: readonly [number, number] | null;
  /** `prev` is the previous sample, for per-tick rates. */
  readonly value: (s: HistorySample, prev?: HistorySample) => number;
  readonly spread?: (s: HistorySample) => number;
  /** A muted comparison line, e.g. what a value would be by chance. */
  readonly reference?: (s: HistorySample) => number;
  readonly format: (s: HistorySample, prev?: HistorySample) => string;
  readonly axisLabel?: (v: number) => string;
  canvas?: HTMLCanvasElement;
  valueEl?: HTMLElement;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Per-100-tick rate of a cumulative counter between two samples. */
function ratePer100(total: (s: HistorySample) => number) {
  return (s: HistorySample, prev?: HistorySample): number =>
    !prev || s.tick === prev.tick ? 0 : ((total(s) - total(prev)) / (s.tick - prev.tick)) * 100;
}

// Ordinary gifts exclude parent-to-child care, which has its own chart.
const sharesPer100Ticks = ratePer100((s) => s.sharesTotal - s.parentalSharesTotal);
const parentalSharesPer100Ticks = ratePer100((s) => s.parentalSharesTotal);

function inGroupBias(s: HistorySample): number {
  return s.weights.shareWithKin.mean - s.weights.shareWithStrangers.mean;
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
 * Small-multiple trend charts: population and food, tribe formation and
 * sharing, and the mean ± 1 SD of each inherited policy weight over the run.
 * Press and drag to read any tick.
 */
export class HistoryView {
  private readonly panels: Panel[];
  private readonly readout: HTMLElement;
  private samples: readonly HistorySample[] = [];
  private hoverIndex: number | null = null;

  constructor(container: HTMLElement, onDownloadCSV: () => void) {
    this.panels = [
      {
        section: 'Population & food',
        label: 'Population',
        fixedRange: null,
        value: (s) => s.population,
        format: (s) => String(s.population),
      },
      {
        section: 'Population & food',
        label: 'Food stock',
        fixedRange: null,
        value: (s) => s.foodStock,
        format: (s) => String(s.foodStock),
      },
      {
        section: 'Tribes & sharing',
        label: 'Look-alike groups (5+)',
        fixedRange: null,
        value: (s) => s.tribeCount,
        format: (s) => `${s.tribeCount} · largest ${s.largestTribe}`,
      },
      {
        section: 'Tribes & sharing',
        label: 'Neighbours who look alike',
        fixedRange: [0, 1],
        value: (s) => s.localKinFraction,
        reference: (s) => s.globalKinFraction,
        format: (s) => `${pct(s.localKinFraction)} · chance ${pct(s.globalKinFraction)}`,
        axisLabel: pct,
      },
      {
        section: 'Tribes & sharing',
        label: 'Gifts to others',
        fixedRange: null,
        value: sharesPer100Ticks,
        format: (s, prev) => `${sharesPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: 'Tribes & sharing',
        label: 'Gifts to own children',
        fixedRange: null,
        value: parentalSharesPer100Ticks,
        format: (s, prev) => `${parentalSharesPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: 'Tribes & sharing',
        label: 'Immigrants (total)',
        fixedRange: null,
        value: (s) => s.immigrantsTotal,
        format: (s) => String(s.immigrantsTotal),
      },
      {
        section: 'Tribes & sharing',
        label: 'In-group bias',
        fixedRange: [WEIGHT_MIN, WEIGHT_MAX],
        value: inGroupBias,
        format: (s) => `${inGroupBias(s) >= 0 ? '+' : ''}${inGroupBias(s).toFixed(2)}`,
      },
      {
        section: 'Body traits',
        label: 'Carry capacity',
        fixedRange: [0, 6],
        value: (s) => s.carryCapacity.mean,
        spread: (s) => s.carryCapacity.sd,
        format: (s) => `${s.carryCapacity.mean.toFixed(2)} ± ${s.carryCapacity.sd.toFixed(2)} units`,
      },
      {
        section: 'Body traits',
        label: 'Leapers',
        fixedRange: [0, 1],
        value: (s) => s.leapers,
        format: (s) => pct(s.leapers),
        axisLabel: pct,
      },
      {
        section: 'Brains (used when Controller = Brain)',
        label: 'Drift from head start',
        fixedRange: null,
        value: (s) => s.brainDrift.mean,
        spread: (s) => s.brainDrift.sd,
        format: (s) => `${s.brainDrift.mean.toFixed(2)} ± ${s.brainDrift.sd.toFixed(2)}`,
      },
      {
        section: 'Brains (used when Controller = Brain)',
        label: 'Hidden layer strength',
        fixedRange: null,
        value: (s) => s.hiddenStrength.mean,
        spread: (s) => s.hiddenStrength.sd,
        format: (s) => `${s.hiddenStrength.mean.toFixed(2)} ± ${s.hiddenStrength.sd.toFixed(2)}`,
      },
      ...POLICY_WEIGHT_KEYS.map(
        (key): Panel => ({
          section: 'Inherited weights (dials)',
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
          <span class="trends-hint">Shaded = lean season · band = ±1 SD · grey = chance · bias = kin − stranger giving</span>
        </summary>
        <div class="trends-body">
          <div class="trends-toolbar">
            <span class="trends-readout"></span>
            <button type="button" class="btn btn-secondary btn-small btn-csv">Download CSV</button>
          </div>
          ${[...new Set(this.panels.map((p) => p.section))]
            .map(
              (section) => `
          <h4 class="trends-section">${section}</h4>
          <div class="trends-grid">
            ${this.panels
              .filter((p) => p.section === section)
              .map(
                (p) => `
              <figure class="trend-panel">
                <figcaption><span class="trend-label">${p.label}</span><span class="trend-value"></span></figcaption>
                <canvas></canvas>
              </figure>`
              )
              .join('')}
          </div>`
            )
            .join('')}
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
    const grid = container.querySelector<HTMLElement>('.trends-body')!;
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
    const shownIndex = this.hoverIndex ?? n - 1;
    const shown = n === 0 ? null : this.samples[shownIndex];
    const shownPrev = shownIndex > 0 ? this.samples[shownIndex - 1] : undefined;

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
      panel.valueEl!.textContent = shown ? panel.format(shown, shownPrev) : '–';
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
      samples.forEach((s, i) => {
        max = Math.max(max, panel.value(s, samples[i - 1]));
      });
      yMax = niceMax(max);
    }

    // Gridlines: top, bottom, and zero for signed ranges.
    const gridValues = yMin < 0 ? [yMax, 0, yMin] : [yMax, yMin];
    const formatTick = (v: number) =>
      panel.axisLabel ? panel.axisLabel(v) : v > 0 && yMin < 0 ? `+${v}` : String(v);
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    const gutter = Math.max(...gridValues.map((v) => ctx.measureText(formatTick(v)).width));

    // Plot area, leaving a left gutter for the y labels and room for the end dot.
    const left = Math.ceil(gutter) + 6;
    const right = width - 6;
    const top = 6;
    const bottom = height - 6;
    const x = (i: number) => (n <= 1 ? right : left + (i / (n - 1)) * (right - left));
    const y = (v: number) => {
      const clamped = Math.min(yMax, Math.max(yMin, v));
      return bottom - ((clamped - yMin) / (yMax - yMin)) * (bottom - top);
    };
    const valueAt = (i: number) => panel.value(samples[i], samples[i - 1]);

    // Lean seasons: a faint wash behind everything else.
    if (n > 1) {
      ctx.fillStyle = LEAN_WASH;
      const half = (right - left) / (n - 1) / 2;
      samples.forEach((s, i) => {
        if (s.lean) ctx.fillRect(x(i) - half, top, half * 2, bottom - top);
      });
    }

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of gridValues) {
      const gy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(right, gy);
      ctx.stroke();
      ctx.fillText(formatTick(v), left - 4, Math.min(Math.max(gy, top + 4), bottom - 4));
    }

    if (n === 0) return;

    // ±1 SD band.
    if (panel.spread) {
      ctx.fillStyle = SERIES_BAND;
      ctx.beginPath();
      samples.forEach((s, i) => {
        const py = y(valueAt(i) + panel.spread!(s));
        if (i === 0) ctx.moveTo(x(i), py);
        else ctx.lineTo(x(i), py);
      });
      for (let i = n - 1; i >= 0; i--) {
        ctx.lineTo(x(i), y(valueAt(i) - panel.spread(samples[i])));
      }
      ctx.closePath();
      ctx.fill();
    }

    // Reference (chance) line, drawn under the series.
    if (panel.reference) {
      ctx.strokeStyle = REFERENCE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      samples.forEach((s, i) => {
        if (i === 0) ctx.moveTo(x(i), y(panel.reference!(s)));
        else ctx.lineTo(x(i), y(panel.reference!(s)));
      });
      ctx.stroke();
    }

    // Series line.
    ctx.strokeStyle = SERIES;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    samples.forEach((_, i) => {
      if (i === 0) ctx.moveTo(x(i), y(valueAt(i)));
      else ctx.lineTo(x(i), y(valueAt(i)));
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
    const my = y(valueAt(markIndex));
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
