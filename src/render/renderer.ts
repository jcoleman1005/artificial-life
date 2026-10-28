import type { CarrionPatch, FoodPatch, Plant, SimulationConfig } from '../sim/types';
import { plantHue } from '../sim/plants';
import { bodyScaleOf } from '../sim/growth';
import type { EggView, OrganismView, WorldView } from '../sim/protocol';
import { speciesHue } from '../sim/species';
import type { HeatmapKind } from '../sim/activity';
import { regionSeasonAt, seasonAt } from '../sim/seasons';
import { isLeapAction, isMoveAction, unitDirectionOf } from '../sim/directions';
import type { ActionType } from '../sim/types';

/**
 * How drawn positions follow true ones (display only): 'smooth' trails by a
 * short fixed lag; 'fluid' follows like a soft spring paced to the tick
 * rate, so step-rest-step reads as one continuous drift.
 */
export type MotionStyle = 'smooth' | 'fluid';

/**
 * What an organism's colour shows: its visible tag, its founding family, its diet (green plants to red meat),
 * its metabolic rate (blue slow burners to orange-red fast ones) or its breeding strategy (cyan many-small-clutch
 * "r" end to purple few-well-fed "K" end). The last two read the life-history genes, so they are neutral while
 * those genes are off. Display only: nothing here feeds back into the world.
 */
export type ColorMode = 'tag' | 'lineage' | 'diet' | 'metabolism' | 'reproStrategy' | 'species';

/** Position of v in [min, max], 0..1 (0 when the range is empty). */
const unit = (v: number, min: number, max: number): number => (max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0);

/** Hue for the metabolism mode: 215 (cool blue, slow) down to 12 (orange-red, fast). */
export function metabolismHue(org: Pick<OrganismView, 'metabolicRate'>, config: Readonly<SimulationConfig>): number {
  if (org.metabolicRate === undefined) return 215 - 0.5 * 203; // gene off: mid-scale, not a claim
  return 215 - 203 * unit(org.metabolicRate, config.metabolismMin, config.metabolismMax);
}

/**
 * Hue for the breeding-strategy mode: 185 (cyan) for a large clutch and a small investment, 275 (purple) for a
 * single, well-provisioned child. The index averages whichever of the two genes exist; with neither, mid-scale.
 */
export function reproStrategyHue(org: Pick<OrganismView, 'investment' | 'clutchSize'>, config: Readonly<SimulationConfig>): number {
  const terms: number[] = [];
  if (org.investment !== undefined) terms.push(unit(org.investment, config.investmentMin, config.investmentMax));
  if (org.clutchSize !== undefined) terms.push(1 - unit(org.clutchSize, config.clutchMin, config.clutchMax));
  const k = terms.length > 0 ? terms.reduce((a, t) => a + t, 0) / terms.length : 0.5;
  return 185 + 90 * k;
}

/**
 * One optional layer over the world (one at a time):
 * - family: the selected organism's parent and children, its lineage lit and others dimmed;
 * - senses: the selected organism's sight and signal ranges, and signal ripples;
 * - trails: short fading paths behind organisms;
 * - crowding / deaths / feeding: fading heatmaps of where those happen.
 * - health: how much grazing has worn each cell down (overgrazing), on a fixed 0-1 scale.
 */
export type OverlayMode = 'none' | 'family' | 'senses' | 'trails' | 'weather' | HeatmapKind;

const HEATMAP_COLOUR: Record<HeatmapKind, string> = {
  crowding: '251, 146, 60',
  deaths: '248, 113, 113',
  feeding: '134, 239, 172',
  health: '217, 119, 6',
  nutrients: '34, 197, 94',
};
/** Trail points kept per organism (one per frame). */
const TRAIL_LENGTH = 12;
/** How far behind its true position a blob is drawn (time constant of the smoothing). */
const MOTION_SMOOTHING_MS = 70;
/** A move longer than this (in cells) is drawn as a jump, not smoothed (e.g. a new world). */
const MAX_SMOOTHED_JUMP = 4;
/** Fluid motion: a blob settles into a new cell over about this many frame gaps (bounded below and above, in ms). */
const FLUID_SETTLE_GAPS = 3;
const FLUID_SETTLE_MIN_MS = 120;
const FLUID_SETTLE_MAX_MS = 1200;

/** Space at the canvas edges covered by overlays (sheet, playback pill). */
export interface ViewInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Unit vector for an action that ends in a direction (moves, leaps, gifts). */
function directionOf(type: ActionType): [number, number] {
  if (isMoveAction(type) || isLeapAction(type)) return unitDirectionOf(type);
  if (type.endsWith('_NORTH')) return [0, -1];
  if (type.endsWith('_SOUTH')) return [0, 1];
  if (type.endsWith('_EAST')) return [1, 0];
  if (type.endsWith('_WEST')) return [-1, 0];
  return [0, 0];
}

const TAU = Math.PI * 2;
const GLYPH = 'rgba(255, 255, 255, 0.88)';
const BERRY = '#86efac';
const GIFT = '#fcd877';
const STARVING = 'rgba(248, 113, 113, 0.92)';
const BONE = '#e9dcc6';
const BITE = '#f43f5e';
const ZOOM_ANIMATION_MS = 320;

