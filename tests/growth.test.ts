import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { BRAIN_HIDDEN, BRAIN_INPUTS, BRAIN_INPUT_COUNT, MATURITY_INPUT, brainFeatures, createHeadStartBrain, upgradeBrain } from '../src/sim/brain';
import { getLegalActions } from '../src/sim/policy';
import { senseEnvironment } from '../src/sim/sensors';
import { bodyScaleOf, carryCapacityOf, growthCostOf, growthDurationOf, growthRateOf, isMature, lifeStageOf, senescenceFactorOf } from '../src/sim/growth';
import { LIFE_GENES, clampLife, geneForTrait, inheritLifeValue, maxEnergyOf } from '../src/sim/lifehistory';
import { metabolismCost, moveEnergyCost, plantYield } from '../src/sim/traits';
import { GeneClass, TraitId, decodeOrganismDNA, encodeOrganismDNA, geneClassOf, geneIndexOf, geneCount, phenotypeOf } from '../src/sim/dna';
import type { Organism, SimulationConfig } from '../src/sim/types';

// Growth and ageing (docs/specs/growth.md). Mechanisms and invariants only: nothing here asserts
// that any behaviour evolves. Hand-built worlds start empty (initialOrganisms 0) with one organism.

/** A grown organism copied from a founder, then set to the given state (a quiet, hand-built subject). */
function lone(config: Partial<SimulationConfig>, state: Partial<Organism>): { world: World; org: Organism } {
  const world = new World({ seed: 7, initialOrganisms: 0, initialFoodPatches: 0, foodRegionCount: 0, obstacleDensity: 0, ...config });
  const donor = new World({ seed: 7, ...config }).organisms.values().next().value as Organism;
  const org: Organism = { ...donor, id: 'solo', x: 10, y: 10, carriedFood: 0, recentHistory: [], ...state };
  world.organisms.set(org.id, org);
  return { world, org };
}

