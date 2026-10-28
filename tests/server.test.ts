import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { SimulationHost } from '../src/sim/host';
import type { FromWorker } from '../src/sim/protocol';
import { ViewerStream, encodeMessage } from '../server/viewer-stream';
import { WorldStore } from '../server/store';
import { AlifeServer } from '../server/app';

type Frame = Extract<FromWorker, { kind: 'frame' }>;

/** A fake clock and timer queue. */
function fakeClock() {
  let time = 0;
  let nextId = 1;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  return {
    now: () => time,
    schedule: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: time + ms, fn, id });
      return id;
    },
    cancel: (handle: unknown) => {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
    advance(ms: number) {
      const end = time + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > end) break;
        timers.shift();
        time = next.at;
        next.fn();
      }
      time = end;
    },
  };
}

const SMALL = { seed: 'server', gridWidth: 20, gridHeight: 20, initialOrganisms: 12, foodRegionCount: 0 };

const frame = (tick: number, extra: Partial<Frame> = {}): Frame => ({
  kind: 'frame',
  tick,
  organisms: [],
  foodPatches: [],
  ticksPerSecond: 0,
  running: true,
  targetTicksPerSecond: 60,
  fromStep: false,
  events: [],
  ...extra,
});

describe('Viewer stream (frames to one viewer)', () => {
  it('sends at most one frame per interval, merging the ones in between', () => {
    const clock = fakeClock();
    const sent: FromWorker[] = [];
    const stream = new ViewerStream((m) => sent.push(m), 100, clock);
    const event = { tick: 2 } as never;
    const panels = { metrics: {} } as never;
    stream.post(frame(1));
    clock.advance(0);
    expect(sent.map((m) => (m as Frame).tick)).toEqual([1]);
    stream.post(frame(2, { events: [event], panels }));
    stream.post(frame(3));
    stream.post(frame(4));
    clock.advance(50);
    expect(sent).toHaveLength(1);
    clock.advance(50);
    expect(sent).toHaveLength(2);
    const merged = sent[1] as Frame;
    expect(merged.tick).toBe(4); // newest positions
    expect(merged.events).toEqual([event]); // events kept
    expect(merged.panels).toBe(panels); // the latest panels kept
  });

  it('sends Step frames and other messages at once, in order, and drops a stale frame on new terrain', () => {
    const clock = fakeClock();
    const sent: FromWorker[] = [];
    const stream = new ViewerStream((m) => sent.push(m), 100, clock);
    stream.post(frame(1));
    clock.advance(0);
    stream.post(frame(2));
    stream.post({ kind: 'csv', requestId: 1, csv: 'x' });
    expect(sent.map((m) => m.kind)).toEqual(['frame', 'frame', 'csv']); // pending frame first
    stream.post(frame(3, { fromStep: true }));
    expect((sent.at(-1) as Frame).tick).toBe(3);
    stream.post(frame(4));
    stream.post({ kind: 'static' } as FromWorker);
    clock.advance(500);
    expect(sent.at(-1)!.kind).toBe('static');
  });

  it('holds frames while the connection is backed up', () => {
    const clock = fakeClock();
    const sent: FromWorker[] = [];
    let busy = true;
    const stream = new ViewerStream((m) => sent.push(m), 100, clock, () => !busy);
    stream.post(frame(1));
    stream.post(frame(2));
    clock.advance(1000);
    expect(sent).toHaveLength(0);
    busy = false;
    clock.advance(100);
    expect(sent.map((m) => (m as Frame).tick)).toEqual([2]);
  });

  it('sends heatmaps as plain arrays', () => {
    const json = encodeMessage(frame(1, { panels: { heatmap: { kind: 'deaths', cells: new Float32Array([0.5, 0.12345]) } } as never }));
    expect(JSON.parse(json).panels.heatmap.cells).toEqual([0.5, 0.123]);
  });
});

