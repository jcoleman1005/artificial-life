/**
 * The boundary between the simulation (run by a Web Worker) and the page.
 *
 * The worker owns the World and its tick timing. The page keeps a light
 * mirror of what it draws: organisms as OrganismView records, food, and the
 * static terrain. Panels (metrics, history, the selected organism's full
 * record) arrive at a slower rate. Everything here is plain data, so it
 * survives structured cloning.
 */
import type { HistorySample } from './history';
import type { WorldEvent } from './events';
import type { HeatmapKind } from './activity';
import type {
  CarrionPatch,
  DecisionOutcome,
  FoodPatch,
  FoodRegion,
  LegalAction,
  Organism,
  SimulationConfig,
  WorldMetrics,
} from './types';
import type { WorldState } from './world';

/** What an organism did on its latest tick, as much as drawing needs. */
export interface ActionView {
  readonly chosenAction: Pick<LegalAction, 'type' | 'target' | 'recipientId' | 'swapWithId' | 'swapRelation' | 'preyId' | 'mateId'>;
  readonly outcome: DecisionOutcome;
}

/** The fields the renderer, card and colour groups read. A full Organism satisfies it. */
export interface OrganismView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly energy: number;
  readonly tag: number;
  readonly lineage: { readonly id: string; readonly parentId: string | null; readonly mateId?: string; readonly generation: number };
  readonly age: number;
  readonly carriedFood: number;
  /** Diet, 0 (plants) to 1 (meat). */
  readonly carnivory: number;
  /** Only the latest decision (or none). */
  readonly recentHistory: readonly ActionView[];
}

/** What the renderer reads from a world. Both World and the page's mirror satisfy it. */
export interface WorldView {
  readonly config: Readonly<SimulationConfig>;
  readonly tick: number;
  readonly organisms: ReadonlyMap<string, OrganismView>;
  readonly foodPatches: ReadonlyMap<string, FoodPatch>;
  readonly carrion: ReadonlyMap<string, CarrionPatch>;
  readonly foodRegions: readonly FoodRegion[];
  readonly obstacles: ReadonlySet<string>;
  getSelectedOrganism(): OrganismView | undefined;
}

export function toOrganismView(org: Readonly<Organism>): OrganismView {
  const last = org.recentHistory[0];
  return {
    id: org.id,
    x: org.x,
    y: org.y,
    energy: org.energy,
    tag: org.tag,
    lineage: { id: org.lineage.id, parentId: org.lineage.parentId, mateId: org.lineage.mateId, generation: org.lineage.generation },
    age: org.age,
    carriedFood: org.carriedFood,
    carnivory: org.carnivory,
    recentHistory: last
      ? [
          {
            chosenAction: {
              type: last.chosenAction.type,
              target: last.chosenAction.target,
              recipientId: last.chosenAction.recipientId,
              swapWithId: last.chosenAction.swapWithId,
              swapRelation: last.chosenAction.swapRelation,
              preyId: last.chosenAction.preyId,
              mateId: last.chosenAction.mateId,
            },
            outcome: last.outcome,
          },
        ]
      : [],
  };
}

/** Messages from the page to the worker. */
export type ToWorker =
  | { readonly kind: 'play' }
  | { readonly kind: 'pause' }
  | { readonly kind: 'step' }
  | { readonly kind: 'speed'; readonly ticksPerSecond: number }
  /** Restart from tick 0, after applying a config change (world size, food layout). */
  | { readonly kind: 'reset'; readonly seed: string | number; readonly config?: Partial<SimulationConfig> }
  /** A live config change (sharing, signals, controller, seasons). */
  | { readonly kind: 'config'; readonly config: Partial<SimulationConfig> }
  | { readonly kind: 'select'; readonly id: string | null }
  /** Which slow data the page is showing, so the worker only sends that. */
  | { readonly kind: 'panels'; readonly history: boolean; readonly heatmap: HeatmapKind | null }
  | { readonly kind: 'csv'; readonly requestId: number }
  /** Ask for the whole world as a SavedWorld. */
  | { readonly kind: 'save'; readonly requestId: number }
  /** Replace the world with a saved one (paused). */
  | { readonly kind: 'load'; readonly saved: SavedWorld };

/** A saved world, as kept in the browser or written to a file. */
export interface SavedWorld {
  readonly format: 'alife-world';
  readonly version: 1;
  /** When it was saved (ISO 8601). */
  readonly savedAt: string;
  readonly world: WorldState;
  /** The event feed at the time, so it carries on after resuming. */
  readonly events: readonly WorldEvent[];
}

/** Checks the outer shape of a loaded file before handing it to the worker. */
export function isSavedWorld(value: unknown): value is SavedWorld {
  const v = value as Partial<SavedWorld> | null;
  return !!v && v.format === 'alife-world' && v.version === 1 && !!v.world && Array.isArray(v.events);
}

/** Terrain and settings: sent at start and after every reset. */
export interface WorldStatic {
  readonly config: SimulationConfig;
  readonly obstacles: readonly string[];
  readonly foodRegions: readonly FoodRegion[];
  /** Recent world events, oldest first (the feed starts from these). */
  readonly events: readonly WorldEvent[];
}

/** Messages from the worker to the page. */
export type FromWorker =
  | ({ readonly kind: 'static' } & WorldStatic)
  | {
      readonly kind: 'frame';
      readonly tick: number;
      readonly organisms: readonly OrganismView[];
      readonly foodPatches: readonly FoodPatch[];
      readonly carrion: readonly CarrionPatch[];
      /** Ticks run in the last second (measured in the worker). */
      readonly ticksPerSecond: number;
      /** Whether the world is playing, and at what speed (another viewer may have changed them). */
      readonly running: boolean;
      readonly targetTicksPerSecond: number;
      /** True when the frame comes from a single Step, so the page can glide it. */
      readonly fromStep: boolean;
      /** World events since the previous frame. */
      readonly events: readonly WorldEvent[];
      /** Present when panels are due (a few times a second, and after a step or selection). */
      readonly panels?: PanelData;
    }
  /** Settings changed live (perhaps by another viewer). */
  | { readonly kind: 'config'; readonly config: SimulationConfig }
  | { readonly kind: 'csv'; readonly requestId: number; readonly csv: string }
  | { readonly kind: 'saved'; readonly requestId: number; readonly saved: SavedWorld }
  /** A load failed (bad or incompatible file); the current world is kept. */
  | { readonly kind: 'error'; readonly message: string };

export interface PanelData {
  readonly metrics: WorldMetrics;
  /** The selected organism's full record, or null if none is selected or it died. */
  readonly selected: Organism | null;
  /** History samples, only when the page asked for them. */
  readonly history?: readonly HistorySample[];
  /** The heatmap the page is showing (one value per cell, row by row), only when asked for. */
  readonly heatmap?: { readonly kind: HeatmapKind; readonly cells: Float32Array };
}
