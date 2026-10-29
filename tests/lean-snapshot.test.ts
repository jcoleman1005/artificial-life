import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { evaluateBrain } from '../src/sim/brain';
import { senseEnvironment } from '../src/sim/sensors';
import { getLegalActions } from '../src/sim/policy';
import type { WorldSnapshot } from '../src/sim/types';

/** The lean per-tick snapshot World.step builds (private; the test reaches it on purpose). */
const leanSnapshot = (w: World): WorldSnapshot =>
  (w as unknown as { buildSnapshot(full: boolean): WorldSnapshot }).buildSnapshot(false);

/** Every organism's decision from one snapshot, drawing from a fresh PRNG so two runs are comparable. */
function decisions(world: World, snapshot: WorldSnapshot) {
  const prng = new PRNG(99);
  const sorted = Array.from(world.organisms.values()).sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((org) => {
    const sensed = senseEnvironment(org, snapshot, world.config);
    const legal = getLegalActions(org, snapshot, world.config, sensed);
    const { chosenAction, scores } = evaluateBrain(org, legal, sensed, world.config, prng);
    return {
      id: org.id,
      sensed: JSON.stringify(sensed),
      legal: JSON.stringify(legal),
      scores: scores.map((s) => s.totalScore),
      chosen: JSON.stringify(chosenAction),
    };
  });
}

describe('lean per-tick snapshot', () => {
  it('gives every organism the same decision as the full getSnapshot()', () => {
    const world = new World({ seed: 7, controller: 'brain' });
    for (let t = 0; t < 120; t++) world.step();
    expect(world.organisms.size).toBeGreaterThan(10);

    const fromFull = decisions(world, world.getSnapshot());
    const fromLean = decisions(world, leanSnapshot(world));
    expect(fromLean).toEqual(fromFull);
  });

  it('leaves the live organisms untouched (nothing in the decision phase writes to them)', () => {
    const world = new World({ seed: 7, controller: 'brain' });
    for (let t = 0; t < 60; t++) world.step();
    const before = JSON.stringify(Array.from(world.organisms.values()));
    decisions(world, leanSnapshot(world));
    expect(JSON.stringify(Array.from(world.organisms.values()))).toBe(before);
  });
});
