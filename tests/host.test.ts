import { describe, expect, it } from 'vitest';
import { SimulationHost, type HostEnvironment } from '../src/sim/host';
import type { FromWorker } from '../src/sim/protocol';
import { toOrganismView } from '../src/sim/protocol';
import { World } from '../src/sim/world';

/** A fake clock and timer queue, so tests control time exactly. */
function fakeEnv() {
  let time = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const posted: FromWorker[] = [];
  const env: HostEnvironment = {
    post: (m) => posted.push(m),
    now: () => time,
    schedule: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: time + ms, fn, id });
      return id;
    },
    cancel: (handle) => {
      const i = timers.findIndex((t) => t.id === handle);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  /** Advances the clock, firing due timers in order. */
  const advance = (ms: number) => {
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
  };
  const frames = () => posted.filter((m): m is Extract<FromWorker, { kind: 'frame' }> => m.kind === 'frame');
  return { env, posted, advance, frames };
}

const SMALL = { seed: 'host', gridWidth: 20, gridHeight: 20, initialOrganisms: 12, foodRegionCount: 0 };

describe('Simulation host (the Web Worker side)', () => {
  it('sends the terrain and a first frame on start', () => {
    const { env, posted } = fakeEnv();
    new SimulationHost(env, SMALL);
    expect(posted.map((m) => m.kind)).toEqual(['static', 'frame']);
    const first = posted[1] as Extract<FromWorker, { kind: 'frame' }>;
    expect(first.tick).toBe(0);
    expect(first.organisms).toHaveLength(12);
  });

  it('steps once per Step, and runs at the requested speed while playing', () => {
    const { env, advance, frames } = fakeEnv();
    const host = new SimulationHost(env, SMALL);
    host.handle({ kind: 'step' });
    expect(host.world.tick).toBe(1);
    expect(frames().at(-1)).toMatchObject({ tick: 1, fromStep: true });

    host.handle({ kind: 'speed', ticksPerSecond: 20 });
    host.handle({ kind: 'play' });
    advance(1000);
    expect(host.world.tick).toBe(21); // 20 ticks in one second
    host.handle({ kind: 'pause' });
    advance(1000);
    expect(host.world.tick).toBe(21);
    host.handle({ kind: 'step' }); // stepping works again once paused
    expect(host.world.tick).toBe(22);
  });

  it('gives exactly the same world as stepping a World by hand', () => {
    const { env, advance, frames } = fakeEnv();
    const host = new SimulationHost(env, SMALL);
    host.handle({ kind: 'speed', ticksPerSecond: 60 });
    host.handle({ kind: 'play' });
    advance(2500);
    host.handle({ kind: 'pause' });

    const direct = new World(SMALL);
    while (direct.tick < host.world.tick) direct.step();
    const last = frames().at(-1)!;
    expect(last.tick).toBe(direct.tick);
    expect(last.organisms).toEqual(Array.from(direct.organisms.values(), toOrganismView));
    expect(last.foodPatches).toEqual(Array.from(direct.foodPatches.values()));
  }, 30_000); // runs the same world twice; slow when the machine is busy

  it('applies live settings, resets with new settings, and sends the selected organism in full', () => {
    const { env, posted, frames } = fakeEnv();
    const host = new SimulationHost(env, SMALL);
    host.handle({ kind: 'config', config: { sharingEnabled: false } });
    expect(host.world.config.sharingEnabled).toBe(false);

    const id = frames()[0].organisms[0].id;
    host.handle({ kind: 'select', id });
    expect(frames().at(-1)!.panels!.selected!.id).toBe(id);
    expect(frames().at(-1)!.panels!.selected!.policy).toBeDefined();

    posted.length = 0;
    host.handle({ kind: 'reset', seed: 7, config: { gridWidth: 25, gridHeight: 25 } });
    expect(posted[0]).toMatchObject({ kind: 'static', config: { seed: 7, gridWidth: 25 } });
    expect(host.world.tick).toBe(0);
  });

  it('sends history only when asked, and the CSV on request', () => {
    const { env, posted, frames } = fakeEnv();
    const host = new SimulationHost(env, SMALL);
    for (let i = 0; i < 5; i++) host.handle({ kind: 'step' });
    expect(frames().at(-1)!.panels!.history).toBeUndefined();
    host.handle({ kind: 'panels', history: true, heatmap: null });
    expect(frames().at(-1)!.panels!.history!.length).toBeGreaterThan(0);
    expect(frames().at(-1)!.panels!.heatmap).toBeUndefined();
    host.handle({ kind: 'panels', history: false, heatmap: 'crowding' });
    const heat = frames().at(-1)!.panels!.heatmap!;
    expect(heat.kind).toBe('crowding');
    expect(heat.cells).toHaveLength(20 * 20);
    host.handle({ kind: 'csv', requestId: 3 });
    const csv = posted.at(-1) as Extract<FromWorker, { kind: 'csv' }>;
    expect(csv.requestId).toBe(3);
    expect(csv.csv.split('\n')[0]).toContain('tick');
  });

  it('saves and loads a world: a loaded save carries on exactly like the original', () => {
    const { env, posted, frames } = fakeEnv();
    const host = new SimulationHost(env, SMALL);
    for (let i = 0; i < 40; i++) host.handle({ kind: 'step' });
    host.handle({ kind: 'save', requestId: 9 });
    const saved = (posted.at(-1) as Extract<FromWorker, { kind: 'saved' }>).saved;
    expect(saved).toMatchObject({ format: 'alife-world', version: 1, world: { tick: 40 } });
    for (let i = 0; i < 25; i++) host.handle({ kind: 'step' });
    const after65 = frames().at(-1)!;

    host.handle({ kind: 'load', saved: JSON.parse(JSON.stringify(saved)) });
    expect(host.world.tick).toBe(40);
    expect(posted.at(-2)).toMatchObject({ kind: 'static' });
    for (let i = 0; i < 25; i++) host.handle({ kind: 'step' });
    expect(frames().at(-1)!.organisms).toEqual(after65.organisms);
  });

  it('keeps the current world when a save cannot be loaded', () => {
    const { env, posted } = fakeEnv();
    const host = new SimulationHost(env, SMALL);
    host.handle({ kind: 'step' });
    host.handle({ kind: 'load', saved: { format: 'alife-world', version: 1, savedAt: '', world: { version: 7 } as never, events: [] } });
    expect(posted.at(-1)).toMatchObject({ kind: 'error' });
    expect(host.world.tick).toBe(1);
  });
});
