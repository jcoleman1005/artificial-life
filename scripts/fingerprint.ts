import { createHash } from 'node:crypto';
import { World } from '../src/sim/world';
import type { SimulationConfig } from '../src/sim/types';
// Prints a hash of the world state at intervals for both controllers in the
// default world. Run before and after an
// engine optimization: identical output means the change did not alter any
// simulation outcome.  Usage: npm run fingerprint [-- --set key=value ...]
// --set applies config to every world, e.g. --set overgrazingEnabled=false to
// check that a feature's switch off reproduces the pre-change fingerprint.
const set: Partial<SimulationConfig> = {};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--set') continue;
  const [k, raw] = (args[++i] ?? '').split('=');
  const n = Number(raw);
  (set as Record<string, unknown>)[k] = raw === 'true' ? true : raw === 'false' ? false : raw.trim() !== '' && !Number.isNaN(n) ? n : raw;
}
// Seed '2' keeps both controllers' populations alive to tick 1500 (seed
// 'fingerprint' and the small world died out by ~900, leaving later samples
// nothing to hash). No immigration: the world survives on its own.
const worlds: Record<string, Partial<SimulationConfig>> = { large: {} };
const out: string[] = [];
for (const [name, overrides] of Object.entries(worlds)) {
  for (const controller of ['dials', 'brain'] as const) {
    const w = new World({ ...overrides, ...set, seed: '2', controller });
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
