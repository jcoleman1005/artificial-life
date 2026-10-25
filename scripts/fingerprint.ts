import { createHash } from 'node:crypto';
import { World } from '../src/sim/world';
// Prints a hash of the world state at intervals for both controllers.
// Run before and after an engine optimization: identical output means the
// change did not alter any simulation outcome.  Usage: npm run fingerprint
const out: string[] = [];
for (const controller of ['dials', 'brain'] as const) {
  const w = new World({ seed: 'fingerprint', controller });
  const h = createHash('sha256');
  for (let t = 1; t <= 1500; t++) {
    w.step();
    if (t % 100 === 0) {
      const orgs = Array.from(w.organisms.values()).sort((a, b) => a.id.localeCompare(b.id));
      h.update(JSON.stringify(orgs.map((o) => [o.id, o.x, o.y, o.energy, o.carriedFood, o.tag, o.recentHistory[0]?.chosenAction.type])));
      h.update(JSON.stringify(Array.from(w.foodPatches.values())));
    }
  }
  out.push(`${controller}: ${h.digest('hex').slice(0, 16)} pop ${w.organisms.size} births ${w.birthsTotal}`);
}
console.log(out.join('\n'));