describe('Growth', () => {
  it('stalls while starving, advances (and pays heat) while fed', () => {
    // Isolating the mechanism: no seasons or windfalls to feed anyone; the organism is alone; the gene is off so the duration is the fixed growthTicks.
    const c = { growthEnabled: true, growthGeneEnabled: false, ageingEnabled: false, seasonLength: 0, windfallsEnabled: false };
    const { world: hungry } = lone(c, { maturity: 0.5, energy: 3 });
    hungry.step();
    expect(hungry.organisms.get('solo')?.maturity ?? 0.5).toBe(0.5); // below the growth floor: no growth (it may die; either way no growth)
    expect(hungry.growthHeatTotal).toBe(0);

    const { world: fed, org: f } = lone(c, { maturity: 0.5, energy: 60 });
    const before = f.energy;
    fed.step();
    const after = fed.organisms.get('solo')!;
    expect(after.maturity).toBeCloseTo(0.5 + 1 / fed.config.growthTicks, 12);
    expect(fed.growthHeatTotal).toBeCloseTo(fed.config.growthCostPerTick, 12);
    // Energy ledger: upkeep + growth heat (+ any move or action cost) only ever lowers it here (no food).
    expect(after.energy).toBeLessThan(before - fed.config.growthCostPerTick);
  });

  it('masks REPRODUCE and MATE below matureAt, and allows them above', () => {
    const c = { growthEnabled: true, ageingEnabled: false, controller: 'brain' as const };
    const energy = 95;
    for (const [maturity, expected] of [[0.5, false], [0.95, true]] as const) {
      const { world, org } = lone(c, { maturity, energy });
      const partner: Organism = { ...org, id: 'partner', x: 11, y: 10, recentHistory: [] };
      world.organisms.set(partner.id, partner);
      const snap = world.getSnapshot();
      const me = snap.organisms.find((o) => o.id === 'solo')!;
      const sensed = senseEnvironment(me, snap, world.config);
      const types = getLegalActions(me, snap, world.config, sensed).map((a) => a.type);
      expect(sensed.canReproduce).toBe(expected);
      expect(types.some((t) => t.startsWith('REPRODUCE_'))).toBe(expected);
      // The partner is grown here, so MATE is masked only by the asker's own maturity.
      expect(types.some((t) => t.startsWith('MATE_'))).toBe(expected);
    }
  });

  it('scales the body: reserves, upkeep, move cost, bite and carry capacity', () => {
    const config = new World({ seed: 1 }).config;
    const off = { ...config, growthEnabled: false };
    const grown = lone({}, { maturity: 1 }).org;
    const baby = { ...grown, maturity: config.hatchMaturity };
    const scale = bodyScaleOf(baby, config);
    expect(scale).toBeCloseTo(config.hatchScale + (1 - config.hatchScale) * config.hatchMaturity, 12);
    expect(scale).toBeLessThan(1);
    expect(maxEnergyOf(baby, config)).toBeCloseTo(maxEnergyOf(grown, config) * scale, 9);
    expect(metabolismCost(baby, config)).toBeLessThan(metabolismCost(grown, config));
    const step = { leap: false, diagonal: false, squeeze: false };
    expect(moveEnergyCost(baby, step, config)).toBeCloseTo(moveEnergyCost(grown, step, config) * scale, 9);
    expect(plantYield(baby, config)).toBeCloseTo(plantYield(grown, config) * scale, 9);
    expect(carryCapacityOf({ ...baby, carryCapacity: 3 }, config)).toBeLessThanOrEqual(3);
    expect(carryCapacityOf({ ...baby, carryCapacity: 3 }, config)).toBeGreaterThanOrEqual(1);
    // With growth off an unripe organism is a grown one.
    expect(bodyScaleOf(baby, off)).toBe(1);
    expect(isMature(baby, off)).toBe(true);
    expect(isMature(baby, config)).toBe(false);
  });

  it('newborns hatch at hatchMaturity, founders are grown, and a hatchling cannot hold more energy than its body', { timeout: 60000 }, () => {
    // Hatch maturity gene off (stated): this checks the fixed hatchMaturity; the gene's own newborns are in tests/hatch-maturity.test.ts.
    const w = new World({ seed: 3, ageingEnabled: false, hatchMaturityGeneEnabled: false });
    expect([...w.organisms.values()].every((o) => o.maturity === 1)).toBe(true);
    let sawBaby = false;
    const bad: string[] = [];
    for (let i = 0; i < 300; i++) {
      w.step();
      for (const o of w.organisms.values()) {
        if (o.energy > maxEnergyOf(o, w.config) + 1e-9) bad.push(`${o.id} holds ${o.energy} of ${maxEnergyOf(o, w.config)}`);
        if (o.age === 0) {
          if (o.maturity !== w.config.hatchMaturity) bad.push(`${o.id} hatched at ${o.maturity}`);
          sawBaby = true;
        }
      }
    }
    expect(bad).toEqual([]);
    expect(sawBaby).toBe(true);
  });
});

describe('Ageing', () => {
  it('raises upkeep past senescenceAge, and the organism dies of old age at maxAge, leaving carrion', () => {
    const c = { growthEnabled: false, ageingEnabled: true };
    const config = new World({ seed: 1, ...c }).config;
    const young = { age: config.senescenceAge };
    const old = { age: config.senescenceAge + 1000 };
    expect(senescenceFactorOf(young, config)).toBe(1);
    expect(senescenceFactorOf(old, config)).toBeCloseTo(1 + 1000 * config.senescenceRate, 12);
    expect(lifeStageOf({ ...old, maturity: 1 }, config)).toBe('senescent');

    const { world } = lone(c, { age: config.maxAge - 1, energy: 90 });
    world.step();
    expect(world.organisms.has('solo')).toBe(false);
    expect(world.deathsOldAgeTotal).toBe(1);
    expect(world.deathsTotal).toBe(1);
    expect(world.carrion.size).toBe(1); // bodies are left like any other death

    // With ageing off the same organism lives on.
    const { world: free } = lone({ ...c, ageingEnabled: false }, { age: config.maxAge - 1, energy: 90 });
    free.step();
    expect(free.organisms.has('solo')).toBe(true);
    expect(free.deathsOldAgeTotal).toBe(0);
  });
});

