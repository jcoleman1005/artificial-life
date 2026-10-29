import type { FromWorker } from '../src/sim/protocol';

type Frame = Extract<FromWorker, { kind: 'frame' }>;

/**
 * One viewer's outgoing messages, with frames limited to one per interval.
 *
 * The world can tick 60 times a second; a phone over Wi-Fi or Tailscale only
 * needs ~10 pictures a second. Frames in between are merged into the next one
 * sent: the newest positions win, world events add up, and the newest panels
 * are kept, so nothing the page shows is lost. Frames from a single Step go
 * out at once. Other messages go out at once, in order (a pending frame is
 * sent first, or dropped when the terrain is replaced).
 *
 * `canSend` lets the server hold frames back while a slow connection still
 * has data queued; they keep merging until it drains.
 */
export class ViewerStream {
  private pending: Frame | null = null;
  private lastSent = -Infinity;
  private timer: unknown = null;

  constructor(
    private readonly write: (message: FromWorker) => void,
    private readonly intervalMs: number,
    private readonly clock: {
      now(): number;
      schedule(fn: () => void, ms: number): unknown;
      cancel(handle: unknown): void;
    },
    private readonly canSend: () => boolean = () => true
  ) {}

  public post(message: FromWorker): void {
    if (message.kind !== 'frame') {
      if (message.kind === 'static') this.pending = null; // its frame belongs to the old world
      else this.flush();
      this.write(message);
      return;
    }
    this.pending = this.pending ? merge(this.pending, message) : message;
    if (message.fromStep) this.flush();
    else this.schedule();
  }

  /** Sends the pending frame now, if any. */
  public flush(): void {
    if (this.timer !== null) {
      this.clock.cancel(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    const frame = this.pending;
    this.pending = null;
    this.lastSent = this.clock.now();
    this.write(frame);
  }

  public close(): void {
    if (this.timer !== null) this.clock.cancel(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    const wait = Math.max(0, this.lastSent + this.intervalMs - this.clock.now());
    this.timer = this.clock.schedule(() => {
      this.timer = null;
      if (this.canSend()) this.flush();
      else this.schedule(); // try again after another interval
    }, wait || (this.canSend() ? 0 : this.intervalMs));
  }
}

/** A newer frame on top of an unsent older one. */
function merge(older: Frame, newer: Frame): Frame {
  return {
    ...newer,
    fromStep: older.fromStep || newer.fromStep,
    events: older.events.length > 0 ? [...older.events, ...newer.events] : newer.events,
    ...(newer.panels ? {} : older.panels ? { panels: older.panels } : {}),
  };
}

/** JSON for the wire: typed arrays (heatmaps, genomes) become plain arrays; heatmaps are rounded to keep them small. */
export function encodeMessage(message: FromWorker): string {
  const hasTypedArrays =
    message.kind === 'saved' || (message.kind === 'frame' && Boolean(message.panels?.heatmap || message.panels?.selected));
  if (!hasTypedArrays) return JSON.stringify(message);
  return JSON.stringify(message, (_key, value: unknown) =>
    value instanceof Float32Array
      ? Array.from(value, (v) => Math.round(v * 1000) / 1000)
      : value instanceof Uint32Array
        ? Array.from(value)
        : value
  );
}
