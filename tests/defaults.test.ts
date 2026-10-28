import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { BRAIN_INPUTS, HEAD_START_SKIP } from '../src/sim/brain';

// Many tests switch features off to isolate one mechanism (e.g. a quiet world
// with no metabolism, signals or memory). Those overrides are local to each
// test. This file pins what the app actually runs, so isolating a mechanism
// in a test can never hide a change to the defaults (AGENTS.md, Decisions).
describe('Default world', () => {
  it('runs every built feature, with spontaneous generation off', () => {
    expect({
      controller: DEFAULT_CONFIG.controller,
      windfallsEnabled: DEFAULT_CONFIG.windfallsEnabled,
      staggeredSeasons: DEFAULT_CONFIG.staggeredSeasons,
      sharingEnabled: DEFAULT_CONFIG.sharingEnabled,
      dispersalEnabled: DEFAULT_CONFIG.dispersalEnabled,
      memoryEnabled: DEFAULT_CONFIG.memoryEnabled,
      diagonalMoves: DEFAULT_CONFIG.diagonalMoves,
      squeezeEnabled: DEFAULT_CONFIG.squeezeEnabled,
      leapEnabled: DEFAULT_CONFIG.leapEnabled,
      founderAbilities: DEFAULT_CONFIG.founderAbilities,
      signalsEnabled: DEFAULT_CONFIG.signalsEnabled,
      carrionEnabled: DEFAULT_CONFIG.carrionEnabled,
      predationEnabled: DEFAULT_CONFIG.predationEnabled,
      sexEnabled: DEFAULT_CONFIG.sexEnabled,
      immigrationEnabled: DEFAULT_CONFIG.immigrationEnabled,
      plantsEnabled: DEFAULT_CONFIG.plantsEnabled,
      dnaEnabled: DEFAULT_CONFIG.dnaEnabled,
      dnaContinuousAbilities: DEFAULT_CONFIG.dnaContinuousAbilities,
      dnaSplitDiets: DEFAULT_CONFIG.dnaSplitDiets,
      dnaVariationEnabled: DEFAULT_CONFIG.dnaVariationEnabled,
      dnaGrowableBrain: DEFAULT_CONFIG.dnaGrowableBrain,
      dnaMaxInternal: DEFAULT_CONFIG.dnaMaxInternal,
      dnaUpkeepPerConnection: DEFAULT_CONFIG.dnaUpkeepPerConnection,
      clutchGeneEnabled: DEFAULT_CONFIG.clutchGeneEnabled,
      sizeGeneEnabled: DEFAULT_CONFIG.sizeGeneEnabled,
      sensingGeneEnabled: DEFAULT_CONFIG.sensingGeneEnabled,
      digestiveGeneEnabled: DEFAULT_CONFIG.digestiveGeneEnabled,
      carnivoreGeneEnabled: DEFAULT_CONFIG.carnivoreGeneEnabled,
      carnivoreFounder: DEFAULT_CONFIG.carnivoreFounder,
      weatherEnabled: DEFAULT_CONFIG.weatherEnabled,
      nutrientCycleEnabled: DEFAULT_CONFIG.nutrientCycleEnabled,
      plantDefenseEnabled: DEFAULT_CONFIG.plantDefenseEnabled,
      detoxGeneEnabled: DEFAULT_CONFIG.detoxGeneEnabled,
    }).toEqual({
      controller: 'brain',
      windfallsEnabled: true,
      staggeredSeasons: true,
      sharingEnabled: true,
      dispersalEnabled: true,
      memoryEnabled: true,
      diagonalMoves: true,
      squeezeEnabled: true,
      leapEnabled: true,
      founderAbilities: 'one',
      signalsEnabled: true,
      carrionEnabled: true,
      predationEnabled: true,
      sexEnabled: true,
      immigrationEnabled: false,
      plantsEnabled: true,
      // DNA Stage 1 is on; the Stage 1b toggles and Stage 2 stay off until their gates are signed off.
      dnaEnabled: true,
      dnaContinuousAbilities: false,
      dnaSplitDiets: false,
      dnaVariationEnabled: false,
      // DNA Stage 3 (growable brain) stays off until its gate is signed off; its size cap and
      // connection upkeep are pinned (docs/findings.md, Parameter log).
      dnaGrowableBrain: false,
      dnaMaxInternal: 16,
      dnaUpkeepPerConnection: 0.00005,
      // The clutch gene (matings only) is a new feature, on by default.
      clutchGeneEnabled: true,
      // Tier 1 physical & energetic architecture basic genes
      sizeGeneEnabled: true,
      sensingGeneEnabled: true,
      digestiveGeneEnabled: true,
      // Meat digestion: on, founders at half so selection can go either way (Parameter log).
      carnivoreGeneEnabled: true,
      carnivoreFounder: 0.5,
      // Weather systems are a new feature, on by default.
      weatherEnabled: true,
      // Nutrient cycle: on by default.
      nutrientCycleEnabled: true,
      // Red Queen: Trophic plant defense and herbivore detox on by default.
      plantDefenseEnabled: true,
      detoxGeneEnabled: true,
    });
  });

  it('runs growth and ageing, with the logged constants (docs/findings.md, Parameter log)', () => {
    expect({
      growthEnabled: DEFAULT_CONFIG.growthEnabled,
      hatchMaturity: DEFAULT_CONFIG.hatchMaturity,
      hatchScale: DEFAULT_CONFIG.hatchScale,
      growthTicks: DEFAULT_CONFIG.growthTicks,
      growthEnergyFloor: DEFAULT_CONFIG.growthEnergyFloor,
      growthCostPerTick: DEFAULT_CONFIG.growthCostPerTick,
      matureAt: DEFAULT_CONFIG.matureAt,
      growthGeneEnabled: DEFAULT_CONFIG.growthGeneEnabled,
      growthDurationFounder: DEFAULT_CONFIG.growthDurationFounder,
      growthDurationMin: DEFAULT_CONFIG.growthDurationMin,
      growthDurationMax: DEFAULT_CONFIG.growthDurationMax,
      growthDurationStep: DEFAULT_CONFIG.growthDurationStep,
      growthDurationCostExponent: DEFAULT_CONFIG.growthDurationCostExponent,
      hatchMaturityGeneEnabled: DEFAULT_CONFIG.hatchMaturityGeneEnabled,
      hatchMaturityMin: DEFAULT_CONFIG.hatchMaturityMin,
      hatchMaturityMax: DEFAULT_CONFIG.hatchMaturityMax,
      hatchMaturityStep: DEFAULT_CONFIG.hatchMaturityStep,
      ageingEnabled: DEFAULT_CONFIG.ageingEnabled,
      senescenceAge: DEFAULT_CONFIG.senescenceAge,
      senescenceRate: DEFAULT_CONFIG.senescenceRate,
      maxAge: DEFAULT_CONFIG.maxAge,
    }).toEqual({
      growthEnabled: true,
      hatchMaturity: 0.35,
      hatchScale: 0.4,
      growthTicks: 100,
      growthEnergyFloor: 0.4,
      growthCostPerTick: 0.05,
      matureAt: 0.9,
      growthGeneEnabled: true,
      growthDurationFounder: 100,
      growthDurationMin: 20,
      growthDurationMax: 800,
      growthDurationStep: 10,
      growthDurationCostExponent: 1.5,
      hatchMaturityGeneEnabled: true,
      hatchMaturityMin: 0.2,
      hatchMaturityMax: 1,
      hatchMaturityStep: 0.05,
      ageingEnabled: true,
      senescenceAge: 4000,
      senescenceRate: 0.001,
      maxAge: 8000,
    });
    // The maturity input starts with no weight, so no founder is born with an opinion about it.
    expect(BRAIN_INPUTS[BRAIN_INPUTS.length - 1]).toBe('maturity');
    expect(HEAD_START_SKIP[BRAIN_INPUTS.indexOf('maturity')]).toBe(0);
  });

  it('keeps the logged brain head starts for attacking and mating (docs/findings.md, Parameter log)', () => {
    const skip = (name: (typeof BRAIN_INPUTS)[number]) => HEAD_START_SKIP[BRAIN_INPUTS.indexOf(name)];
    expect([skip('isAttack'), skip('attackKillChance'), skip('attackAlike'), skip('attackFamily'), skip('attackHunger')]).toEqual([
      -0.5, 1, 0, -2, 2,
    ]);
    expect([skip('isReproduce'), skip('reproFullness')]).toEqual([0.2, 3.5]);
    expect([skip('isMate'), skip('mateFullness'), skip('mateAlike'), skip('mateFamily'), skip('mateReady')]).toEqual([0, 3.5, 0, 0, 0]);
  });
});