describe('Simulation host with several viewers', () => {
  it('shares the world but keeps each viewer’s selection and panels', () => {
    const clock = fakeClock();
    const host = new SimulationHost(clock, SMALL);
    const a: FromWorker[] = [];
    const b: FromWorker[] = [];
    const idA = host.connect((m) => a.push(m));
    const idB = host.connect((m) => b.push(m));
    expect([a[0].kind, b[0].kind]).toEqual(['static', 'static']);
    const frames = (list: FromWorker[]) => list.filter((m): m is Frame => m.kind === 'frame');
    const target = frames(a)[0].organisms[3].id;

    host.handle({ kind: 'select', id: target }, idA);
    host.handle({ kind: 'panels', history: true, heatmap: null }, idB);
    host.handle({ kind: 'step' }, idB);
    const lastA = frames(a).at(-1)!;
    const lastB = frames(b).at(-1)!;
    expect(lastA.tick).toBe(1);
    expect(lastB.tick).toBe(1);
    expect(lastA.panels!.selected?.id).toBe(target);
    expect(lastB.panels!.selected).toBeNull();
    expect(lastA.panels!.history).toBeUndefined();
    expect(lastB.panels!.history).toBeDefined();

    host.handle({ kind: 'config', config: { sharingEnabled: false } }, idA);
    expect(b.some((m) => m.kind === 'config' && !m.config.sharingEnabled)).toBe(true);
    host.handle({ kind: 'speed', ticksPerSecond: 30 }, idA);
    host.handle({ kind: 'play' }, idA);
    clock.advance(200);
    expect(frames(b).at(-1)).toMatchObject({ running: true, targetTicksPerSecond: 30 });

    host.disconnect(idA);
    expect(host.viewerCount).toBe(1);
    const sentToA = a.length;
    clock.advance(200);
    expect(a.length).toBe(sentToA);
  });

  it('runs with nobody watching', () => {
    const clock = fakeClock();
    const host = new SimulationHost(clock, SMALL);
    host.handle({ kind: 'speed', ticksPerSecond: 20 });
    host.handle({ kind: 'play' });
    clock.advance(1000);
    expect(host.world.tick).toBe(20);
  });
});

describe('World store (the server’s files)', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('saves, loads and keeps only the newest backups', () => {
    dir = mkdtempSync(join(tmpdir(), 'alife-store-'));
    const store = new WorldStore(dir, 2);
    expect(store.loadWorld()).toBeNull();
    const host = new SimulationHost(fakeClock(), SMALL);
    for (let i = 0; i < 3; i++) host.handle({ kind: 'step' });
    const saved = host.save();
    store.save(saved, { running: true, ticksPerSecond: 12 });
    expect(store.loadWorld()!.world.tick).toBe(3);
    expect(store.loadPlayback()).toEqual({ running: true, ticksPerSecond: 12 });
    for (let i = 0; i < 3; i++) store.backup({ ...saved, savedAt: `2026-10-25T10:0${i}:00.000Z` });
    const backups = store.listBackups();
    expect(backups).toHaveLength(2);
    expect(backups[0]).toContain('10-01');
    const restored = JSON.parse(gunzipSync(readFileSync(join(dir, 'backups', backups[1]))).toString());
    expect(restored.world.tick).toBe(3);
  });

  it('refuses a damaged save instead of starting over', () => {
    dir = mkdtempSync(join(tmpdir(), 'alife-store-'));
    writeFileSync(join(dir, 'world.json'), '{"not":"a world"}');
    expect(() => new WorldStore(dir).loadWorld()).toThrow(/not a saved world/);
  });
});

/** Reads Server-Sent Events from a fetch response until `until` says stop (closing it unless `keepOpen`). */
async function readEvents(
  response: Response,
  until: (messages: { event: string; data: unknown }[]) => boolean,
  keepOpen = false
): Promise<{ event: string; data: unknown }[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const messages: { event: string; data: unknown }[] = [];
  let buffer = '';
  while (!until(messages)) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = 'message';
      let data = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        if (line.startsWith('data: ')) data += line.slice(6);
      }
      if (data) messages.push({ event, data: JSON.parse(data) });
    }
  }
  if (keepOpen) reader.releaseLock();
  else await reader.cancel();
  return messages;
}

