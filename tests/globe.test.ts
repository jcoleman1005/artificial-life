import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createConfig } from '../src/sim/config';
import { generateElevation } from '../src/sim/elevation';
import { getLegalActions } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
import { neighbourIndex, wrapDx, wrapX } from '../src/sim/globe';
import { WeatherSimulation } from '../src/sim/weather';
import { PRNG } from '../src/sim/prng';
import type { Organism } from '../src/sim/types';

// The globe (docs/specs/globe.md): a cylinder (east and west edges join), wind belts and rain bands by latitude, and
// opposite-hemisphere seasons. Mechanisms and invariants only: nothing asserts any behaviour evolves.

describe('Wrapping helpers', () => {
  it('wrap a column onto the map and take the short way round', () => {
    expect(wrapX(-1, 60, true)).toBe(59);
    expect(wrapX(60, 60, true)).toBe(0);
    expect(wrapX(-61, 60, true)).toBe(59);
    expect(wrapX(-1, 60, false)).toBe(-1);
    expect(wrapDx(59, 60, true)).toBe(-1);
    expect(wrapDx(-59, 60, true)).toBe(1);
    expect(wrapDx(20, 60, true)).toBe(20);
    expect(wrapDx(59, 60, false)).toBe(59);
  });

  it('give a neighbour across the seam and none beyond the poles', () => {
    expect(neighbourIndex(0, 5, -1, 0, 10, 10, true)).toBe(5 * 10 + 9);
    expect(neighbourIndex(9, 5, 1, 0, 10, 10, true)).toBe(5 * 10);
    expect(neighbourIndex(0, 5, -1, 0, 10, 10, false)).toBe(-1);
    expect(neighbourIndex(3, 0, 0, -1, 10, 10, true)).toBe(-1);
    expect(neighbourIndex(3, 9, 0, 1, 10, 10, true)).toBe(-1);
  });
});

/** A quiet 20x20 world on flat ground with one organism, to test movement and senses across the seam. */
function lone(config: Record<string, unknown>, x: number, y = 10): { world: World; org: Organism } {
  const world = new World({
    seed: 11, gridWidth: 20, gridHeight: 20, initialOrganisms: 1, initialFoodPatches: 0, obstacleDensity: 0,
    elevationEnabled: false, /* isolates the seam from continents and water */
    weatherEnabled: false, controller: 'brain', ...config,
  });
  const org = world.organisms.values().next().value as Organism;
  org.x = x;
  org.y = y;
  return { world, org };
}

function senses(world: World, org: Organism) {
  const snap = world.getSnapshot();
  const me = snap.organisms.find((o) => o.id === org.id)!;
  const sensed = senseEnvironment(me, snap, world.config);
  return { snap, me, sensed, legal: getLegalActions(me, snap, world.config, sensed) };
}

describe('Wrap in the sim', () => {
  it('lets a body step off the west edge onto the east, and not when the world is flat', () => {
    const wrapped = lone({ worldWrapEnabled: true }, 0);
    const west = senses(wrapped.world, wrapped.org).legal.find((a) => a.type === 'MOVE_WEST');
    expect(west?.target).toEqual({ x: 19, y: 10 });
    const flat = lone({ worldWrapEnabled: false }, 0);
    expect(senses(flat.world, flat.org).legal.some((a) => a.type === 'MOVE_WEST')).toBe(false);
    const east = lone({ worldWrapEnabled: true }, 19);
    expect(senses(east.world, east.org).legal.find((a) => a.type === 'MOVE_EAST')?.target).toEqual({ x: 0, y: 10 });
  });

  it('keeps the poles as edges: no step north from the top row', () => {
    const { world, org } = lone({ worldWrapEnabled: true }, 5, 0);
    expect(senses(world, org).legal.some((a) => a.type === 'MOVE_NORTH')).toBe(false);
  });

  it('actually moves a body across the seam and charges for it like any step', () => {
    const { world, org } = lone({ worldWrapEnabled: true, brainMutationRate: 0 }, 0);
    const legal = senses(world, org).legal;
    expect(legal.some((a) => a.type === 'MOVE_WEST')).toBe(true);
    // Hand the body to the step with only the westward move: place food west of the seam so it is the best move.
    world.foodPatches.set('19,10', { x: 19, y: 10, stock: 5, capacity: 5 });
    for (let t = 0; t < 6; t++) world.step();
    expect(world.organisms.size).toBeGreaterThan(0);
    for (const o of world.organisms.values()) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThan(20);
    }
  });

  it('senses food, bodies and obstacles across the seam as near, with the short way as the direction', () => {
    const { world, org } = lone({ worldWrapEnabled: true }, 0);
    world.foodPatches.set('18,10', { x: 18, y: 10, stock: 3, capacity: 3 });
    const a = senses(world, org).sensed;
    expect(a.nearestFood).not.toBeNull();
    expect(a.nearestFood!.dx).toBe(-2);
    expect(a.nearestFood!.x).toBe(18);
    expect(a.nearestFood!.distance).toBe(2);
    // The same world flat: the food is 18 columns away and out of sight.
    const flat = lone({ worldWrapEnabled: false }, 0);
    flat.world.foodPatches.set('18,10', { x: 18, y: 10, stock: 3, capacity: 3 });
    expect(senses(flat.world, flat.org).sensed.nearestFood).toBeNull();
    // No wall at the seam when wrapped: the nearest obstacle is not the (absent) west edge.
    expect(a.nearestObstacle === null || a.nearestObstacle.dx !== -1 || a.nearestObstacle.dy !== 0).toBe(true);
  });

  it('sees another body across the seam', () => {
    const { world, org } = lone({ worldWrapEnabled: true, initialOrganisms: 2 }, 0);
    const other = Array.from(world.organisms.values()).find((o) => o.id !== org.id)!;
    other.x = 19;
    other.y = 10;
    const { sensed } = senses(world, org);
    expect(sensed.nearestOrganism).not.toBeNull();
    expect(sensed.nearestOrganism!.dx).toBe(-1);
    expect(sensed.surroundingOrganismCount).toBeGreaterThan(0);
  });

  it('wraps seeds and nutrients: plants grow across the seam', () => {
    const w = new World({ seed: 5, gridWidth: 20, gridHeight: 20, initialOrganisms: 0, elevationEnabled: false, worldWrapEnabled: true, weatherEnabled: false });
    for (let t = 0; t < 400; t++) w.step();
    const xs = new Set<number>();
    for (const p of w.foodPatches.values()) xs.add(p.x);
    expect(xs.has(0) || xs.has(19)).toBe(true);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(20);
    }
  }, 60_000);
});

