import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, type Brain, type BrainInput } from '../src/sim/brain';
import { createConfig } from '../src/sim/config';
import { GENE_WORDS, GeneClass, TraitId, encodeOrganismDNA, geneKey, phenotypeOf } from '../src/sim/dna';
import { genomeDistance, hybridIncompatibility, hybridInviableChance } from '../src/sim/speciation';
import type { Organism, PolicyWeights, SimulationConfig } from '../src/sim/types';

// Mechanism tests for docs/specs/speciation.md. Each one that turns a feature
// off to isolate a mechanism says so. None asserts that species appear.

const NEUTRAL: PolicyWeights = {
  foodAttraction: 0, obstacleAvoidance: 0, crowdingAvoidance: 0, exploreTendency: 0, eatDrive: 0, reproduceDrive: 0,
  kinAffinity: 0, shareWithKin: 0, shareWithStrangers: 0, careForChildren: 0, forageDrive: 0, eatPriority: 0,
  hungerUrgency: 0, followFoodParent: 0, signalOnFood: 0, signalWhenHungry: 0, followSignal: 0, restDrive: 0,
  avoidOccupied: 0, leapEagerness: 0,
};

function brainWith(weights: Partial<Record<BrainInput, number>>): Brain {
  return {
    skip: BRAIN_INPUTS.map((name) => weights[name] ?? 0),
    hidden: new Array<number>(BRAIN_HIDDEN * BRAIN_INPUT_COUNT).fill(0),
    hiddenBias: new Array<number>(BRAIN_HIDDEN).fill(0),
    out: new Array<number>(BRAIN_HIDDEN).fill(0),
    outBias: 0,
  };
}
const ASKER = brainWith({ isMate: 100 });

function makeOrganism(id: string, x: number, y: number, overrides: Partial<Organism> = {}): Organism {
  const o: Organism = {
    id, x, y, energy: 60, policy: { ...NEUTRAL }, tag: 0, carryCapacity: 0, dispersal: 1, memorySpan: 0, carnivory: 0,
    kills: 0, memoryWeights: [], memory: { food: null, signal: null, home: { x, y }, registers: [0, 0, 0] },
    abilities: { diagonal: 0, squeeze: 0, leap: 0 }, brain: ASKER,
    lineage: { id: `lin-${id}`, parentId: null, generation: 1, birthTick: 0 }, age: 100, offspringCount: 0,
    foodEatenCount: 0, carriedFood: 0, foodGiven: 0, foodReceived: 0, signalTick: -1, recentHistory: [],
    ...overrides,
  };
  return { ...o, genome: encodeOrganismDNA(phenotypeOf(o)) };
}

/** An empty world where nothing costs energy, so only the mating is measured. */
function quietWorld(overrides: Partial<SimulationConfig> = {}): World {
  return new World({
    seed: 'speciation', gridWidth: 12, gridHeight: 12, initialOrganisms: 0, initialFoodPatches: 0, obstacleDensity: 0,
    immigrationInterval: 0, seasonLength: 0, foodRegionCount: 0, tickMetabolismCost: 0, carryUpkeep: 0, abilityUpkeep: 0,
    memoryEnabled: false, windfallsEnabled: false, signalsEnabled: false, reproductionThreshold: 40,
    reproductionMetabolismTax: 5, minViableChildEnergy: 1, foodRegenInterval: 9999, foodSpawnInterval: 9999,
    controller: 'brain', ...overrides,
  });
}

/** Two parents that will mate (a clutch of 3 fits the carrier's three free cardinal cells): `b` differs from `a` only in carry capacity, so its genome is `far` away or identical. */
function mateablePair(world: World, far: boolean, extra: Partial<Organism> = {}) {
  const a = makeOrganism('a', 5, 5, { clutchSize: 3, investment: 0.5, ...extra });
  const b = makeOrganism('b', 6, 5, { clutchSize: 3, investment: 0.5, tag: 180, carryCapacity: far ? 6 : 0, ...extra });
  world.organisms.set(a.id, a);
  world.organisms.set(b.id, b);
  return [a, b] as const;
}
const kidsOf = (w: World) => Array.from(w.organisms.values()).filter((o) => o.id !== 'a' && o.id !== 'b');

