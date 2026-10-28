import { DEFAULT_CONFIG } from '../sim/config';
import type { HistorySample } from '../sim/history';
import { EVENT_LOG_SIZE, type WorldEvent } from '../sim/events';
import type { HeatmapKind } from '../sim/activity';
import type { BrainTrace } from '../sim/brain-trace';
import type {
  AncestorNode,
  EggView,
  FromWorker,
  OrganismView,
  PanelData,
  SavedWorld,
  ToWorker,
  WorldView,
} from '../sim/protocol';
import type { SpeciesSnapshot } from '../sim/species';
import type { CarrionPatch, FoodPatch, FoodRegion, Organism, SimulationConfig, WorldMetrics } from '../sim/types';

export interface ClientEvents {
  /** A new frame arrived. Called before it is applied, so positions can be remembered for glides. */
  beforeFrame(): void;
  /** The frame is applied. */
  frame(fromStep: boolean): void;
  /** Terrain and settings were replaced (start, reset). */
  reset(): void;
  /** New world events arrived (oldest first). */
  events(events: readonly WorldEvent[]): void;
  /** Something the user asked for failed (e.g. loading a bad file). */
  error(message: string): void;
  /** Settings changed live, perhaps by another viewer of a shared world. */
  config(): void;
  /** The connection to the server dropped or came back (server mode only). */
  connection(connected: boolean): void;
}

/** What the always-on server says about itself at /api/info. */
export interface ServerInfo {
  readonly app: 'alife-server';
  readonly frameIntervalMs: number;
  readonly maxTicksPerSecond: number;
  readonly watchOnly: boolean;
}

/** Asks the page's own origin whether it is the always-on server (a plain static host or Vite answers otherwise). */
async function probeServer(): Promise<ServerInfo | null> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 3000);
  try {
    const response = await fetch('api/info', { cache: 'no-store', signal: abort.signal });
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('json')) return null;
    const info = (await response.json()) as Partial<ServerInfo>;
    return info.app === 'alife-server' ? (info as ServerInfo) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Heatmaps travel from the server as plain arrays; the renderer wants typed ones. */
function decodeFromServer(message: FromWorker): FromWorker {
  if (message.kind === 'frame' && message.panels?.heatmap && Array.isArray(message.panels.heatmap.cells)) {
    const { kind, cells } = message.panels.heatmap;
    return { ...message, panels: { ...message.panels, heatmap: { kind, cells: Float32Array.from(cells as ArrayLike<number>) } } };
  }
  return message;
}

/**
 * The page's side of the simulation: sends commands to the worker and keeps
 * a read-only mirror of the world for drawing (WorldView) plus the latest
 * panel data. Nothing here changes simulation outcomes.
 *
 * Opened from the always-on server (server/), it watches and steers that
 * shared world over /api/events and /api/command instead; otherwise the
 * world runs in a Web Worker in this page. The messages are the same.
 */
export class SimulationClient implements WorldView {
  public config: SimulationConfig = { ...DEFAULT_CONFIG };
  public tick = 0;
  public organisms = new Map<string, OrganismView>();
  public foodPatches = new Map<string, FoodPatch>();
  public carrion = new Map<string, CarrionPatch>();
  public eggs = new Map<string, EggView>();
  public foodRegions: readonly FoodRegion[] = [];
  public obstacles: ReadonlySet<string> = new Set();
  public weather: WorldView['weather'] = null;
  /** Ticks per second the worker actually ran over the last second. */
  public ticksPerSecond = 0;
  /** Whether the world is playing, and at what speed, as of the latest frame. */
  public running = false;
  public targetTicksPerSecond = 0;
  /** Where the world runs: in this page, or on the always-on server (null until known). */
  public mode: 'worker' | 'server' | null = null;
  public serverInfo: ServerInfo | null = null;
  /** False while the connection to the server is down (it reconnects by itself). */
  public connected = true;
  /** Resolves once the world's location is known and commands can flow. */
  public readonly ready: Promise<void>;

