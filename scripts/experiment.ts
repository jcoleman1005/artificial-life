// Compare simulation variants across seeds, headless and in parallel.
//
//   npm run experiment -- --compare sharingEnabled=false,true
//   npm run experiment -- --compare controller=dials,brain --seeds 1-8 --ticks 10000
//   npm run experiment -- --compare seasonLength=0,800 --set gridWidth=60 --set gridHeight=60
//
// Options:
//   --compare key=a,b,...   one config key and the values to compare (required);
//                           k1+k2=a,b sets several keys to the same value together
//   --set key=value         extra config applied to every run (repeatable)
//   --seeds 1-8 | 1,4,9     seeds to run (default 1-8)
//   --ticks N               ticks per run (default 10000)
//   --workers N             parallel processes (default 3)
//   --json path             also save every run's raw results as JSON
//
// Each seed runs once per variant, so variants are compared seed by seed
// ("paired"): the summary shows each variant's mean and, against the first
// variant, the mean per-seed difference and in how many seeds it was higher.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { World } from '../src/sim/world';
import { POLICY_WEIGHT_KEYS, abilityShares } from '../src/sim/history';
import { brainDrift, hiddenStrength } from '../src/sim/brain';
import { seasonAt } from '../src/sim/seasons';
import type { SimulationConfig } from '../src/sim/types';

type ConfigValue = string | number | boolean;
type Overrides = Record<string, ConfigValue>;

interface Job {
  seed: number;
  variant: string;
  overrides: Overrides;
  ticks: number;
}

type RunResult = { seed: number; variant: string; metrics: Record<string, number> };

function parseValue(raw: string): ConfigValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const n = Number(raw);
  return raw.trim() !== '' && !Number.isNaN(n) ? n : raw;
}

