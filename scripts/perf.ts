// Engine speed for both controllers over 3000 ticks (includes a boom).  Usage: npm run perf
import { World } from '../src/sim/world';
for (const controller of ['dials', 'brain'] as const) {
  const w = new World({ seed: 42, controller });
  let total = 0, organismTicks = 0, peakMs = 0, peakPop = 0;
  for (let t = 0; t < 3000; t++) {
    const n = w.organisms.size;
    const t0 = performance.now();
    w.step();
    const ms = performance.now() - t0;
    total += ms; organismTicks += n;
    if (n > peakPop) { peakPop = n; peakMs = ms; }
  }
  console.log(`${controller}: ${(total / 3000).toFixed(2)} ms/tick avg, ${(1000 * total / organismTicks).toFixed(1)} µs per organism, at peak pop ${peakPop}: ${peakMs.toFixed(1)} ms`);
}
