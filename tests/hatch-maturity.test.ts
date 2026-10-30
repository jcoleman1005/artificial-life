import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { bodyScaleOf, hatchMaturityOf, isMature, launchRatioOf, minViableEnergyAt } from '../src/sim/growth';
import { LIFE_GENES, clampLife, geneForTrait, inheritLifeValue, maxEnergyOf } from '../src/sim/lifehistory';
import { TraitId, decodeOrganismDNA, encodeOrganismDNA, phenotypeOf } from '../src/sim/dna';
import type { Organism, SimulationConfig } from '../src/sim/types';

// Inherited hatch maturity (docs/specs/hatch-maturity.md). Mechanisms and invariants only: nothing
// here asserts that any hatch maturity evolves or is favoured. Hand-built worlds start empty.

type Privates = {
  makeChild: (a: Organism, b: Organism | null, at: { x: number; y: number }, e: number) => Organism;
  mate: (a: Organism, b: Organism, blocked: Set<string>, born: Organism[]) => boolean;
};
const priv = (w: World) => w as unknown as Privates;

/** A grown organism copied from a founder, carrying hatch maturity `h` (genome re-encoded so the child inherits it). */
function withHatch(w: World, o: Organism, h: number, extra: Partial<Organism> = {}): Organism {
  const out: Organism = { ...o, hatchMaturity: h, maturity: 1, ...extra };
  (out as { genome?: Uint32Array }).genome = encodeOrganismDNA(phenotypeOf(out), w.config);
  return out;
}

function emptyWorld(config: Partial<SimulationConfig> = {}): { world: World; donor: Organism } {
  const donor = new World({ seed: 7, landSensingEnabled: false, ...config }).organisms.values().next().value as Organism;
  const world = new World({ seed: 7, landSensingEnabled: false, initialOrganisms: 0, initialFoodPatches: 0, foodRegionCount: 0, obstacleDensity: 0, ...config }); // land inputs off: the test pins exact clutch counts
  return { world, donor };
}

