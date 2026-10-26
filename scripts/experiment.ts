// Compare simulation variants across seeds, headless and in parallel.
//
//   npm run experiment -- --compare sharingEnabled=false,true
//   npm run experiment -- --compare controller=dials,brain --seeds 1-8 --ticks 10000
//   npm run experiment -- --compare seasonLength=0,800 --set gridWidth=60 --set gridHeight=60
//
// Options:
//   --compare key=a,b,...   one config key and the values to compare (required);
//                           k1+k2=a,b sets several keys to the same value together
//   --arm name=k:v,k:v      (repeatable, instead of --compare) a named variant setting several keys
//   --set key=value         extra config applied to every run (repeatable)
//   --seeds 1-8 | 1,4,9     seeds to run (default 1-8)
//   --ticks N               ticks per run (default 10000)
//   --workers N             parallel processes (default 3)
//   --json path             also save every run's raw results as JSON
//   --from saved.json       start every run from a saved world (a SavedWorld file
//                           from the app, or a bare World.exportState()) instead of
//                           tick 0; each seed reseeds its random stream, and the
//                           variant and --set values are applied on top. Settings
//                           that only shape a new world (size, obstacles, regions,
//                           founders) have no effect on a saved one.
//
// Each seed runs once per variant, so variants are compared seed by seed
// ("paired"): the summary shows each variant's mean and, against the first
// variant, the mean per-seed difference and in how many seeds it was higher.

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { World, type WorldState } from '../src/sim/world';
import { POLICY_WEIGHT_KEYS, abilityShares } from '../src/sim/history';
import { BRAIN_INPUTS, brainDrift, hiddenStrength } from '../src/sim/brain';
import { unitDirectionOf } from '../src/sim/directions';
import { seasonAt } from '../src/sim/seasons';
import { PLANT_TRAIT_KEYS, computePlantMetrics } from '../src/sim/plants';
import type { Organism, SimulationConfig } from '../src/sim/types';
import { Diagnostics } from './diagnostics';
import { continuousAbilities, herbivoryOf, splitDiets } from '../src/sim/traits';
import { GENE_TYPES, genomeStats } from '../src/sim/dna';

type ConfigValue = string | number | boolean;
type Overrides = Record<string, ConfigValue>;

interface Job {
  seed: number;
  variant: string;
  overrides: Overrides;
  ticks: number;
  /** Path of a saved world to start from (otherwise a new world). */
  from?: string;
}

/** The brain's direct connections reported after each run: the signal ones. */
const SIGNAL_INPUTS = ['isSignal', 'signalOnFood', 'signalHunger', 'moveSignal', 'moveSignalAlike'] as const;
/** ...and the hunting ones. */
const HUNTING_INPUTS = ['isAttack', 'attackKillChance', 'attackAlike', 'attackFamily', 'attackHunger', 'moveCarrion'] as const;

/** Continuous abilities: per ability, the share holding it, holders' mean and spread of efficiency, and the share locked at 1. */
function abilityEfficiencyResults(organisms: readonly Organism[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of ['diagonal', 'squeeze', 'leap'] as const) {
    const held = organisms.map((o) => o.abilities[name]).filter((e) => e > 0);
    const n = Math.max(1, held.length);
    const avg = held.reduce((a, e) => a + e, 0) / n;
    out[`held.${name}`] = held.length / Math.max(1, organisms.length);
    out[`eff.${name}`] = avg;
    out[`effSd.${name}`] = Math.sqrt(held.reduce((a, e) => a + (e - avg) ** 2, 0) / n);
    out[`atOne.${name}`] = held.filter((e) => e >= 0.999).length / n;
  }
  return out;
}

/** Reads a SavedWorld file (or a bare WorldState) and returns the world state. */
function readWorldState(path: string): WorldState {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { format?: string; world?: WorldState } & Partial<WorldState>;
  return (data.format === 'alife-world' ? data.world : data) as WorldState;
}

