import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createConfig } from '../src/sim/config';
import { createHeadStartBrain } from '../src/sim/brain';
import { TERRAIN_FULL, TerrainField, coverExposure, generateTerrain, roughnessMoveFactor } from '../src/sim/terrain';
import { thermalUpkeepFactor } from '../src/sim/traits';
import type { Organism, PolicyWeights } from '../src/sim/types';

// Terrain fields (docs/decisions.md, "Terrain fields"): per-cell roughness (move cost) and cover
// (shelter from temperature swing and weather exposure), from seeded noise with a stream of its own.

const ZERO_POLICY: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0, eatDrive: 0,
  reproduceDrive: 0, kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0, careForChildren: 0,
  forageDrive: 0, eatPriority: 0, hungerUrgency: 0, followFoodParent: 0, signalOnFood: 0,
  signalWhenHungry: 0, followSignal: 0, restDrive: 0, avoidOccupied: 0, leapEagerness: 0,
};

function body(overrides: Partial<Organism> = {}): Organism {
  return {
    id: 'o', x: 5, y: 5, energy: 50, policy: ZERO_POLICY, tag: 0, carryCapacity: 2, dispersal: 1,
    memorySpan: 0, carnivory: 0, kills: 0, memoryWeights: [],
    memory: { food: null, signal: null, home: { x: 0, y: 0 }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 }, brain: createHeadStartBrain(new PRNG(1)),
    lineage: { id: 'l', parentId: null, generation: 1, birthTick: 0 }, age: 100, offspringCount: 0,
    foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1, recentHistory: [],
    ...overrides,
  };
}

describe('Terrain generation', () => {
  it('is deterministic per seed, differs between seeds, and stays in range', () => {
    const a = generateTerrain(createConfig({ seed: 1 }));
    const b = generateTerrain(createConfig({ seed: 1 }));
    const c = generateTerrain(createConfig({ seed: 2 }));
    expect(Array.from(a.roughness)).toEqual(Array.from(b.roughness));
    expect(Array.from(a.cover)).toEqual(Array.from(b.cover));
    expect(Array.from(a.roughness)).not.toEqual(Array.from(c.roughness));
    expect(a.roughness.length).toBe(60 * 60);
    expect(Math.max(...a.roughness)).toBeLessThanOrEqual(TERRAIN_FULL);
    // Rough and open ground both exist, and the two fields are not the same.
    const open = Array.from(a.roughness).filter((v) => v === 0).length;
    expect(open).toBeGreaterThan(0.2 * 3600);
    expect(open).toBeLessThan(0.9 * 3600);
    expect(Array.from(a.roughness)).not.toEqual(Array.from(a.cover));
  });

  it('is smooth: neighbouring cells differ little', () => {
    const t = generateTerrain(createConfig({ seed: 3 }));
    let worst = 0;
    for (let y = 0; y < 60; y++) for (let x = 0; x < 59; x++) worst = Math.max(worst, Math.abs(t.roughnessAt(x, y) - t.roughnessAt(x + 1, y)));
    expect(worst).toBeLessThan(0.35);
  });

  it('draws nothing from the simulation random stream, and is independent of the food regions', () => {
    // The same world with terrain off and on makes the same walls, food regions and founders.
    const off = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 9, terrainEnabled: false });
    const on = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 9, terrainEnabled: true });
    expect(Array.from(on.obstacles)).toEqual(Array.from(off.obstacles));
    expect(on.foodRegions).toEqual(off.foodRegions);
    expect(Array.from(on.organisms.keys())).toEqual(Array.from(off.organisms.keys()));
    expect(off.getTerrain()).toBeNull();
    expect(on.getTerrain()).not.toBeNull();
  });
});

