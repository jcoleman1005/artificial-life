import { describe, expect, it } from 'vitest';
import { World } from '../src/sim/world';
import { createConfig } from '../src/sim/config';
import {
  DIST_BIN_COUNT,
  DIST_TRAITS,
  binOf,
  computeBins,
  computeGenomeSample,
  computeLifeStats,
  computeTopology,
} from '../src/sim/history';
import { GENE_WORDS, GeneClass, TraitId, geneKey } from '../src/sim/dna';
import { genomeBarsHtml, genomeTraitRows } from '../src/ui/inspector';
import { isSplit } from '../src/ui/history-view';
import { metabolismHue, reproStrategyHue } from '../src/render/renderer';
import type { Organism } from '../src/sim/types';

// Every world here sets the three 2026-10-29 DNA defaults (continuous abilities, split diets, variation) off, so each test isolates its own mechanism on the legacy costs.

const config = createConfig({ seed: 'trends' });

function run(ticks: number, sampleEveryTick: boolean): World {
  const w = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 'trends' });
  for (let t = 0; t < ticks; t++) {
    w.step();
    if (sampleEveryTick) {
      // The observers the Trends tab relies on, called as often as possible.
      const orgs = Array.from(w.organisms.values());
      computeBins(orgs, w.config);
      computeLifeStats(orgs);
      computeTopology(orgs);
      computeGenomeSample(orgs, w.config);
    }
  }
  return w;
}

describe('Genome trend telemetry', () => {
  it('is read-only: measuring every tick leaves the world bit-identical', () => {
    expect(run(60, true).stateHash()).toBe(run(60, false).stateHash());
  }, 30_000);

  it('records life-history, topology, genome and histogram data that agree with the living', () => {
    const w = run(40, false);
    const s = w.history.getSamples().at(-1)!;
    const orgs = Array.from(w.organisms.values());
    expect(s.life?.reproThreshold?.mean).toBeCloseTo(orgs.reduce((a, o) => a + o.reproThreshold!, 0) / orgs.length, 9);
    expect(s.life?.fat).toBeDefined();
    for (const trait of DIST_TRAITS) {
      const bins = s.bins?.[trait];
      expect(bins).toHaveLength(DIST_BIN_COUNT);
      expect(bins!.reduce((a, c) => a + c, 0)).toBe(s.population);
    }
    expect(s.topology!.connections.mean).toBeGreaterThan(0);
    expect(s.genome!.length.mean).toBeGreaterThan(0);
  });

  it('puts values in fifths of their range, clamped at the edges', () => {
    expect([0, 0.19, 0.2, 0.55, 0.99, 1, 1.5, -1].map((v) => binOf(v, 0, 1))).toEqual([0, 0, 1, 2, 4, 4, 4, 0]);
    expect(binOf(5, 3, 3)).toBe(0); // an empty range never divides by zero
  });

  it('leaves out a trait whose gene is off, rather than binning zeros', () => {
    const off = createConfig({ seed: 'x', metabolismGeneEnabled: false });
    expect(computeBins([], off).metabolicRate).toBeUndefined();
    expect(computeBins([], off).carnivory).toHaveLength(DIST_BIN_COUNT);
  });

  it('spots two separate humps but not a single broad one', () => {
    expect(isSplit([0.45, 0.05, 0.05, 0.05, 0.4])).toBe(true);
    expect(isSplit([0.1, 0.3, 0.4, 0.15, 0.05])).toBe(false);
    expect(isSplit([0.3, 0.25, 0.2, 0.15, 0.1])).toBe(false);
  });

  it('writes a CSV row with as many cells as the header', () => {
    const csv = run(10, false).history.toCSV().trim().split('\n');
    const width = csv[0].split(',').length;
    expect(csv.slice(1).every((row) => row.split(',').length === width)).toBe(true);
    expect(csv[0]).toContain('reproThreshold_mean');
  });
});

describe('Colour modes', () => {
  it('runs metabolism from cool blue (slow) to orange-red (fast)', () => {
    const slow = metabolismHue({ metabolicRate: config.metabolismMin }, config);
    const fast = metabolismHue({ metabolicRate: config.metabolismMax }, config);
    expect(slow).toBeGreaterThan(200);
    expect(fast).toBeLessThan(30);
  });

  it('runs breeding strategy from cyan (big clutch, small investment) to purple (single, well-fed child)', () => {
    const r = reproStrategyHue({ investment: config.investmentMin, clutchSize: config.clutchMax }, config);
    const k = reproStrategyHue({ investment: config.investmentMax, clutchSize: config.clutchMin }, config);
    expect(r).toBeCloseTo(185, 6);
    expect(k).toBeCloseTo(275, 6);
    expect(reproStrategyHue({}, config)).toBeCloseTo(230, 6); // neither gene: mid-scale
  });
});

describe('Genome dosage bars', () => {
  function withGenes(extra: [number, number][]): Organism {
    const w = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 'bars' });
    const o = Array.from(w.organisms.values())[0];
    const view = new DataView(new ArrayBuffer(8));
    const more = new Uint32Array(extra.length * GENE_WORDS);
    extra.forEach(([key, dose], g) => {
      view.setFloat64(0, dose, true);
      more.set([key, view.getUint32(0, true), view.getUint32(4, true)], g * GENE_WORDS);
    });
    const genome = new Uint32Array(o.genome!.length + more.length);
    genome.set(o.genome!);
    genome.set(more, o.genome!.length);
    return { ...o, genome };
  }

  it('shows a copied gene as ×2 and a gene the world does not read as silent', () => {
    const w = new World({ dnaContinuousAbilities: false, dnaSplitDiets: false, dnaVariationEnabled: false, seed: 'bars', metabolismGeneEnabled: true });
    const dup = withGenes([[geneKey(GeneClass.trait, TraitId.carnivory), 0.5]]);
    const row = genomeTraitRows(dup, w.config).find((r) => r.label === 'Meat eating')!;
    expect(row.copies).toBe(2);
    expect(genomeBarsHtml(dup, w.config)).toContain('×2 dosage');

    // Split diets are off by default, so a herbivory gene decodes to nothing.
    const silent = withGenes([[geneKey(GeneClass.trait, TraitId.herbivory), 0.7]]);
    const silentRow = genomeTraitRows(silent, w.config).find((r) => r.label === 'Plant eating')!;
    expect(silentRow.silent).toBe(true);
    expect(genomeBarsHtml(silent, w.config)).toContain('silent');
  });
});
