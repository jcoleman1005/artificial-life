import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { genomeDistance } from '../src/sim/speciation';
import { tagDistance } from '../src/sim/tags';
import type { SimulationConfig } from '../src/sim/types';

// Phase 0 diagnostic for docs/specs/speciation.md: observer only. Runs worlds
// with the hybrid cost at zero and reports how far apart genomes are (random
// pairs, and the pairs that actually mated), and whether hue tracks genome
// distance. Use it to set hybridTolerance and hybridFull from real numbers.
// Usage: npm run genome-distance [-- --seeds 1-4 --ticks 5000 --pairs 300 --set key=value ...]
const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const [s0, s1] = opt('seeds', '1-4').split('-').map(Number);
const seeds = Array.from({ length: (s1 ?? s0) - s0 + 1 }, (_, i) => s0 + i);
const ticks = Number(opt('ticks', '5000'));
const pairs = Number(opt('pairs', '300'));
const set: Partial<SimulationConfig> = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [k, raw] = (args[++i] ?? '').split('=');
  const n = Number(raw);
  (set as Record<string, unknown>)[k] = raw === 'true' ? true : raw === 'false' ? false : raw.trim() !== '' && !Number.isNaN(n) ? n : raw;
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN);
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

console.log(`genome-distance: seeds ${seeds.join(',')}, ${ticks} ticks, ${pairs} pairs per sample`);
console.log('seed  tick   pop  | random-pair distance: p10   p50   p90   max | mated-pair mean | hue~genome r');
const checkpoints = [Math.round(ticks / 5), Math.round((2 * ticks) / 5), Math.round((3 * ticks) / 5), Math.round((4 * ticks) / 5), ticks];
for (const seed of seeds) {
  const w = new World({ seed: String(seed), ...set });
  const sampler = new PRNG(`genome-distance-${seed}`); // observer's own stream: never the world's
  for (let t = 1; t <= ticks; t++) {
    w.step();
    if (!checkpoints.includes(t)) continue;
    const orgs = Array.from(w.organisms.values()).filter((o) => o.genome).sort((a, b) => a.id.localeCompare(b.id));
    if (orgs.length < 3) {
      console.log(`${String(seed).padStart(4)} ${String(t).padStart(5)} ${String(orgs.length).padStart(5)}  | too few organisms`);
      continue;
    }
    const d: number[] = [];
    const hue: number[] = [];
    for (let i = 0; i < pairs; i++) {
      const a = orgs[sampler.nextInt(0, orgs.length - 1)];
      const b = orgs[sampler.nextInt(0, orgs.length - 1)];
      if (a === b) continue;
      d.push(genomeDistance(a.genome!, b.genome!, w.config));
      hue.push(tagDistance(a.tag, b.tag));
    }
    const sorted = [...d].sort((x, y) => x - y);
    const matedMean = w.matingsTotal > 0 ? w.matingGenomeDistanceSum / w.matingsTotal : NaN;
    console.log(
      `${String(seed).padStart(4)} ${String(t).padStart(5)} ${String(orgs.length).padStart(5)}  | ${f(pct(sorted, 0.1))} ${f(pct(sorted, 0.5))} ${f(pct(sorted, 0.9))} ${f(sorted[sorted.length - 1])} | ${f(matedMean)} (n=${w.matingsTotal}) | ${f(correlation(hue, d), 2)}`
    );
  }
}