  /** Species of each organism in the latest frame (organism id -> species id; 0 or absent: none). */
  private speciesIds = new Map<string, number>();
  private speciesSnapshot: SpeciesSnapshot | null = null;
  private selectedSpeciesInfo: { speciesId: number; distance: number } | null = null;
  private selectedId: string | null = null;
  private metrics: WorldMetrics | null = null;
  private selectedDetail: Organism | null = null;
  private selectedAncestry: readonly AncestorNode[] = [];
  private history: readonly HistorySample[] = [];
  private heatmap: { kind: HeatmapKind; cells: Float32Array } | null = null;
  private wantsHistory = false;
  private wantsHeatmap: HeatmapKind | null = null;
  /** Recent world events, oldest first. */
  public worldEvents: WorldEvent[] = [];
  private nextRequestId = 1;
  private readonly pendingCsv = new Map<number, (csv: string) => void>();
  private readonly pendingSaves = new Map<number, (saved: SavedWorld) => void>();
  private readonly pendingTraces = new Map<number, (trace: BrainTrace | null) => void>();
  private transport: ((message: ToWorker) => void) | null = null;
  /** Commands sent before the transport is up. */
  private readonly queue: ToWorker[] = [];
  private readonly events: ClientEvents;

  constructor(events: ClientEvents) {
    this.events = events;
    this.ready = probeServer().then((info) => (info ? this.connectServer(info) : this.startWorker()));
  }