describe('Brain input', () => {
  it('appends maturity after the weather and Red Queen inputs (the land inputs follow it); weights exist only while growth is on', () => {
    expect(BRAIN_INPUTS[MATURITY_INPUT]).toBe('maturity');
    expect(MATURITY_INPUT).toBe(56);
    expect(BRAIN_INPUTS[MATURITY_INPUT - 1]).toBe('lastBiteYield');
    expect(BRAIN_INPUT_COUNT).toBe(61);
    // Founders start with zero weight on it (direct and hidden), growth on or off.
    const on = createHeadStartBrain(new PRNG(1), { growthEnabled: true, landSensingEnabled: false } as SimulationConfig);
    expect(on.skip[MATURITY_INPUT]).toBe(0);
    // With growth on the hidden weights are ordinary small draws (they can evolve); off they are zero and never drawn.
    expect(on.hidden.filter((_, i) => i % BRAIN_INPUT_COUNT === MATURITY_INPUT).some((w) => w !== 0)).toBe(true);
    const prngOff = new PRNG(1);
    const off = createHeadStartBrain(prngOff, { growthEnabled: false, landSensingEnabled: false } as SimulationConfig);
    expect(off.hidden.filter((_, i) => i % BRAIN_INPUT_COUNT === MATURITY_INPUT).every((w) => w === 0)).toBe(true);
    // Switch-off identity: the draws consumed equal the pre-growth count (BRAIN_HIDDEN rows of 56 weights, then 6 + 6).
    const ref = new PRNG(1);
    for (let n = 0; n < BRAIN_HIDDEN * MATURITY_INPUT + 2 * BRAIN_HIDDEN; n++) ref.nextGaussian(0, 0.1);
    expect(prngOff.next()).toBe(ref.next());
    // An older, narrower brain (a save from before the input) upgrades with zero weights and the same behaviour.
    const narrow = {
      ...on,
      skip: on.skip.slice(0, MATURITY_INPUT),
      hidden: Array.from({ length: BRAIN_HIDDEN }, (_, h) => on.hidden.slice(h * BRAIN_INPUT_COUNT, h * BRAIN_INPUT_COUNT + MATURITY_INPUT)).flat(),
    };
    const wide = upgradeBrain(narrow);
    expect(wide.skip).toHaveLength(BRAIN_INPUT_COUNT);
    expect(wide.skip[MATURITY_INPUT]).toBe(0);
    expect(wide.hidden.filter((_, i) => i % BRAIN_INPUT_COUNT === MATURITY_INPUT).every((w) => w === 0)).toBe(true);
    // The feature is the organism's maturity (1 when grown).
    const { world, org } = lone({ ageingEnabled: false }, { maturity: 0.4 });
    const snap = world.getSnapshot();
    const sensed = senseEnvironment(org, snap, world.config);
    const rest = getLegalActions(org, snap, world.config, sensed).find((a) => a.type === 'REST')!;
    const x = brainFeatures(rest, org, sensed, world.config, false, new PRNG(1));
    expect(x).toHaveLength(BRAIN_INPUT_COUNT);
    expect(x[MATURITY_INPUT]).toBe(0.4);
  });
});