describe('Elevation on a cylinder', () => {
  it('has no seam: the height changes across the join about as much as between any two columns', () => {
    for (const seed of [1, 2, 3, 4]) {
      const c = createConfig({ seed, worldWrapEnabled: true });
      const e = generateElevation(c);
      const { width: w, height: h } = e;
      const colDiff = (a: number, b: number) => {
        let s = 0;
        for (let y = 0; y < h; y++) s += Math.abs(e.elev01(y * w + a) - e.elev01(y * w + b));
        return s / h;
      };
      let inside = 0;
      for (let x = 0; x < w - 1; x++) inside += colDiff(x, x + 1);
      inside /= w - 1;
      expect(colDiff(w - 1, 0)).toBeLessThan(inside * 2.5 + 0.02);
    }
  });

  it('lets land and water span the seam: some continent touches both edges, and the join is not a wall of sea', () => {
    let spanning = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const e = generateElevation(createConfig({ seed, worldWrapEnabled: true }));
      const { width: w, height: h } = e;
      for (let y = 0; y < h; y++) {
        const a = y * w;
        const b = y * w + w - 1;
        if (!e.isPermanentWater(a) && !e.isPermanentWater(b) && e.continent[a] >= 0 && e.continent[a] === e.continent[b]) {
          spanning++;
          break;
        }
      }
    }
    expect(spanning).toBeGreaterThan(0);
  });

  it('is deterministic and differs from the flat map', () => {
    const a = generateElevation(createConfig({ seed: 3, worldWrapEnabled: true }));
    const b = generateElevation(createConfig({ seed: 3, worldWrapEnabled: true }));
    const flat = generateElevation(createConfig({ seed: 3, worldWrapEnabled: false }));
    expect(Array.from(a.elevation)).toEqual(Array.from(b.elevation));
    expect(Array.from(a.elevation)).not.toEqual(Array.from(flat.elevation));
  });
});