function parseSeeds(spec: string): number[] {
  return spec.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

/** Runs one world and returns a fixed set of measurements. */
function runJob(job: Job): RunResult {
  const world = new World({ ...(job.overrides as Partial<SimulationConfig>), seed: job.seed });
  const tailStart = Math.floor(job.ticks * 0.8); // action mix over the last 20%
  let popSum = 0;
  let cycleLow = Infinity;
  const leanLows: number[] = [];
  const actions: Record<string, number> = {};
  // Migration: the last food region each organism was inside, and how often
  // organisms turn up in a different region from their last one.
  const lastRegion = new Map<string, number>();
  let regionChanges = 0;
  let inRegionSum = 0;
  // Signals, over the last 20%: how often organisms on food signal compared
  // with how often anyone signals (does a signal say "food here"?), and
  // whether moves made with a signal in range head toward it.
  const sig = { sent: 0, sentOnFood: 0, decisions: 0, onFood: 0, onFoodSent: 0, movesWithSignal: 0, movesToward: 0 };

  for (let t = 1; t <= job.ticks; t++) {
    world.step();
    const n = world.organisms.size;
    popSum += n;
    if (world.foodRegions.length > 0) {
      for (const o of world.organisms.values()) {
        const region = world.foodRegions.findIndex((r) => Math.hypot(o.x - r.x, o.y - r.y) <= r.radius);
        if (region < 0) continue;
        inRegionSum++;
        const previous = lastRegion.get(o.id);
        if (previous !== undefined && previous !== region) regionChanges++;
        lastRegion.set(o.id, region);
      }
      for (const id of lastRegion.keys()) if (!world.organisms.has(id)) lastRegion.delete(id);
    }
    cycleLow = Math.min(cycleLow, n);
    const season = seasonAt(world.tick, world.config);
    if (season && season.season === 'plenty' && season.ticksLeft === Math.round(world.config.seasonLength * (1 - world.config.leanFraction))) {
      // A new cycle just began: record the previous cycle's low (skip the first).
      if (t > world.config.seasonLength) leanLows.push(cycleLow);
      cycleLow = Infinity;
    }
    if (t > tailStart) {
      for (const o of world.organisms.values()) {
        const d = o.recentHistory[0];
        if (!d) continue;
        const base = d.chosenAction.type.split('_')[0].toLowerCase();
        const ok = d.outcome === 'success' || d.outcome === 'rested';
        const key = ok ? base : `${base}Failed`;
        actions[key] = (actions[key] ?? 0) + 1;
        sig.decisions++;
        const onFood = d.sensed.currentCellFood > 0;
        const signalled = d.chosenAction.type === 'SIGNAL';
        if (signalled) sig.sent++;
        if (onFood) sig.onFood++;
        if (onFood && signalled) sig.onFoodSent++;
        const s = d.sensed.nearestSignal;
        if (s && d.chosenAction.type.startsWith('MOVE_') && d.outcome === 'success') {
          sig.movesWithSignal++;
          const t = d.chosenAction.type;
          const [mx, my] = t.endsWith('NORTH') ? [0, -1] : t.endsWith('SOUTH') ? [0, 1] : t.endsWith('EAST') ? [1, 0] : [-1, 0];
          if (mx * s.dx + my * s.dy > 0) sig.movesToward++;
        }
      }
    }
  }

  const organisms = Array.from(world.organisms.values());
  const count = Math.max(1, organisms.length);
  const mean = (f: (o: (typeof organisms)[number]) => number) => organisms.reduce((a, o) => a + f(o), 0) / count;
  const m = world.getMetrics();
  const actionTotal = Object.values(actions).reduce((a, v) => a + v, 0) || 1;

  const metrics: Record<string, number> = {
    avgPop: popSum / job.ticks,
    finalPop: organisms.length,
    ...(leanLows.length ? { leanLow: leanLows.reduce((a, v) => a + v, 0) / leanLows.length } : {}),
    ...(world.foodRegions.length
      ? { 'inRegion%': (100 * inRegionSum) / Math.max(1, popSum), regionMovesPer1k: (1000 * regionChanges) / job.ticks }
      : {}),
    'signal%': (100 * sig.sent) / Math.max(1, sig.decisions),
    'signalOnFood%': (100 * sig.onFoodSent) / Math.max(1, sig.onFood),
    'movesTowardSignal%': (100 * sig.movesToward) / Math.max(1, sig.movesWithSignal),
    births: m.birthsTotal,
    deaths: m.deathsTotal,
    giftsToOthers: m.sharesTotal - m.parentalSharesTotal,
    giftsToChildren: m.parentalSharesTotal,
    largestGroup: m.tribes.largestTribe,
    lookAlikeNeighbours: m.tribes.localKinFraction,
    lookAlikeByChance: m.tribes.globalKinFraction,
    carryCapacity: mean((o) => o.carryCapacity),
    ...Object.fromEntries(
      Object.entries(abilityShares([...world.organisms.values()])).map(([k, v]) => [`ability.${k}`, v])
    ),
    brainDrift: mean((o) => brainDrift(o.brain)),
    hiddenStrength: mean((o) => hiddenStrength(o.brain)),
    ...Object.fromEntries(POLICY_WEIGHT_KEYS.map((k) => [`w.${k}`, mean((o) => o.policy[k])])),
    ...Object.fromEntries(Object.entries(actions).map(([k, v]) => [`act.${k}%`, (100 * v) / actionTotal])),
  };
  return { seed: job.seed, variant: job.variant, metrics };
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

function summarize(results: RunResult[], variants: string[]): string {
  const keys = [...new Set(results.flatMap((r) => Object.keys(r.metrics)))];
  const byVariant = (v: string) => results.filter((r) => r.variant === v);
  const lines: string[] = [];
  const base = variants[0];
  const header = ['metric', ...variants, ...variants.slice(1).map((v) => `Δ ${v} vs ${base} (higher in)`)];
  lines.push(header.join(' | '));
  lines.push(header.map(() => '---').join(' | '));
  for (const key of keys) {
    const means = variants.map((v) => {
      const vals = byVariant(v).map((r) => r.metrics[key] ?? 0);
      return vals.reduce((a, x) => a + x, 0) / Math.max(1, vals.length);
    });
    const diffs = variants.slice(1).map((v) => {
      const pairs = byVariant(v).map((r) => {
        const b = results.find((x) => x.variant === base && x.seed === r.seed);
        return (r.metrics[key] ?? 0) - (b?.metrics[key] ?? 0);
      });
      const d = pairs.reduce((a, x) => a + x, 0) / Math.max(1, pairs.length);
      const higher = pairs.filter((x) => x > 0).length;
      return `${d >= 0 ? '+' : ''}${fmt(d)} (${higher}/${pairs.length})`;
    });
    lines.push([key, ...means.map(fmt), ...diffs].join(' | '));
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);

  // Worker mode: run the given jobs and print one JSON line per result.
  const jobArg = args.indexOf('--jobs');
  if (jobArg >= 0) {
    const jobs = JSON.parse(args[jobArg + 1]) as Job[];
    for (const job of jobs) console.log(JSON.stringify(runJob(job)));
    return;
  }

  const get = (name: string, fallback?: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const compare = get('--compare');
  if (!compare || !compare.includes('=')) {
    console.error('Usage: npm run experiment -- --compare key=a,b [--set key=value] [--seeds 1-8] [--ticks 10000] [--workers 3] [--json out.json]');
    process.exit(1);
  }
  const [compareKey, valueList] = compare.split('=');
  const variants = valueList.split(',');
  const fixed: Overrides = {};
  args.forEach((a, i) => {
    if (a === '--set') {
      const [k, v] = args[i + 1].split('=');
      fixed[k] = parseValue(v);
    }
  });
  const seeds = parseSeeds(get('--seeds', '1-8')!);
  const ticks = Number(get('--ticks', '10000'));
  const workers = Math.max(1, Number(get('--workers', '3')));

  const jobs: Job[] = seeds.flatMap((seed) =>
    variants.map((variant) => ({
      seed,
      variant,
      ticks,
      overrides: { ...fixed, ...Object.fromEntries(compareKey.split('+').map((k) => [k, parseValue(variant)])) },
    }))
  );
  console.log(`${jobs.length} runs (${seeds.length} seeds × ${variants.length} variants of ${compareKey}), ${ticks} ticks each, ${workers} workers${Object.keys(fixed).length ? `, with ${JSON.stringify(fixed)}` : ''}`);

  // Deal jobs round-robin to worker processes.
  const slices: Job[][] = Array.from({ length: Math.min(workers, jobs.length) }, () => []);
  jobs.forEach((job, i) => slices[i % slices.length].push(job));
  const started = Date.now();
  const results: RunResult[] = [];
  await Promise.all(
    slices.map(
      (slice) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(
            process.execPath,
            ['node_modules/vite-node/vite-node.mjs', 'scripts/experiment.ts', '--', '--jobs', JSON.stringify(slice)],
            { stdio: ['ignore', 'pipe', 'inherit'] }
          );
          let buffer = '';
          child.stdout.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();
            let nl: number;
            while ((nl = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, nl).trim();
              buffer = buffer.slice(nl + 1);
              if (!line.startsWith('{')) continue;
              const r = JSON.parse(line) as RunResult;
              results.push(r);
              console.log(`  done: seed ${r.seed}, ${compareKey}=${r.variant} (${results.length}/${jobs.length})`);
            }
          });
          child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`worker exited ${code}`))));
        })
    )
  );

  console.log(`\nFinished in ${((Date.now() - started) / 60000).toFixed(1)} min. Means per variant; Δ = mean per-seed difference.\n`);
  console.log(summarize(results, variants));
  const jsonPath = get('--json');
  if (jsonPath) {
    writeFileSync(jsonPath, JSON.stringify({ compareKey, variants, fixed, seeds, ticks, results }, null, 2));
    console.log(`\nRaw results saved to ${jsonPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