/** Any difference at all makes a cross fully incompatible (tolerance 0, full ~0). */
const STRICT = { hybridTolerance: 0, hybridFull: 0.0001 };

describe('genomeDistance', () => {
  const config = createConfig({});
  const a = makeOrganism('a', 0, 0).genome!;

  it('is 0 for identical genomes and symmetric', () => {
    expect(genomeDistance(a, a, config)).toBe(0);
    const b = makeOrganism('b', 0, 0, { carryCapacity: 3, dispersal: 4 }).genome!;
    expect(genomeDistance(a, b, config)).toBeGreaterThan(0);
    expect(genomeDistance(a, b, config)).toBe(genomeDistance(b, a, config));
  });

  it('ignores the hue gene, so hue stays a neutral marker', () => {
    const b = makeOrganism('b', 0, 0, { tag: 200 }).genome!;
    expect(genomeDistance(a, b, config)).toBe(0);
  });

  it('counts a trait difference as a fraction of that trait\'s scale, capped at 1', () => {
    const half = makeOrganism('h', 0, 0, { carryCapacity: config.maxCarryCapacity / 2 }).genome!;
    const full = makeOrganism('f', 0, 0, { carryCapacity: config.maxCarryCapacity }).genome!;
    const genes = a.length / GENE_WORDS - 1; // the hue gene is not counted
    expect(genomeDistance(a, half, config)).toBeCloseTo(0.5 / genes, 10);
    expect(genomeDistance(a, full, config)).toBeCloseTo(1 / genes, 10);
  });

  it('counts a gene only one genome has as a full difference', () => {
    const extra = new Uint32Array([...a, geneKey(GeneClass.trait, TraitId.carryCapacity + 90), 0, 0]);
    const genes = a.length / GENE_WORDS - 1; // the hue gene is not counted
    expect(genomeDistance(a, extra, config)).toBeCloseTo(1 / (genes + 1), 10);
  });
});

describe('hybrid incompatibility', () => {
  const config = createConfig({ hybridTolerance: 0.1, hybridFull: 0.3, hybridMaxInviability: 0.8 });

  it('is 0 up to the tolerance, 1 from the full distance, linear between', () => {
    expect(hybridIncompatibility(0, config)).toBe(0);
    expect(hybridIncompatibility(0.1, config)).toBe(0);
    expect(hybridIncompatibility(0.2, config)).toBeCloseTo(0.5, 12);
    expect(hybridIncompatibility(0.3, config)).toBe(1);
    expect(hybridIncompatibility(0.9, config)).toBe(1);
  });

  it('scales the child\'s chance of inviability by hybridMaxInviability', () => {
    expect(hybridInviableChance(0.05, config)).toBe(0);
    expect(hybridInviableChance(0.2, config)).toBeCloseTo(0.4, 12);
    expect(hybridInviableChance(0.5, config)).toBeCloseTo(0.8, 12);
  });

  it('the matched-random control applies one flat rate whatever the distance', () => {
    const control = createConfig({ hybridControlInviability: 0.3 });
    expect(hybridInviableChance(0, control)).toBe(0.3);
    expect(hybridInviableChance(0.9, control)).toBe(0.3);
  });
});

