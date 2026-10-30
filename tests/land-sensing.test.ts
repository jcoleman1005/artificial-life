import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, HEAD_START_SKIP, LAND_INPUT_START, brainFeatures, brainInputActive, createHeadStartBrain, upgradeBrain } from '../src/sim/brain';
import { getLegalActions } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
import { decodeOrganismDNA, encodeOrganismDNA } from '../src/sim/dna';
import { createConfig } from '../src/sim/config';
import type { Organism } from '../src/sim/types';

// Land sensing (docs/specs/land-sensing.md): four appended brain inputs. Mechanisms only: nothing asserts what a brain does with them.

const idx = (name: (typeof BRAIN_INPUTS)[number]) => BRAIN_INPUTS.indexOf(name);

function features(world: World, org: Organism, type: string): number[] | null {
  const snap = world.getSnapshot();
  const me = snap.organisms.find((o) => o.id === org.id)!;
  const sensed = senseEnvironment(me, snap, world.config);
  const action = getLegalActions(me, snap, world.config, sensed).find((a) => a.type === type);
  return action ? brainFeatures(action, me, sensed, world.config, false, new PRNG(1)) : null;
}

describe('Land inputs', () => {
  it('are appended after maturity with no head start', () => {
    expect(BRAIN_INPUTS.slice(LAND_INPUT_START)).toEqual(['moveSlope', 'moveWater', 'moveRough', 'cover']);
    for (const n of ['moveSlope', 'moveWater', 'moveRough', 'cover'] as const) expect(HEAD_START_SKIP[idx(n)]).toBe(0);
  });

  it('are live only with their field on, and frozen otherwise', () => {
    const c = createConfig({ seed: 1 });
    for (let i = LAND_INPUT_START; i < BRAIN_INPUT_COUNT; i++) expect(brainInputActive(i, c)).toBe(true);
    expect(brainInputActive(idx('moveSlope'), { ...c, elevationEnabled: false })).toBe(false);
    expect(brainInputActive(idx('moveRough'), { ...c, elevationEnabled: false })).toBe(true);
    expect(brainInputActive(idx('moveRough'), { ...c, terrainEnabled: false })).toBe(false);
    for (let i = LAND_INPUT_START; i < BRAIN_INPUT_COUNT; i++) expect(brainInputActive(i, { ...c, landSensingEnabled: false })).toBe(false);
  });

  it('switch-off draws exactly the same random numbers as the brain before them', () => {
    const off = createConfig({ seed: 1, landSensingEnabled: false });
    const a = new PRNG(3);
    const b = createHeadStartBrain(a, off);
    const ref = new PRNG(3);
    for (let n = 0; n < BRAIN_HIDDEN * LAND_INPUT_START + 2 * BRAIN_HIDDEN; n++) ref.nextGaussian(0, 0.1);
    expect(a.next()).toBe(ref.next());
    for (let h = 0; h < BRAIN_HIDDEN; h++) for (let i = LAND_INPUT_START; i < BRAIN_INPUT_COUNT; i++) expect(b.hidden[h * BRAIN_INPUT_COUNT + i]).toBe(0);
  });

  it('upgrade an older brain with zero weights', () => {
    const c = createConfig({ seed: 1 });
    const full = createHeadStartBrain(new PRNG(2), c);
    const narrow = {
      ...full,
      skip: full.skip.slice(0, LAND_INPUT_START),
      hidden: Array.from({ length: BRAIN_HIDDEN }, (_, h) => full.hidden.slice(h * BRAIN_INPUT_COUNT, h * BRAIN_INPUT_COUNT + LAND_INPUT_START)).flat(),
    };
    const wide = upgradeBrain(narrow);
    expect(wide.skip).toHaveLength(BRAIN_INPUT_COUNT);
    for (let i = LAND_INPUT_START; i < BRAIN_INPUT_COUNT; i++) {
      expect(wide.skip[i]).toBe(0);
      for (let h = 0; h < BRAIN_HIDDEN; h++) expect(wide.hidden[h * BRAIN_INPUT_COUNT + i]).toBe(0);
    }
  });

  it('round-trip through the genome with the land genes present, and are absent from the genome when off', () => {
    const on = createConfig({ seed: 1 });
    const w = new World({ seed: 1, initialOrganisms: 1 });
    const org = w.organisms.values().next().value as Organism;
    const dna = org.genome!;
    expect(decodeOrganismDNA(dna, on).brain.skip).toHaveLength(BRAIN_INPUT_COUNT);
    const off = createConfig({ seed: 1, landSensingEnabled: false });
    const w2 = new World({ seed: 1, initialOrganisms: 1, landSensingEnabled: false });
    const g1 = w.organisms.values().next().value!.genome!;
    const g2 = w2.organisms.values().next().value!.genome!;
    expect(g1.length).toBeGreaterThan(g2.length); // the on genome carries the extra land genes
    expect(Array.from(encodeOrganismDNA(decodeOrganismDNA(g2, off), off)).length).toBe(g2.length);
  });
});