describe('Growth duration gene (trait 55)', () => {
  const base = { growthEnabled: true, ageingEnabled: false };

  it('is a life-history gene with the logged range, carried only while growth and the gene are on', () => {
    expect(TraitId.growthDuration).toBe(55);
    const gene = geneForTrait(55)!;
    const w = new World({ seed: 2, initialOrganisms: 4 });
    const c = w.config;
    expect([gene.founder(c), gene.min(c), gene.max(c), gene.step(c)]).toEqual([100, 20, 800, 10]);
    expect([...w.organisms.values()].every((o) => o.growthDuration === 100)).toBe(true);
    for (const off of [{ growthGeneEnabled: false }, { growthEnabled: false }]) {
      const w2 = new World({ seed: 2, initialOrganisms: 4, ...off });
      expect([...w2.organisms.values()].every((o) => o.growthDuration === undefined)).toBe(true);
      expect(w2.getMetrics().life?.growthDuration).toBeNull();
    }
    expect(LIFE_GENES.map((g) => g.traitId)).toContain(55);
  });

  it('falls back to the fixed growthTicks without the gene (switch off, or an organism that carries none)', () => {
    const c = new World({ seed: 1 }).config;
    expect(growthDurationOf({ growthDuration: 300 }, c)).toBe(300);
    expect(growthDurationOf({}, c)).toBe(c.growthTicks);
    const geneOff = { ...c, growthGeneEnabled: false, growthTicks: 150 };
    expect(growthDurationOf({ growthDuration: 300 }, geneOff)).toBe(150);
    expect(growthRateOf({ growthDuration: 300 }, geneOff)).toBeCloseTo(1 / 150, 12);
    // At the reference duration the heat per tick is exactly growthCostPerTick.
    expect(growthCostOf({ growthDuration: 150 }, geneOff)).toBe(geneOff.growthCostPerTick);
    expect(growthCostOf({ growthDuration: 300 }, geneOff)).toBe(geneOff.growthCostPerTick);
  });

  it('heat per tick falls with duration, total heat to grow up falls with duration, no duration is favoured by a rule', () => {
    const c = new World({ seed: 1 }).config;
    const durations = [20, 50, 100, 200, 400, 800];
    const perTick = durations.map((d) => growthCostOf({ growthDuration: d }, c));
    const total = durations.map((d, i) => perTick[i] * d);
    for (let i = 1; i < durations.length; i++) {
      expect(perTick[i]).toBeLessThan(perTick[i - 1]);
      expect(total[i]).toBeLessThan(total[i - 1]); // exponent 1.5 > 1: faster growth costs more in all
    }
    // Closed form: total = growthCostPerTick x growthTicks^e x duration^(1 - e).
    const e = c.growthDurationCostExponent;
    durations.forEach((d, i) => expect(total[i]).toBeCloseTo(c.growthCostPerTick * Math.pow(c.growthTicks, e) * Math.pow(d, 1 - e), 9));
    // Exponent 1 would make the total independent of duration (the knob is the only trade-off).
    const flat = { ...c, growthDurationCostExponent: 1 };
    expect(growthCostOf({ growthDuration: 20 }, flat) * 20).toBeCloseTo(growthCostOf({ growthDuration: 800 }, flat) * 800, 9);
  });

  it('a faster grower matures sooner and has paid more heat in all; a slower one matures later and pays less', () => {
    // Isolated: alone, no food needed (energy topped up each tick), breeding impossible (huge threshold), ageing off.
    // The hatch maturity gene is off here (stated): a grown subject can still breed late in the run, and its newborns' heat would depend on the gene's extra draws.
    const run = (duration: number) => {
      const { world, org } = lone({ ...base, reproductionThreshold: 1e6, seasonLength: 0, windfallsEnabled: false, hatchMaturityGeneEnabled: false, thresholdGeneEnabled: false }, { maturity: 0.35, growthDuration: duration }); // threshold gene off too: otherwise the inherited threshold lets the grown loner breed, and its newborns' growth heat enters the ledger
      let matureTick = -1;
      let t = 0;
      while ((world.organisms.get('solo')?.maturity ?? 1) < 1 && t < 5000) {
        const o = world.organisms.get('solo')!;
        o.energy = maxEnergyOf(o, world.config);
        world.step();
        t++;
        if (matureTick < 0 && (world.organisms.get('solo')?.maturity ?? 1) >= world.config.matureAt) matureTick = t;
      }
      void org;
      return { matureTick, grownTick: t, heat: world.growthHeatTotal };
    };
    const fast = run(40);
    const mid = run(100);
    const slow = run(400);
    expect(fast.matureTick).toBeLessThan(mid.matureTick);
    expect(mid.matureTick).toBeLessThan(slow.matureTick);
    expect(fast.heat).toBeGreaterThan(mid.heat);
    expect(mid.heat).toBeGreaterThan(slow.heat);
    // The ledger matches the closed form for the 0.35 -> 1 stretch (ceil'd tick count x heat per tick).
    const c = new World({ seed: 1 }).config;
    expect(fast.heat).toBeCloseTo(growthCostOf({ growthDuration: 40 }, c) * Math.ceil(0.65 * 40 - 1e-9), 6);
  });

  it('with the gene off, the organism grows at the fixed growthTicks whatever duration it carries', () => {
    const c = { ...base, growthGeneEnabled: false, seasonLength: 0, windfallsEnabled: false };
    const { world } = lone(c, { maturity: 0.5, energy: 60, growthDuration: 20 }); // a stray field is ignored
    world.step();
    expect(world.organisms.get('solo')!.maturity).toBeCloseTo(0.5 + 1 / world.config.growthTicks, 12);
    expect(world.growthHeatTotal).toBeCloseTo(world.config.growthCostPerTick, 12);
  });

  it('is inherited by a clone (legacy and DNA), mutates by one step and stays within the range', () => {
    for (const dnaEnabled of [false, true]) {
      const w = new World({ seed: 9, initialOrganisms: 2, dnaEnabled, traitMutationRate: 0 });
      const [p] = [...w.organisms.values()];
      const parent: Organism = { ...p, growthDuration: 260 };
      if (dnaEnabled) (parent as { genome?: Uint32Array }).genome = encodeOrganismDNA(phenotypeOf(parent), w.config);
      const makeChild = (w as unknown as { makeChild: (a: Organism, b: Organism | null, at: { x: number; y: number }, e: number) => Organism }).makeChild.bind(w);
      expect(makeChild(parent, null, { x: 1, y: 1 }, 30).growthDuration).toBe(260); // no mutation: copied
      // Every mutation is one step up or down, clamped.
      w.config.traitMutationRate = 1;
      const seen = new Set<number>();
      for (let i = 0; i < 30; i++) seen.add(makeChild(parent, null, { x: 1, y: 1 }, 30).growthDuration!);
      expect([...seen].every((v) => v === 250 || v === 270 || v === 260)).toBe(true);
      expect(seen.has(250) || seen.has(270)).toBe(true);
    }
    const gene = geneForTrait(55)!;
    const c = new World({ seed: 1 }).config;
    const prng = new PRNG(3);
    const lo = { ...c, traitMutationRate: 1 };
    for (let i = 0; i < 40; i++) {
      expect(inheritLifeValue(c.growthDurationMin, gene, lo, prng)).toBeGreaterThanOrEqual(c.growthDurationMin);
      expect(inheritLifeValue(c.growthDurationMax, gene, lo, prng)).toBeLessThanOrEqual(c.growthDurationMax);
    }
    expect(clampLife(gene, 5, c)).toBe(c.growthDurationMin);
    expect(clampLife(gene, 5000, c)).toBe(c.growthDurationMax);
  });

  it('is inherited through mating: the child gets one parent\'s duration, whole (legacy and DNA)', () => {
    for (const dnaEnabled of [false, true]) {
      const w = new World({ seed: 11, initialOrganisms: 2, dnaEnabled, traitMutationRate: 0 });
      const [a0, b0] = [...w.organisms.values()];
      const mk = (o: Organism, d: number): Organism => {
        const out: Organism = { ...o, growthDuration: d };
        if (dnaEnabled) (out as { genome?: Uint32Array }).genome = encodeOrganismDNA(phenotypeOf(out), w.config);
        return out;
      };
      const a = mk(a0, 60);
      const b = mk(b0, 500);
      const makeChild = (w as unknown as { makeChild: (a: Organism, b: Organism | null, at: { x: number; y: number }, e: number) => Organism }).makeChild.bind(w);
      const seen = new Set<number>();
      for (let i = 0; i < 40; i++) seen.add(makeChild(a, b, { x: 1, y: 1 }, 30).growthDuration!);
      expect([...seen].sort((x, y) => x - y)).toEqual([60, 500]);
    }
  });

  it('round-trips through the genome, and a missing gene decodes to the founder value', () => {
    const w = new World({ seed: 2, initialOrganisms: 1 });
    const o = [...w.organisms.values()][0];
    const genome = encodeOrganismDNA(phenotypeOf({ ...o, growthDuration: 333 }), w.config);
    expect(decodeOrganismDNA(genome, w.config).growthDuration).toBe(333);
    const words: number[] = [];
    for (let g = 0; g < geneCount(genome); g++) {
      const key = genome[g * 3];
      if (geneClassOf(key) === GeneClass.trait && geneIndexOf(key) === TraitId.growthDuration) continue;
      words.push(genome[g * 3], genome[g * 3 + 1], genome[g * 3 + 2]);
    }
    const without = Uint32Array.from(words);
    expect(without.length).toBe(genome.length - 3);
    expect(geneCount(without)).toBe(geneCount(genome) - 1);
    expect(decodeOrganismDNA(without, w.config).growthDuration).toBe(w.config.growthDurationFounder);
  });

  it('survives a snapshot, and a save without the gene continues (organisms fall back to growthTicks)', { timeout: 120000 }, () => {
    const a = new World({ seed: 4 });
    for (let t = 0; t < 200; t++) a.step();
    expect([...a.organisms.values()].some((o) => o.growthDuration !== undefined)).toBe(true);
    const b = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
    expect(b.stateHash()).toBe(a.stateHash());
    for (let t = 0; t < 60; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());

    // An older save: no growthDuration on any organism (and none in its genomes' keys is fine: the gene is simply absent).
    const state = JSON.parse(JSON.stringify(a.exportState()));
    for (const o of state.organisms) delete o.growthDuration;
    const c = World.fromState(state);
    for (let t = 0; t < 60; t++) c.step();
    for (const o of c.organisms.values()) {
      expect(Number.isFinite(o.energy)).toBe(true);
      expect(growthDurationOf(o, c.config)).toBeGreaterThanOrEqual(c.config.growthDurationMin);
    }
    expect(c.organisms.size).toBeGreaterThan(0);
  });
});