describe('Terrain physics', () => {
  const cfg = createConfig({});

  it('charges more to enter rough ground, more for a bigger footprint, and nothing extra on open ground', () => {
    expect(roughnessMoveFactor(0, 1, cfg)).toBe(1);
    expect(roughnessMoveFactor(1, 1, cfg)).toBeCloseTo(1 + cfg.terrainRoughnessCoeff, 12);
    expect(roughnessMoveFactor(1, 4, cfg)).toBeCloseTo(1 + cfg.terrainRoughnessCoeff * 2, 12); // √4 = 2
    expect(roughnessMoveFactor(0.5, 1, cfg)).toBeGreaterThan(1);
    expect(roughnessMoveFactor(0.5, 1, cfg)).toBeLessThan(roughnessMoveFactor(1, 1, cfg));
  });

  it('lets cover shelter a body from temperature swing and weather exposure', () => {
    expect(coverExposure(0, cfg)).toBe(1);
    expect(coverExposure(1, cfg)).toBeCloseTo(1 - cfg.terrainCoverShelter, 12);
    const small = body({ size: 0.5, metabolicRate: 1 });
    const cold = -0.6;
    const open = thermalUpkeepFactor(small, cold * coverExposure(0, cfg), cfg);
    const covered = thermalUpkeepFactor(small, cold * coverExposure(1, cfg), cfg);
    expect(covered).toBeLessThan(open);
    const heat = 0.9;
    expect(thermalUpkeepFactor(body({ size: 2 }), heat * coverExposure(1, cfg), cfg)).toBeLessThan(thermalUpkeepFactor(body({ size: 2 }), heat, cfg));
  });

  it('charges a real move more on rough ground than on open ground, and the ledger still balances', () => {
    // Two worlds from the same seed, one with a field of all-rough ground and one with all-open ground;
    // a single organism that is made to move pays the extra. Weather off so only terrain differs.
    const run = (rough: number) => {
      const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
        seed: 4, gridWidth: 12, gridHeight: 12, weatherEnabled: false, terrainEnabled: true, terrainWearEnabled: false, obstacleDensity: 0,
        initialOrganisms: 0, initialFoodPatches: 0, torporEnabled: false, ledgerCheckInterval: 1, controller: 'dials',
        plantsEnabled: false,
      });
      const roughness = new Uint16Array(144).fill(rough * 257);
      (world as unknown as { terrainField: TerrainField }).terrainField = TerrainField.fresh(12, 12, roughness, new Uint16Array(144));
      const mover = body({ id: 'mover', x: 6, y: 6, energy: 80, policy: { ...ZERO_POLICY, exploreTendency: 2 } });
      world.organisms.set(mover.id, mover);
      world.step();
      const flows = world.ledger.report()!;
      return { move: flows.flows.move, violations: flows.violations };
    };
    const open = run(0);
    const rough = run(255);
    expect(rough.violations).toBe(0);
    expect(open.violations).toBe(0);
    expect(open.move).toBeGreaterThan(0); // the explorer really moved
    expect(rough.move / open.move).toBeCloseTo(1 + createConfig({}).terrainRoughnessCoeff, 6);
  });
});

describe('Terrain in saved worlds', () => {
  it('survives an export and restore, and a world from before terrain loads with it off', () => {
    const a = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 6 });
    for (let t = 0; t < 30; t++) a.step();
    const state = a.exportState();
    expect(state.terrain).toBeDefined();
    const b = World.fromState(state);
    expect(Array.from(b.getTerrain()!.roughness)).toEqual(Array.from(a.getTerrain()!.roughness));
    expect(b.stateHash()).toBe(a.stateHash());

    const { terrain: _terrain, ...old } = state;
    const { terrainEnabled: _flag, ...oldConfig } = old.config as unknown as Record<string, unknown>;
    const loaded = World.fromState({ ...old, config: oldConfig as unknown as typeof old.config });
    expect(loaded.config.terrainEnabled).toBe(false);
    expect(loaded.getTerrain()).toBeNull();
  }, 60_000);

  it('keeps the energy books balanced with terrain on', () => {
    const w = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 8, ledgerCheckInterval: 1 });
    for (let t = 0; t < 300; t++) w.step();
    expect(w.ledgerReport()!.violations).toBe(0);
  }, 120_000);
});