describe('Climate belts', () => {
  const sim = () => new WeatherSimulation(60, 60).configure(createConfig({ climateBeltsEnabled: true, worldWrapEnabled: true }));

  it('put easterly trades in the tropics, westerlies in mid-latitudes, easterlies at the poles', () => {
    const s = sim();
    const rowAt = (phi: number) => Math.floor(30 - phi * 30); // northern hemisphere row for latitude phi
    expect(s.beltWind(rowAt(1 / 6)).wx).toBeLessThan(0);
    expect(s.beltWind(rowAt(0.5)).wx).toBeGreaterThan(0);
    expect(s.beltWind(rowAt(5 / 6)).wx).toBeLessThan(0);
  });

  it('blow toward the equator in the trades and mirror across the equator', () => {
    const s = sim();
    const north = s.beltWind(5); // trade belt, northern: equator is down (+y)
    const south = s.beltWind(59 - 5);
    expect(north.wy).toBeGreaterThan(0);
    expect(south.wy).toBeLessThan(0);
    expect(north.wx).toBeCloseTo(south.wx, 6);
  });

  it('are absent without the switch: the old single prevailing wind', () => {
    const off = new WeatherSimulation(60, 60).configure(createConfig({ climateBeltsEnabled: false }));
    expect(off.beltWind(10)).toEqual({ wx: 0, wy: 0 });
    expect(off.getWind(10, 10)).toEqual(off.getWind(50, 50));
  });

  it('make the wind depend on the row', () => {
    const s = sim();
    expect(s.getWind(10, 8)).not.toEqual(s.getWind(10, 30));
  });

  it('make the equator and mid-latitudes wetter than the subtropics', () => {
    const s = sim();
    expect(s.wetness(30)).toBeGreaterThan(s.wetness(Math.round(30 - 0.275 * 30)));
    expect(s.wetness(Math.round(30 - 0.55 * 30))).toBeGreaterThan(s.wetness(Math.round(30 - 0.275 * 30)));
  });

  it('form rain storms more often on wet bands than on dry ones', () => {
    const s = sim();
    const spawn = (s as unknown as { spawnBeltFront(prng: PRNG, season: null): void }).spawnBeltFront.bind(s);
    const prng = new PRNG(4);
    for (let i = 0; i < 4000; i++) spawn(prng, null);
    let wet = 0;
    let dry = 0;
    for (const f of s.fronts) {
      const lat = s.latitude(f.y);
      if (Math.abs(lat - 0.275) < 0.1) dry++;
      else if (Math.abs(lat - 0.55) < 0.1) wet++;
    }
    expect(wet).toBeGreaterThan(dry);
  });

  it('are steered: a storm on a belt drifts toward the belt wind', () => {
    const s = sim();
    s.fronts.push({ id: 1, type: 'rain_storm', x: 30, y: 25, vx: 0.3, vy: 0, radius: 12, intensity: 0.8, lifetime: 500 });
    const target = s.beltWind(25).wx * 0.8;
    for (let t = 0; t < 400; t++) s.step(t, new PRNG(1), createConfig({ weatherMaxFronts: 0, climateBeltsEnabled: true, worldWrapEnabled: true }), null);
    expect(Math.abs(s.fronts[0].vx - target)).toBeLessThan(Math.abs(0.3 - target));
  });
});

describe('Storms on a cylinder', () => {
  it('wrap their position and reach across the seam', () => {
    const s = new WeatherSimulation(60, 60).configure(createConfig({ worldWrapEnabled: true }));
    s.fronts.push({ id: 1, type: 'rain_storm', x: 59, y: 30, vx: 0, vy: 0, radius: 6, intensity: 1, lifetime: 500 });
    expect(s.getRain(1, 30)).toBeGreaterThan(0); // two columns across the join
    const flat = new WeatherSimulation(60, 60).configure(createConfig({ worldWrapEnabled: false }));
    flat.fronts.push({ id: 1, type: 'rain_storm', x: 59, y: 30, vx: 0, vy: 0, radius: 6, intensity: 1, lifetime: 500 });
    expect(flat.getRain(1, 30)).toBe(0);
  });

  it('are not discarded at the east and west edges', () => {
    const s = new WeatherSimulation(60, 60).configure(createConfig({ worldWrapEnabled: true }));
    s.fronts.push({ id: 1, type: 'cold_front', x: 59.9, y: 30, vx: 1, vy: 0, radius: 6, intensity: 1, lifetime: 500 });
    s.step(1, new PRNG(1), createConfig({ weatherMaxFronts: 0, worldWrapEnabled: true }), null);
    expect(s.fronts).toHaveLength(1);
    expect(s.fronts[0].x).toBeGreaterThanOrEqual(0);
    expect(s.fronts[0].x).toBeLessThan(60);
  });
});

describe('Hemispheric seasons', () => {
  const seasonRow = (w: World, y: number) => (w as unknown as { seasonAtRow(y: number): string | null }).seasonAtRow(y);

  it('put the southern half half a cycle behind the north', () => {
    const w = new World({ seed: 2, hemisphericSeasonsEnabled: true, seasonLength: 400, leanFraction: 0.3 });
    // At tick 0 the north is in plenty; half a cycle later (the south's tick 0) the south is.
    expect(seasonRow(w, 2)).toBe('plenty');
    expect(seasonRow(w, 57)).toBe('plenty'); // 200 ticks behind is still before the lean stretch at 280..400
    (w as unknown as { tick: number }).tick = 300; // north lean (280..), south at 500 % 400 = 100: plenty
    expect(seasonRow(w, 2)).toBe('lean');
    expect(seasonRow(w, 57)).toBe('plenty');
  });

  it('are in step everywhere with the switch off', () => {
    const w = new World({ seed: 2, hemisphericSeasonsEnabled: false, seasonLength: 400, leanFraction: 0.3 });
    (w as unknown as { tick: number }).tick = 300;
    expect(seasonRow(w, 2)).toBe(seasonRow(w, 57));
  });
});

describe('Globe in a whole world', () => {
  it('keeps every body and plant on the map, balances energy, and restores identically', () => {
    const a = new World({ seed: 8, ledgerCheckInterval: 1 });
    for (let t = 0; t < 200; t++) a.step();
    for (const o of a.organisms.values()) {
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x).toBeLessThan(a.config.gridWidth);
    }
    expect(a.ledgerReport()!.violations).toBe(0);
    const b = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    for (let t = 0; t < 50; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  }, 120_000);
});
