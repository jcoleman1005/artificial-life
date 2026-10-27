// Parameter sweep for overgrazing defaults (logged in docs/findings.md).
//   npm run sweep:overgrazing -- --damage 0.02 [--ticks 1500] [--seeds 1,2]
// Prints one line per (damage, recovery, rest): how fast ground degrades where
// grazing is heaviest (the worst region's mean health first under 0.8, and the
// first cell under 0.5, and when 2% of fertile cells are degraded), the most degraded it gets, and population against the same
// seed with overgrazing off.
import { World } from '../src/sim/world';

const args = process.argv.slice(2);
const get = (name: string, fallback: string) => (args.indexOf(name) >= 0 ? args[args.indexOf(name) + 1] : fallback);
const ticks = Number(get('--ticks', '1500'));
const seeds = get('--seeds', '1,2').split(',').map(Number);
const damages = get('--damage', '0.02').split(',').map(Number);
const recoveries = get('--recovery', '0.002,0.005,0.01').split(',').map(Number);
const rests = get('--rest', '20,50').split(',').map(Number);

function run(seed: number, overrides: Record<string, number | boolean>) {
  const w = new World({ seed, ...overrides });
  let popSum = 0;
  let regionTick = Infinity;
  let cellTick = Infinity;
  let patchTick = Infinity;
  let peak = 0;
  for (let t = 1; t <= ticks; t++) {
    w.step();
    popSum += w.organisms.size;
    const o = w.cellHealth && t % 10 === 0 ? w.getMetrics().overgrazing : null;
    if (o) {
      if (regionTick === Infinity && Math.min(...o.meanHealth) < 0.8) regionTick = t;
      if (cellTick === Infinity && o.fractionDegraded > 0) cellTick = t;
      if (patchTick === Infinity && o.fractionDegraded >= 0.02) patchTick = t;
      peak = Math.max(peak, o.fractionDegraded);
    }
  }
  const o = w.getMetrics().overgrazing;
  return { avgPop: popSum / ticks, regionTick, cellTick, patchTick, peak, health: o?.meanHealthAll ?? 1, degraded: o?.fractionDegraded ?? 0, worst: o ? Math.min(...o.meanHealth) : 1 };
}

const off = new Map(seeds.map((s) => [s, run(s, { overgrazingEnabled: false }).avgPop]));
for (const damage of damages) for (const recovery of recoveries) for (const rest of rests) {
  const rs = seeds.map((s) => run(s, { overgrazingDamagePerBite: damage, overgrazingRecoveryRate: recovery, overgrazingRestTicks: rest }));
  const mean = (f: (r: (typeof rs)[number]) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
  const ratio = rs.reduce((a, r, i) => a + r.avgPop / Math.max(1e-9, off.get(seeds[i])!), 0) / rs.length;
  const show = (v: number) => (Number.isFinite(v) ? v.toFixed(0) : 'never');
  console.log(
    `damage ${damage} recovery ${recovery} rest ${rest}: region<0.8 at ${rs.map((r) => show(r.regionTick)).join('/')}, first cell<0.5 at ${rs.map((r) => show(r.cellTick)).join('/')}, 2% degraded at ${rs.map((r) => show(r.patchTick)).join('/')}, peak degraded ${(100 * mean((r) => r.peak)).toFixed(1)}%, ` +
      `end health ${mean((r) => r.health).toFixed(2)} (worst region ${mean((r) => r.worst).toFixed(2)}), degraded ${(100 * mean((r) => r.degraded)).toFixed(0)}%, avgPop/off ${ratio.toFixed(2)}`
  );
}
