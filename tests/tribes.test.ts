import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { computeTribeMetrics } from '../src/sim/metrics';
import { inheritTag, isKin, shareWeightFor, tagDistance, tagSimilarity } from '../src/sim/tags';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

const NEUTRAL: PolicyWeights = {
  foodAttraction: 0,
  obstacleAvoidance: 0,
  crowdingAvoidance: 0,
  exploreTendency: 0,
  eatDrive: 0,
  reproduceDrive: 0,
  kinAffinity: 0,
  shareWithKin: 0,
  shareWithStrangers: 0,
  careForChildren: 0,
};

function makeOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  return {
    id,
    x,
    y,
    energy: 50,
    policy: { ...NEUTRAL },
    tag: 0,
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 },
    age: 0,
    offspringCount: 0,
    foodEatenCount: 0,
    energyGiven: 0,
    energyReceived: 0,
    recentHistory: [],
    ...overrides,
  };
}

/**
 * An empty 10×10 world where only sharing changes energy: no metabolism,
 * free movement, and reproduction out of reach.
 */
function emptyWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 3,
    gridWidth: 10,
    gridHeight: 10,
    initialOrganisms: 0,
    initialFoodPatches: 0,
    obstacleDensity: 0,
    tickMetabolismCost: 0,
    moveCost: 0,
    reproductionThreshold: 1000,
    immigrationInterval: 0,
    foodSpawnInterval: 9999,
    ...overrides,
  });
}

describe('Tags', () => {
  it('measures hue distance around the colour wheel', () => {
    expect(tagDistance(10, 350)).toBe(20);
    expect(tagDistance(0, 180)).toBe(180);
    expect(tagSimilarity(0, 180)).toBe(0);
    expect(tagSimilarity(30, 30)).toBe(1);
    expect(isKin(10, 350, DEFAULT_CONFIG)).toBe(true); // 89% alike >= 75%
    expect(isKin(0, 90, DEFAULT_CONFIG)).toBe(false); // 50% alike
  });

  it('grades the sharing weight from the stranger weight to the kin weight', () => {
    const policy = { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: -2 };
    expect(shareWeightFor(policy, 1, DEFAULT_CONFIG)).toBe(2);
    expect(shareWeightFor(policy, 0.75, DEFAULT_CONFIG)).toBe(2);
    expect(shareWeightFor(policy, 0.5, DEFAULT_CONFIG)).toBeCloseTo(0);
    expect(shareWeightFor(policy, 0.25, DEFAULT_CONFIG)).toBe(-2);
    expect(shareWeightFor(policy, 0, DEFAULT_CONFIG)).toBe(-2);
  });

  it('inherits unchanged without mutation and always stays in [0, 360)', () => {
    const prng = new PRNG(8);
    expect(inheritTag(123, { ...DEFAULT_CONFIG, tagMutationRate: 0 }, prng)).toBe(123);
    const config = { ...DEFAULT_CONFIG, tagMutationRate: 1, tagMutationStdDev: 40 };
    for (let i = 0; i < 500; i++) {
      const tag = inheritTag(i % 2 === 0 ? 1 : 359, config, prng);
      expect(tag).toBeGreaterThanOrEqual(0);
      expect(tag).toBeLessThan(360);
    }
  });
});

