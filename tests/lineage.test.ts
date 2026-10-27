import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { createConfig } from '../src/sim/config';
import {
  LineageTracker,
  attributeGenomeChanges,
  snapshotTraits,
  type TraitSnapshot,
} from '../src/sim/lineage';
import type { Organism } from '../src/sim/types';

function createMockOrganism(id: string, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x: 5,
    y: 5,
    energy: 100,
    tag: 120,
    lineage: {
      id: 'family-1',
      generation: 1,
      founderHue: 120,
      mutations: 0,
      ...overrides.lineage,
    },
    size: 1.0,
    sensingRadius: 2,
    metabolicRate: 1.0,
    digestiveEfficiency: 1.0,
    energyReserveCap: 1.0,
    carnivory: 0.1,
    carryCapacity: 0,
    memorySpan: 0,
    dispersal: 1,
    abilities: { diagonal: false, squeeze: false, leap: false },
    controller: 'brain',
    weights: {} as any,
    brain: {} as any,
    memory: {} as any,
    ...overrides,
  };
}

describe('Genome Lineage Tracking & Attribution', () => {
  it('correctly snapshots traits from an organism', () => {
    const org = createMockOrganism('org-1', {
      size: 1.25,
      carnivory: 0.45,
      dispersal: 2,
      abilities: { diagonal: true, squeeze: false, leap: false },
      clutchSize: 2.5,
      eggAllocation: 0.3,
    });

    const snapshot = snapshotTraits(org);
    expect(snapshot.size).toBe(1.25);
    expect(snapshot.carnivory).toBe(0.45);
    expect(snapshot.dispersal).toBe(2);
    expect(snapshot.abilities.diagonal).toBe(true);
    expect(snapshot.abilities.squeeze).toBe(false);
    expect(snapshot.clutchSize).toBe(2.5);
    expect(snapshot.eggAllocation).toBe(0.3);
  });

  it('attributes asexual cloning mutations when traits drift', () => {
    const parent = createMockOrganism('parent-1', {
      size: 1.0,
      carnivory: 0.0,
      dispersal: 1,
      abilities: { diagonal: false, squeeze: false, leap: false },
    });
    const parentSnapshot = snapshotTraits(parent);

    const child = createMockOrganism('child-1', {
      size: 1.3,
      carnivory: 0.2,
      dispersal: 2,
      abilities: { diagonal: true, squeeze: false, leap: false },
    });

    const { crossover, mutations } = attributeGenomeChanges(child, parentSnapshot);
    expect(crossover).toBeUndefined();
    expect(mutations.some((m) => m.includes('Size'))).toBe(true);
    expect(mutations.some((m) => m.includes('Diet'))).toBe(true);
    expect(mutations.some((m) => m.includes('Dispersal'))).toBe(true);
    expect(mutations.some((m) => m.includes('+Diagonal'))).toBe(true);
  });

  it('attributes sexual mating crossover shares and mate trait contributions', () => {
    const parent = createMockOrganism('parent-1', {
      size: 1.0,
      carnivory: 0.0,
      dispersal: 1,
      abilities: { diagonal: false, squeeze: false, leap: false },
    });
    const parentSnapshot = snapshotTraits(parent);

    const mate = createMockOrganism('mate-1', {
      size: 1.5,
      carnivory: 0.8,
      dispersal: 3,
      abilities: { diagonal: true, squeeze: true, leap: false },
    });
    const mateSnapshot = snapshotTraits(mate);

    // Child gets diet and diagonal ability from mate, but size and dispersal from parent
    const child = createMockOrganism('child-1', {
      size: 1.0,
      carnivory: 0.8,
      dispersal: 1,
      abilities: { diagonal: true, squeeze: false, leap: false },
    });

    const { crossover, mutations } = attributeGenomeChanges(child, parentSnapshot, mateSnapshot);
    expect(crossover).toBeDefined();
    expect(crossover!.parentShare).toBeGreaterThan(0);
    expect(crossover!.mateShare).toBeGreaterThan(0);
    expect(crossover!.mateTraits.some((t) => t.includes('Carnivory') || t.includes('Diagonal'))).toBe(true);
  });

  it('tracks lineage nodes across generations and retrieves ancestry tree', () => {
    const tracker = new LineageTracker();

    // 1. Founder
    const founder = createMockOrganism('founder-1', {
      lineage: { id: 'fam-1', generation: 1, founderHue: 120, mutations: 0 },
    });
    tracker.recordBirth(founder, null, null, 0);

    // 2. Mate
    const mate = createMockOrganism('founder-2', {
      lineage: { id: 'fam-2', generation: 1, founderHue: 240, mutations: 0 },
    });
    tracker.recordBirth(mate, null, null, 0);

    // 3. Child
    const child = createMockOrganism('child-1', {
      lineage: { id: 'fam-1', generation: 2, founderHue: 120, mutations: 1 },
    });
    tracker.recordBirth(child, founder, mate, 10);

    const ancestry = tracker.getAncestry('child-1', 4);
    expect(ancestry.length).toBe(3);

    const ids = ancestry.map((n) => n.id);
    expect(ids).toContain('child-1');
    expect(ids).toContain('founder-1');
    expect(ids).toContain('founder-2');

    const childNode = ancestry.find((n) => n.id === 'child-1');
    expect(childNode?.parentId).toBe('founder-1');
    expect(childNode?.mateId).toBe('founder-2');
    expect(childNode?.generation).toBe(2);
  });

  it('prunes extinct lineage nodes while retaining live ancestry', () => {
    const tracker = new LineageTracker();

    const founderA = createMockOrganism('fa', { lineage: { id: 'fa', generation: 1, founderHue: 50, mutations: 0 } });
    const founderB = createMockOrganism('fb', { lineage: { id: 'fb', generation: 1, founderHue: 150, mutations: 0 } });
    tracker.recordBirth(founderA, null, null, 0);
    tracker.recordBirth(founderB, null, null, 0);

    const childA = createMockOrganism('ca', { lineage: { id: 'fa', generation: 2, founderHue: 50, mutations: 1 } });
    tracker.recordBirth(childA, founderA, null, 10);

    // Currently only childA is alive; founderB had no living descendants
    tracker.prune(['ca']);

    expect(tracker.getAncestry('ca').map((n) => n.id)).toEqual(expect.arrayContaining(['ca', 'fa']));
    expect(tracker.getAncestry('fb').length).toBe(0);
  });

  it('serializes and restores lineage state identically', () => {
    const tracker = new LineageTracker();
    const founder = createMockOrganism('f1');
    tracker.recordBirth(founder, null, null, 5);

    const child = createMockOrganism('c1', { lineage: { id: 'f1', generation: 2, founderHue: 120, mutations: 1 } });
    tracker.recordBirth(child, founder, null, 15);

    const exported = tracker.exportState();

    const tracker2 = new LineageTracker();
    tracker2.fromState(exported);

    expect(tracker2.getAncestry('c1')).toEqual(tracker.getAncestry('c1'));
  });

  it('integrates seamlessly with World without altering stateHash determinism', () => {
    const prng = new PRNG(42);
    const config = createConfig({ seed: 42, worldWidth: 30, worldHeight: 30, sexEnabled: true });
    const world1 = new World(config, prng);

    const initialHash = world1.stateHash();

    // Step world a few ticks
    for (let i = 0; i < 20; i++) {
      world1.step();
    }

    const orgs = Array.from(world1.organisms.values());
    expect(orgs.length).toBeGreaterThan(0);

    // Query ancestry for living organism
    const firstOrg = orgs[0];
    const ancestry = world1.getAncestry(firstOrg.id);
    expect(ancestry.length).toBeGreaterThan(0);
    expect(ancestry[0].id).toBe(firstOrg.id);

    // Verify snapshot serialization preserves lineage
    const state = world1.exportState();
    expect(state.lineage).toBeDefined();

    const prng2 = new PRNG(42);
    const world2 = World.fromState(state, prng2);
    const ancestry2 = world2.getAncestry(firstOrg.id);
    expect(ancestry2).toEqual(ancestry);

    // Verify stateHash equality
    expect(world1.stateHash()).toBe(world2.stateHash());
  });
});
