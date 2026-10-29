import { World } from './world';
import type { SavedWorld } from './protocol';
import { WorldEventDetector, type WorldEvent } from './events';
import { ActivityMaps, type HeatmapKind } from './activity';
import { toOrganismView, type EggView, type FromWorker, type PanelData, type ToWorker } from './protocol';
import type { Egg, Organism, SimulationConfig } from './types';

/** How often panel data (metrics, history, the selected organism) is sent while running. */
export const PANEL_INTERVAL_MS = 200;
/** Ticks never pile up beyond this much lag (e.g. after the tab was hidden). */
const MAX_LAG_MS = 250;

export interface HostEnvironment {
  /** The page, when there is exactly one (the Web Worker). The server connects viewers instead. */
  post?(message: FromWorker): void;
  now(): number;
  /** Runs `fn` after `ms`; returns a handle for cancel. */
  schedule(fn: () => void, ms: number): unknown;
  cancel(handle: unknown): void;
}

/** One page watching the world. Selection and panels are its own; everything else is shared. */
interface Viewer {
  readonly post: (message: FromWorker) => void;
  selectedId: string | null;
  wantsHistory: boolean;
  heatmap: HeatmapKind | null;
}

/** The saved part of the playback state, so a server can resume as it was. */
export interface PlaybackState {
  readonly running: boolean;
  readonly ticksPerSecond: number;
}

/**
 * Runs the World and its tick timing, driven by messages from the page.
 * Used inside the Web Worker (src/sim/worker.ts) for one page, and by the
 * always-on server (server/) for any number of viewers; kept free of worker
 * and Node APIs so tests can drive it directly. It only steps the World, so
 * outcomes are exactly those of stepping a World by hand with the same seed.
 */
function toEggView(e: Egg): EggView {
  return {
    id: e.child.id,
    x: e.x,
    y: e.y,
    laidTick: e.laidTick,
    shell: e.shell ?? 0,
    energy: e.child.energy,
    tag: e.child.tag,
    size: e.child.size ?? 1.0,
    parentId: e.child.lineage.id,
    generation: e.child.lineage.generation,
  };
}

