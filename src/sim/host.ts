import { World } from './world';
import { WorldEventDetector, type WorldEvent } from './events';
import { ActivityMaps, type HeatmapKind } from './activity';
import { toOrganismView, type FromWorker, type PanelData, type ToWorker } from './protocol';
import type { SimulationConfig } from './types';

/** How often panel data (metrics, history, the selected organism) is sent while running. */
export const PANEL_INTERVAL_MS = 200;
/** Ticks never pile up beyond this much lag (e.g. after the tab was hidden). */
const MAX_LAG_MS = 250;

export interface HostEnvironment {
  post(message: FromWorker): void;
  now(): number;
  /** Runs `fn` after `ms`; returns a handle for cancel. */
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/**
 * Runs the World and its tick timing, driven by messages from the page.
 * Used inside the Web Worker (src/sim/worker.ts); kept free of worker APIs
 * so tests can drive it directly. It only steps the World, so outcomes are
 * exactly those of stepping a World by hand with the same seed.
 */
export class SimulationHost {
  public readonly world: World;
  private readonly env: HostEnvironment;
  private running = false;
  private ticksPerSecond = 6;
  private accumulator = 0;
  private lastPump = 0;
  private timer: unknown = null;
  private lastPanels = -Infinity;
  private wantsHistory = false;
  private heatmap: HeatmapKind | null = null;
  // Observers of the world (they never change it): world events and heatmaps.
  private events = new WorldEventDetector();
  private activity!: ActivityMaps;
  /** Events found since the last frame was sent. */
  private pendingEvents: WorldEvent[] = [];
  private readonly tickTimes: number[] = [];

  constructor(env: HostEnvironment, config?: Partial<SimulationConfig>) {
    this.env = env;
    this.world = new World(config);
    this.resetObservers();
    this.postStatic();
    this.postFrame(false, true);
  }

  public handle(message: ToWorker): void {
    switch (message.kind) {
      case 'play':
        if (this.running) return;
        this.running = true;
        this.accumulator = 0;
        this.lastPump = this.env.now();
        this.tickTimes.length = 0;
        this.scheduleNext();
        break;
      case 'pause':
        this.running = false;
        this.stopTimer();
        this.tickTimes.length = 0;
        this.postFrame(false, true);
        break;
      case 'step':
        if (this.running) return;
        this.stepWorld();
        this.postFrame(true, true);
        break;
      case 'speed':
        this.ticksPerSecond = Math.max(0.1, message.ticksPerSecond);
        this.tickTimes.length = 0;
        if (this.running) {
          this.stopTimer();
          this.scheduleNext();
        }
        break;
      case 'reset':
        this.running = false;
        this.stopTimer();
        if (message.config) Object.assign(this.world.config, message.config);
        this.world.reset(message.seed);
        this.resetObservers();
        this.tickTimes.length = 0;
        this.postStatic();
        this.postFrame(false, true);
        break;
      case 'config':
        // Live switches take effect from the next tick.
        Object.assign(this.world.config, message.config);
        this.postFrame(false, true);
        break;
      case 'select':
        this.world.selectOrganism(message.id);
        this.postFrame(false, true);
        break;
      case 'panels':
        this.wantsHistory = message.history;
        this.heatmap = message.heatmap;
        this.postFrame(false, true);
        break;
      case 'csv':
        this.env.post({ kind: 'csv', requestId: message.requestId, csv: this.world.history.toCSV() });
        break;
    }
  }

  /** Runs every tick that is due, then sends one frame. */
  private pump(): void {
    this.timer = null;
    if (!this.running) return;
    const now = this.env.now();
    this.accumulator += Math.min(now - this.lastPump, MAX_LAG_MS);
    this.lastPump = now;
    const interval = 1000 / this.ticksPerSecond;
    let stepped = 0;
    while (this.accumulator >= interval) {
      this.stepWorld();
      this.tickTimes.push(now);
      this.accumulator -= interval;
      stepped++;
    }
    if (stepped > 0) this.postFrame(false, now - this.lastPanels >= PANEL_INTERVAL_MS);
    this.scheduleNext();
  }

  /** One world tick, then the observers look at the result. */
  private stepWorld(): void {
    this.world.step();
    this.pendingEvents.push(...this.events.observe(this.world));
    this.activity.observe(this.world);
  }

  private resetObservers(): void {
    this.events = new WorldEventDetector();
    this.events.observe(this.world); // starting state, e.g. groups already large
    this.activity = new ActivityMaps(this.world.config.gridWidth, this.world.config.gridHeight);
    this.pendingEvents = [];
  }

  private scheduleNext(): void {
    const interval = 1000 / this.ticksPerSecond;
    this.timer = this.env.schedule(() => this.pump(), Math.max(1, interval - this.accumulator));
  }

  private stopTimer(): void {
    if (this.timer !== null) this.env.cancel(this.timer);
    this.timer = null;
  }

  private postStatic(): void {
    const { world } = this;
    this.env.post({
      kind: 'static',
      config: { ...world.config },
      obstacles: Array.from(world.obstacles),
      foodRegions: world.foodRegions.map((r) => ({ ...r })),
      events: [...this.events.recentEvents()],
    });
  }

  private postFrame(fromStep: boolean, withPanels: boolean): void {
    const { world } = this;
    const now = this.env.now();
    while (this.tickTimes.length > 0 && now - this.tickTimes[0] > 1000) this.tickTimes.shift();
    let panels: PanelData | undefined;
    if (withPanels) {
      this.lastPanels = now;
      panels = {
        metrics: world.getMetrics(),
        selected: world.getSelectedOrganism() ?? null,
        ...(this.wantsHistory ? { history: world.history.getSamples() } : {}),
        ...(this.heatmap ? { heatmap: { kind: this.heatmap, cells: this.activity.snapshot(this.heatmap) } } : {}),
      };
    }
    this.env.post({
      kind: 'frame',
      tick: world.tick,
      organisms: Array.from(world.organisms.values(), toOrganismView),
      foodPatches: Array.from(world.foodPatches.values(), (p) => ({ ...p })),
      ticksPerSecond: this.tickTimes.length,
      fromStep,
      events: this.pendingEvents,
      ...(panels ? { panels } : {}),
    });
    this.pendingEvents = [];
  }
}
