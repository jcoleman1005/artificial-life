import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { SimulationHost, type HostEnvironment } from '../src/sim/host';
import type { FromWorker } from '../src/sim/protocol';
import { WorldEventDetector, type WorldEventBody } from '../src/sim/events';
import { SpeciesTracker, genomeDistance, speciesName, speciesHue } from '../src/sim/species';
import type { Organism, SimulationConfig } from '../src/sim/types';

// Species detection is an observer (docs/specs/species.md). These tests check
// the mechanism: the distance, stable ids, the persistence clock, events, saves
// and that it never touches the world. They never assert that a species appears.

/** A quiet template world supplying real organisms (bodies, brains) to copy from. */
function template(config: Partial<SimulationConfig> = {}): { config: SimulationConfig; base: Organism } {
  const w = new World({ seed: 'sp', gridWidth: 20, gridHeight: 20, initialOrganisms: 1, foodRegionCount: 0, immigrationEnabled: false, ...config });
  return { config: w.config, base: [...w.organisms.values()][0] };
}

/** `n` copies of `base` with ids `${prefix}${i}` and the given trait overrides. */
function population(base: Organism, prefix: string, n: number, over: Partial<Organism>): Organism[] {
  return Array.from({ length: n }, (_, i) => ({ ...base, id: `${prefix}${String(i).padStart(3, '0')}`, ...over }) as Organism);
}

const PLANT_EATER: Partial<Organism> = { carnivory: 0, size: 0.5, sensingRadius: 1, metabolicRate: 0.5, digestiveEfficiency: 0.5, clutchSize: 1, dispersal: 1, tag: 0 };
const MEAT_EATER: Partial<Organism> = { carnivory: 1, size: 2.4, sensingRadius: 6, metabolicRate: 1.5, digestiveEfficiency: 1.5, clutchSize: 6, dispersal: 8, tag: 180 };

function view(config: SimulationConfig, organisms: Organism[], tick: number) {
  return { config, tick, organisms: new Map(organisms.map((o) => [o.id, o])) };
}

describe('genomeDistance', () => {
  const { config, base } = template();
  const other = { ...base, id: 'x', ...MEAT_EATER } as Organism;

  it('is 0 for identical organisms, symmetric, and within [0, 1]', () => {
    expect(genomeDistance(base, base, config)).toBe(0);
    expect(genomeDistance({ ...base, id: 'copy' } as Organism, base, config)).toBe(0);
    const ab = genomeDistance(base, other, config);
    const ba = genomeDistance(other, base, config);
    expect(ab).toBeCloseTo(ba, 12);
    expect(ab).toBeGreaterThan(0);
    expect(ab).toBeLessThanOrEqual(1);
  });

  it('is pure: calling it again gives the same number and does not change its arguments', () => {
    const before = JSON.stringify(base);
    const d1 = genomeDistance(base, other, config);
    const d2 = genomeDistance(base, other, config);
    expect(d2).toBe(d1);
    expect(JSON.stringify(base)).toBe(before);
  });

  it('never lets the brain contribute more than speciesBrainWeight', () => {
    const wild = (v: number) => ({
      skip: base.brain.skip.map(() => v),
      hidden: base.brain.hidden.map(() => v),
      hiddenBias: base.brain.hiddenBias.map(() => v),
      out: base.brain.out.map(() => v),
      outBias: v,
    });
    const a = { ...base, id: 'a', brain: wild(-50) } as Organism;
    const b = { ...base, id: 'b', brain: wild(50) } as Organism; // same body and tag: only the brain differs
    expect(genomeDistance(a, b, config)).toBeLessThanOrEqual(config.speciesBrainWeight + 1e-9);
    expect(genomeDistance(a, b, config)).toBeGreaterThan(0.99 * config.speciesBrainWeight);
    expect(genomeDistance(a, b, { ...config, speciesBrainWeight: 0.1 })).toBeLessThanOrEqual(0.1 + 1e-9);
  });

  it('counts the hue tag circularly with weight speciesTagWeight', () => {
    const a = { ...base, id: 'a', tag: 350 } as Organism;
    const b = { ...base, id: 'b', tag: 10 } as Organism;
    const c = { ...base, id: 'c', tag: 170 } as Organism;
    expect(genomeDistance(a, b, config)).toBeCloseTo(config.speciesTagWeight * (20 / 180), 9);
    expect(genomeDistance(a, c, config)).toBeCloseTo(config.speciesTagWeight * 1, 9);
  });

  it('skips a trait that one side lacks (its gene switch is off) instead of counting it as different', () => {
    const lacking = { ...base, id: 'l', size: undefined } as Organism;
    expect(genomeDistance(lacking, base, config)).toBe(0);
  });

  it('uses the policy weights under the dials controller', () => {
    const dials = { ...config, controller: 'dials' as const };
    const a = { ...base, id: 'a' } as Organism;
    const b = { ...base, id: 'b', policy: { ...base.policy, foodAttraction: base.policy.foodAttraction > 0 ? -2 : 2 } } as Organism;
    expect(genomeDistance(a, b, dials)).toBeGreaterThan(0);
    expect(genomeDistance(a, b, dials)).toBeLessThanOrEqual(dials.speciesBrainWeight);
  });
});