describe('hybrid incompatibility in a mating', () => {
  it('loses every child of a maximally incompatible cross and conserves energy', () => {
    const world = quietWorld({ ...STRICT, hybridMaxInviability: 1 });
    const [a, b] = mateablePair(world, true);
    world.step();
    expect(world.matingsTotal).toBe(1);
    expect(kidsOf(world)).toHaveLength(0);
    expect(world.hybridCrossesTotal).toBe(1);
    expect(world.hybridChildrenLostTotal).toBe(3);
    expect(world.matingChildrenLostTotal).toBe(3);
    expect(world.matingGenomeDistanceSum).toBeGreaterThan(0);
    // Parents still pay their share and the tax; the pool is lost as heat, nothing appears or vanishes.
    expect(a.energy + b.energy + world.matingEnergyLostTotal + 2 * 5).toBeCloseTo(120, 9);
    expect(world.matingEnergyLostTotal).toBeCloseTo(60, 9);
  });

  it('loses nothing, and draws nothing extra, for identical genomes', () => {
    const on = quietWorld({ ...STRICT, hybridMaxInviability: 1 });
    mateablePair(on, false);
    on.step();
    const off = quietWorld({ ...STRICT, hybridMaxInviability: 1, hybridIncompatibilityEnabled: false }); // switch off isolates the baseline
    mateablePair(off, false);
    off.step();
    expect(on.hybridCrossesTotal).toBe(0);
    expect(on.hybridChildrenLostTotal).toBe(0);
    expect(kidsOf(on)).toHaveLength(3);
    // The snapshot holds the config, so compare what the world did: same organisms, places and energies, and the same next random number.
    const shape = (w: World) => Array.from(w.organisms.values()).map((o) => [o.id, o.x, o.y, o.energy, o.tag, o.lineage.parentId]);
    expect(shape(on)).toEqual(shape(off));
    expect(on.prng.next()).toBe(off.prng.next());
  });

  it('does nothing when the switch is off, however far apart the genomes are', () => {
    const world = quietWorld({ ...STRICT, hybridMaxInviability: 1, hybridIncompatibilityEnabled: false }); // switch off isolates the cost
    mateablePair(world, true);
    world.step();
    expect(kidsOf(world)).toHaveLength(3);
    expect(world.hybridChildrenLostTotal).toBe(0);
    expect(world.matingGenomeDistanceSum).toBe(0);
  });

  it('the control arm loses children at its flat rate even between identical genomes', () => {
    const world = quietWorld({ hybridControlInviability: 1 });
    mateablePair(world, false);
    world.step();
    expect(kidsOf(world)).toHaveLength(0);
    expect(world.hybridChildrenLostTotal).toBe(3);
  });

  it('the same seed gives the same outcome twice, and a partial rate loses some but not all', () => {
    const run = () => {
      const world = quietWorld({ ...STRICT, hybridMaxInviability: 0.5 });
      mateablePair(world, true);
      world.step();
      return [kidsOf(world).length, world.hybridChildrenLostTotal, world.stateHash()] as const;
    };
    const first = run();
    expect(run()).toEqual(first);
    expect(first[0] + first[1]).toBe(3);
  });

  it('survives a snapshot round trip with its counters', () => {
    const world = quietWorld({ ...STRICT, hybridMaxInviability: 1 });
    mateablePair(world, true);
    world.step();
    const copy = World.fromState(world.exportState());
    expect(copy.hybridChildrenLostTotal).toBe(world.hybridChildrenLostTotal);
    expect(copy.hybridCrossesTotal).toBe(world.hybridCrossesTotal);
    expect(copy.matingGenomeDistanceSum).toBeCloseTo(world.matingGenomeDistanceSum, 3);
    expect(copy.stateHash()).toBe(world.stateHash());
  });
});

describe('smoke', () => {
  it('runs 1,000 ticks with the feature on without NaN, negative energy or overlap', () => {
    const world = new World({ seed: '3' });
    for (let t = 0; t < 1000; t++) world.step();
    const seen = new Set<string>();
    for (const o of world.organisms.values()) {
      expect(Number.isFinite(o.energy)).toBe(true);
      expect(o.energy).toBeGreaterThanOrEqual(0);
      const cell = `${o.x},${o.y}`;
      expect(seen.has(cell)).toBe(false);
      seen.add(cell);
    }
    expect(Number.isFinite(world.matingGenomeDistanceSum)).toBe(true);
  });
});
