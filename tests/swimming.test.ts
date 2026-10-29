import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createConfig } from '../src/sim/config';
import { generateElevation, swimMoveFactor, wadeMoveFactor } from '../src/sim/elevation';
import { getLegalActions } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
import { canSwimDeep, swimOf } from '../src/sim/lifehistory';
import { metabolismCost } from '../src/sim/traits';
import type { Organism } from '../src/sim/types';

// Swimming and marine plants (docs/specs/swimming-marine.md). Mechanisms and invariants only: nothing here asserts that
// anything swims or that a marine food chain forms.

const SEED = 42;

/** A deep-water cell with a dry neighbour to its west, east, north or south. */
function shore(world: World): { land: { x: number; y: number }; deep: { x: number; y: number } } {
  const w = world.config.gridWidth;
  for (const key of world.deepWater) {
    const [x, y] = key.split(',').map(Number);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const lx = x + dx;
      const ly = y + dy;
      if (lx < 0 || ly < 0 || lx >= w || ly >= world.config.gridHeight) continue;
      if (!world.obstacles.has(`${lx},${ly}`) && !world.isWet(lx, ly)) return { land: { x: lx, y: ly }, deep: { x, y } };
    }
  }
  throw new Error('no shore');
}

function subject(swim: number | undefined, extra = {}): { world: World; org: Organism; deep: { x: number; y: number } } {
  const world = new World({ seed: SEED, initialOrganisms: 3, obstacleDensity: 0, ...extra });
  const { land, deep } = shore(world);
  const org = world.organisms.values().next().value as Organism;
  for (const o of [...world.organisms.values()]) if (o !== org) world.organisms.delete(o.id);
  org.x = land.x;
  org.y = land.y;
  (org as { swim?: number }).swim = swim;
  return { world, org, deep };
}

function legalMoveTo(world: World, org: Organism, cell: { x: number; y: number }): boolean {
  const snap = world.getSnapshot();
  const me = snap.organisms.find((o) => o.id === org.id)!;
  const sensed = senseEnvironment(me, snap, world.config);
  return getLegalActions(me, snap, world.config, sensed).some(
    (a) => a.type.startsWith('MOVE_') && a.target?.x === cell.x && a.target?.y === cell.y
  );
}

describe('Swimming gene', () => {
  it('is in the genome with a founder value of 0, and only where there is deep water', () => {
    const on = new World({ seed: SEED });
    for (const o of on.organisms.values()) expect(o.swim).toBe(0);
    expect(new World({ seed: SEED, elevationEnabled: false }).organisms.values().next().value!.swim).toBeUndefined();
    expect(new World({ seed: SEED, swimGeneEnabled: false }).organisms.values().next().value!.swim).toBeUndefined();
  });

  it('opens deep water to a body at or above the threshold, and to nobody else', () => {
    const c = createConfig({ seed: SEED });
    expect(canSwimDeep({ swim: 0 }, c)).toBe(false);
    expect(canSwimDeep({ swim: c.swimDeepThreshold - 0.05 }, c)).toBe(false);
    expect(canSwimDeep({ swim: c.swimDeepThreshold }, c)).toBe(true);
    expect(swimOf({ swim: 0.9 }, createConfig({ seed: SEED, swimGeneEnabled: false }))).toBe(0);
    expect(swimOf({ swim: 0.9 }, createConfig({ seed: SEED, elevationEnabled: false }))).toBe(0);
  });

  it('makes deep water a legal move for a swimmer and a wall for a non-swimmer', () => {
    for (const [swim, expected] of [[0, false], [0.3, false], [0.5, true], [1, true]] as const) {
      const { world, org, deep } = subject(swim);
      expect(legalMoveTo(world, org, deep)).toBe(expected);
    }
  });

  it('lets a swimmer cross deep water; a non-swimmer cannot step into it even when it tries', () => {
    const { world, org, deep } = subject(0.8);
    expect(world.obstacles.has(`${deep.x},${deep.y}`)).toBe(true); // still a wall to everyone else
    expect(legalMoveTo(world, org, deep)).toBe(true);
  });

  it('charges upkeep in proportion to swimming and size', () => {
    const world = new World({ seed: SEED, initialOrganisms: 1 });
    const o = world.organisms.values().next().value as Organism;
    const base = metabolismCost({ ...o, swim: 0 }, world.config);
    const fin = metabolismCost({ ...o, swim: 1 }, world.config);
    const half = metabolismCost({ ...o, swim: 0.5 }, world.config);
    expect(fin).toBeGreaterThan(half);
    expect(half).toBeGreaterThan(base);
    expect(fin - base).toBeCloseTo(2 * (half - base), 9);
    const off = createConfig({ seed: SEED, swimGeneEnabled: false });
    expect(metabolismCost({ ...o, swim: 1 }, off)).toBeCloseTo(metabolismCost({ ...o, swim: 0 }, off), 12);
  });
});

