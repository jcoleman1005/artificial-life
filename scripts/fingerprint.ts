import { createHash } from 'node:crypto';
import { World } from '../src/sim/world';
import { FOOD_LAYOUTS, WORLD_SIZES } from '../src/sim/config';
import type { SimulationConfig } from '../src/sim/types';
// Prints a hash of the world state at intervals for both controllers, in the
// original small world and in the default large one. Run before and after an
// engine optimization: identical output means the change did not alter any
// simulation outcome.  Usage: npm run fingerprint
const worlds: Record<string, Partial<SimulationConfig>> = {
  small: { ...WORLD_SIZES.small, ...FOOD_LAYOUTS.anywhere },
  large: {},
};
const out: string[] = [];
for (const [name, overrides] of Object.entries(worlds)) {
  for (const controller of ['dials', 'brain'] as const) {
    const w = new World({ ...overrides, seed: 'fingerprint', controller });
    const h = createHash('sha256');
    for (let t = 1; t <= 1500; t++) {
      w.step();
      if (t % 100 === 0) {
        const orgs = Array.from(w.organisms.values()).sort((a, b) => a.id.localeCompare(b.id));
        h.update(JSON.stringify(orgs.map((o) => [o.id, o.x, o.y, o.energy, o.carriedFood, o.tag, o.recentHistory[0]?.chosenAction.type])));
        h.update(JSON.stringify(Array.from(w.foodPatches.values())));
      }
    }
    out.push(`${name} ${controller}: ${h.digest('hex').slice(0, 16)} pop ${w.organisms.size} births ${w.birthsTotal}`);
  }
}
console.log(out.join('\n'));
