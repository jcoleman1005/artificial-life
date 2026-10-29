import { World } from '../src/sim/world';
// Fixed-tick cost harness (default world, brain controller, seed 42, 1300 ticks).
// Run: npx vite-node scripts/perf-fixed.ts   (the same tick count every run, so runs are comparable)
const w = new World({ seed: 42 });
let total = 0, orgTicks = 0;
for (let t = 0; t < 1300; t++) {
  const n = w.organisms.size;
  const t0 = performance.now(); w.step(); total += performance.now() - t0; orgTicks += n;
}
console.log(`avg ${(total/1300).toFixed(2)} ms/tick, ${(1000*total/orgTicks).toFixed(1)} us per organism-tick, pop ${w.organisms.size}`);