describe('Hatch maturity gene (trait 56)', () => {
  it('is a life-history gene with the logged range, carried only while growth and the gene are on', () => {
    expect(TraitId.hatchMaturity).toBe(56);
    const gene = geneForTrait(56)!;
    const w = new World({ seed: 2, initialOrganisms: 4 });
    const c = w.config;
    expect([gene.founder(c), gene.min(c), gene.max(c), gene.step(c)]).toEqual([0.35, 0.2, 1, 0.05]);
    expect([...w.organisms.values()].every((o) => o.hatchMaturity === 0.35)).toBe(true);
    for (const off of [{ hatchMaturityGeneEnabled: false }, { growthEnabled: false }]) {
      const w2 = new World({ seed: 2, initialOrganisms: 4, ...off });
      expect([...w2.organisms.values()].every((o) => o.hatchMaturity === undefined)).toBe(true);
      expect(w2.getMetrics().life?.hatchMaturity ?? null).toBeNull();
    }
    expect(LIFE_GENES.map((g) => g.traitId)).toContain(56);
  });

  it('clamps to its range and round-trips through the genome (a missing gene decodes to the founder value)', () => {
    const w = new World({ seed: 2, initialOrganisms: 1 });
    const gene = geneForTrait(56)!;
    expect(clampLife(gene, 0.01, w.config)).toBe(w.config.hatchMaturityMin);
    expect(clampLife(gene, 4, w.config)).toBe(w.config.hatchMaturityMax);
    const o = [...w.organisms.values()][0];
    expect(decodeOrganismDNA(encodeOrganismDNA(phenotypeOf({ ...o, hatchMaturity: 0.7 }), w.config), w.config).hatchMaturity).toBe(0.7);
    const p = { ...phenotypeOf(o) } as Record<string, unknown>;
    delete p.hatchMaturity;
    expect(decodeOrganismDNA(encodeOrganismDNA(p as never, w.config), w.config).hatchMaturity).toBe(w.config.hatchMaturity);
    const prng = new PRNG(3);
    const lo = { ...w.config, traitMutationRate: 1 };
    for (let i = 0; i < 40; i++) {
      expect(inheritLifeValue(w.config.hatchMaturityMin, gene, lo, prng)).toBeGreaterThanOrEqual(w.config.hatchMaturityMin);
      expect(inheritLifeValue(w.config.hatchMaturityMax, gene, lo, prng)).toBeLessThanOrEqual(w.config.hatchMaturityMax);
    }
  });

  it('is inherited by a clone (legacy and DNA), and a newborn starts at its own value; mutation is one step', () => {
    for (const dnaEnabled of [false, true]) {
      const w = new World({ seed: 9, initialOrganisms: 2, dnaEnabled, traitMutationRate: 0 });
      const parent = withHatch(w, [...w.organisms.values()][0], 0.7);
      const kid = priv(w).makeChild(parent, null, { x: 1, y: 1 }, 30);
      expect(kid.hatchMaturity).toBe(0.7);
      expect(kid.maturity).toBe(0.7); // born at the maturity its genes say, not the fixed 0.35
      w.config.traitMutationRate = 1;
      const seen = new Set<number>();
      for (let i = 0; i < 30; i++) seen.add(priv(w).makeChild(parent, null, { x: 1, y: 1 }, 30).hatchMaturity!);
      expect([...seen].every((v) => [0.65, 0.7, 0.75].includes(v))).toBe(true);
      expect(seen.has(0.65) || seen.has(0.75)).toBe(true);
    }
  });

  it("is inherited through mating: the child gets one parent's value, whole (legacy and DNA)", () => {
    for (const dnaEnabled of [false, true]) {
      const w = new World({ seed: 11, initialOrganisms: 2, dnaEnabled, traitMutationRate: 0 });
      const [a0, b0] = [...w.organisms.values()];
      const a = withHatch(w, a0, 0.25);
      const b = withHatch(w, b0, 0.9);
      const seen = new Set<number>();
      for (let i = 0; i < 40; i++) seen.add(priv(w).makeChild(a, b, { x: 1, y: 1 }, 30).hatchMaturity!);
      expect([...seen].sort((x, y) => x - y)).toEqual([0.25, 0.9]);
    }
  });

  it('a more developed newborn is a larger body, can breed at once above matureAt, and grows at the same 1 / duration', () => {
    const w = new World({ seed: 5, initialOrganisms: 2, traitMutationRate: 0 });
    const base = [...w.organisms.values()][0];
    const small = priv(w).makeChild(withHatch(w, base, 0.2), null, { x: 1, y: 1 }, 1000);
    const big = priv(w).makeChild(withHatch(w, base, 1.0), null, { x: 1, y: 1 }, 1000);
    expect(bodyScaleOf(big, w.config)).toBeGreaterThan(bodyScaleOf(small, w.config));
    expect(maxEnergyOf(big, w.config)).toBeGreaterThan(maxEnergyOf(small, w.config));
    expect(small.energy).toBeCloseTo(maxEnergyOf(small, w.config), 9); // energy past the body's capacity is lost
    expect(big.energy).toBeCloseTo(maxEnergyOf(big, w.config), 9);
    expect(isMature(small, w.config)).toBe(false);
    expect(isMature(big, w.config)).toBe(true); // hatch maturity >= matureAt: breeds at once (the launch cost is the brake)
    expect(hatchMaturityOf(big, w.config)).toBe(1);
  });

  it('launch cost: closed form is exactly 1 at the reference, rises with hatch maturity, and is 1 with the gene or growth off', () => {
    const c = new World({ seed: 1, initialOrganisms: 1 }).config;
    expect(launchRatioOf(c.hatchMaturity, c)).toBe(1);
    expect(minViableEnergyAt(c.hatchMaturity, c)).toBe(c.minViableChildEnergy);
    let prev = 0;
    for (const h of [0.2, 0.35, 0.5, 0.75, 1]) {
      const r = launchRatioOf(h, c);
      expect(r).toBeGreaterThan(prev);
      expect(r).toBeCloseTo((c.hatchScale + (1 - c.hatchScale) * h) / (c.hatchScale + (1 - c.hatchScale) * c.hatchMaturity), 12);
      prev = r;
    }
    expect(launchRatioOf(1, { ...c, hatchMaturityGeneEnabled: false })).toBe(1);
    expect(launchRatioOf(1, { ...c, growthEnabled: false })).toBe(1);
  });

  it('the same pool launches fewer children when each is born more developed (mating)', () => {
    const counts: number[] = [];
    for (const h of [0.2, 0.35, 1.0]) {
      const { world, donor } = emptyWorld({ traitMutationRate: 0 });
      const mk = (id: string, x: number) =>
        withHatch(world, donor, h, { id, x, y: 10, energy: 60, reproThreshold: 10, investment: 0.5, clutchSize: 6, nextBirthTick: 0, recentHistory: [] });
      const a = mk('a', 10);
      const b = mk('b', 14);
      world.organisms.set('a', a);
      world.organisms.set('b', b);
      const born: Organism[] = [];
      expect(priv(world).mate(a, b, new Set(), born)).toBe(true);
      counts.push(born.length);
      // Pool 60 split among the admitted children: nothing is minted (each child holds at most its share).
      expect(born.every((k) => k.energy <= 60 / born.length + 1e-9)).toBe(true);
      expect(born.every((k) => k.hatchMaturity === h)).toBe(true);
    }
    // pool 60 vs minima 8.52 / 10 / 16.39: 6 (clutch cap), 6, 3
    expect(counts).toEqual([6, 6, 3]);
  });

  it('a clone is launched only with energy for its body: a precocial child needs more than an altricial one', () => {
    const outcomes: boolean[] = [];
    for (const h of [0.2, 1.0]) {
      const { world, donor } = emptyWorld({ traitMutationRate: 0, controller: 'dials', seasonLength: 0, windfallsEnabled: false, eggsEnabled: false });
      const policy = { ...donor.policy, reproduceDrive: 5, eatPriority: 0, exploreTendency: 0 };
      const o = withHatch(world, donor, h, { id: 'solo', x: 10, y: 10, energy: 30, reproThreshold: 20, investment: 0.4, policy, recentHistory: [], carriedFood: 0 });
      world.organisms.set('solo', o);
      world.step();
      outcomes.push(world.organisms.size > 1);
    }
    // child energy floor(30 x 0.4) = 12 clears 8.52 (h 0.2) but not 16.39 (h 1.0)
    expect(outcomes).toEqual([true, false]);
  });

  it('with the gene off, a stray hatchMaturity changes nothing: newborns use the fixed hatchMaturity and the old launch cost', () => {
    const w = new World({ seed: 9, initialOrganisms: 2, traitMutationRate: 0, hatchMaturityGeneEnabled: false });
    const parent: Organism = { ...[...w.organisms.values()][0], hatchMaturity: 1 };
    const kid = priv(w).makeChild(parent, null, { x: 1, y: 1 }, 30);
    expect(kid.maturity).toBe(w.config.hatchMaturity);
    expect(kid.hatchMaturity).toBeUndefined();
    expect(launchRatioOf(1, w.config)).toBe(1);
  });
});

