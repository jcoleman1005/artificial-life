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
        // Life-history state, hashed only when something carries it, so a world with those switches off keeps its old hash.
        const life = orgs.filter((o) => o.reproThreshold !== undefined || o.fatCapacity !== undefined || o.torporDepth !== undefined || o.eggRate !== undefined || o.metabolicRate !== undefined || o.investment !== undefined || o.clutchSize !== undefined);
        if (life.length > 0 || w.eggs.size > 0) {
          // clutchSize only when present, so a world with the clutch gene off keeps its old hash.
          h.update(JSON.stringify(life.map((o) => [o.id, o.reproThreshold, o.investment, o.fatCapacity, o.fat, o.torporDepth, o.rested, o.eggRate, o.metabolicRate, o.nextBirthTick, ...(o.clutchSize !== undefined ? [o.clutchSize] : [])])));
          h.update(JSON.stringify(Array.from(w.eggs.values()).map((e) => [e.child.id, e.x, e.y, e.laidTick, e.child.energy])));
        }
        // Growth state (maturity, age, growth duration), hashed only while growth or ageing is on, so a world with both off keeps its old hash.
        if (w.config.growthEnabled || w.config.ageingEnabled) h.update(JSON.stringify(orgs.map((o) => [o.id, o.maturity ?? 1, o.age, ...(o.growthDuration !== undefined ? [o.growthDuration] : []), ...(o.hatchMaturity !== undefined ? [o.hatchMaturity] : [])])));
        if (w.cellHealth) h.update(JSON.stringify(w.cellHealth.exportState())); // overgrazing state, only while it is on
        if (w.weather) h.update(JSON.stringify(w.weather.exportState())); // weather state, only while it is on
        if (w.config.nutrientCycleEnabled) h.update(JSON.stringify(Array.from(w.soil().nutrients)));
      }
    }
    out.push(`${name} ${controller}: ${h.digest('hex').slice(0, 16)} pop ${w.organisms.size} births ${w.birthsTotal}`);
  }
}
console.log(out.join('\n'));