describe('Terrain wear and recovery', () => {
  const cfg = createConfig({});
  const field = (rough = TERRAIN_FULL, cover = TERRAIN_FULL) =>
    TerrainField.fresh(10, 10, new Uint16Array(100).fill(rough), new Uint16Array(100).fill(cover));

  it('wears roughness and cover down multiplicatively, more for a bigger footprint, and never below zero', () => {
    const a = field();
    const b = field();
    a.trample(0, 1, cfg);
    b.trample(0, 4, cfg); // footprint √4 = 2
    expect(a.roughnessAt(0, 0)).toBeCloseTo(1 - cfg.terrainTrampleRoughness, 3);
    expect(b.roughnessAt(0, 0)).toBeCloseTo(1 - 2 * cfg.terrainTrampleRoughness, 3);
    expect(b.coverAt(0, 0)).toBeLessThan(a.coverAt(0, 0));
    for (let i = 0; i < 5000; i++) a.trample(0, 2.5, cfg);
    expect(a.roughnessAt(0, 0)).toBeGreaterThanOrEqual(0);
    expect(a.coverAt(0, 0)).toBeGreaterThanOrEqual(0);
  });

  it('leaves open ground untouched (nothing to wear) and grazing wears only cover', () => {
    const open = field(0, 0);
    open.trample(5, 1, cfg);
    open.graze(5, cfg);
    expect(open.wornCells()).toBe(0);
    const f = field();
    f.graze(7, cfg);
    expect(f.roughnessAt(7, 0)).toBe(1);
    expect(f.coverAt(7, 0)).toBeCloseTo(1 - cfg.terrainGrazeCover, 3);
    expect(f.wornCells()).toBe(1);
  });

  it('recovers toward the original terrain: busy cells stay worn longer, and healed cells are no longer worn', () => {
    const f = field();
    for (let i = 0; i < 300; i++) f.trample(1, 1, cfg); // a busy path
    for (let i = 0; i < 20; i++) f.trample(2, 1, cfg); // a quiet cell
    const busy0 = f.roughnessAt(1, 0);
    const quiet0 = f.roughnessAt(2, 0);
    expect(busy0).toBeLessThan(quiet0);
    f.recover(10, cfg);
    expect(f.roughnessAt(1, 0)).toBeGreaterThan(busy0); // moved back toward 1
    expect(f.roughnessAt(1, 0)).toBeLessThan(1); // but not all the way
    for (let i = 0; i < 2000; i++) f.recover(10, cfg);
    expect(f.roughnessAt(1, 0)).toBe(1);
    expect(f.coverAt(1, 0)).toBe(1);
    expect(f.wornCells()).toBe(0);
  });

  it('wears the ground in a real world, and not at all with wear switched off', () => {
    const worn = (terrainWearEnabled: boolean) => {
      const w = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 12, terrainWearEnabled });
      for (let t = 0; t < 250; t++) w.step();
      return w.getTerrain()!.wornCells();
    };
    expect(worn(true)).toBeGreaterThan(0);
    expect(worn(false)).toBe(0);
  }, 120_000);

  it('a crossing leaves the cell entered smoother, and no other cell changes', () => {
    const world = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */ 
      seed: 4, gridWidth: 12, gridHeight: 12, weatherEnabled: false, terrainEnabled: true, obstacleDensity: 0,
      initialOrganisms: 0, initialFoodPatches: 0, torporEnabled: false, controller: 'dials', plantsEnabled: false,
    });
    (world as unknown as { terrainField: TerrainField }).terrainField = TerrainField.fresh(12, 12, new Uint16Array(144).fill(TERRAIN_FULL), new Uint16Array(144));
    const mover = body({ id: 'mover', x: 6, y: 6, energy: 80, policy: { ...ZERO_POLICY, exploreTendency: 2 } });
    world.organisms.set(mover.id, mover);
    world.step();
    expect([mover.x, mover.y]).not.toEqual([6, 6]);
    const t = world.getTerrain()!;
    expect(t.wornCells()).toBe(1);
    expect(t.roughnessAt(mover.x, mover.y)).toBeLessThan(1);
    expect(t.roughnessAt(6, 6)).toBe(1); // the cell it left is untouched
  });

  it('survives a save and restore bit for bit, worn ground included, and then continues identically', () => {
    const a = new World({ elevationEnabled: false, /* isolates the mechanism from continents and water */  seed: 21 });
    for (let t = 0; t < 120; t++) a.step();
    expect(a.getTerrain()!.wornCells()).toBeGreaterThan(0);
    const b = World.fromState(a.exportState());
    expect(b.getTerrain()!.wornCells()).toBe(a.getTerrain()!.wornCells());
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 40; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  }, 120_000);

  it('reads terrain saved as bytes by an earlier version', () => {
    const a = generateTerrain(createConfig({ seed: 5 }));
    const bytes = Array.from(a.roughness, (v) => Math.round(v / 257));
    const state = { width: 60, height: 60, roughness: bytes, cover: bytes };
    const restored = TerrainField.fromState(state, createConfig({ seed: 5 }));
    expect(restored.roughness[10]).toBe(bytes[10] * 257);
  });

  it('reports how worn a cell is against the original, and the page can keep the original across updates', () => {
    const f = field();
    expect(f.wear01(3)).toBe(0);
    for (let i = 0; i < 100; i++) f.trample(3, 1, cfg);
    const w = f.wear01(3);
    expect(w).toBeGreaterThan(0.2);
    expect(w).toBeLessThan(1);
    expect(field(0, 0).wear01(3)).toBe(0); // open ground has nothing to wear

    // The static message carries the original; later updates carry only the current fields.
    const first = TerrainField.forView(f.exportState(true));
    expect(first.wear01(3)).toBeCloseTo(w, 6);
    f.trample(3, 1, cfg);
    const next = TerrainField.forView(f.exportState(), first.originalFields());
    expect(next.wear01(3)).toBeCloseTo(f.wear01(3), 6);
    expect(f.exportState().original).toBeUndefined(); // saves never hold it
  });
});