describe('Always-on server over HTTP', () => {
  let dir = '';
  let server: AlifeServer | null = null;
  afterEach(async () => {
    await server?.close();
    server = null;
    rmSync(dir, { recursive: true, force: true });
  });

  async function start(options = {}) {
    const staticDir = join(dir, 'dist');
    mkdirSync(staticDir, { recursive: true });
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
    server = new AlifeServer({ dataDir: join(dir, 'data'), staticDir, port: 0, host: '127.0.0.1', log: () => {}, ...options });
    const port = await server.listen();
    return `http://127.0.0.1:${port}`;
  }

  it('serves the app, streams the world, takes commands, and saves on close', async () => {
    dir = mkdtempSync(join(tmpdir(), 'alife-server-'));
    const base = await start();
    server!.host.handle({ kind: 'pause' }); // keep ticks still for the test

    const info = await (await fetch(`${base}/api/info`)).json();
    expect(info).toMatchObject({ app: 'alife-server', watchOnly: false });
    expect(await (await fetch(`${base}/`)).text()).toContain('<title>app</title>');
    expect((await fetch(`${base}/../../etc/passwd`)).status).not.toBe(200);

    const events = await fetch(`${base}/api/events`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(events.headers.get('content-encoding')).toBe('gzip');
    const first = await readEvents(events, (m) => m.length >= 3);
    expect(first.map((m) => m.event)).toEqual(['hello', 'message', 'message']);
    const viewer = (first[0].data as { viewer: number }).viewer;
    expect((first[1].data as FromWorker).kind).toBe('static');
    const tick = (first[2].data as Frame).tick;

    // A command without a live stream is refused; with one it reaches the world.
    const stream = await fetch(`${base}/api/events`);
    const hello = await readEventsUntilHello(stream);
    const step = await fetch(`${base}/api/command`, {
      method: 'POST',
      headers: { 'X-Viewer': String(hello), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'step' }),
    });
    expect(step.status).toBe(204);
    expect(server!.host.world.tick).toBe(tick + 1);
    const stale = await fetch(`${base}/api/command`, { method: 'POST', headers: { 'X-Viewer': String(viewer + 100) }, body: '{"kind":"step"}' });
    expect(stale.status).toBe(409);

    const world = await (await fetch(`${base}/api/world`)).json();
    expect(world).toMatchObject({ format: 'alife-world', world: { tick: tick + 1 } });

    await server!.close();
    server = null;
    expect(existsSync(join(dir, 'data', 'world.json'))).toBe(true);
    const resumed = new AlifeServer({ dataDir: join(dir, 'data'), staticDir: join(dir, 'dist'), log: () => {} });
    expect(resumed.host.world.tick).toBe(tick + 1);
    resumed.host.handle({ kind: 'pause' });
  }, 30_000);

  it('refuses world-changing commands when watch-only, and caps the speed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'alife-server-'));
    const base = await start({ watchOnly: true });
    const stream = await fetch(`${base}/api/events`);
    const viewer = await readEventsUntilHello(stream);
    const post = (body: unknown) =>
      fetch(`${base}/api/command`, { method: 'POST', headers: { 'X-Viewer': String(viewer) }, body: JSON.stringify(body) });
    expect((await post({ kind: 'reset', seed: 1 })).status).toBe(403);
    expect((await post({ kind: 'select', id: null })).status).toBe(204);
    // The brain viewer's read-only request is allowed even when watch-only.
    expect((await post({ kind: 'inspectBrain', requestId: 1, organismId: 'nobody' })).status).toBe(204);
    await server!.close();

    server = null;
    const capped = await start({ maxTicksPerSecond: 10 });
    const s2 = await fetch(`${capped}/api/events`);
    const v2 = await readEventsUntilHello(s2);
    await fetch(`${capped}/api/command`, { method: 'POST', headers: { 'X-Viewer': String(v2) }, body: '{"kind":"speed","ticksPerSecond":60}' });
    expect(server!.host.playback().ticksPerSecond).toBe(10);
  }, 30_000);
});

async function readEventsUntilHello(response: Response): Promise<number> {
  // Stays open: closing the stream ends the viewer.
  const messages = await readEvents(response, (m) => m.some((x) => x.event === 'hello'), true);
  return (messages.find((m) => m.event === 'hello')!.data as { viewer: number }).viewer;
}