/** A world for a job: new, or the saved one reseeded with the job's seed and overrides applied. */
function makeWorld(job: Job): World {
  const overrides = { ...(job.overrides as Partial<SimulationConfig>), seed: job.seed };
  if (!job.from) return new World(overrides);
  const state = readWorldState(job.from);
  return World.fromState({ ...state, config: { ...state.config, ...overrides }, prng: { seed: job.seed, state: (job.seed >>> 0) || 1 } }); // a fresh stream, as setSeed gives
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
  const world = makeWorld(job);
  // Counters are measured from the start, so runs from a saved world report only their own ticks.
  const start = world.getMetrics();
  const startBirthDistance = world.birthDistanceSum;
  const startWindfall = { placed: world.windfallUnitsPlaced, rotted: world.windfallUnitsRotted };
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
  // Plants (when on): standing crop over the run.
  let plantSum = 0;
  let edibleSum = 0;
  // Windfalls: how often organisms standing on windfall food signal.
  const sig = { sent: 0, sentOnFood: 0, decisions: 0, onFood: 0, onFoodSent: 0, onWindfall: 0, onWindfallSent: 0, movesWithSignal: 0, movesToward: 0 };
  const onWindfall = new Set<string>();
  // Stage 2: genome length (mean and spread) at five checkpoints, and the cost of the steps themselves.
  const genomeSeries: { mean: number; sd: number }[] = [];
  let stepMs = 0;
  let organismSteps = 0;
  const diagnostics = new Diagnostics();

  for (let t = 1; t <= job.ticks; t++) {
    onWindfall.clear();
    if (t > tailStart && world.windfallUnitsPlaced > 0) {
      for (const o of world.organisms.values()) {
        if (world.foodPatches.get(`${o.x},${o.y}`)?.expiresAt !== undefined) onWindfall.add(o.id);
      }
    }
    const stepStart = performance.now();
    world.step();
    stepMs += performance.now() - stepStart;
    diagnostics.observe(world, t > tailStart);
    const n = world.organisms.size;
    organismSteps += n;
    popSum += n;
    if (world.config.dnaVariationEnabled && t % Math.floor(job.ticks / 5) === 0 && genomeSeries.length < 5) {
      const s = genomeStats(Array.from(world.organisms.values(), (o) => o.genome ?? new Uint32Array(0)), world.config);
      genomeSeries.push({ mean: s.meanLength, sd: s.sdLength });
    }
    if (world.config.plantsEnabled) {
      for (const p of world.foodPatches.values()) {
        if (!p.plant) continue;
        plantSum++;
        edibleSum += p.plant.biomass;
      }
    }
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
      // (From a saved world the first cycle is partial, so it is skipped too.)
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
        if (onWindfall.has(o.id)) {
          sig.onWindfall++;
          if (signalled) sig.onWindfallSent++;
        }
        const s = d.sensed.nearestSignal;
        if (s && (d.chosenAction.type.startsWith('MOVE_') || d.chosenAction.type.startsWith('LEAP_')) && d.outcome === 'success') {
          sig.movesWithSignal++;
          const [mx, my] = unitDirectionOf(d.chosenAction.type);
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
    ...(sig.onWindfall > 0 ? { 'signalOnWindfall%': (100 * sig.onWindfallSent) / sig.onWindfall } : {}),
    births: m.birthsTotal - start.birthsTotal,
    deaths: m.deathsTotal - start.deathsTotal,
    giftsToOthers: m.sharesTotal - m.parentalSharesTotal - (start.sharesTotal - start.parentalSharesTotal),
    giftsToChildren: m.parentalSharesTotal - start.parentalSharesTotal,
    kills: m.killsTotal - start.killsTotal,
    'killsOfStrangers%': (100 * (m.killsOfStrangersTotal - start.killsOfStrangersTotal)) / Math.max(1, m.killsTotal - start.killsTotal),
    'killsOfKin%': (100 * (m.killsOfKinTotal - start.killsOfKinTotal)) / Math.max(1, m.killsTotal - start.killsTotal),
    carrionEaten: m.carrionEatenTotal - start.carrionEatenTotal,
    carnivory: m.averageCarnivory,
    meatEaters: m.meatEaters,
    largestGroup: m.tribes.largestTribe,
    lookAlikeNeighbours: m.tribes.localKinFraction,
    lookAlikeByChance: m.tribes.globalKinFraction,
    carryCapacity: mean((o) => o.carryCapacity),
    dispersal: mean((o) => o.dispersal),
    memorySpan: mean((o) => o.memorySpan),
    ...(world.windfallUnitsPlaced > startWindfall.placed
      ? {
          // Windfall food eaten before it rotted (leftovers still on the ground count as uneaten).
          'windfallEaten%':
            (100 *
              (world.windfallUnitsPlaced -
                startWindfall.placed -
                (world.windfallUnitsRotted - startWindfall.rotted) -
                Array.from(world.foodPatches.values()).reduce((s, p) => s + (p.expiresAt !== undefined ? p.stock : 0), 0))) /
            (world.windfallUnitsPlaced - startWindfall.placed),
        }
      : {}),
    birthDistance:
      (world.birthDistanceSum - startBirthDistance) /
      Math.max(1, m.birthsTotal - start.birthsTotal - (job.from ? 0 : world.config.initialOrganisms) - (m.immigrantsTotal - start.immigrantsTotal)),
    ...Object.fromEntries(
      Object.entries(abilityShares([...world.organisms.values()])).map(([k, v]) => [`ability.${k}`, v])
    ),
    extinct: organisms.length === 0 ? 1 : 0,
    ...(organisms.length > 0 ? { energy: mean((o) => o.energy) } : {}),
    ...(continuousAbilities(world.config) && organisms.length > 0 ? abilityEfficiencyResults(organisms) : {}),
    ...(splitDiets(world.config) && organisms.length > 0
      ? {
          herbivory: mean((o) => herbivoryOf(o, world.config)),
          generalists: organisms.filter((o) => herbivoryOf(o, world.config) >= 0.5 && o.carnivory >= 0.5).length,
          meatSpecialists: organisms.filter((o) => herbivoryOf(o, world.config) < 0.5 && o.carnivory >= 0.5).length,
        }
      : {}),
    ...(world.config.plantsEnabled ? plantResults(world, plantSum / job.ticks, edibleSum / job.ticks, job.ticks) : {}),
    usPerOrganismTick: (1000 * stepMs) / Math.max(1, organismSteps),
    ...(world.config.dnaVariationEnabled && organisms.length > 0 ? genomeResults(organisms, world.config, genomeSeries) : {}),
    ...diagnostics.results(),
    ...overgrazingResults(world),
    brainDrift: mean((o) => brainDrift(o.brain)),
    hiddenStrength: mean((o) => hiddenStrength(o.brain)),
    ...Object.fromEntries(
      [...SIGNAL_INPUTS, ...HUNTING_INPUTS].map((k) => [`b.${k}`, mean((o) => o.brain.skip[BRAIN_INPUTS.indexOf(k)])])
    ),
    ...Object.fromEntries(POLICY_WEIGHT_KEYS.map((k) => [`w.${k}`, mean((o) => o.policy[k])])),
    ...Object.fromEntries(Object.entries(actions).map(([k, v]) => [`act.${k}%`, (100 * v) / actionTotal])),
  };
  return { seed: job.seed, variant: job.variant, metrics };
}

/** Stage 2 measurements: genome length over time, gene counts by type, and how far duplicated copies have drifted apart. */
function genomeResults(organisms: readonly Organism[], config: SimulationConfig, series: { mean: number; sd: number }[]): Record<string, number> {
  const s = genomeStats(organisms.map((o) => o.genome ?? new Uint32Array(0)), config);
  return {
    'genes.mean': s.meanLength,
    'genes.sd': s.sdLength,
    'genes.min': s.minLength,
    'genes.max': s.maxLength,
    'genes.atCap%': (100 * organisms.filter((o) => (o.genome?.length ?? 0) / 3 >= config.dnaMaxGenes).length) / organisms.length,
    ...Object.fromEntries(series.flatMap((p, i) => [[`genes.mean@${(i + 1) * 20}%`, p.mean], [`genes.sd@${(i + 1) * 20}%`, p.sd]])),
    ...Object.fromEntries(GENE_TYPES.map((t) => [`genes.${t}`, s.meanByType[t]])),
    'dup.multiCopySlots': s.multiCopySlots,
    'dup.identical%': 100 * s.identicalShare,
    'dup.spread(sd)': s.meanSpread,
  };
}

/** Overgrazing (when on): cell health at the end of the run, per region and overall, and the share of degraded cells. */
function overgrazingResults(world: World): Record<string, number> {
  const o = world.getMetrics().overgrazing;
  if (!o) return {};
  return {
    meanHealth: o.meanHealthAll,
    fractionDegraded: o.fractionDegraded,
    ...Object.fromEntries(o.meanHealth.map((h, i) => [`meanHealth.r${i}`, h])),
  };
}

/** Plant measurements: standing crop, production, grazing, deaths by cause and final trait means. */
function plantResults(world: World, avgPlants: number, avgEdible: number, ticks: number): Record<string, number> {
  const c = world.plantCounters;
  const p = computePlantMetrics(world.foodPatches, c);
  return {
    avgPlants,
    avgEdible,
    finalPlants: p.count,
    edibleGrownPerTick: c.edibleGrownTotal / ticks,
    grazedPerTick: c.grazedTotal / ticks,
    seedRain: c.seedRainTotal,
    'plantDeaths.grazed': c.deathsGrazed,
    'plantDeaths.shaded': c.deathsShaded,
    'plantDeaths.lean': c.deathsLean,
    'plantDeaths.starved': c.deathsStarved,
    ...Object.fromEntries(PLANT_TRAIT_KEYS.map((k) => [`plant.${k}`, p.traits[k].mean])),
  };
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
      // Over the runs that report it (e.g. trait means only exist while something is alive).
      const vals = byVariant(v).flatMap((r) => (key in r.metrics ? [r.metrics[key]] : []));
      return vals.reduce((a, x) => a + x, 0) / Math.max(1, vals.length);
    });
    const diffs = variants.slice(1).map((v) => {
      const pairs = byVariant(v).flatMap((r) => {
        const b = results.find((x) => x.variant === base && x.seed === r.seed);
        // Only seeds where both report it (n in the "higher in" count).
        return b && key in r.metrics && key in b.metrics ? [r.metrics[key] - b.metrics[key]] : [];
      });
      const d = pairs.reduce((a, x) => a + x, 0) / Math.max(1, pairs.length);
      const higher = pairs.filter((x) => x > 0).length;
      return `${d >= 0 ? '+' : ''}${fmt(d)} (${higher}/${pairs.length})`;
    });
    lines.push([key, ...means.map(fmt), ...diffs].join(' | '));
  }
  // The ship-on gate in WORLD_RULES.md, against the first variant (the switch off).
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length === 0 ? NaN : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  lines.push('', `Ship-on gate vs ${base}: median per-seed ratio (avgPop ≥ 0.8, leanLow ≥ 0.7); new extinctions (finalPop 0 where ${base} survived)`);
  for (const v of variants.slice(1)) {
    const ratios = (key: string) =>
      byVariant(v).flatMap((r) => {
        const b = results.find((x) => x.variant === base && x.seed === r.seed);
        return b && key in r.metrics && b.metrics[key] > 0 ? [r.metrics[key] / b.metrics[key]] : [];
      });
    const extinct = byVariant(v)
      .filter((r) => r.metrics.finalPop === 0 && (results.find((x) => x.variant === base && x.seed === r.seed)?.metrics.finalPop ?? 0) > 0)
      .map((r) => r.seed);
    const pop = median(ratios('avgPop'));
    const lean = median(ratios('leanLow'));
    // No leanLow when the run is shorter than a season; the gate then rests on the rest.
    const pass = pop >= 0.8 && (Number.isNaN(lean) || lean >= 0.7) && extinct.length === 0;
    lines.push(`${v}: avgPop ${fmt(pop)}, leanLow ${Number.isNaN(lean) ? 'n/a' : fmt(lean)}, new extinctions ${extinct.length ? `seeds ${extinct.join(',')}` : 'none'} → ${pass ? 'PASS' : 'FAIL'}`);
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
  // --arm name=k:v,k:v (repeatable) names variants that set several keys at once, in place of --compare.
  const arms: { name: string; overrides: Overrides }[] = [];
  args.forEach((a, i) => {
    if (a !== '--arm') return;
    const [name, spec] = args[i + 1].split('=');
    arms.push({ name, overrides: Object.fromEntries(spec.split(',').map((kv) => { const [k, v] = kv.split(':'); return [k, parseValue(v)]; })) });
  });
  const compare = arms.length > 0 ? 'arm=' + arms.map((a) => a.name).join(',') : get('--compare');
  if (!compare || !compare.includes('=')) {
    console.error('Usage: npm run experiment -- --compare key=a,b | --arm name=k:v,k:v --arm ... [--set key=value] [--seeds 1-8] [--ticks 10000] [--workers 3] [--json out.json] [--from saved.json]');
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
  const from = get('--from');
  if (from) {
    const state = readWorldState(from); // fail early on a bad file
    console.log(`Starting every run from ${from} (tick ${state.tick}, ${state.organisms.length} organisms)`);
  }

  const jobs: Job[] = seeds.flatMap((seed) =>
    variants.map((variant) => ({
      seed,
      variant,
      ticks,
      from,
      overrides: { ...fixed, ...(arms.length > 0 ? arms.find((a) => a.name === variant)!.overrides : Object.fromEntries(compareKey.split('+').map((k) => [k, parseValue(variant)]))) },
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
    writeFileSync(jsonPath, JSON.stringify({ compareKey, variants, fixed, seeds, ticks, from, results }, null, 2));
    console.log(`\nRaw results saved to ${jsonPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
