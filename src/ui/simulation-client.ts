import { DEFAULT_CONFIG } from '../sim/config';
import type { HistorySample } from '../sim/history';
import { EVENT_LOG_SIZE, type WorldEvent } from '../sim/events';
import type { HeatmapKind } from '../sim/activity';
import type {
  FromWorker,
  OrganismView,
  PanelData,
  ToWorker,
  WorldView,
} from '../sim/protocol';
import type { FoodPatch, FoodRegion, Organism, SimulationConfig, WorldMetrics } from '../sim/types';

export interface ClientEvents {
  /** A new frame arrived. Called before it is applied, so positions can be remembered for glides. */
  beforeFrame(): void;
  /** The frame is applied. */
  frame(fromStep: boolean): void;
  /** Terrain and settings were replaced (start, reset). */
  reset(): void;
  /** New world events arrived (oldest first). */
  events(events: readonly WorldEvent[]): void;
}

/**
 * The page's side of the simulation: sends commands to the worker and keeps
 * a read-only mirror of the world for drawing (WorldView) plus the latest
 * panel data. Nothing here changes simulation outcomes.
 */
export class SimulationClient implements WorldView {
  public config: SimulationConfig = { ...DEFAULT_CONFIG };
  public tick = 0;
  public organisms = new Map<string, OrganismView>();
  public foodPatches = new Map<string, FoodPatch>();
  public foodRegions: readonly FoodRegion[] = [];
  public obstacles: ReadonlySet<string> = new Set();
  /** Ticks per second the worker actually ran over the last second. */
  public ticksPerSecond = 0;

  private selectedId: string | null = null;
  private metrics: WorldMetrics | null = null;
  private selectedDetail: Organism | null = null;
  private history: readonly HistorySample[] = [];
  private heatmap: { kind: HeatmapKind; cells: Float32Array } | null = null;
  private wantsHistory = false;
  private wantsHeatmap: HeatmapKind | null = null;
  /** Recent world events, oldest first. */
  public worldEvents: WorldEvent[] = [];
  private nextRequestId = 1;
  private readonly pendingCsv = new Map<number, (csv: string) => void>();
  private readonly worker: Worker;
  private readonly events: ClientEvents;

  constructor(events: ClientEvents) {
    this.events = events;
    this.worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  private receive(message: FromWorker): void {
    switch (message.kind) {
      case 'static':
        this.config = message.config;
        this.obstacles = new Set(message.obstacles);
        this.foodRegions = message.foodRegions;
        this.worldEvents = [...message.events];
        this.heatmap = null;
        this.events.reset();
        break;
      case 'frame': {
        this.events.beforeFrame();
        this.tick = message.tick;
        this.organisms = new Map(message.organisms.map((o) => [o.id, o]));
        this.foodPatches = new Map(message.foodPatches.map((p) => [`${p.x},${p.y}`, p]));
        this.ticksPerSecond = message.ticksPerSecond;
        if (message.panels) this.applyPanels(message.panels);
        if (message.events.length > 0) {
          this.worldEvents.push(...message.events);
          if (this.worldEvents.length > EVENT_LOG_SIZE) this.worldEvents.splice(0, this.worldEvents.length - EVENT_LOG_SIZE);
          this.events.events(message.events);
        }
        this.events.frame(message.fromStep);
        break;
      }
      case 'csv':
        this.pendingCsv.get(message.requestId)?.(message.csv);
        this.pendingCsv.delete(message.requestId);
        break;
    }
  }

  private applyPanels(panels: PanelData): void {
    this.metrics = panels.metrics;
    this.selectedDetail = panels.selected;
    if (panels.history) this.history = panels.history;
    this.heatmap = panels.heatmap ?? null;
  }

  // Commands
  public play(): void {
    this.send({ kind: 'play' });
  }
  public pause(): void {
    this.send({ kind: 'pause' });
  }
  public step(): void {
    this.send({ kind: 'step' });
  }
  public setSpeed(ticksPerSecond: number): void {
    this.send({ kind: 'speed', ticksPerSecond });
  }
  /** Restart from tick 0, optionally changing settings that need a fresh world. */
  public reset(seed: string | number, config?: Partial<SimulationConfig>): void {
    this.selectedId = null;
    this.selectedDetail = null;
    this.send({ kind: 'reset', seed, config });
  }
  /** A live settings change, from the next tick. */
  public setConfig(config: Partial<SimulationConfig>): void {
    Object.assign(this.config, config);
    this.send({ kind: 'config', config });
  }
  public select(id: string | null): void {
    this.selectedId = id;
    this.selectedDetail = null;
    this.send({ kind: 'select', id });
  }
  /** Ask for history samples only while the Trends tab is showing. */
  public setWantsHistory(wants: boolean): void {
    this.wantsHistory = wants;
    this.send({ kind: 'panels', history: wants, heatmap: this.wantsHeatmap });
  }
  /** Ask for one heatmap only while its overlay is showing (null: none). */
  public setWantsHeatmap(kind: HeatmapKind | null): void {
    this.wantsHeatmap = kind;
    if (!kind) this.heatmap = null;
    this.send({ kind: 'panels', history: this.wantsHistory, heatmap: kind });
  }
  /** The latest heatmap the worker sent, if one is showing. */
  public getHeatmap(): { kind: HeatmapKind; cells: Float32Array } | null {
    return this.heatmap;
  }
  public requestCSV(): Promise<string> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      this.pendingCsv.set(requestId, resolve);
      this.send({ kind: 'csv', requestId });
    });
  }

  // Reads
  public getSelectedOrganism(): OrganismView | undefined {
    return this.selectedId ? this.organisms.get(this.selectedId) : undefined;
  }
  /** The selected organism's full record (policy, brain, last decision), as of the last panel update. */
  public getSelectedDetail(): Organism | null {
    return this.selectedDetail && this.selectedDetail.id === this.selectedId ? this.selectedDetail : null;
  }
  public getMetrics(): WorldMetrics | null {
    return this.metrics;
  }
  public getHistorySamples(): readonly HistorySample[] {
    return this.history;
  }
}