describe('Sharing', () => {
  it('moves energy from donor to an adjacent recipient with the configured multiplier', () => {
    const world = emptyWorld({ shareAmount: 10, shareMultiplier: 1.5 });
    const donor = makeOrganism('donor', 5, 5, {
      energy: 90,
      policy: { ...NEUTRAL, shareWithKin: 2 },
    });
    const recipient = makeOrganism('recipient', 6, 5, { energy: 20 });
    world.organisms.set(donor.id, donor);
    world.organisms.set(recipient.id, recipient);

    world.step();

    expect(donor.recentHistory[0].chosenAction.type).toBe('SHARE_EAST');
    expect(donor.recentHistory[0].energyDelta).toBe(-10);
    expect(donor.energy).toBe(80);
    expect(recipient.energy).toBe(35);
    expect(donor.energyGiven).toBe(10);
    expect(recipient.energyReceived).toBe(15);
    expect(world.sharesTotal).toBe(1);
    expect(world.kinSharesTotal).toBe(1);
  });

  it('conserves energy by default: the recipient gains exactly what the donor gives', () => {
    const world = emptyWorld();
    const donor = makeOrganism('donor', 5, 5, { energy: 90, policy: { ...NEUTRAL, shareWithKin: 2 } });
    const recipient = makeOrganism('recipient', 6, 5, { energy: 20 });
    world.organisms.set(donor.id, donor);
    world.organisms.set(recipient.id, recipient);

    world.step();

    expect(donor.energy).toBe(80);
    expect(recipient.energy).toBe(30);
    expect(donor.energy + recipient.energy).toBe(110);
  });

  it('uses the kin weight for look-alikes and the stranger weight for others', () => {
    const world = emptyWorld();
    // Shares generously with kin, refuses strangers.
    const donor = makeOrganism('donor', 5, 5, {
      energy: 90,
      tag: 100,
      policy: { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: -2 },
    });
    const stranger = makeOrganism('stranger', 6, 5, { tag: 280, energy: 20 });
    const kin = makeOrganism('kin', 4, 5, { tag: 110, energy: 20 });
    for (const o of [donor, stranger, kin]) world.organisms.set(o.id, o);

    world.step();

    expect(donor.recentHistory[0].chosenAction.type).toBe('SHARE_WEST');
    expect(kin.energyReceived).toBeGreaterThan(0);
    expect(stranger.energyReceived).toBe(0);
  });

  it('is never chosen when switched off, or when the donor would drop too low', () => {
    for (const config of [
      { sharingEnabled: false },
      { shareAmount: 10, shareMinEnergyAfter: 25 }, // 30 - 10 < 25
    ]) {
      const world = emptyWorld(config);
      const donor = makeOrganism('donor', 5, 5, {
        energy: 30,
        policy: { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: 2 },
      });
      if (!config.shareAmount) donor.energy = 100;
      const recipient = makeOrganism('recipient', 6, 5, { energy: 20 });
      world.organisms.set(donor.id, donor);
      world.organisms.set(recipient.id, recipient);

      world.step();

      const actions = donor.recentHistory[0].scores.map((s) => s.action.type);
      expect(actions.some((a) => a.startsWith('SHARE_'))).toBe(false);
      expect(recipient.energyReceived).toBe(0);
    }
  });

  it('never pushes a recipient above maximum energy', () => {
    const world = emptyWorld({ maxEnergy: 100, shareMultiplier: 6 });
    const donor = makeOrganism('donor', 5, 5, { energy: 100, policy: { ...NEUTRAL, shareWithKin: 2 } });
    const recipient = makeOrganism('recipient', 5, 6, { energy: 45 });
    world.organisms.set(donor.id, donor);
    world.organisms.set(recipient.id, recipient);

    world.step();

    expect(recipient.energy).toBe(100);
    expect(recipient.energyReceived).toBe(55);
  });

  it('only offers sharing to hungry neighbours, scored by how hungry they are', () => {
    const scoreFor = (recipientEnergy: number) => {
      const world = emptyWorld();
      const donor = makeOrganism('donor', 5, 5, { energy: 90, policy: { ...NEUTRAL, shareWithKin: 1 } });
      const recipient = makeOrganism('recipient', 6, 5, { energy: recipientEnergy });
      world.organisms.set(donor.id, donor);
      world.organisms.set(recipient.id, recipient);
      world.step();
      return donor.recentHistory[0].scores.find((s) => s.action.type === 'SHARE_EAST')?.totalScore;
    };
    expect(scoreFor(50)).toBeUndefined(); // at half energy: not hungry
    expect(scoreFor(70)).toBeUndefined();
    // need = (50 - e) / 50; score = 1 × need × 2 − 0.1
    expect(scoreFor(25)).toBeCloseTo(0.9);
    expect(scoreFor(5)).toBeCloseTo(1.7);
  });
});

describe('Parental care', () => {
  function parentAndChild(parentEnergy: number, childEnergy: number, care: number) {
    const world = emptyWorld({ shareAmount: 10, shareMultiplier: 1.5, parentalMinEnergyAfter: 5 });
    const parent = makeOrganism('parent', 5, 5, {
      energy: parentEnergy,
      policy: { ...NEUTRAL, careForChildren: care },
    });
    const child = makeOrganism('child', 6, 5, {
      energy: childEnergy,
      lineage: { id: 'lin-parent', parentId: 'parent', generation: 2, birthTick: 0 },
    });
    world.organisms.set(parent.id, parent);
    world.organisms.set(child.id, child);
    world.step();
    return { world, parent, child };
  }

  it('feeds a hungry child even when the parent is below the normal sharing floor', () => {
    // 30 - 10 = 20 is below shareMinEnergyAfter (25) but above the parental floor (5).
    const { world, parent, child } = parentAndChild(30, 10, 2);
    expect(parent.recentHistory[0].chosenAction.type).toBe('SHARE_EAST');
    expect(parent.energy).toBe(20);
    expect(child.energy).toBe(25);
    expect(world.parentalSharesTotal).toBe(1);
  });

  it('scores care by the child’s hunger and never goes below the parental floor', () => {
    expect(parentAndChild(30, 10, 2).parent.recentHistory[0].scores.some((s) => 'parentalCare' in s.components)).toBe(true);
    // Child at or above half energy: no parental care on offer.
    const fed = parentAndChild(30, 60, 2);
    expect(fed.parent.recentHistory[0].scores.some((s) => 'parentalCare' in s.components)).toBe(false);
    // Parent would drop below the floor: 14 - 10 < 5.
    const weak = parentAndChild(14, 10, 2);
    expect(weak.parent.recentHistory[0].scores.some((s) => s.action.type.startsWith('SHARE_'))).toBe(false);
  });

  it('does not treat an unrelated hungry neighbour as a child', () => {
    const world = emptyWorld();
    const adult = makeOrganism('adult', 5, 5, { energy: 30, policy: { ...NEUTRAL, careForChildren: 2 } });
    const other = makeOrganism('other', 6, 5, { energy: 10 });
    world.organisms.set(adult.id, adult);
    world.organisms.set(other.id, other);
    world.step();
    expect(other.energyReceived).toBe(0);
  });
});