describe('Hatch maturity: whole world', () => {
  it('smoke: 400 ticks stay finite and non-negative with the gene on', { timeout: 120000 }, () => {
    const w = new World({ seed: 3 });
    for (let t = 0; t < 400; t++) w.step();
    expect(w.organisms.size).toBeGreaterThan(0);
    for (const o of w.organisms.values()) {
      expect(Number.isFinite(o.energy) && o.energy >= 0).toBe(true);
      expect(o.hatchMaturity).toBeGreaterThanOrEqual(w.config.hatchMaturityMin);
      expect(o.hatchMaturity).toBeLessThanOrEqual(w.config.hatchMaturityMax);
    }
  });

  it('is repeatable: the same seed twice gives the same state hash', { timeout: 120000 }, () => {
    const run = () => {
      const w = new World({ seed: 6 });
      for (let t = 0; t < 300; t++) w.step();
      return w.stateHash();
    };
    expect(run()).toBe(run());
  });

  it('snapshot round trip continues identically; a save without the gene loads with it off and continues', { timeout: 120000 }, () => {
    const a = new World({ seed: 4 });
    for (let t = 0; t < 200; t++) a.step();
    const b = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 50; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());

    const state = JSON.parse(JSON.stringify(a.exportState()));
    delete state.config.hatchMaturityGeneEnabled;
    for (const o of state.organisms) delete o.hatchMaturity;
    const c = World.fromState(state);
    expect(c.config.hatchMaturityGeneEnabled).toBe(false);
    for (let t = 0; t < 50; t++) c.step();
    expect(c.organisms.size).toBeGreaterThan(0);
    for (const o of c.organisms.values()) expect(Number.isFinite(o.energy)).toBe(true);
  });
});