/** Lineage colour: a hash of the founding ancestor's id, so a family shares a hue. */
export function lineageHue(lineageId: string): number {
  let hash = 0;
  for (let i = 0; i < lineageId.length; i++) {
    hash = (hash * 31 + lineageId.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

const easeInOut = (p: number) => p * p * (3 - 2 * p);

/**
 * Draws the world in the "Pebbles" style: glowing orbs for organisms, berry
 * clusters for food, rounded rocks, soft glows for fertile regions. The
 * canvas fills its parent; at zoom 1 the whole world fits inside the part
 * not covered by overlays (the insets), and zooming in lets it fill the screen.
 */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private world: WorldView;
  private width = 360;
  private height = 360;
  private insets: ViewInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  /** Cell size at zoom 1 (the whole world fits the visible area). */
  private baseCell = 6;
  private cellSize = 6;
  private colorMode: ColorMode = 'tag';
  private speciesOf: ((organismId: string) => number) | null = null;
  private highlightSpecies: number | null = null;
  // Smooth movement: where each organism was before the latest tick, and how
  // far (0..1) the current frame is through that tick.
  /** Where each organism's current glide starts, in cells (fractional when a glide was cut short). */
  private previousPositions = new Map<string, { x: number; y: number }>();
  /** Glides ease in and out (a single step) or run at constant speed (playing, so moves flow into each other). */
  private easedGlide = false;
  /**
   * Where each organism is drawn this frame, in cells: it follows its glide
   * position with a short lag (MOTION_SMOOTHING_MS), so at high speeds a
   * blob stepping back and forth every tick drifts instead of jittering.
   * Heading angle (radians) tracks the latest movement or directional action.
   * Display only; the world is unaffected.
   */
  private drawn = new Map<string, { x: number; y: number; vx: number; vy: number; heading: number }>();
  private lastRenderAt = 0;
  private motionSettled = true;
  private motionStyle: MotionStyle = 'fluid';
  /** The expected time between frames (ms), which paces fluid motion. */
  private paceMs = 167;
  private progress = 1;
  // Zoom and pan: the world is drawn `zoom` times larger than the fitted size;
  // world pixel (viewX, viewY) sits at the canvas's top-left corner.
  private zoom = 1;
  private viewX = 0;
  private viewY = 0;
  /** While zoomed, keep the selected organism centred (until the view is dragged). */
  private following = true;
  private zoomAnimation: { from: number; to: number; start: number } | null = null;
  private overlay: OverlayMode = 'none';
  /** The plant shown in the inspector, ringed in the world. */
  private selectedPlantId: string | null = null;
  /** The egg shown in the inspector, ringed in the world. */
  private selectedEggId: string | null = null;
  private heatmap: Float32Array | null = null;
  private trails = new Map<string, { x: number; y: number }[]>();

  constructor(canvas: HTMLCanvasElement, world: WorldView) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this.world = world;
    this.resize();
  }

  public setWorld(world: WorldView): void {
    this.world = world;
  }

  public setMotionStyle(style: MotionStyle): void {
    this.motionStyle = style;
  }

  /** The expected time between frames while playing, so fluid motion keeps pace with the speed. */
  public setPace(ms: number): void {
    this.paceMs = ms;
  }

  public setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
  }

  /** Where to read an organism's species id from (the 'species' colour mode and the highlight). */
  public setSpeciesLookup(lookup: ((organismId: string) => number) | null): void {
    this.speciesOf = lookup;
  }

  /** Dims everyone outside this species (null: no highlight). */
  public setHighlightSpecies(id: number | null): void {
    this.highlightSpecies = id;
  }

  public setSelectedPlant(id: string | null): void {
    this.selectedPlantId = id;
  }

  public setSelectedEgg(id: string | null): void {
    this.selectedEggId = id;
  }

  public setOverlay(mode: OverlayMode): void {
    this.overlay = mode;
    this.trails.clear();
    if (mode === 'none' || mode === 'family' || mode === 'senses' || mode === 'trails') this.heatmap = null;
  }

  /** The heatmap to draw (one value per cell), or null. */
  public setHeatmap(cells: Float32Array | null): void {
    this.heatmap = cells;
  }

  public hueOf(org: OrganismView): number {
    if (this.colorMode === 'diet') return 120 - 120 * org.carnivory;
    if (this.colorMode === 'metabolism') return metabolismHue(org, this.world.config);
    if (this.colorMode === 'reproStrategy') return reproStrategyHue(org, this.world.config);
    if (this.colorMode === 'species') {
      const id = this.speciesOf?.(org.id) ?? 0;
      return id > 0 ? speciesHue(id) : org.tag; // no species yet: fall back to the tag
    }
    return this.colorMode === 'tag' ? org.tag : lineageHue(org.lineage.id);
  }

  /** The zoom the view is heading to (the target while animating). */
  public getZoom(): number {
    return this.zoomAnimation ? this.zoomAnimation.to : this.zoom;
  }

  /** True while a zoom animation still needs frames drawn. */
  public isAnimating(): boolean {
    return this.zoomAnimation !== null || !this.motionSettled;
  }

  public setInsets(insets: ViewInsets): void {
    this.insets = insets;
    this.resize();
  }

  /** Zooms about the centre of the visible area, or the followed organism. */
  public setZoom(zoom: number, animate = true): void {
    const target = Math.max(1, zoom);
    this.following = true;
    if (!animate) {
      this.zoomAnimation = null;
      this.applyZoom(target);
      return;
    }
    this.zoomAnimation = { from: this.zoom, to: target, start: performance.now() };
  }

  private applyZoom(zoom: number): void {
    const { cx, cy } = this.visibleCentre();
    const worldX = (this.viewX + cx) / this.cellSize;
    const worldY = (this.viewY + cy) / this.cellSize;
    this.zoom = zoom;
    this.cellSize = this.baseCell * zoom;
    this.viewX = worldX * this.cellSize - cx;
    this.viewY = worldY * this.cellSize - cy;
    this.clampView();
  }

  /** Drags the view by a screen offset in CSS pixels; stops following. */
  public panBy(dx: number, dy: number): void {
    this.viewX -= dx;
    this.viewY -= dy;
    this.following = false;
    this.clampView();
  }

  /** Whether the world is larger than the visible area (so a drag can pan). */
  public canPan(): boolean {
    const { gridWidth, gridHeight } = this.world.config;
    const { vw, vh } = this.visibleSize();
    return gridWidth * this.cellSize > vw + 1 || gridHeight * this.cellSize > vh + 1;
  }

  /** Follow the selected organism again (after a new selection). */
  public follow(): void {
    this.following = true;
  }

  /** Centers the camera on a specific grid cell (e.g. an egg). */
  public followCell(gx: number, gy: number): void {
    this.following = true;
    const sx = (gx + 0.5) * this.cellSize;
    const sy = (gy + 0.5) * this.cellSize;
    const { cx, cy } = this.visibleCentre();
    this.viewX = sx - cx;
    this.viewY = sy - cy;
    this.clampView();
  }

  private visibleSize(): { vw: number; vh: number } {
    const { top, bottom, left, right } = this.insets;
    return {
      vw: Math.max(1, this.width - left - right),
      vh: Math.max(1, this.height - top - bottom),
    };
  }

  private visibleCentre(): { cx: number; cy: number } {
    const { vw, vh } = this.visibleSize();
    return { cx: this.insets.left + vw / 2, cy: this.insets.top + vh / 2 };
  }

  /**
   * Keeps the world in view: centred in the visible area along an axis where
   * it is smaller, otherwise able to pan from edge to edge of that area.
   */
  private clampView(): void {
    const { gridWidth, gridHeight } = this.world.config;
    const { vw, vh } = this.visibleSize();
    const clampAxis = (view: number, worldPx: number, start: number, visible: number) =>
      worldPx <= visible
        ? -(start + (visible - worldPx) / 2)
        : Math.max(-start, Math.min(worldPx - visible - start, view));
    this.viewX = clampAxis(this.viewX, gridWidth * this.cellSize, this.insets.left, vw);
    this.viewY = clampAxis(this.viewY, gridHeight * this.cellSize, this.insets.top, vh);
  }

  /**
   * Call just before each new frame is applied, so moves can be drawn as
   * glides. Each glide starts where the organism is on screen right now,
   * even part-way through the previous glide, so a frame arriving a little
   * early never makes it jump.
   */
  public rememberPositions(): void {
    const starts = new Map<string, { x: number; y: number }>();
    for (const org of this.world.organisms.values()) {
      const [gx, gy] = this.gridPosition(org);
      starts.set(org.id, { x: gx, y: gy });
    }
    this.previousPositions = starts;
    if (this.overlay === 'trails') {
      for (const { id, x, y } of this.world.organisms.values()) {
        const trail = this.trails.get(id) ?? [];
        const last = trail[trail.length - 1];
        if (!last || last.x !== x || last.y !== y) trail.push({ x, y });
        if (trail.length > TRAIL_LENGTH) trail.shift();
        this.trails.set(id, trail);
      }
      for (const id of this.trails.keys()) if (!this.world.organisms.has(id)) this.trails.delete(id);
    }
  }

  /** Forget remembered positions (after a reset, ids restart from 1). */
  public clearMotion(): void {
    this.previousPositions.clear();
    this.drawn.clear();
    this.trails.clear();
    this.heatmap = null;
    this.progress = 1;
  }

  /** Where an organism is drawn, in cells: part-way along its latest glide. */
  private gridPosition(org: OrganismView): [number, number] {
    const prev = this.previousPositions.get(org.id);
    if (!prev || this.progress >= 1) return [org.x, org.y];
    const t = this.easedGlide ? easeInOut(this.progress) : this.progress;
    return [prev.x + (org.x - prev.x) * t, prev.y + (org.y - prev.y) * t];
  }

  /** Moves every drawn position toward its glide position (once per frame). */
  private updateDrawnPositions(): void {
    const now = performance.now();
    const dt = this.lastRenderAt > 0 ? Math.min(250, now - this.lastRenderAt) : 0;
    this.lastRenderAt = now;
    const fluid = this.motionStyle === 'fluid';
    // Smooth: exponential follow. Fluid: a critically damped spring (exact
    // for any frame time), so blobs ease into and out of moves.
    const follow = 1 - Math.exp(-dt / MOTION_SMOOTHING_MS);
    const settleMs = Math.max(FLUID_SETTLE_MIN_MS, Math.min(FLUID_SETTLE_MAX_MS, FLUID_SETTLE_GAPS * this.paceMs));
    const omega = 4 / settleMs;
    const decay = Math.exp(-omega * dt);
    const next = new Map<string, { x: number; y: number; vx: number; vy: number; heading: number }>();
    let settled = true;
    for (const org of this.world.organisms.values()) {
      const [tx, ty] = this.gridPosition(org);
      const was = this.drawn.get(org.id);
      const lastType = org.recentHistory[0]?.chosenAction.type;
      const [adx, ady] = lastType ? directionOf(lastType) : [0, 0];
      if (!was || Math.abs(tx - was.x) + Math.abs(ty - was.y) > MAX_SMOOTHED_JUMP) {
        const initialHeading = adx !== 0 || ady !== 0 ? Math.atan2(ady, adx) : -Math.PI / 2;
        next.set(org.id, { x: tx, y: ty, vx: 0, vy: 0, heading: initialHeading });
        continue;
      }
      let x: number, y: number, vx: number, vy: number;
      if (fluid) {
        const dx = was.x - tx;
        const dy = was.y - ty;
        const kx = (was.vx + omega * dx) * dt;
        const ky = (was.vy + omega * dy) * dt;
        vx = (was.vx - omega * kx) * decay;
        vy = (was.vy - omega * ky) * decay;
        x = tx + (dx + kx) * decay;
        y = ty + (dy + ky) * decay;
      } else {
        x = was.x + (tx - was.x) * follow;
        y = was.y + (ty - was.y) * follow;
        vx = 0;
        vy = 0;
      }
      let heading = was.heading;
      const mvx = tx - was.x;
      const mvy = ty - was.y;
      if (Math.hypot(mvx, mvy) > 0.04) {
        const targetAngle = Math.atan2(mvy, mvx);
        const diff = Math.atan2(Math.sin(targetAngle - heading), Math.cos(targetAngle - heading));
        heading += diff * Math.min(1, follow * 1.5 + 0.25);
      } else if (adx !== 0 || ady !== 0) {
        const targetAngle = Math.atan2(ady, adx);
        const diff = Math.atan2(Math.sin(targetAngle - heading), Math.cos(targetAngle - heading));
        heading += diff * Math.min(1, follow * 1.2 + 0.2);
      }
      if (Math.abs(tx - x) + Math.abs(ty - y) > 0.01 || Math.abs(vx) + Math.abs(vy) > 0.0005) settled = false;
      next.set(org.id, { x, y, vx, vy, heading });
    }
    this.drawn = next;
    this.motionSettled = settled;
  }

  /** Pixel centre of an organism, part-way along its latest move. */
  private displayCentre(org: OrganismView): [number, number] {
    const drawn = this.drawn.get(org.id);
    const [gx, gy] = drawn ? [drawn.x, drawn.y] : this.gridPosition(org);
    return [(gx + 0.5) * this.cellSize, (gy + 0.5) * this.cellSize];
  }

  /** Visual altitude offset (CSS px, positive = elevated upwards in screen -Y) for leaping. */
  private leapLiftOf(org: OrganismView): number {
    const lastAction = org.recentHistory[0];
    if (!lastAction || !isLeapAction(lastAction.chosenAction.type) || lastAction.outcome !== 'success') {
      return 0;
    }
    const [hx, hy] = directionOf(lastAction.chosenAction.type);
    const originPx = (org.x - 2 * hx + 0.5) * this.cellSize;
    const originPy = (org.y - 2 * hy + 0.5) * this.cellSize;
    const targetPx = (org.x + 0.5) * this.cellSize;
    const targetPy = (org.y + 0.5) * this.cellSize;
    const [gx, gy] = this.displayCentre(org);
    const totalDist = Math.hypot(targetPx - originPx, targetPy - originPy) || (2 * this.cellSize);
    const traveled = Math.hypot(gx - originPx, gy - originPy);
    const u = Math.max(0, Math.min(1, traveled / totalDist));
    const rem = Math.hypot(targetPx - gx, targetPy - gy);
    if (rem <= 0.04 * this.cellSize || u >= 0.98) return 0;
    const Hmax = this.cellSize * 0.85;
    return 4 * Hmax * u * (1 - u);
  }

  /** Screen position (CSS px, relative to the canvas) of an organism. */
  public screenPositionOf(org: OrganismView): { x: number; y: number } {
    const [x, y] = this.displayCentre(org);
    const lift = this.leapLiftOf(org);
    return { x: x - this.viewX, y: (y - lift) - this.viewY };
  }

  /** Screen position (CSS px, relative to the canvas) of a grid cell center. */
  public screenPositionOfCell(gx: number, gy: number): { x: number; y: number } {
    const sx = (gx + 0.5) * this.cellSize;
    const sy = (gy + 0.5) * this.cellSize;
    return { x: sx - this.viewX, y: sy - this.viewY };
  }

  public resize(): void {
    // CSS owns the on-screen size (the canvas fills its parent); here we
    // match the drawing buffer to it for crisp high-DPI output.
    const parent = this.canvas.parentElement;
    this.width = Math.max(1, parent ? parent.clientWidth : this.canvas.clientWidth);
    this.height = Math.max(1, parent ? parent.clientHeight : this.canvas.clientHeight);

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const { gridWidth, gridHeight } = this.world.config;
    const { vw, vh } = this.visibleSize();
    // A little breathing room around the world at zoom 1.
    this.baseCell = Math.max(1, Math.min((vw - 8) / gridWidth, (vh - 8) / gridHeight));
    this.cellSize = this.baseCell * this.zoom;
    this.clampView();
  }

  /** Converts client touch or pointer coordinates to a grid cell, or null outside the world. */
  public clientToGrid(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const gridX = Math.floor((px + this.viewX) / this.cellSize);
    const gridY = Math.floor((py + this.viewY) / this.cellSize);
    const { gridWidth, gridHeight } = this.world.config;
    if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
      return { x: gridX, y: gridY };
    }
    return null;
  }

  /** Draws the world; `progress` (0..1) is how far through the latest tick to show movement. */
  /** Draws the world with moves `progress` (0..1) of the way along; `eased` for a single step's glide. */
  public render(progress = 1, eased = false): void {
    this.progress = Math.max(0, Math.min(1, progress));
    this.easedGlide = eased;
    this.updateDrawnPositions();
    if (this.zoomAnimation) {
      const { from, to, start } = this.zoomAnimation;
      const p = Math.min(1, (performance.now() - start) / ZOOM_ANIMATION_MS);
      this.applyZoom(from + (to - from) * easeInOut(p));
      if (p >= 1) this.zoomAnimation = null;
    }

    const { ctx, cellSize, width, height } = this;
    const { config } = this.world;
    const { gridWidth, gridHeight } = config;
    const selectedOrg = this.world.getSelectedOrganism();

    // Background: a dark radial gradient, warmer while the world is lean.
    // With staggered regions there is no world season: each region glows instead.
    const regionSeasons = config.staggeredSeasons && this.world.foodRegions.length > 0;
    const lean = !regionSeasons && seasonAt(this.world.tick, config)?.season === 'lean';
    const bg = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
    bg.addColorStop(0, lean ? '#2a2418' : '#1c2430');
    bg.addColorStop(1, lean ? '#130f0a' : '#0b1017');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Zoomed: follow the selected organism or egg, then shift the world into view.
    if (this.zoom > 1 && this.following) {
      if (selectedOrg) {
        const [sx, sy] = this.displayCentre(selectedOrg);
        const { cx, cy } = this.visibleCentre();
        this.viewX = sx - cx;
        this.viewY = sy - cy;
        this.clampView();
      } else if (this.selectedEggId) {
        const egg = this.world.eggs.get(this.selectedEggId);
        if (egg) {
          const sx = (egg.x + 0.5) * cellSize;
          const sy = (egg.y + 0.5) * cellSize;
          const { cx, cy } = this.visibleCentre();
          this.viewX = sx - cx;
          this.viewY = sy - cy;
          this.clampView();
        }
      }
    }
    ctx.save();
    ctx.translate(-this.viewX, -this.viewY);

    // The world's floor, so its edges read against the full-bleed background.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(0, 0, gridWidth * cellSize, gridHeight * cellSize, Math.min(14, cellSize));
    ctx.fill();
    ctx.stroke();

    // Visible cell range (plus a margin for rings), to skip off-screen drawing.
    const minX = Math.floor(this.viewX / cellSize) - 2;
    const minY = Math.floor(this.viewY / cellSize) - 2;
    const maxX = Math.ceil((this.viewX + width) / cellSize) + 2;
    const maxY = Math.ceil((this.viewY + height) / cellSize) + 2;
    const inView = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;

    // How much detail to draw: plain dots when cells are tiny, glyphs fading
    // in as cells grow (about 2× zoom on a phone).
    const detail = Math.max(0, Math.min(1, (cellSize - 8) / 4));

    // Fertile regions: soft glows, amber while that region is lean
    for (const region of this.world.foodRegions) {
      const regionLean = regionSeasonAt(this.world.tick, region, config)?.season === 'lean';
      const rx = (region.x + 0.5) * cellSize;
      const ry = (region.y + 0.5) * cellSize;
      const r = (region.radius + 1) * cellSize;
      const glow = ctx.createRadialGradient(rx, ry, 0, rx, ry, r);
      glow.addColorStop(0, regionLean ? 'rgba(217, 160, 80, 0.22)' : 'rgba(110, 231, 183, 0.13)');
      glow.addColorStop(0.6, regionLean ? 'rgba(217, 160, 80, 0.10)' : 'rgba(110, 231, 183, 0.06)');
      glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(rx, ry, r, 0, TAU);
      ctx.fill();
    }

    // Rocks: rounded grey blocks, filled as one path
    ctx.fillStyle = '#2b3542';
    ctx.beginPath();
    const inset = Math.max(0.5, cellSize * 0.07);
    const corner = cellSize * 0.24;
    for (const obsKey of this.world.obstacles) {
      const comma = obsKey.indexOf(',');
      const ox = Number(obsKey.slice(0, comma));
      const oy = Number(obsKey.slice(comma + 1));
      if (!inView(ox, oy)) continue;
      ctx.roundRect(ox * cellSize + inset, oy * cellSize + inset, cellSize - inset * 2, cellSize - inset * 2, corner);
    }
    ctx.fill();

    // Food: plants (leaves in their strategy's colour, berries for edible
    // units), or berry clusters on a faint disc
    for (const patch of this.world.foodPatches.values()) {
      if (!inView(patch.x, patch.y)) continue;
      if (patch.plant) this.drawPlant(patch, patch.plant, detail);
      else if (patch.stock > 0) this.drawFoodPatch(patch, detail);
    }
    // Carrion: pale bones on a dark red stain
    for (const c of this.world.carrion.values()) {
      if (c.stock <= 0 || !inView(c.x, c.y)) continue;
      this.drawCarrion(c, detail);
    }

    // Eggs: small pale ovals, waiting
    for (const egg of this.world.eggs.values()) {
      if (!inView(egg.x, egg.y)) continue;
      this.drawEgg(egg, detail);
    }

    // Overlays drawn under the organisms
    if (this.heatmap && this.overlay !== 'none' && this.overlay in HEATMAP_COLOUR) {
      this.drawHeatmap(this.heatmap, HEATMAP_COLOUR[this.overlay as HeatmapKind], inView, this.overlay === 'health' || this.overlay === 'nutrients');
    }
    if (this.overlay === 'trails') this.drawTrails(selectedOrg);
    if (this.overlay === 'senses') this.drawSignalRipples(selectedOrg);
    if (this.overlay === 'weather') this.drawWeather();

    // Sensing range of the selected organism: a soft dashed square
    if (selectedOrg) {
      const radius = Math.round(selectedOrg.sensingRadius ?? config.sensingRadius);
      const x0 = Math.max(0, selectedOrg.x - radius) * cellSize;
      const y0 = Math.max(0, selectedOrg.y - radius) * cellSize;
      const x1 = Math.min(gridWidth, selectedOrg.x + radius + 1) * cellSize;
      const y1 = Math.min(gridHeight, selectedOrg.y + radius + 1) * cellSize;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.roundRect(x0, y0, x1 - x0, y1 - y0, Math.min(12, cellSize * 0.6));
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Organisms (with the family overlay, everyone outside the selected lineage is dimmed)
    const family = this.overlay === 'family' && selectedOrg ? selectedOrg.lineage.id : null;
    if (family && selectedOrg) this.drawFamilyLines(selectedOrg);
    for (const org of this.world.organisms.values()) {
      if (!inView(org.x, org.y)) continue;
      if (family && org.lineage.id !== family) ctx.globalAlpha = 0.18;
      else if (this.highlightSpecies !== null && this.speciesOf?.(org.id) !== this.highlightSpecies) ctx.globalAlpha = 0.18;
      this.drawOrganism(org, detail);
      ctx.globalAlpha = 1;
    }
    if (selectedOrg) this.drawSelection(selectedOrg);

    // Interactions that span two cells: food gifts and births
    if (detail > 0) {
      ctx.globalAlpha = detail;
      this.drawInteractions();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Fading cells, scaled to the busiest cell. */
  private drawHeatmap(cells: Float32Array, rgb: string, inView: (x: number, y: number) => boolean, absolute: boolean): void {
    const { ctx, cellSize } = this;
    const { gridWidth } = this.world.config;
    let max = 1; // health is absolute: 1 means bare ground
    if (this.overlay === 'nutrients') {
      max = this.world.config.nutrientCapacity || 2.0;
    }
    if (!absolute) {
      max = 0;
      for (let i = 0; i < cells.length; i++) if (cells[i] > max) max = cells[i];
    }
    if (max < 0.05) return;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i] / max;
      if (v < 0.03) continue;
      const x = i % gridWidth;
      const y = (i - x) / gridWidth;
      if (!inView(x, y)) continue;
      // Square root lifts quiet cells so the pattern reads, not only the hot spot.
      ctx.fillStyle = `rgba(${rgb}, ${(0.12 + 0.6 * Math.sqrt(v)).toFixed(3)})`;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  /** Weather overlay: dynamic temperature / storm fronts and prevailing wind streamlines. */
  private drawWeather(): void {
    if (!this.world.weather) return;
    const { ctx, cellSize } = this;
    const weather = this.world.weather;

    // 1. Draw weather front areas
    for (const front of weather.fronts) {
      const cx = front.x * cellSize;
      const cy = front.y * cellSize;
      const r = front.radius * cellSize;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);

      if (front.type === 'cold_front') {
        grad.addColorStop(0, `rgba(59, 130, 246, ${0.3 * front.intensity})`);
        grad.addColorStop(1, 'rgba(59, 130, 246, 0)');
      } else if (front.type === 'rain_storm') {
        grad.addColorStop(0, `rgba(16, 185, 129, ${0.28 * front.intensity})`);
        grad.addColorStop(1, 'rgba(16, 185, 129, 0)');
      } else if (front.type === 'heat_wave') {
        grad.addColorStop(0, `rgba(245, 158, 11, ${0.28 * front.intensity})`);
        grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // 2. Draw wind flow streamlines (sparse grid of gentle arrows)
    const step = 6;
    const { gridWidth, gridHeight } = this.world.config;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1.2;

    for (let gy = 3; gy < gridHeight; gy += step) {
      for (let gx = 3; gx < gridWidth; gx += step) {
        const wind = weather.getWind(gx, gy);
        const speed = Math.hypot(wind.wx, wind.wy);
        if (speed < 0.05) continue;

        const x0 = gx * cellSize;
        const y0 = gy * cellSize;
        const length = Math.min(cellSize * 2.5, speed * cellSize * 4);
        const x1 = x0 + (wind.wx / speed) * length;
        const y1 = y0 + (wind.wy / speed) * length;

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();

        const head = Math.min(4, length * 0.3);
        const angle = Math.atan2(wind.wy, wind.wx);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(angle - Math.PI / 6), y1 - head * Math.sin(angle - Math.PI / 6));
        ctx.moveTo(x1, y1);
        ctx.lineTo(x1 - head * Math.cos(angle + Math.PI / 6), y1 - head * Math.sin(angle + Math.PI / 6));
        ctx.stroke();
      }
    }
  }

  /** Short fading paths behind organisms (brighter for the selected one). */
  private drawTrails(selected: OrganismView | undefined): void {
    const { ctx, cellSize } = this;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const org of this.world.organisms.values()) {
      const trail = this.trails.get(org.id);
      if (!trail || trail.length < 1) continue;
      const isSelected = selected?.id === org.id;
      const points = [...trail.map((p) => [(p.x + 0.5) * cellSize, (p.y + 0.5) * cellSize] as const), this.displayCentre(org)];
      ctx.strokeStyle = `hsl(${this.hueOf(org)}, 80%, 65%)`;
      ctx.lineWidth = Math.max(1, cellSize * (isSelected ? 0.14 : 0.07));
      for (let i = 1; i < points.length; i++) {
        ctx.globalAlpha = (isSelected ? 0.9 : 0.45) * (i / points.length);
        ctx.beginPath();
        ctx.moveTo(points[i - 1][0], points[i - 1][1]);
        ctx.lineTo(points[i][0], points[i][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  /**
   * Signals spreading to their real reach (a diamond: reach is counted in
   * steps), and the selected organism's own signal reach. Skewed downwind
   * when weather wind is active.
   */
  private drawSignalRipples(selected: OrganismView | undefined): void {
    const { ctx, cellSize } = this;
    const reach = this.world.config.signalRadius;
    const diamond = (cx: number, cy: number, r: number, gx: number, gy: number) => {
      let k = 0;
      let ux = 0;
      let uy = 0;
      if (this.world.weather) {
        const wind = this.world.weather.getWind(gx, gy);
        const speed = Math.hypot(wind.wx, wind.wy);
        if (speed > 0.05) {
          k = speed * 0.3;
          ux = wind.wx / speed;
          uy = wind.wy / speed;
        }
      }
      const rawPts: readonly [number, number][] = [
        [0, -r],
        [r, 0],
        [0, r],
        [-r, 0],
      ];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const [dx, dy] = rawPts[i];
        const dot = k > 0 ? (dx * ux + dy * uy) / r : 0;
        const stretch = 1 + k * dot;
        const px = cx + dx * stretch;
        const py = cy + dy * stretch;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };
    ctx.lineWidth = Math.max(1, cellSize * 0.06);
    for (const org of this.world.organisms.values()) {
      const last = org.recentHistory[0];
      if (last?.chosenAction.type !== 'SIGNAL' || last.outcome !== 'success') continue;
      const [cx, cy] = this.displayCentre(org);
      const p = this.progress;
      ctx.strokeStyle = `hsla(${this.hueOf(org)}, 85%, 70%, ${(0.55 * (1 - p) + 0.08).toFixed(3)})`;
      diamond(cx, cy, Math.max(0.1, p) * (reach + 0.5) * cellSize, org.x, org.y);
      ctx.stroke();
    }
    if (selected) {
      const [cx, cy] = this.displayCentre(selected);
      ctx.strokeStyle = 'rgba(103, 232, 249, 0.45)';
      ctx.fillStyle = 'rgba(103, 232, 249, 0.04)';
      ctx.setLineDash([3, 5]);
      diamond(cx, cy, (reach + 0.5) * cellSize, selected.x, selected.y);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /** Lines from the selected organism to its living parent (solid) and children (dashed). */
  private drawFamilyLines(selected: OrganismView): void {
    const { ctx, cellSize } = this;
    const [sx, sy] = this.displayCentre(selected);
    ctx.lineWidth = Math.max(1, cellSize * 0.07);
    ctx.lineCap = 'round';
    const link = (other: OrganismView, dashed: boolean) => {
      const [ox, oy] = this.displayCentre(other);
      ctx.setLineDash(dashed ? [3, 4] : []);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ox, oy);
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
    for (const parentId of [selected.lineage.parentId, selected.lineage.mateId]) {
      const parent = parentId ? this.world.organisms.get(parentId) : undefined;
      if (parent) link(parent, false);
    }
    ctx.strokeStyle = 'rgba(252, 216, 119, 0.8)';
    for (const org of this.world.organisms.values()) {
      if (org.lineage.parentId === selected.id || org.lineage.mateId === selected.id) link(org, true);
    }
    ctx.setLineDash([]);
    ctx.lineCap = 'butt';
  }

  /** Gold arrows from givers to receivers, and thin lines from parents to newborns. */
  private drawInteractions(): void {
    const { ctx, cellSize } = this;
    const centre = (o: { x: number; y: number }) => [(o.x + 0.5) * cellSize, (o.y + 0.5) * cellSize];
    ctx.lineCap = 'round';

    for (const org of this.world.organisms.values()) {
      const last = org.recentHistory[0];
      if (!last) continue;
      const type = last.chosenAction.type;

      // An attack: a red slash across the prey's cell (bold if it killed)
      if (type.startsWith('ATTACK_') && last.chosenAction.target) {
        const killed = last.outcome === 'success';
        const [tx, ty] = centre(last.chosenAction.target);
        const s = cellSize * 0.3;
        ctx.strokeStyle = BITE;
        ctx.globalAlpha *= killed ? 1 : 0.5;
        ctx.lineWidth = Math.max(1.2, cellSize * (killed ? 0.1 : 0.06));
        ctx.beginPath();
        for (const off of [-0.35, 0, 0.35]) {
          ctx.moveTo(tx - s + off * s, ty - s - off * s);
          ctx.lineTo(tx + s + off * s, ty + s - off * s);
        }
        ctx.stroke();
        ctx.globalAlpha /= killed ? 1 : 0.5;
        continue;
      }
      if (last.outcome !== 'success') continue;

      if (type.startsWith('GIVE_') && last.chosenAction.recipientId) {
        const recipient = this.world.organisms.get(last.chosenAction.recipientId);
        if (!recipient) continue;
        const [x1, y1] = this.displayCentre(org);
        const [x2, y2] = this.displayCentre(recipient);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
        const head = Math.max(3, cellSize * 0.22);
        const ex = x2 - ux * cellSize * 0.32;
        const ey = y2 - uy * cellSize * 0.32;
        ctx.strokeStyle = GIFT;
        ctx.fillStyle = GIFT;
        ctx.lineWidth = Math.max(1.5, cellSize * 0.08);
        ctx.beginPath();
        ctx.moveTo(x1 + ux * cellSize * 0.3, y1 + uy * cellSize * 0.3);
        ctx.lineTo(ex - ux * head * 0.6, ey - uy * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ux * head - uy * head * 0.7, ey - uy * head + ux * head * 0.7);
        ctx.lineTo(ex - ux * head + uy * head * 0.7, ey - uy * head - ux * head * 0.7);
        ctx.closePath();
        ctx.fill();
        // The receiver gets a soft gold ring
        ctx.globalAlpha *= 0.8;
        ctx.lineWidth = Math.max(1, cellSize * 0.05);
        ctx.beginPath();
        ctx.arc(x2, y2, cellSize * 0.46, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha /= 0.8;
      } else if (type.startsWith('REPRODUCE_') && last.chosenAction.target) {
        const [x1, y1] = this.displayCentre(org);
        const [x2, y2] = centre(last.chosenAction.target);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.lineCap = 'butt';
  }

  private drawEgg(egg: EggView, detail: number): void {
    const { ctx, cellSize } = this;
    const cx = (egg.x + 0.5) * cellSize;
    const cy = (egg.y + 0.5) * cellSize;
    const sizeScale = Math.max(0.7, Math.min(1.5, Math.sqrt(egg.size || 1)));
    const rx = cellSize * 0.2 * sizeScale;
    const ry = cellSize * 0.27 * sizeScale;
    const tagHue = Math.round(egg.tag ?? 45);
    const shellStrength = Math.max(0, Math.min(1, egg.shell ?? 0.5));

    // Shell body tinted gently by parent lineage tag
    ctx.fillStyle = `hsl(${tagHue}, 38%, 86%)`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.fill();

    // Inner embryo yolk core visible when zoomed in
    if (detail >= 0.35) {
      const energyNorm = Math.max(0.3, Math.min(1, (egg.energy || 25) / 60));
      ctx.fillStyle = `hsla(${tagHue}, 78%, 56%, 0.65)`;
      ctx.beginPath();
      ctx.arc(cx, cy + ry * 0.1, rx * 0.52 * energyNorm, 0, TAU);
      ctx.fill();
    }

    // Calcified shell rim: thickness and contrast reflect shell buffer durability
    if (cellSize >= 5.5) {
      ctx.strokeStyle = `rgba(55, 42, 24, ${(0.35 + 0.55 * shellStrength).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.8, cellSize * (0.035 + 0.055 * shellStrength));
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.stroke();
    }

    if (egg.id === this.selectedEggId) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(5, cellSize * 0.5 * sizeScale), 0, TAU);
      ctx.stroke();
    }
  }

  private drawCarrion(c: CarrionPatch, detail: number): void {
    const { ctx, cellSize } = this;
    const cx = (c.x + 0.5) * cellSize;
    const cy = (c.y + 0.5) * cellSize;
    const config = this.world.config;
    const baseEnergy = config.carrionBodyEnergy;
    const size = Math.min(1, 0.5 + c.stock / 100); // by the energy left in it

    const isFresh = c.stock >= baseEnergy * 0.7;
    const isDecomposing = !isFresh && c.stock >= baseEnergy * 0.3;

    if (isFresh) {
      // Fresh carcass: vivid crimson circle with fleshy tint
      ctx.fillStyle = 'rgba(225, 29, 72, 0.38)';
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * 0.44 * size, 0, TAU);
      ctx.fill();

      // Fleshy tint core
      ctx.fillStyle = 'rgba(251, 113, 133, 0.48)';
      ctx.beginPath();
      ctx.arc(cx - cellSize * 0.04, cy - cellSize * 0.04, cellSize * 0.26 * size, 0, TAU);
      ctx.fill();

      if (detail < 0.5) {
        ctx.fillStyle = 'rgba(244, 63, 94, 0.9)';
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.7, cellSize * 0.12 * size), 0, TAU);
        ctx.fill();
        return;
      }
      // Fleshy nodule with subtle submerged bone tip
      ctx.fillStyle = 'rgba(254, 205, 211, 0.85)';
      ctx.strokeStyle = 'rgba(254, 205, 211, 0.85)';
      const half = cellSize * 0.16 * size;
      const knob = cellSize * 0.05;
      ctx.lineWidth = Math.max(0.9, cellSize * 0.06);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - half, cy + half * 0.5);
      ctx.lineTo(cx + half, cy - half * 0.5);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const [bx, by] of [
        [cx - half, cy + half * 0.5],
        [cx + half, cy - half * 0.5],
      ] as const) {
        ctx.moveTo(bx + knob, by);
        ctx.arc(bx, by, knob, 0, TAU);
      }
      ctx.fill();
    } else if (isDecomposing) {
      // Decomposing flesh: darker brown-red puddle with exposed bone
      ctx.fillStyle = 'rgba(127, 29, 29, 0.32)';
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * 0.42 * size, 0, TAU);
      ctx.fill();

      ctx.fillStyle = BONE;
      ctx.strokeStyle = BONE;
      if (detail < 0.5) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.7, cellSize * 0.1 * size), 0, TAU);
        ctx.fill();
        return;
      }
      // Prominent exposed bone: a bar with a knob at each end
      const half = cellSize * 0.2 * size;
      const knob = cellSize * 0.06;
      ctx.lineWidth = Math.max(1, cellSize * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - half, cy + half * 0.6);
      ctx.lineTo(cx + half, cy - half * 0.6);
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const [bx, by] of [
        [cx - half, cy + half * 0.6],
        [cx + half, cy - half * 0.6],
      ] as const) {
        ctx.moveTo(bx + knob, by);
        ctx.arc(bx, by, knob, 0, TAU);
      }
      ctx.fill();
    } else {
      // Weathered bones: desaturated faint weathered stain with pale bone fragments
      ctx.fillStyle = 'rgba(120, 113, 108, 0.16)';
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * 0.36 * size, 0, TAU);
      ctx.fill();

      const paleBone = 'rgba(214, 211, 200, 0.82)';
      ctx.fillStyle = paleBone;
      ctx.strokeStyle = paleBone;
      if (detail < 0.5) {
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.6, cellSize * 0.08 * size), 0, TAU);
        ctx.fill();
        return;
      }
      // Disjoint pale bone fragments / shards
      const frag = cellSize * 0.15 * size;
      ctx.lineWidth = Math.max(0.8, cellSize * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - frag, cy - frag * 0.2);
      ctx.lineTo(cx - frag * 0.2, cy - frag * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + frag * 0.2, cy + frag * 0.3);
      ctx.lineTo(cx + frag * 0.9, cy + frag * 0.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + frag * 0.3, cy - frag * 0.4, Math.max(0.6, cellSize * 0.04), 0, TAU);
      ctx.fill();
      ctx.lineCap = 'butt';
    }
  }

  /**
   * A plant: a rosette of leaves sized by its whole mass (edible plus roots),
   * coloured by strategy (greyed while dormant), with leaf count from maxBiomass,
   * blade shape from growthRate, root halo from roots/rootShare, and berries
   * scaled by seedSize. Seedlings are small dots.
   */
  private drawPlant(patch: FoodPatch, plant: Plant, detail: number): void {
    const { ctx, cellSize } = this;
    const cx = (patch.x + 0.5) * cellSize;
    const cy = (patch.y + 0.5) * cellSize;
    const g = plant.genome;
    const hue = plantHue(g);
    const size = plant.biomass + plant.roots;
    const r = cellSize * (0.12 + 0.34 * Math.min(1, Math.sqrt(size / 10)));
    const sat = plant.dormant ? 12 : 55;

    // Subterranean root halo when roots / rootShare are substantial
    if (plant.roots > 0.4 && cellSize >= 5.5) {
      const rootRadius = cellSize * (0.14 + 0.28 * Math.min(1, Math.sqrt(plant.roots / 6)));
      ctx.strokeStyle = `hsla(32, 48%, 32%, ${(0.25 + 0.35 * g.rootShare).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.8, cellSize * 0.055);
      ctx.beginPath();
      ctx.arc(cx, cy, rootRadius, 0, TAU);
      ctx.stroke();
    }

    ctx.fillStyle = `hsla(${hue}, ${sat}%, ${plant.dormant ? 45 : 38}%, 0.85)`;
    ctx.beginPath();
    if (cellSize < 5.5 || size < 1) {
      ctx.arc(cx, cy, Math.max(0.7, r), 0, TAU);
    } else {
      // Leaf count (3..8) scales with genetic maxBiomass; blade aspect scales with growthRate
      const leaves = 3 + Math.round(unit(g.maxBiomass, 1, 20) * 5);
      const growthNorm = unit(g.growthRate, 0.01, 1);
      const leafLen = r * (0.48 + 0.16 * growthNorm);
      const leafWid = r * (0.44 - 0.14 * growthNorm);
      const spread = r * (plant.dormant ? 0.28 : 0.5);
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * TAU + 0.3;
        const lx = cx + Math.cos(a) * spread;
        const ly = cy + Math.sin(a) * spread;
        ctx.moveTo(lx + leafLen, ly);
        ctx.ellipse(lx, ly, leafLen, leafWid, a, 0, TAU);
      }
    }
    ctx.fill();

    // High-dispersal spore/pappus tips at high zoom
    if (detail >= 0.7 && g.dispersal >= 6 && size >= 1 && !plant.dormant) {
      const leaves = 3 + Math.round(unit(g.maxBiomass, 1, 20) * 5);
      ctx.strokeStyle = 'rgba(236, 253, 245, 0.55)';
      ctx.lineWidth = Math.max(0.7, cellSize * 0.035);
      ctx.beginPath();
      for (let i = 0; i < leaves; i++) {
        const a = (i / leaves) * TAU + 0.3;
        const r0 = r * 0.82;
        const r1 = r * (0.98 + 0.14 * unit(g.dispersal, 6, 10));
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.stroke();
    }

    // Sharp thorn/spine needles radiating from leaf axils for defended plants
    if (plant.genome.defense !== undefined && plant.genome.defense > 0.2 && cellSize >= 5.5) {
      const spineCount = 3 + Math.round(plant.genome.defense * 5);
      const spineLen = r * (0.35 + 0.35 * plant.genome.defense);
      ctx.strokeStyle = `hsla(15, 85%, 65%, ${(0.45 + 0.45 * plant.genome.defense).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.8, cellSize * 0.04);
      ctx.beginPath();
      for (let i = 0; i < spineCount; i++) {
        const a = (i / spineCount) * TAU + (Math.PI / spineCount) + 0.3;
        const r0 = r * 0.55;
        const r1 = r0 + spineLen;
        ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      ctx.stroke();
    }

    if (patch.stock > 0 && cellSize >= 7) {
      const ratio = Math.max(0, Math.min(1, patch.stock / patch.capacity));
      const berries = Math.max(1, Math.ceil(ratio * 5));
      const spread = berries === 1 ? 0 : cellSize * 0.14;
      const seedScale = 0.78 + 0.45 * unit(g.seedSize, 0.2, 4);
      const br = cellSize * 0.085 * seedScale;
      ctx.fillStyle = BERRY;
      ctx.beginPath();
      for (let i = 0; i < berries; i++) {
        const a = i * 1.7 + 0.4;
        const bx = cx + Math.cos(a) * spread;
        const by = cy + Math.sin(a) * spread;
        ctx.moveTo(bx + br, by);
        ctx.arc(bx, by, br, 0, TAU);
      }
      ctx.fill();
    } else if (patch.stock > 0) {
      ctx.fillStyle = BERRY;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.6, cellSize * 0.1), 0, TAU);
      ctx.fill();
    }
    if (plant.id === this.selectedPlantId) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(5, cellSize * 0.62), 0, TAU);
      ctx.stroke();
    }
  }

  private drawFoodPatch(patch: FoodPatch, detail: number): void {
    const { ctx, cellSize } = this;
    const cx = (patch.x + 0.5) * cellSize;
    const cy = (patch.y + 0.5) * cellSize;
    const ratio = Math.max(0, Math.min(1, patch.stock / patch.capacity));

    ctx.fillStyle = 'rgba(134, 239, 172, 0.16)';
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.45, 0, TAU);
    ctx.fill();

    ctx.fillStyle = BERRY;
    if (detail < 0.5) {
      // Tiny cells: one berry, sized by stock
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(0.8, cellSize * (0.12 + 0.14 * ratio)), 0, TAU);
      ctx.fill();
      return;
    }
    // A cluster of berries, one per fifth of capacity (at least one)
    const berries = Math.max(1, Math.ceil(ratio * 5));
    const spread = berries === 1 ? 0 : cellSize * 0.17;
    const r = cellSize * 0.115;
    ctx.beginPath();
    for (let i = 0; i < berries; i++) {
      const a = i * 1.7 + 0.4;
      const bx = cx + Math.cos(a) * spread;
      const by = cy + Math.sin(a) * spread;
      ctx.moveTo(bx + r, by);
      ctx.arc(bx, by, r, 0, TAU);
    }
    ctx.fill();
  }

  private drawSelection(org: OrganismView): void {
    const { ctx, cellSize } = this;
    const [cx, cy] = this.displayCentre(org);
    const lift = this.leapLiftOf(org);
    const selY = cy - lift;
    const r = Math.max(5, cellSize * 0.62);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, selY, r, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = `hsla(${this.hueOf(org)}, 90%, 72%, 0.45)`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, selY, r + 4, 0, TAU);
    ctx.stroke();
  }

  private drawOrganism(org: OrganismView, detail: number): void {
    const { ctx, cellSize } = this;
    const [gx, gy] = this.displayCentre(org);
    const lift = this.leapLiftOf(org);
    const cx = gx;
    const cy = gy - lift;
    const config = this.world.config;
    // Growth: a juvenile is drawn smaller (render only), and its energy is shown against its smaller capacity.
    const bodyScale = bodyScaleOf(org, config);
    const maxEnergy = config.maxEnergy * (config.sizeGeneEnabled ? (org.size ?? 1) : 1) * bodyScale;
    const energyRatio = Math.max(0, Math.min(1, org.energy / maxEnergy));
    const hue = Math.round(this.hueOf(org));
    const sizeScale = (config.sizeGeneEnabled ? Math.sqrt(org.size ?? 1) : 1) * Math.sqrt(bodyScale);
    // Size by energy and body size, so glyphs stay readable and mice vs elephants are visible.
    const r = Math.max(1.6, cellSize * 0.4 * (0.6 + 0.4 * energyRatio) * sizeScale);

    // Airborne ground drop shadow (projected on the terrain floor beneath the leaping organism)
    if (lift > 0.5) {
      const Hmax = cellSize * 0.85;
      const shadowFactor = Math.max(0, 1 - lift / Hmax);
      const shadowScale = 0.75 + 0.25 * shadowFactor;
      const shadowAlpha = 0.14 + 0.18 * shadowFactor;
      ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(gx, gy, Math.max(2, r * shadowScale * 1.15), Math.max(1.5, r * shadowScale * 0.6), 0, 0, TAU);
      ctx.fill();
    }

    // Phenotype traits (safe fallbacks when genes are switched off or absent)
    const squeeze = config.squeezeEnabled ? (org.abilities?.squeeze ?? 0) : 0;
    const leap = config.leapEnabled ? (org.abilities?.leap ?? 0) : 0;
    const diagonal = config.diagonalMoves ? (org.abilities?.diagonal ?? 0) : 0;
    const fatCap = config.fatEnabled ? (org.fatCapacity ?? 0) : 0;
    const fatHeld = config.fatEnabled ? (org.fat ?? 0) : 0;
    const fatRatio = fatCap > 0 ? Math.min(1, fatHeld / Math.max(10, fatCap)) : 0;
    const torpor = config.torporEnabled && org.rested ? (org.torporDepth ?? 0) : 0;
    const carnivory = org.carnivory * (config.carnivoreGeneEnabled ? (org.carnivoreEfficiency ?? 1) : 1);

    // Body aspect: streamlined along heading for squeeze, plumper laterally when fat-loaded
    const heading = this.drawn.get(org.id)?.heading ?? -Math.PI / 2;
    const a = r * (1 + 0.2 * squeeze - 0.05 * fatRatio);
    const b = r * (1 - 0.13 * squeeze + 0.22 * fatRatio);
    const fx = Math.cos(heading);
    const fy = Math.sin(heading);
    const rx = -fy;
    const ry = fx;

    const sat = torpor > 0.1 ? Math.round(82 - 35 * torpor) : 82;
    const baseLight = Math.round(40 + 18 * energyRatio);

    if (cellSize < 5.5) {
      // Ultra-compact cells: fast 2-layer dot + fat/torpor cues
      ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.22)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.85, 0, TAU);
      ctx.fill();
      ctx.fillStyle = `hsl(${hue}, ${sat}%, ${baseLight + 10}%)`;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.fill();
      return;
    }

    const last = org.recentHistory[0];
    const type = last?.chosenAction.type ?? 'REST';
    const succeeded = last?.outcome === 'success';
    const eating = (type === 'EAT' || type === 'EAT_CARRION') && succeeded;

    // Signalling: two soft rings in its own hue
    if (type === 'SIGNAL' && succeeded && detail > 0) {
      ctx.lineWidth = Math.max(1, cellSize * 0.06);
      for (const [scale, alpha] of [[1.45, 0.55], [2.0, 0.28]] as const) {
        ctx.strokeStyle = `hsla(${hue}, 90%, 75%, ${(alpha * detail).toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r * scale, 0, TAU);
        ctx.stroke();
      }
    }

    // LOD 1+: Rear propulsion fin/chevron for leapers (drawn behind body)
    if (leap > 0.05) {
      const finLen = r * (0.28 + 0.22 * leap);
      const finSpread = b * 0.48;
      const bx = cx - fx * (a * 0.85);
      const by = cy - fy * (a * 0.85);
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 72%, 0.85)`;
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(bx + rx * finSpread - fx * finLen, by + ry * finSpread - fy * finLen);
      ctx.lineTo(bx - fx * (finLen * 0.25), by - fy * (finLen * 0.25));
      ctx.lineTo(bx - rx * finSpread - fx * finLen, by - ry * finSpread - fy * finLen);
      ctx.stroke();
    }

    // LOD 2: 45° diagonal setae/notches for diagonal movers
    if (diagonal > 0.05 && detail >= 0.35) {
      ctx.strokeStyle = `hsla(${hue}, ${sat}%, 76%, ${(0.75 * detail).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.9, r * 0.13);
      ctx.beginPath();
      const c45 = 0.7071;
      for (const sx of [-1, 1] as const) {
        for (const sy of [-1, 1] as const) {
          const dx = (fx * sx * a + rx * sy * b) * c45;
          const dy = (fy * sx * a + ry * sy * b) * c45;
          ctx.moveTo(cx + dx * 0.88, cy + dy * 0.88);
          ctx.lineTo(cx + dx * (1.16 + 0.12 * diagonal), cy + dy * (1.16 + 0.12 * diagonal));
        }
      }
      ctx.stroke();
    }

    // Two-tone layered pebble body (replaces expensive per-organism createRadialGradient)
    ctx.fillStyle = `hsl(${hue}, ${sat}%, ${baseLight}%)`;
    ctx.beginPath();
    if (eating) {
      ctx.moveTo(cx, cy);
      ctx.ellipse(cx, cy, a, b, heading, Math.PI * 0.22, Math.PI * 1.78);
      ctx.closePath();
    } else {
      ctx.ellipse(cx, cy, a, b, heading, 0, TAU);
    }
    ctx.fill();

    // Top-left specular pebble highlight + inner digestive core modulation
    if (!eating) {
      const gutBoost = config.digestiveGeneEnabled ? unit(org.digestiveEfficiency ?? 1, 0.5, 1.5) : 0.5;
      ctx.fillStyle = `hsla(${hue}, 90%, 76%, ${(0.34 + 0.22 * gutBoost).toFixed(2)})`;
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.22, cy - r * 0.22, a * 0.62, b * 0.58, heading, 0, TAU);
      ctx.fill();
    }

    // Fat reserve: warm amber adipose inner rim when carrying stored fat
    if (fatHeld > 1) {
      const fatAlpha = Math.min(0.9, 0.35 + 0.55 * fatRatio);
      ctx.strokeStyle = `hsla(42, 95%, 62%, ${fatAlpha.toFixed(2)})`;
      ctx.lineWidth = Math.max(1, r * (0.12 + 0.18 * fatRatio));
      ctx.beginPath();
      ctx.ellipse(cx, cy, a * 0.86, b * 0.86, heading, 0, TAU);
      ctx.stroke();
    }

    // Torpor rest shell: cool frosted outer rim when hibernating/resting in torpor
    if (torpor > 0.1) {
      ctx.strokeStyle = `hsla(200, 45%, 82%, ${(0.35 + 0.5 * torpor).toFixed(2)})`;
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.beginPath();
      ctx.ellipse(cx, cy, a + 1.2, b + 1.2, heading, 0, TAU);
      ctx.stroke();
    }

    // Acute toxin distress spasm glyph: vibrating amber-magenta jagged distress ring / starburst
    if (eating && org.lastBiteYield !== undefined && org.lastBiteYield < 0.775) {
      const malaiseNorm = Math.min(1, (0.775 - org.lastBiteYield) / 0.4);
      const ringBase = Math.max(a, b) + Math.max(1.8, cellSize * 0.12);
      const points = 10;
      const t = performance.now() * 0.018;
      ctx.strokeStyle = `hsla(300, 80%, 60%, ${(0.65 + 0.25 * malaiseNorm).toFixed(2)})`;
      ctx.fillStyle = `hsla(330, 85%, 55%, ${(0.12 + 0.1 * malaiseNorm).toFixed(2)})`;
      ctx.lineWidth = Math.max(1, cellSize * 0.055);
      ctx.beginPath();
      for (let i = 0; i < points * 2; i++) {
        const angle = (i / (points * 2)) * TAU + (t * 0.2) % TAU;
        const isSpike = i % 2 === 1;
        const vibe = Math.sin(t * 3 + i * 1.8) * cellSize * 0.06 * malaiseNorm;
        const spikeLen = isSpike ? cellSize * (0.15 + 0.18 * malaiseNorm) : 0;
        const rad = ringBase + spikeLen + vibe;
        const px = cx + Math.cos(angle) * rad;
        const py = cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Sharp amber inner spasms
      ctx.strokeStyle = `hsla(38, 95%, 58%, ${(0.7 * malaiseNorm).toFixed(2)})`;
      ctx.lineWidth = Math.max(0.8, cellSize * 0.035);
      ctx.beginPath();
      for (let i = 0; i < points; i++) {
        const angle = (i / points) * TAU + (t * 0.4) % TAU;
        const rad0 = ringBase * 0.75;
        const rad1 = ringBase * 1.05;
        ctx.moveTo(cx + Math.cos(angle) * rad0, cy + Math.sin(angle) * rad0);
        ctx.lineTo(cx + Math.cos(angle) * rad1, cy + Math.sin(angle) * rad1);
      }
      ctx.stroke();
    }

    // Predatory / Carnivore forward mandible bevel at the leading edge (+f)
    if (carnivory >= 0.22 && !eating) {
      const strength = Math.min(1, (carnivory - 0.2) / 0.65);
      const tipX = cx + fx * (a * (1.02 + 0.16 * strength));
      const tipY = cy + fy * (a * (1.02 + 0.16 * strength));
      const baseX = cx + fx * (a * 0.68);
      const baseY = cy + fy * (a * 0.68);
      const jawSpread = b * (0.28 + 0.18 * strength);
      ctx.strokeStyle = `rgba(251, 113, 133, ${(0.55 + 0.4 * strength).toFixed(2)})`;
      ctx.lineWidth = Math.max(1, r * 0.16);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(baseX + rx * jawSpread, baseY + ry * jawSpread);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(baseX - rx * jawSpread, baseY - ry * jawSpread);
      ctx.stroke();
    }

    // LOD 2: Sensory aperture crescent & neural/memory core nodes
    if (detail >= 0.35) {
      const senseR = config.sensingGeneEnabled ? (org.sensingRadius ?? config.sensingRadius) : config.sensingRadius;
      if (senseR > 2.2) {
        const span = (0.22 + 0.14 * unit(senseR, 2, 6)) * Math.PI;
        ctx.strokeStyle = `hsla(190, 90%, 82%, ${(0.45 * detail).toFixed(2)})`;
        ctx.lineWidth = Math.max(0.9, r * 0.11);
        ctx.beginPath();
        ctx.ellipse(cx, cy, a + Math.max(1.5, r * 0.22), b + Math.max(1.5, r * 0.22), heading, -span, span);
        ctx.stroke();
      }

      const memSpan = config.memoryEnabled ? (org.memorySpan ?? 0) : 0;
      const brainExtra = org.acquiredBrainUnits ?? 0;
      const nodeCount = Math.min(3, (memSpan >= 8 ? 1 : 0) + (memSpan >= 24 ? 1 : 0) + (brainExtra > 0 ? 1 : 0));
      if (nodeCount > 0 && detail >= 0.55) {
        const nodeR = Math.max(0.8, r * 0.1);
        ctx.fillStyle = `rgba(255, 255, 255, ${(0.82 * detail).toFixed(2)})`;
        ctx.beginPath();
        for (let i = 0; i < nodeCount; i++) {
          const offsetLat = (i - (nodeCount - 1) / 2) * (b * 0.36);
          const nx = cx + fx * (a * 0.48) + rx * offsetLat;
          const ny = cy + fy * (a * 0.48) + ry * offsetLat;
          ctx.moveTo(nx + nodeR, ny);
          ctx.arc(nx, ny, nodeR, 0, TAU);
        }
        ctx.fill();
      }
    }

    if (detail <= 0) {
      return;
    }

    ctx.globalAlpha = detail;
    ctx.strokeStyle = GLYPH;
    ctx.fillStyle = GLYPH;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const stroke = Math.max(1.2, r * 0.17);
    ctx.lineWidth = stroke;

    const moving = isMoveAction(type) || isLeapAction(type);
    if (moving && succeeded) {
      if (isLeapAction(type)) {
        // Stationary 2.5D ballistic trajectory guide anchored to fixed grid cells
        const [hx, hy] = directionOf(type);
        const originPx = (org.x - 2 * hx + 0.5) * cellSize;
        const originPy = (org.y - 2 * hy + 0.5) * cellSize;
        const targetPx = (org.x + 0.5) * cellSize;
        const targetPy = (org.y + 0.5) * cellSize;
        const midPx = (originPx + targetPx) / 2;
        const midPy = (originPy + targetPy) / 2;
        const Hmax = cellSize * 0.85;
        const cpx = midPx;
        const cpy = midPy - 2 * Hmax;

        // Subtle ground track connecting origin to destination
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = Math.max(0.9, stroke * 0.65);
        ctx.setLineDash([cellSize * 0.12, cellSize * 0.12]);
        ctx.beginPath();
        ctx.moveTo(originPx, originPy);
        ctx.lineTo(targetPx, targetPy);
        ctx.stroke();
        ctx.setLineDash([]);

        // Ballistic parabolic trajectory curve in 2.5D perspective
        ctx.strokeStyle = GLYPH;
        ctx.lineWidth = stroke;
        ctx.beginPath();
        ctx.moveTo(originPx, originPy);
        ctx.quadraticCurveTo(cpx, cpy, targetPx, targetPy);
        ctx.stroke();

        // Arrowhead at landing
        const tx = targetPx - cpx;
        const ty = targetPy - cpy;
        const tLen = Math.hypot(tx, ty) || 1;
        const ux = tx / tLen;
        const uy = ty / tLen;
        const wing = r * 0.32;
        const wingX = targetPx - ux * wing;
        const wingY = targetPy - uy * wing;
        const px = -uy * wing * 0.65;
        const py = ux * wing * 0.65;
        ctx.beginPath();
        ctx.moveTo(wingX + px, wingY + py);
        ctx.lineTo(targetPx, targetPy);
        ctx.lineTo(wingX - px, wingY - py);
        ctx.stroke();
      } else {
        // Moving: a white arrow along the way it went
        const [hx, hy] = directionOf(type);
        const tip = r * 0.5;
        const wing = r * 0.28;
        ctx.beginPath();
        ctx.moveTo(cx - hx * r * 0.4, cy - hy * r * 0.4);
        ctx.lineTo(cx + hx * tip, cy + hy * tip);
        ctx.moveTo(cx + hx * (tip - wing) - hy * wing, cy + hy * (tip - wing) + hx * wing);
        ctx.lineTo(cx + hx * tip, cy + hy * tip);
        ctx.lineTo(cx + hx * (tip - wing) + hy * wing, cy + hy * (tip - wing) - hx * wing);
        ctx.stroke();
      }
    } else if (moving) {
      // Blocked: a white bar on the side it pushed toward
      const [hx, hy] = directionOf(type);
      const off = r * 0.5;
      const half = r * 0.45;
      ctx.lineWidth = stroke * 1.2;
      ctx.beginPath();
      ctx.moveTo(cx + hx * off - hy * half, cy + hy * off + hx * half);
      ctx.lineTo(cx + hx * off + hy * half, cy + hy * off - hx * half);
      ctx.stroke();
    } else if (type === 'PICK_UP' && succeeded) {
      // Harvesting: a small pouch outline
      const half = r * 0.32;
      ctx.beginPath();
      ctx.roundRect(cx - half, cy - half * 0.8, half * 2, half * 1.8, half * 0.5);
      ctx.stroke();
    } else if (!eating) {
      // Resting or anything else: a soft white core
      ctx.globalAlpha = detail * 0.7;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r * 0.2), 0, TAU);
      ctx.fill();
      ctx.globalAlpha = detail;
    }

    // Newborn: a thin white ring for its first few ticks
    if (org.age < 4) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2, 0, TAU);
      ctx.stroke();
    }

    // Starving (below a quarter of max energy): a red dashed ring
    if (org.energy < maxEnergy * 0.25) {
      ctx.strokeStyle = STARVING;
      ctx.lineWidth = Math.max(1, cellSize * 0.05);
      const dash = Math.max(1.5, cellSize * 0.09);
      ctx.setLineDash([dash, dash]);
      ctx.beginPath();
      ctx.arc(cx, cy, r + Math.max(2, cellSize * 0.1), 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Carried food: one berry per unit, along the top
    if (org.carriedFood > 0) {
      const pip = Math.max(1, cellSize * 0.075);
      const spacing = pip * 2.6;
      ctx.fillStyle = BERRY;
      ctx.beginPath();
      for (let i = 0; i < org.carriedFood; i++) {
        const px = cx + (i - (org.carriedFood - 1) / 2) * spacing;
        const py = cy - r - pip * 1.2;
        ctx.moveTo(px + pip, py);
        ctx.arc(px, py, pip, 0, TAU);
      }
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }
}