describe('Immigration', () => {
  it('adds founders with new lineages at the configured interval', () => {
    const world = emptyWorld({ immigrationInterval: 10, immigrationCount: 2 });
    for (let t = 0; t < 30; t++) world.step();
    expect(world.immigrantsTotal).toBe(6);
    const lineages = new Set(Array.from(world.organisms.values(), (o) => o.lineage.id));
    expect(lineages.size).toBe(world.organisms.size);
    for (const o of world.organisms.values()) {
      expect(o.lineage.parentId).toBeNull();
      expect(o.lineage.birthTick).toBeGreaterThan(0);
    }
  });

  it('is off when the interval is 0', () => {
    const world = emptyWorld({ immigrationInterval: 0 });
    for (let t = 0; t < 60; t++) world.step();
    expect(world.immigrantsTotal).toBe(0);
    expect(world.organisms.size).toBe(0);
  });
});

describe('Kin affinity', () => {
  it('moves a positive-affinity organism toward a look-alike and a negative one away', () => {
    for (const [affinity, expected] of [
      [2, 'MOVE_EAST'],
      [-2, 'MOVE_WEST'],
    ] as const) {
      const world = emptyWorld({ sharingEnabled: false });
      const mover = makeOrganism('mover', 3, 5, { tag: 50, policy: { ...NEUTRAL, kinAffinity: affinity } });
      const lookAlike = makeOrganism('look-alike', 6, 5, { tag: 55 });
      world.organisms.set(mover.id, mover);
      world.organisms.set(lookAlike.id, lookAlike);

      world.step();

      expect(mover.recentHistory[0].chosenAction.type).toBe(expected);
    }
  });
});

describe('Tribe metrics', () => {
  it('finds separate groups of nearby look-alikes and measures clustering above chance', () => {
    const organisms: Organism[] = [];
    // Two tight groups of 6 with very different tags, far apart.
    for (let i = 0; i < 6; i++) {
      organisms.push(makeOrganism(`a${i}`, 1 + (i % 3), 1 + Math.floor(i / 3), { tag: 10 }));
      organisms.push(makeOrganism(`b${i}`, 20 + (i % 3), 20 + Math.floor(i / 3), { tag: 200 }));
    }
    // A loner that looks like group A but lives far away.
    organisms.push(makeOrganism('loner', 10, 25, { tag: 12 }));

    const m = computeTribeMetrics(organisms, DEFAULT_CONFIG);
    expect(m.tribeCount).toBe(2);
    expect(m.largestTribe).toBe(6);
    expect(m.inTribeFraction).toBeCloseTo(12 / 13, 2);
    expect(m.localKinFraction).toBe(1);
    expect(m.globalKinFraction).toBeLessThan(0.6);
  });

  it('does not count a mixed crowd of strangers as a tribe', () => {
    // Six neighbours whose tags are all at least 60° apart (at most 67% alike).
    const organisms = Array.from({ length: 6 }, (_, i) =>
      makeOrganism(`m${i}`, i % 3, Math.floor(i / 3), { tag: i * 60 })
    );
    const m = computeTribeMetrics(organisms, DEFAULT_CONFIG);
    expect(m.tribeCount).toBe(0);
    expect(m.localKinFraction).toBe(0);
  });
});

describe('Long run with sharing', () => {
  it('keeps energy and tags within bounds and never puts two organisms in one cell', () => {
    const world = new World({ seed: 'tribes-invariants' });
    const violations: string[] = [];
    for (let t = 0; t < 600; t++) {
      world.step();
      const cells = new Set<string>();
      for (const o of world.organisms.values()) {
        const key = `${o.x},${o.y}`;
        if (!(o.energy > 0 && o.energy <= world.config.maxEnergy)) violations.push(`energy ${o.energy}`);
        if (!(o.tag >= 0 && o.tag < 360)) violations.push(`tag ${o.tag}`);
        if (cells.has(key)) violations.push(`overlap at ${key}`);
        cells.add(key);
      }
    }
    expect(violations).toEqual([]);
   }, 30_000);
});
