import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { computeTribeMetrics } from '../src/sim/metrics';
import { inheritTag, isKin, tagDistance } from '../src/sim/tags';
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
    foodSpawnInterval: 9999,
    ...overrides,
  });
}

describe('Tags', () => {
  it('measures hue distance around the colour wheel', () => {
    expect(tagDistance(10, 350)).toBe(20);
    expect(tagDistance(0, 180)).toBe(180);
    expect(isKin(10, 350, DEFAULT_CONFIG)).toBe(true); // 20° <= 30° tolerance
    expect(isKin(0, 90, DEFAULT_CONFIG)).toBe(false);
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

  it('uses the kin weight for look-alikes and the stranger weight for others', () => {
    const world = emptyWorld();
    // Shares generously with kin, refuses strangers.
    const donor = makeOrganism('donor', 5, 5, {
      energy: 90,
      tag: 100,
      policy: { ...NEUTRAL, shareWithKin: 2, shareWithStrangers: -2 },
    });
    const stranger = makeOrganism('stranger', 6, 5, { tag: 280 });
    const kin = makeOrganism('kin', 4, 5, { tag: 110 });
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
      const recipient = makeOrganism('recipient', 6, 5);
      world.organisms.set(donor.id, donor);
      world.organisms.set(recipient.id, recipient);

      world.step();

      const actions = donor.recentHistory[0].scores.map((s) => s.action.type);
      expect(actions.some((a) => a.startsWith('SHARE_'))).toBe(false);
      expect(recipient.energyReceived).toBe(0);
    }
  });

  it('never pushes a recipient above maximum energy', () => {
    const world = emptyWorld({ maxEnergy: 100 });
    const donor = makeOrganism('donor', 5, 5, { energy: 100, policy: { ...NEUTRAL, shareWithKin: 2 } });
    const recipient = makeOrganism('recipient', 5, 6, { energy: 95 });
    world.organisms.set(donor.id, donor);
    world.organisms.set(recipient.id, recipient);

    world.step();

    expect(recipient.energy).toBe(100);
    expect(recipient.energyReceived).toBe(5);
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
    const organisms = Array.from({ length: 9 }, (_, i) =>
      makeOrganism(`m${i}`, i % 3, Math.floor(i / 3), { tag: i * 40 })
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