export class SimulationHost {
  public world: World;
  private readonly env: HostEnvironment;
  private running = false;
  private ticksPerSecond = 6;
  private accumulator = 0;
  private lastPump = 0;
  private timer: unknown = null;
  private lastPanels = -Infinity;
  private readonly viewers = new Map<number, Viewer>();
  private nextViewerId = 1;
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
    if (env.post) this.connect(env.post);
  }

  /**
   * Adds a viewer and sends it the terrain and a first frame. Returns its id,
   * which is also given to `beforeWelcome` before anything is sent.
   */
  public connect(post: (message: FromWorker) => void, beforeWelcome?: (id: number) => void): number {
    const id = this.nextViewerId++;
    const viewer: Viewer = { post, selectedId: null, wantsHistory: false, heatmap: null };
    this.viewers.set(id, viewer);
    beforeWelcome?.(id);
    this.postStatic(viewer);
    viewer.post(this.frameFor(viewer, this.baseFrame(false), this.metricsIfAny()));
    return id;
  }

  public disconnect(id: number): void {
    this.viewers.delete(id);
  }

  public get viewerCount(): number {
    return this.viewers.size;
  }

  public playback(): PlaybackState {
    return { running: this.running, ticksPerSecond: this.ticksPerSecond };
  }

  /**
   * Handles a message from a viewer (by default the first one, i.e. the
   * worker's page). Selection, panels and requests are per viewer; playback,
   * settings, reset and load change the shared world.
   */
  public handle(message: ToWorker, viewerId?: number): void {
    const viewer = viewerId === undefined ? this.viewers.values().next().value : this.viewers.get(viewerId);
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
        for (const v of this.viewers.values()) v.selectedId = null;
        this.tickTimes.length = 0;
        this.postStatic();
        this.postFrame(false, true);
        break;
      case 'config':
        // Live switches take effect from the next tick.
        Object.assign(this.world.config, message.config);
        for (const v of this.viewers.values()) v.post({ kind: 'config', config: { ...this.world.config } });
        this.postFrame(false, true);
        break;
      case 'select':
        if (!viewer) return;
        viewer.selectedId = message.id;
        this.postFrame(false, true);
        break;
      case 'panels':
        if (!viewer) return;
        viewer.wantsHistory = message.history;
        viewer.heatmap = message.heatmap;
        this.postFrame(false, true);
        break;
      case 'csv':
        viewer?.post({ kind: 'csv', requestId: message.requestId, csv: this.world.history.toCSV() });
        break;
      case 'save':
        viewer?.post({ kind: 'saved', requestId: message.requestId, saved: this.save() });
        break;
      case 'load':
        this.load(message.saved, viewer);
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

  /** The whole world as a SavedWorld (also what the server writes to disk). */
  public save(): SavedWorld {
    return {
      format: 'alife-world',
      version: 1,
      savedAt: new Date().toISOString(),
      world: this.world.exportState(),
      events: [...this.events.recentEvents()],
    };
  }

  /** Replaces the world with a saved one, paused. A bad save leaves the current world running. */
  private load(saved: SavedWorld, from?: Viewer): void {
    let world: World;
    try {
      world = World.fromState(saved.world);
    } catch (error) {
      from?.post({ kind: 'error', message: `Could not load that world: ${(error as Error).message}` });
      if (!from) throw error;
      return;
    }
    this.running = false;
    this.stopTimer();
    this.world = world;
    this.events = new WorldEventDetector();
    this.events.resume(world, saved.events);
    this.activity = new ActivityMaps(world.config.gridWidth, world.config.gridHeight);
    this.pendingEvents = [];
    this.tickTimes.length = 0;
    for (const v of this.viewers.values()) v.selectedId = null;
    this.postStatic();
    this.postFrame(false, true);
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

  /** The terrain last sent to the page, to send a new copy only when it has worn. */
  private terrainSentFor: ReturnType<World['getTerrain']> = null;
  private terrainSentVersion = -1;
  private terrainSentAt = 0;

  private postStatic(only?: Viewer): void {
    const { world } = this;
    if (!only) {
      // Everyone gets the current terrain with a reset; a single new viewer does not stop the others' updates.
      this.terrainSentFor = world.getTerrain();
      this.terrainSentVersion = this.terrainSentFor?.version ?? -1;
      this.terrainSentAt = this.env.now();
    }
    const message: FromWorker = {
      kind: 'static',
      config: { ...world.config },
      obstacles: Array.from(world.obstacles),
      ...(world.getTerrain() ? { terrain: world.getTerrain()!.exportState() } : {}),
      foodRegions: world.foodRegions.map((r) => ({ ...r })),
      events: [...this.events.recentEvents()],
    };
    for (const v of only ? [only] : this.viewers.values()) v.post(message);
  }

  /** The part of a frame every viewer shares. */
  private baseFrame(fromStep: boolean): Omit<Extract<FromWorker, { kind: 'frame' }>, 'panels'> {
    const { world } = this;
    const now = this.env.now();
    while (this.tickTimes.length > 0 && now - this.tickTimes[0] > 1000) this.tickTimes.shift();
    return {
      kind: 'frame',
      tick: world.tick,
      organisms: Array.from(world.organisms.values(), toOrganismView),
      foodPatches: Array.from(world.foodPatches.values(), (p) => ({ ...p })),
      carrion: Array.from(world.carrion.values(), (c) => ({ ...c })),
      eggs: Array.from(world.eggs.values(), toEggView),
      ...(world.weather && world.config.weatherEnabled
        ? {
            weather: {
              fronts: world.weather.fronts.map((f) => ({ ...f })),
              wind: { ...world.weather.wind },
            },
          }
        : {}),
      ticksPerSecond: this.tickTimes.length,
      running: this.running,
      targetTicksPerSecond: this.ticksPerSecond,
      fromStep,
      events: this.pendingEvents,
    };
  }

  private metricsIfAny() {
    return this.viewers.size > 0 ? this.world.getMetrics() : null;
  }

  /** A viewer's frame: the shared part plus its own panels, when due. */
  private frameFor(
    viewer: Viewer,
    base: Omit<Extract<FromWorker, { kind: 'frame' }>, 'panels'>,
    metrics: ReturnType<World['getMetrics']> | null
  ): FromWorker {
    if (!metrics) return base;
    const selectedOrg = viewer.selectedId
      ? (this.world.getOrganism(viewer.selectedId) ?? this.world.getEgg(viewer.selectedId)?.child ?? null)
      : null;
    const panels: PanelData = {
      metrics,
      selected: withoutCircuit(selectedOrg),
      ...(viewer.selectedId ? { selectedAncestry: this.world.getAncestry(viewer.selectedId) } : {}),
      ...(viewer.wantsHistory ? { history: this.world.history.getSamples() } : {}),
      ...(viewer.heatmap ? { heatmap: { kind: viewer.heatmap, cells: this.activity.snapshot(viewer.heatmap, this.world) } } : {}),
    };
    return { ...base, panels };
  }

  private postFrame(fromStep: boolean, withPanels: boolean): void {
    if (this.viewers.size === 0) {
      this.pendingEvents = []; // nobody to tell; a new viewer gets the recent events with the terrain
      return;
    }
    // Worn terrain goes along with a frame when it has changed, at most about once a second.
    const terrain = this.world.getTerrain();
    const terrainDue =
      terrain !== null &&
      withPanels &&
      (this.terrainSentFor !== terrain || this.terrainSentVersion !== terrain.version) &&
      this.env.now() - this.terrainSentAt >= 1000;
    const base = { ...this.baseFrame(fromStep), ...(terrainDue ? { terrain: terrain.exportState() } : {}) };
    if (terrainDue) {
      this.terrainSentFor = terrain;
      this.terrainSentVersion = terrain.version;
      this.terrainSentAt = this.env.now();
    }
    let metrics: ReturnType<World['getMetrics']> | null = null;
    if (withPanels) {
      this.lastPanels = this.env.now();
      metrics = this.world.getMetrics();
    }
    for (const v of this.viewers.values()) v.post(this.frameFor(v, base, metrics));
    this.pendingEvents = [];
  }
}

/** An organism for the wire, without its circuit (derived from the genome; nothing on the page reads it). */
function withoutCircuit(o: Organism | null | undefined): Organism | null {
  if (!o) return null;
  if (!o.circuit) return o;
  const { circuit: _circuit, ...rest } = o;
  return rest;
}