describe('Land features', () => {
  const world = (o = {}) => new World({ seed: 42, initialOrganisms: 3, obstacleDensity: 0, controller: 'brain', ...o });

  /** An organism on dry land with a dry neighbour to the east. */
  function placed(w: World): Organism {
    const e = w.getElevation()!;
    const width = w.config.gridWidth;
    const org = w.organisms.values().next().value as Organism;
    for (const o of [...w.organisms.values()]) if (o !== org) w.organisms.delete(o.id);
    for (let i = 0; i < e.width * e.height - 1; i++) {
      const x = i % width;
      if (x < width - 1 && !e.isWater(i) && !e.isWater(i + 1) && !w.obstacles.has(`${x},${Math.floor(i / width)}`) && !w.obstacles.has(`${x + 1},${Math.floor(i / width)}`)) {
        org.x = x;
        org.y = Math.floor(i / width);
        return org;
      }
    }
    throw new Error('no cell');
  }

  it('read the slope, water and roughness of the cell entered and the cover underfoot', () => {
    const w = world();
    const org = placed(w);
    const e = w.getElevation()!;
    const t = w.getTerrain()!;
    const width = w.config.gridWidth;
    const x = features(w, org, 'MOVE_EAST')!;
    const from = org.y * width + org.x;
    const to = from + 1;
    expect(x[idx('moveSlope')]).toBeCloseTo(Math.max(-1, Math.min(1, (e.elev01(to) - e01(e, from)) * 10)), 12);
    expect(x[idx('moveWater')]).toBe(0); // dry
    expect(x[idx('moveRough')]).toBeCloseTo(t.roughnessAt(org.x + 1, org.y), 12);
    expect(x[idx('cover')]).toBeCloseTo(t.coverAt(org.x, org.y), 12);
  });

  it('give the cover underfoot to every action but slope, water and roughness only to moves', () => {
    const w = world();
    const org = placed(w);
    const rest = features(w, org, 'REST')!;
    expect(rest[idx('moveSlope')]).toBe(0);
    expect(rest[idx('moveWater')]).toBe(0);
    expect(rest[idx('moveRough')]).toBe(0);
    expect(rest[idx('cover')]).toBeCloseTo(w.getTerrain()!.coverAt(org.x, org.y), 12);
  });

  it('read water in a wet neighbour as depth relative to the deep threshold', () => {
    const w = world();
    const e = w.getElevation()!;
    const width = w.config.gridWidth;
    const org = w.organisms.values().next().value as Organism;
    for (const o of [...w.organisms.values()]) if (o !== org) w.organisms.delete(o.id);
    let found = false;
    for (let i = 0; i < width * w.config.gridHeight - 1 && !found; i++) {
      const x = i % width;
      if (x < width - 1 && !e.isWater(i) && e.isWater(i + 1) && !e.isDeep(i + 1, w.config) && !w.obstacles.has(`${x},${Math.floor(i / width)}`)) {
        org.x = x;
        org.y = Math.floor(i / width);
        found = true;
      }
    }
    expect(found).toBe(true);
    const x = features(w, org, 'MOVE_EAST')!;
    expect(x[idx('moveWater')]).toBeGreaterThan(0);
    expect(x[idx('moveWater')]).toBeLessThanOrEqual(1);
  });

  it('are all zero with land sensing off', () => {
    const w = world({ landSensingEnabled: false });
    const org = w.organisms.values().next().value as Organism;
    const x = features(w, org, 'REST')!;
    for (let i = LAND_INPUT_START; i < BRAIN_INPUT_COUNT; i++) expect(x[i]).toBe(0);
  });

  it('keep the energy ledger balanced', () => {
    const w = new World({ seed: 9, ledgerCheckInterval: 1 });
    for (let t = 0; t < 150; t++) w.step();
    expect(w.ledgerReport()!.violations).toBe(0);
  });
});

function e01(e: { elev01(i: number): number }, i: number): number {
  return e.elev01(i);
}
