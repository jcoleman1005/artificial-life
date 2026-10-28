import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { WorldEventDetector, GROUP_ESTABLISHED, type WorldEvent } from '../src/sim/events';
import { ActivityMaps } from '../src/sim/activity';
import { groupIndexOf } from '../src/sim/groups';

/** Steps a world, collecting every event the detector finds. */
function run(world: World, ticks: number, detector = new WorldEventDetector()): WorldEvent[] {
  const events = [...detector.observe(world)];
  for (let t = 0; t < ticks; t++) {
    world.step();
    events.push(...detector.observe(world));
  }
  return events;
}

describe('World events', () => {
  it('reports each region turning lean and back when seasons are staggered', () => {
    const world = new World({ seed: 'ev', initialOrganisms: 0, immigrationInterval: 0, seasonLength: 400, leanFraction: 0.5, staggeredSeasons: true });
    const seasons = run(world, 400).filter((e) => e.kind === 'season');
    // 4 regions × one change each way per cycle
    expect(seasons).toHaveLength(8);
    expect(new Set(seasons.map((e) => (e.kind === 'season' ? e.region : -1)))).toEqual(new Set([0, 1, 2, 3]));
  });

  it('reports the world season when seasons are in step', () => {
    const world = new World({ seed: 'ev', initialOrganisms: 0, immigrationInterval: 0, seasonLength: 100, leanFraction: 0.5, staggeredSeasons: false });
    const seasons = run(world, 200).filter((e) => e.kind === 'season');
    expect(seasons.map((e) => (e.kind === 'season' ? [e.tick, e.region, e.season] : null))).toEqual([
      [50, null, 'lean'],
      [100, null, 'plenty'],
      [150, null, 'lean'],
      [200, null, 'plenty'],
    ]);
  });

  it('reports a colour group rising and dying out, and extinction', () => {
    const world = new World({ seed: 'ev', initialOrganisms: 0, immigrationInterval: 0, foodRegionCount: 0 });
    const detector = new WorldEventDetector();
    detector.observe(world);
    // Put a group of look-alikes in, then remove them.
    const template = new World({ seed: 'tpl', initialOrganisms: GROUP_ESTABLISHED, immigrationInterval: 0 });
    for (const o of template.organisms.values()) world.organisms.set(o.id, { ...o, tag: 120 });
    world.step();
    const rise = detector.observe(world);
    expect(rise).toContainEqual(expect.objectContaining({ kind: 'groupEstablished', group: groupIndexOf(120) }));
    world.organisms.clear();
    world.step();
    const fall = detector.observe(world);
    expect(fall.map((e) => e.kind)).toEqual(expect.arrayContaining(['groupExtinct', 'extinction']));
    expect(fall.every((e, i) => i === 0 || e.seq > fall[i - 1].seq)).toBe(true);
  });

  it('reports population records in steps of 100 and a crash below half the recent peak', () => {
    const world = new World({ seed: 'ev', initialOrganisms: 0, immigrationInterval: 0, foodRegionCount: 0 });
    const detector = new WorldEventDetector();
    detector.observe(world);
    const template = new World({ seed: 'tpl', gridWidth: 30, gridHeight: 30, initialOrganisms: 230, obstacleDensity: 0, immigrationInterval: 0 });
    const all = Array.from(template.organisms.values());
    for (const o of all) world.organisms.set(o.id, o);
    world.tick++;
    const up = detector.observe(world);
    expect(up.filter((e) => e.kind === 'populationRecord').map((e) => (e.kind === 'populationRecord' ? e.population : 0))).toEqual([200]);
    for (const o of all.slice(0, 150)) world.organisms.delete(o.id);
    world.tick++;
    expect(detector.observe(world)).toContainEqual(expect.objectContaining({ kind: 'populationCrash', from: 230, to: 80 }));
  });

  it('only watches: a world gives the same results with or without a detector', async () => {
    const small = { seed: 'watch', gridWidth: 30, gridHeight: 30, initialOrganisms: 20, maxFoodPatches: 36, initialFoodPatches: 22 };
    const a = new World(small);
    const b = new World(small);
    const detector = new WorldEventDetector();
    const maps = new ActivityMaps(b.config.gridWidth, b.config.gridHeight);
    for (let t = 0; t < 200; t++) {
      if (t % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
      a.step();
      b.step();
      detector.observe(b);
      maps.observe(b);
    }
    expect(Array.from(b.organisms.values()).map((o) => [o.id, o.x, o.y, o.energy])).toEqual(
      Array.from(a.organisms.values()).map((o) => [o.id, o.x, o.y, o.energy])
    );
  }, 60_000);
});

describe('Activity heatmaps', () => {
  it('counts meals and deaths where they happen, and fades them over time', async () => {
    const world = new World({ seed: 'heat', gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22, maxFoodPatches: 36, foodRegionCount: 0 });
    const maps = new ActivityMaps(30, 30);
    maps.observe(world);
    let meals = 0;
    let deaths = 0;
    for (let t = 0; t < 250; t++) {
      if (t % 50 === 0) await new Promise((resolve) => setImmediate(resolve));
      const before = world.deathsTotal;
      world.step();
      deaths += world.deathsTotal - before;
      for (const o of world.organisms.values()) {
        const d = o.recentHistory[0];
        if (d && d.tick === world.tick - 1 && d.chosenAction.type === 'EAT' && d.outcome === 'success') meals++;
      }
      maps.observe(world);
    }
    const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);
    expect(meals).toBeGreaterThan(0);
    expect(deaths).toBeGreaterThan(0);
    // Faded totals are positive but below the raw counts.
    expect(sum(maps.snapshot('feeding'))).toBeGreaterThan(0);
    expect(sum(maps.snapshot('feeding'))).toBeLessThan(meals);
    expect(sum(maps.snapshot('deaths'))).toBeGreaterThan(0);
    expect(sum(maps.snapshot('deaths'))).toBeLessThan(deaths);
    expect(sum(maps.snapshot('crowding'))).toBeGreaterThan(0);
  }, 60_000);
});
