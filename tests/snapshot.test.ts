import { describe, expect, it } from 'vitest';
import { World, type WorldState } from '../src/sim/world';

/** JSON drops keys whose value is undefined; compare states the same way. */
const plain = (state: WorldState) => JSON.parse(JSON.stringify(state)) as WorldState;

const SMALL = { gridWidth: 30, gridHeight: 30, initialOrganisms: 20, initialFoodPatches: 22, maxFoodPatches: 36 };

describe('Snapshots', () => {
  it.each(['dials', 'brain'] as const)('a world restored mid-run continues exactly as the original (%s)', (controller) => {
    const original = new World({ ...SMALL, seed: 'snap', controller });
    for (let t = 0; t < 300; t++) original.step();

    // Through JSON, as a saved file would be.
    const saved = JSON.parse(JSON.stringify(original.exportState())) as WorldState;
    const restored = World.fromState(saved);
    expect(plain(restored.exportState())).toEqual(plain(original.exportState()));

    for (let t = 0; t < 300; t++) {
      original.step();
      restored.step();
    }
    expect(restored.tick).toBe(600);
    expect(plain(restored.exportState())).toEqual(plain(original.exportState()));
    expect(plain(restored.exportState()).history).toEqual(plain(original.exportState()).history);
  }, 30_000);

  it('a restored world resets to the same start as the original seed', () => {
    const original = new World({ ...SMALL, seed: 'snap-reset' });
    for (let t = 0; t < 50; t++) original.step();
    const restored = World.fromState(original.exportState());
    restored.reset('snap-reset');
    const fresh = new World({ ...SMALL, seed: 'snap-reset' });
    expect(restored.exportState()).toEqual(fresh.exportState());
  });

  it('is independent of the world it came from', () => {
    const original = new World({ ...SMALL, seed: 'snap-copy' });
    const restored = World.fromState(original.exportState());
    const first = Array.from(restored.organisms.values())[0];
    first.energy = 1;
    expect(original.organisms.get(first.id)!.energy).not.toBe(1);
  });

  it('refuses an unknown version', () => {
    const state = { ...new World({ ...SMALL, seed: 1 }).exportState(), version: 2 } as unknown as WorldState;
    expect(() => World.fromState(state)).toThrow(/version/);
  });
});