  private startWorker(): void {
    const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data);
    this.mode = 'worker';
    this.transport = (message) => worker.postMessage(message);
    for (const message of this.queue.splice(0)) this.transport(message);
  }

  private connectServer(info: ServerInfo): void {
    this.mode = 'server';
    this.serverInfo = info;
    let viewer: number | null = null;
    const post = (message: ToWorker) => {
      if (viewer === null) {
        this.queue.push(message);
        return;
      }
      fetch('api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Viewer': String(viewer) },
        body: JSON.stringify(message),
      })
        .then(async (response) => {
          if (response.ok) return;
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          this.events.error(body.error ?? `The server refused that (${response.status})`);
        })
        .catch(() => this.events.error('Could not reach the server'));
    };
    this.transport = post;
    const source = new EventSource('api/events');
    source.addEventListener('hello', (event) => {
      viewer = (JSON.parse((event as MessageEvent<string>).data) as { viewer: number }).viewer;
      // A new connection is a new viewer: tell it what this page is showing.
      const restore: ToWorker[] = [];
      if (this.selectedId) restore.push({ kind: 'select', id: this.selectedId });
      if (this.wantsHistory || this.wantsHeatmap) restore.push({ kind: 'panels', history: this.wantsHistory, heatmap: this.wantsHeatmap });
      for (const message of [...restore, ...this.queue.splice(0)]) post(message);
      if (!this.connected) {
        this.connected = true;
        this.events.connection(true);
      }
    });
    source.onmessage = (event: MessageEvent<string>) => this.receive(decodeFromServer(JSON.parse(event.data) as FromWorker));
    source.onerror = () => {
      // EventSource retries by itself; requests for csv/saves from the old connection are lost.
      viewer = null;
      if (this.connected) {
        this.connected = false;
        this.events.connection(false);
      }
    };
  }

  private send(message: ToWorker): void {
    if (this.transport) this.transport(message);
    else this.queue.push(message);
  }

  private receive(message: FromWorker): void {
    switch (message.kind) {
      case 'static':
        this.config = message.config;
        this.obstacles = new Set(message.obstacles);
        this.foodRegions = message.foodRegions;
        this.worldEvents = [...message.events];
        this.heatmap = null;
        this.speciesIds = new Map();
        this.speciesSnapshot = null;
        this.events.reset();
        break;
      case 'frame': {
        this.events.beforeFrame();
        this.tick = message.tick;
        this.organisms = new Map(message.organisms.map((o) => [o.id, o]));
        this.foodPatches = new Map(message.foodPatches.map((p) => [`${p.x},${p.y}`, p]));
        this.carrion = new Map((message.carrion ?? []).map((c) => [`${c.x},${c.y}`, c]));
        this.eggs = new Map((message.eggs ?? []).map((e) => [e.id, e]));
        if (message.weather) {
          const w = message.weather;
          this.weather = {
            fronts: w.fronts,
            getWind: (x: number, y: number) => {
              let wx = w.wind.wx;
              let wy = w.wind.wy;
              for (const f of w.fronts) {
                const dx = x - f.x;
                const dy = y - f.y;
                const d2 = dx * dx + dy * dy;
                if (d2 <= f.radius * f.radius) {
                  const dist = Math.sqrt(d2);
                  const inf = f.intensity * (1 - dist / f.radius);
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
            },
          };
        } else {
          this.weather = null;
        }
        this.speciesIds = message.speciesIds ? new Map(message.organisms.map((o, i) => [o.id, message.speciesIds![i]])) : new Map();
        this.ticksPerSecond = message.ticksPerSecond;
        this.running = message.running;
        this.targetTicksPerSecond = message.targetTicksPerSecond;
        if (message.panels) this.applyPanels(message.panels);
        if (message.events.length > 0) {
          this.worldEvents.push(...message.events);
          if (this.worldEvents.length > EVENT_LOG_SIZE) this.worldEvents.splice(0, this.worldEvents.length - EVENT_LOG_SIZE);
          this.events.events(message.events);
        }
        this.events.frame(message.fromStep);
        break;
      }
      case 'config':
        this.config = message.config;
        this.events.config();
        break;
      case 'csv':
        this.pendingCsv.get(message.requestId)?.(message.csv);
        this.pendingCsv.delete(message.requestId);
        break;
      case 'saved':
        this.pendingSaves.get(message.requestId)?.(message.saved);
        this.pendingSaves.delete(message.requestId);
        break;
      case 'brainTrace':
        this.pendingTraces.get(message.requestId)?.(message.trace);
        this.pendingTraces.delete(message.requestId);
        break;
      case 'error':
        this.events.error(message.message);
        break;
    }
  }

  private applyPanels(panels: PanelData): void {
    this.metrics = panels.metrics;
    this.selectedDetail = panels.selected;
    this.selectedAncestry = panels.selectedAncestry ?? [];
    if (panels.history) this.history = panels.history;
    this.heatmap = panels.heatmap ?? null;
    if (panels.species) this.speciesSnapshot = panels.species;
    this.selectedSpeciesInfo = panels.selectedSpecies ?? null;
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
    this.selectedAncestry = [];
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
    this.selectedAncestry = [];
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

  /** The whole world, ready to keep in the browser or write to a file. */
  public save(): Promise<SavedWorld> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      this.pendingSaves.set(requestId, resolve);
      this.send({ kind: 'save', requestId });
    });
  }
  /** How an organism would decide right now (read-only; null if it is gone). Works in the worker and on the server. */
  public inspectBrain(organismId: string): Promise<BrainTrace | null> {
    const requestId = this.nextRequestId++;
    return new Promise((resolve) => {
      this.pendingTraces.set(requestId, resolve);
      this.send({ kind: 'inspectBrain', requestId, organismId });
    });
  }
  /** Replace the world with a saved one; it arrives paused. */
  public load(saved: SavedWorld): void {
    this.selectedId = null;
    this.selectedDetail = null;
    this.send({ kind: 'load', saved });
  }

  // Reads
  public getSelectedOrganism(): OrganismView | undefined {
    return this.selectedId ? this.organisms.get(this.selectedId) : undefined;
  }
  public findEggAt(x: number, y: number): EggView | undefined {
    for (const egg of this.eggs.values()) {
      if (egg.x === x && egg.y === y) return egg;
    }
    return undefined;
  }
  /** The selected organism's full record (policy, brain, last decision), as of the last panel update. */
  public getSelectedDetail(): Organism | null {
    return this.selectedDetail && this.selectedDetail.id === this.selectedId ? this.selectedDetail : null;
  }
  public getSelectedAncestry(): readonly AncestorNode[] {
    return this.selectedAncestry;
  }
  public getMetrics(): WorldMetrics | null {
    return this.metrics;
  }
  /** The species an organism belongs to in the latest frame (0: none or unknown). */
  public speciesOf(organismId: string): number {
    return this.speciesIds.get(organismId) ?? 0;
  }
  /** The latest species list (the count history only while the Trends tab is showing); null with species off. */
  public getSpecies(): SpeciesSnapshot | null {
    return this.speciesSnapshot;
  }
  /** The selected organism's species and its distance to that species' representative. */
  public getSelectedSpecies(): { speciesId: number; distance: number } | null {
    return this.selectedSpeciesInfo;
  }
  public getHistorySamples(): readonly HistorySample[] {
    return this.history;
  }
}
