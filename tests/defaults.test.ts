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
      terrainEnabled: DEFAULT_CONFIG.terrainEnabled,
      terrainScale: DEFAULT_CONFIG.terrainScale,
      terrainThreshold: DEFAULT_CONFIG.terrainThreshold,
      terrainRoughnessCoeff: DEFAULT_CONFIG.terrainRoughnessCoeff,
      fertilityDynamicEnabled: DEFAULT_CONFIG.fertilityDynamicEnabled,
      fertilityInterval: DEFAULT_CONFIG.fertilityInterval,
      fertilityRebuildRate: DEFAULT_CONFIG.fertilityRebuildRate,
      fertilityMoistureRate: DEFAULT_CONFIG.fertilityMoistureRate,
      fertilityGrazeWear: DEFAULT_CONFIG.fertilityGrazeWear,
      fertilityTrampleWear: DEFAULT_CONFIG.fertilityTrampleWear,
      fertilityMax: DEFAULT_CONFIG.fertilityMax,
      terrainWearEnabled: DEFAULT_CONFIG.terrainWearEnabled,
      terrainTrampleRoughness: DEFAULT_CONFIG.terrainTrampleRoughness,
      terrainTrampleCover: DEFAULT_CONFIG.terrainTrampleCover,
      terrainGrazeCover: DEFAULT_CONFIG.terrainGrazeCover,
      terrainRecoveryRate: DEFAULT_CONFIG.terrainRecoveryRate,
      terrainRecoveryInterval: DEFAULT_CONFIG.terrainRecoveryInterval,
      terrainCoverShelter: DEFAULT_CONFIG.terrainCoverShelter,
      ledgerEnabled: DEFAULT_CONFIG.ledgerEnabled,
      thermalPhysicsEnabled: DEFAULT_CONFIG.thermalPhysicsEnabled,
      thermalHeatCoeff: DEFAULT_CONFIG.thermalHeatCoeff,
      thermalHeatThreshold: DEFAULT_CONFIG.thermalHeatThreshold,
      thermalFatInsulation: DEFAULT_CONFIG.thermalFatInsulation,
      ledgerCheckInterval: DEFAULT_CONFIG.ledgerCheckInterval,
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
      // The energy ledger is an observer: on, and a check every 25 ticks.
      // Terrain fields: on; patches about 8 cells across, half the ground open, rough ground at most doubles a move, full cover removes 60% of weather exposure.
      terrainEnabled: true,
      terrainScale: 8,
      terrainThreshold: 0.5,
      terrainRoughnessCoeff: 1.0,
      // Terrain wear: a path takes a few hundred crossings; worn ground closes most of the gap in about 500 ticks.
      // Dynamic fertility: on; about a thousand ticks to rebuild, wear wear ten times the first values after the probe (still about five times gentler per bite than overgrazing), capped at the disc value.
      fertilityDynamicEnabled: true,
      fertilityInterval: 10,
      fertilityRebuildRate: 0.002,
      fertilityMoistureRate: 0.001,
      fertilityGrazeWear: 0.004,
      fertilityTrampleWear: 0.001,
      fertilityMax: 1.0,
      terrainWearEnabled: true,
      terrainTrampleRoughness: 0.005,
      terrainTrampleCover: 0.003,
      terrainGrazeCover: 0.004,
      terrainRecoveryRate: 0.002,
      terrainRecoveryInterval: 10,
      terrainCoverShelter: 0.6,
      ledgerEnabled: true,
      // Thermal physics: both extremes cost; the heat threshold sits at the plenty baseline so everyday costs are unchanged.
      thermalPhysicsEnabled: true,
      thermalHeatCoeff: 0.4,
      thermalHeatThreshold: 0.1,
      thermalFatInsulation: 0.5,
      ledgerCheckInterval: 25,
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

  it('keeps the logged brain head starts for attacking and mating (docs/findings.md, Parameter log)', () => {
    const skip = (name: (typeof BRAIN_INPUTS)[number]) => HEAD_START_SKIP[BRAIN_INPUTS.indexOf(name)];
    expect([skip('isAttack'), skip('attackKillChance'), skip('attackAlike'), skip('attackFamily'), skip('attackHunger')]).toEqual([
      -0.5, 1, 0, -2, 2,
    ]);
    expect([skip('isReproduce'), skip('reproFullness')]).toEqual([0.2, 3.5]);
    expect([skip('isMate'), skip('mateFullness'), skip('mateAlike'), skip('mateFamily'), skip('mateReady')]).toEqual([0, 3.5, 0, 0, 0]);
  });
});
