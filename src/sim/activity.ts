import type { World } from './world';

type ObservedKind = 'crowding' | 'deaths' | 'feeding';
/** Heatmap overlays: the three fading activity maps, and cell health (read from the world: it is a state, not an activity). */
export type HeatmapKind = ObservedKind | 'health';
export const HEATMAP_KINDS: readonly HeatmapKind[] = ['crowding', 'deaths', 'feeding', 'health'];

/** Each tick old activity fades by this factor (half-life about 140 ticks). */
export const HEAT_DECAY = 0.995;

/**
 * Fading per-cell counts of where things happen, for the heatmap overlays:
 * moves blocked by other organisms (crowding), deaths, and meals. Updated
 * after every tick by reading the world; it changes no outcome.
 */
export class ActivityMaps {
  public readonly width: number;
  public readonly height: number;
  private readonly maps: Record<ObservedKind, Float32Array>;
  /** Where each organism stood after the previous tick, to place deaths. */
  private lastPositions = new Map<string, number>();

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.maps = {
      crowding: new Float32Array(width * height),
      deaths: new Float32Array(width * height),
      feeding: new Float32Array(width * height),
    };
  }

  public observe(world: World): void {
    const { crowding, deaths, feeding } = this.maps;
    for (const map of [crowding, deaths, feeding]) {
      for (let i = 0; i < map.length; i++) map[i] *= HEAT_DECAY;
    }
    const positions = new Map<string, number>();
    for (const o of world.organisms.values()) {
      const cell = o.y * this.width + o.x;
      positions.set(o.id, cell);
      const last = o.recentHistory[0];
      if (!last || last.tick !== world.tick - 1) continue; // newborns and immigrants have not acted yet
      if (last.outcome === 'blocked_by_organism' || last.outcome === 'conflict_lost') crowding[cell] += 1;
      if (last.chosenAction.type === 'EAT' && last.outcome === 'success') feeding[cell] += 1;
    }
    for (const [id, cell] of this.lastPositions) {
      if (!positions.has(id)) deaths[cell] += 1;
    }
    this.lastPositions = positions;
  }

  /** A copy of one map, for sending to the page. */
  public snapshot(kind: HeatmapKind, world: World): Float32Array {
    // Health overlay: how much of each cell's health is lost (0 healthy, 1 bare), zero everywhere when overgrazing is off.
    if (kind === 'health') return world.cellHealth ? world.cellHealth.health.map((h) => 1 - h) : new Float32Array(this.width * this.height);
    return this.maps[kind].slice();
  }
}