describe('Swimming laws', () => {
  const c = createConfig({ seed: SEED });
  const e = generateElevation(c);
  let deep = -1;
  let shallow = -1;
  let land = -1;
  for (let i = 0; i < e.width * e.height; i++) {
    if (deep < 0 && e.isDeep(i, c)) deep = i;
    else if (shallow < 0 && e.isWater(i) && !e.isDeep(i, c)) shallow = i;
    else if (land < 0 && !e.isWater(i)) land = i;
  }

  it('is a no-op at swim 0', () => {
    for (const i of [deep, shallow, land]) expect(swimMoveFactor(i, 0, e, c)).toBe(1);
  });

  it('costs a swimmer more on dry land, in proportion to swimming', () => {
    expect(swimMoveFactor(land, 1, e, c)).toBeCloseTo(1 + c.swimLandDrag, 12);
    expect(swimMoveFactor(land, 0.5, e, c)).toBeCloseTo(1 + 0.5 * c.swimLandDrag, 12);
  });

  it('costs a weaker swimmer more in deep water, and shrinks the wading drag in shallows', () => {
    expect(swimMoveFactor(deep, 1, e, c)).toBeCloseTo(1, 12);
    expect(swimMoveFactor(deep, 0.5, e, c)).toBeGreaterThan(swimMoveFactor(deep, 0.9, e, c));
    expect(swimMoveFactor(shallow, 0.7, e, c)).toBe(1);
    expect(wadeMoveFactor(shallow, 1, e, c, 1)).toBeCloseTo(1, 12); // a full swimmer does not wade
    expect(wadeMoveFactor(shallow, 1, e, c, 0.5)).toBeLessThan(wadeMoveFactor(shallow, 1, e, c, 0));
  });
});

describe('Marine plants', () => {
  it('give water cells fertility that falls with depth, and leave rock at zero', () => {
    const world = new World({ seed: SEED });
    const soil = world.soil();
    const e = world.getElevation()!;
    expect(soil.marine).not.toBeNull();
    let shallowMax = 0;
    let deepMax = 0;
    for (let i = 0; i < e.width * e.height; i++) {
      if (!e.isWater(i)) {
        expect(soil.marine![i]).toBe(0);
        continue;
      }
      expect(soil.marine![i]).toBe(1);
      expect(soil.fertility[i]).toBeGreaterThan(0);
      expect(soil.fertility[i]).toBeLessThanOrEqual(world.config.marineFertility + 1e-6);
      if (e.isDeep(i, world.config)) deepMax = Math.max(deepMax, soil.fertility[i]);
      else shallowMax = Math.max(shallowMax, soil.fertility[i]);
    }
    expect(shallowMax).toBeGreaterThan(deepMax);
  });

  it('grow nothing under water when switched off', () => {
    const world = new World({ seed: SEED, marineEnabled: false });
    const e = world.getElevation()!;
    for (let i = 0; i < e.width * e.height; i++) if (e.isWater(i)) expect(world.soil().fertility[i]).toBe(0);
    expect(world.soil().marine).toBeNull();
  });

  it('appear in the water as well as on land', () => {
    const world = new World({ seed: SEED, seedRainInterval: 1, seedRainCount: 10 });
    for (let t = 0; t < 100; t++) world.step();
    const e = world.getElevation()!;
    let marine = 0;
    let land = 0;
    for (const patch of world.foodPatches.values()) {
      if (!patch.plant) continue;
      if (e.isWater(patch.y * e.width + patch.x)) marine++;
      else land++;
    }
    expect(marine).toBeGreaterThan(0);
    expect(land).toBeGreaterThan(0);
  });

  it('keeps the energy ledger balanced with swimmers and marine food', () => {
    const world = new World({ seed: SEED, swimFounder: 0.6, initialOrganisms: 60, ledgerCheckInterval: 1 });
    for (let t = 0; t < 200; t++) world.step();
    expect(world.ledgerReport()!.violations).toBe(0);
  });
});

describe('Switches', () => {
  it('turning swimming and marine plants off leaves a world with no swim field and no water food', () => {
    const world = new World({ seed: SEED, swimGeneEnabled: false, marineEnabled: false });
    for (let t = 0; t < 50; t++) world.step();
    const e = world.getElevation()!;
    for (const o of world.organisms.values()) expect(o.swim).toBeUndefined();
    for (const p of world.foodPatches.values()) expect(e.isWater(p.y * e.width + p.x)).toBe(false);
  });
});