describe('Whole-world invariants', () => {
  // One test per seed: a single synchronous test over 60 s starves vitest's worker RPC ("Timeout calling onTaskUpdate") on a slow machine.
  it.each([1, 2])('smoke: 400 ticks on seed %i stay finite, in bounds, non-overlapping, with energy within each body', { timeout: 120000 }, (seed) => {
    const bad: string[] = [];
    {
      const w = new World({ seed });
      for (let t = 0; t < 400; t++) {
        w.step();
        const cells = new Set<string>();
        for (const o of w.organisms.values()) {
          const key = `${o.x},${o.y}`;
          const ok =
            Number.isFinite(o.energy) &&
            o.energy >= 0 &&
            o.energy <= maxEnergyOf(o, w.config) + 1e-9 &&
            o.maturity !== undefined &&
            o.maturity >= 0 &&
            o.maturity <= 1 &&
            o.growthDuration !== undefined &&
            o.growthDuration >= w.config.growthDurationMin &&
            o.growthDuration <= w.config.growthDurationMax &&
            o.x >= 0 &&
            o.y >= 0 &&
            o.x < w.config.gridWidth &&
            o.y < w.config.gridHeight &&
            !cells.has(key);
          if (!ok) bad.push(`seed ${seed} tick ${t} ${o.id} ${key} energy ${o.energy} maturity ${o.maturity}`);
          cells.add(key);
        }
        for (const p of w.foodPatches.values()) if (!(p.stock >= 0)) bad.push(`seed ${seed} tick ${t} food ${p.stock}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('is repeatable: the same seed twice gives the same state hash', { timeout: 60000 }, () => {
    const run = () => {
      const w = new World({ seed: 5 });
      for (let t = 0; t < 400; t++) w.step();
      return w.stateHash();
    };
    expect(run()).toBe(run());
  });

  it('snapshot round trip continues identically (growth and ageing on, and both off)', { timeout: 120000 }, () => {
    for (const c of [{}, { growthEnabled: false, ageingEnabled: false }]) {
      const a = new World({ seed: 4, ...c });
      for (let t = 0; t < 300; t++) a.step();
      const b = World.fromState(JSON.parse(JSON.stringify(a.exportState())));
      expect(b.stateHash()).toBe(a.stateHash());
      for (let t = 0; t < 100; t++) {
        a.step();
        b.step();
      }
      expect(b.stateHash()).toBe(a.stateHash());
    }
  });

  it('a save from before growth loads with growth and ageing off, its organisms grown', { timeout: 60000 }, () => {
    const a = new World({ seed: 6, growthEnabled: false, ageingEnabled: false });
    for (let t = 0; t < 50; t++) a.step();
    const state = JSON.parse(JSON.stringify(a.exportState()));
    delete state.config.growthEnabled;
    delete state.config.ageingEnabled;
    delete state.config.growthGeneEnabled;
    const b = World.fromState(state);
    expect(b.config.growthEnabled).toBe(false);
    expect(b.config.ageingEnabled).toBe(false);
    for (let t = 0; t < 50; t++) {
      a.step();
      b.step();
    }
    expect(b.stateHash()).toBe(a.stateHash());
  });
});