describe('SpeciesTracker', () => {
  const { config, base } = template();
  const A = () => population(base, 'a', 12, PLANT_EATER);
  const B = () => population(base, 'b', 12, MEAT_EATER);

  it('finds two species in two far-apart founder populations, and keeps their ids when nothing changes', () => {
    const tracker = new SpeciesTracker();
    const orgs = [...A(), ...B()];
    expect(tracker.observe(view(config, orgs, 0))).toEqual([]); // founders: no split events
    const first = tracker.snapshot(0, false).species;
    expect(first.map((s) => s.count).sort()).toEqual([12, 12]);
    const idOf = (o: Organism) => tracker.speciesIdOf(o, config);
    expect(idOf(orgs[0])).not.toBe(0);
    expect(idOf(orgs[0])).not.toBe(idOf(orgs[12]));
    expect(new Set(orgs.slice(0, 12).map(idOf)).size).toBe(1);

    // Several more runs with no change: same ids, same counts, no events.
    for (const tick of [50, 100, 150, 200, 250, 300]) {
      expect(tracker.observe(view(config, orgs, tick))).toEqual([]);
    }
    const later = tracker.snapshot(300, false).species;
    expect(later.map((s) => [s.id, s.count])).toEqual(first.map((s) => [s.id, s.count]));
    // A fresh tracker over the same organisms agrees (no hidden state or randomness).
    const again = new SpeciesTracker();
    again.observe(view(config, orgs, 0));
    expect(again.snapshot(0, false).species.map((s) => [s.id, s.count])).toEqual(first.map((s) => [s.id, s.count]));
  });

  it('runs only every speciesInterval ticks', () => {
    const tracker = new SpeciesTracker();
    const orgs = A();
    tracker.observe(view(config, orgs, 0));
    const more = [...orgs, ...population(base, 'n', 3, PLANT_EATER)];
    tracker.observe(view(config, more, 10));
    expect(tracker.snapshot(10, false).species[0].count).toBe(12); // not run yet
    tracker.observe(view(config, more, 50));
    expect(tracker.snapshot(50, false).species[0].count).toBe(15);
  });

  it('turns a new distinct cluster into a species only after speciesPersistTicks, with the old one as parent', () => {
    const tracker = new SpeciesTracker();
    const a = A();
    tracker.observe(view(config, a, 0));
    const parent = tracker.snapshot(0, false).species[0].id;
    const events: { tick: number; e: WorldEventBody }[] = [];
    const both = [...a, ...B()];
    for (let tick = 50; tick <= 300; tick += 50) {
      for (const e of tracker.observe(view(config, both, tick))) events.push({ tick, e });
    }
    // Cluster first seen at 50; 200 ticks later (250) it is promoted, not before.
    expect(events).toHaveLength(1);
    expect(events[0].tick).toBe(250);
    expect(events[0].e).toMatchObject({ kind: 'speciation', parentId: parent, name: speciesName(events[0].e.kind === 'speciation' ? events[0].e.speciesId : 0) });
    const species = tracker.snapshot(300, false).species;
    expect(species).toHaveLength(2);
    expect(species.find((s) => s.id !== parent)).toMatchObject({ parentId: parent, count: 12, born: 250 });
    expect(species.find((s) => s.id === parent)).toMatchObject({ parentId: null, count: 12 });
  });

  it('does not make a species of a cluster smaller than speciesMinSize', () => {
    const tracker = new SpeciesTracker();
    const a = A();
    tracker.observe(view(config, a, 0));
    const few = [...a, ...population(base, 'f', config.speciesMinSize - 1, MEAT_EATER)];
    for (let tick = 50; tick <= 600; tick += 50) tracker.observe(view(config, few, tick));
    expect(tracker.snapshot(600, false).species).toHaveLength(1);
  });

  it('retires a species after speciesExtinctTicks with no members, and keeps its record', () => {
    const tracker = new SpeciesTracker();
    const a = A();
    const both = [...a, ...B()];
    tracker.observe(view(config, both, 0));
    const ids = tracker.snapshot(0, false).species.map((s) => s.id);
    const gone: { tick: number; e: WorldEventBody }[] = [];
    for (let tick = 50; tick <= 300; tick += 50) {
      const orgs = tick >= 100 ? a : both; // the second population vanishes after tick 50
      for (const e of tracker.observe(view(config, orgs, tick))) gone.push({ tick, e });
    }
    // Last seen at tick 50; 100 ticks later (150) it is extinct.
    expect(gone).toHaveLength(1);
    expect(gone[0].tick).toBe(150);
    expect(gone[0].e.kind).toBe('speciesExtinct');
    const snap = tracker.snapshot(300, false).species;
    const extinct = snap.filter((s) => s.extinct !== null);
    expect(extinct).toHaveLength(1);
    expect(extinct[0]).toMatchObject({ extinct: 150, peak: 12, count: 0 });
    expect(snap.map((s) => s.id).sort()).toEqual(ids.slice().sort());
  });

  it('keeps a representative unless a medoid is clearly closer (hysteresis)', () => {
    const tracker = new SpeciesTracker();
    const a = A();
    tracker.observe(view(config, a, 0));
    const jitter = a.map((o, i) => ({ ...o, size: (o.size ?? 1) + (i % 2 ? 0.001 : -0.001) }) as Organism);
    const id = tracker.snapshot(0, false).species[0].id;
    for (let tick = 50; tick <= 200; tick += 50) tracker.observe(view(config, jitter, tick));
    const d = tracker.distanceToRepresentative(jitter[0], config);
    expect(d?.speciesId).toBe(id);
    expect(d?.distance).toBeLessThan(0.01);
  });

  it('records a bounded count history for the stacked chart', () => {
    const tracker = new SpeciesTracker();
    const orgs = [...A(), ...B()];
    for (let tick = 0; tick <= 200; tick += 50) tracker.observe(view(config, orgs, tick));
    const snap = tracker.snapshot(200, true);
    expect(snap.history).toHaveLength(5);
    expect(snap.history![4].counts.map(([, n]) => n).sort()).toEqual([12, 12]);
    expect(tracker.snapshot(200, false).history).toBeUndefined();
  });

  it('keeps its ids through a JSON save and restore, and carries on without events', () => {
    const tracker = new SpeciesTracker();
    const a = A();
    const both = [...a, ...B()];
    tracker.observe(view(config, a, 0));
    for (let tick = 50; tick <= 300; tick += 50) tracker.observe(view(config, both, tick));
    const before = tracker.snapshot(300, true);
    const restored = new SpeciesTracker();
    restored.restore(JSON.parse(JSON.stringify(tracker.exportState())));
    expect(restored.snapshot(300, true)).toEqual(before);
    expect(restored.observe(view(config, both, 350))).toEqual([]);
    expect(restored.snapshot(350, false).species.map((s) => [s.id, s.count])).toEqual(before.species.map((s) => [s.id, s.count]));
    // An organism's species is the same on both.
    expect(restored.speciesIdOf(both[0], config)).toBe(tracker.speciesIdOf(both[0], config));
  });

  it('rebuilds from nothing when a save has no species, and ignores an unknown version', () => {
    const tracker = new SpeciesTracker();
    tracker.restore(undefined);
    tracker.observe(view(config, A(), 1000));
    expect(tracker.snapshot(1000, false).species).toHaveLength(1);
    tracker.restore({ version: 2 } as never);
    expect(tracker.snapshot(1000, false).species).toHaveLength(0);
  });

  it('does nothing when speciesEnabled is false', () => {
    const tracker = new SpeciesTracker();
    expect(tracker.observe(view({ ...config, speciesEnabled: false }, A(), 0))).toEqual([]);
    expect(tracker.snapshot(0, false).species).toHaveLength(0);
  });

  it('survives an empty world without wiping its species', () => {
    const tracker = new SpeciesTracker();
    tracker.observe(view(config, A(), 0));
    tracker.observe(view(config, [], 50));
    expect(tracker.snapshot(50, false).species.filter((s) => s.extinct === null)).toHaveLength(1);
  });

  it('names and colours are fixed by the id', () => {
    expect(speciesName(7)).toBe(speciesName(7));
    expect(speciesName(7)).not.toBe(speciesName(8));
    expect(speciesHue(3)).toBeGreaterThanOrEqual(0);
    expect(speciesHue(3)).toBeLessThan(360);
  });
});

describe('Species as an observer of a running world', () => {
  const SMALL = { seed: 'obs', gridWidth: 24, gridHeight: 24, initialOrganisms: 24, foodRegionCount: 2, immigrationEnabled: false } as const;
  const TICKS = 160;

  /** Steps a world, with or without the species tracker and event detector watching. */
  function run(watch: boolean, config: Partial<SimulationConfig> = {}) {
    const world = new World({ ...SMALL, ...config });
    const tracker = new SpeciesTracker();
    const detector = new WorldEventDetector();
    for (let t = 0; t < TICKS; t++) {
      world.step();
      if (watch) detector.record(tracker.observe(world), world.tick);
    }
    return { world, tracker, detector };
  }

  it('draws no random numbers and changes no outcome: the world is identical with and without it', () => {
    const watched = run(true);
    const bare = run(false);
    expect(watched.world.stateHash()).toBe(bare.world.stateHash());
    expect(watched.world.prng.getState()).toEqual(bare.world.prng.getState());
  });

  it('gives the same species history for the same seed, and none of its settings change the world', () => {
    const one = run(true).tracker.snapshot(TICKS, true);
    const two = run(true).tracker.snapshot(TICKS, true);
    expect(two).toEqual(one);
    expect(one.species.length).toBeGreaterThan(0);
    // Observer settings (and the switch) are not part of the dynamics: strip the config from the state and compare.
    const strip = (w: World) => {
      const { config: _config, history: _history, ...rest } = w.exportState();
      return JSON.stringify(rest);
    };
    const loose = run(true, { speciesThreshold: 0.02, speciesMinSize: 1, speciesInterval: 10 }).world;
    const off = run(true, { speciesEnabled: false }).world;
    expect(strip(loose)).toBe(strip(off));
  });

  it('puts every living organism in at most one species, and counts add up', () => {
    // Stop on a tick the tracker has just clustered (it runs at tick 1, then every speciesInterval): its counts are from
    // that tick, so comparing them with a later population would depend on deaths in between.
    const world = new World({ ...SMALL });
    const tracker = new SpeciesTracker();
    const stop = 1 + Math.floor((TICKS - 1) / world.config.speciesInterval) * world.config.speciesInterval;
    for (let t = 0; t < stop; t++) {
      world.step();
      tracker.observe(world);
    }
    const snap = tracker.snapshot(world.tick, false);
    const living = snap.species.filter((s) => s.extinct === null);
    expect(living.reduce((n, s) => n + s.count, 0)).toBeLessThanOrEqual(world.organisms.size);
    for (const s of snap.species) {
      expect(Number.isFinite(s.count)).toBe(true);
      expect(s.peak).toBeGreaterThanOrEqual(s.count);
    }
  });

  it('the host sends species ids aligned with the organisms, keeps them in saves, and leaves the world alone', () => {
    let time = 0;
    const posted: FromWorker[] = [];
    const env: HostEnvironment = { post: (m) => posted.push(m), now: () => time, schedule: () => 0, cancel: () => {} };
    const host = new SimulationHost(env, SMALL);
    const bare = new World(SMALL);
    for (let t = 0; t < 60; t++) {
      time += 100;
      host.handle({ kind: 'step' });
      bare.step();
    }
    expect(host.world.stateHash()).toBe(bare.stateHash());
    const frame = [...posted].reverse().find((m): m is Extract<FromWorker, { kind: 'frame' }> => m.kind === 'frame')!;
    expect(frame.speciesIds).toHaveLength(frame.organisms.length);
    expect(frame.panels?.species?.species.length).toBeGreaterThan(0);

    const saved = JSON.parse(JSON.stringify(host.save()));
    expect(saved.species).toBeDefined();
    const posted2: FromWorker[] = [];
    const host2 = new SimulationHost({ ...env, post: (m) => posted2.push(m) }, { ...SMALL, seed: 'other' });
    host2.handle({ kind: 'load', saved });
    expect(host2.save().species).toEqual(host.save().species);
  });

  it('a save without species still loads (they are rebuilt)', () => {
    const env: HostEnvironment = { post: () => {}, now: () => 0, schedule: () => 0, cancel: () => {} };
    const host = new SimulationHost(env, SMALL);
    host.handle({ kind: 'step' });
    const { species: _species, ...old } = host.save();
    const other = new SimulationHost(env, { ...SMALL, seed: 'other' });
    other.handle({ kind: 'load', saved: old as never });
    expect(other.save().species?.species.length).toBeGreaterThan(0);
  });
});

describe('Species cost', () => {
  it('one run at 500 organisms costs well under 1 ms per tick amortised over the interval', () => {
    const { config, base } = template();
    const orgs = [
      ...population(base, 'a', 250, { ...PLANT_EATER, tag: 10 }),
      ...population(base, 'b', 250, { ...MEAT_EATER, tag: 200 }),
    ];
    const tracker = new SpeciesTracker();
    tracker.observe(view(config, orgs, 0)); // warm-up
    const t0 = performance.now();
    const runs = 10;
    for (let i = 1; i <= runs; i++) tracker.observe(view(config, orgs, i * config.speciesInterval));
    const perTick = (performance.now() - t0) / runs / config.speciesInterval;
    // Budget in the spec is 1 ms; keep a wide margin so a slow machine cannot make this flaky.
    expect(perTick).toBeLessThan(1);
  });
});
