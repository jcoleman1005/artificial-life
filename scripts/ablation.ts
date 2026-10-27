// Ablation assay for DNA Stage 3 (growable brain): does an organism's acquired brain topology matter?
//
//   npm run ablation -- [--seeds 1-8] [--ticks 5000] [--replicates 10] [--window 500]
//                       [--sample 40] [--arenas 4] [--arena-window 200] [--early 100] [--level all|units] [--workers 4]
//                       [--set key=value] [--out docs/experiments/dna-stage3-ablation]
//
// Per seed, a world with dnaEnabled, dnaVariationEnabled and dnaGrowableBrain on (plus any --set) is
// evolved for --ticks. A seed that dies out, or where no organism has an acquired hidden unit
// (circuit.acquiredUnits > 0), is reported and skipped. The cohort is every living organism with
// acquired connections (circuit.acquiredConnections > 0). "Ablating" an organism replaces its genome
// with stripAcquiredTopology(genome, config, --level): 'all' (default) removes every brain gene the
// growable-off decode ignores (genes on units >= 6 and wrapped keys, which the growable brain folds onto
// canonical slots), so the circuit then scores exactly as the dense brain; 'units' removes only genes on
// units >= 6 (wrapped keys landing on canonical slots stay). Either way its dense brain and every other
// trait are unchanged (checked), and its children inherit the stripped genome.
//
// B1, in situ (the main measure). For each of --replicates replicates (own seeded split, own world
// random stream): the cohort is split at random into two equal halves; the evolved world is restored
// (exportState -> JSON -> fromState, reseeded with the replicate's stream), one half is ablated, the
// other left intact, and the world runs --window ticks. A SHAM run uses the same split and the same
// stream but ablates nobody: it is the chance baseline for half-vs-half differences. Per half:
//   survival   share of the half's original members alive at the end
//   survivalEarly  the same after --early ticks (lifespans are often shorter than the window)
//   energy     mean member energy over the window, a dead member counting 0
//   births     children with a half member as either parent
//   descAlive  living descendants (any depth, through either parent) at the end, members excluded
// The reported difference is intact - ablated (in the sham, the would-be-intact half minus the
// would-be-ablated half). "ablation effect" = ablation diff - sham diff, paired by replicate, with an
// exact sign-flip permutation p-value (two-sided) over replicates.
//
// B2, standardized. --sample cohort organisms are each run alone, intact and ablated, through the same
// --arenas fixed 24x24 arenas × --arena-window ticks as the mutation census (scripts/census.ts), with
// mutation off. Score = births of the founder's line, and the share of the window the founder lived.
//
// Note: an ablated organism also stops paying dnaUpkeepPerConnection for its acquired connections and
// dnaUpkeepPerGene for the removed genes, a small energy advantage for it.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { World, type WorldState } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { newMemory } from '../src/sim/memory';
import { BRAIN_HIDDEN } from '../src/sim/brain';
import { decodeOrganismDNA, genomeStats, stripAcquiredTopology } from '../src/sim/dna';
import type { Organism, SimulationConfig } from '../src/sim/types';

type Overrides = Record<string, string | number | boolean>;

interface Options {
  seed: number;
  ticks: number;
  replicates: number;
  window: number;
  sample: number;
  arenas: number;
  arenaWindow: number;
  early: number;
  level: 'all' | 'units';
  overrides: Overrides;
}

const MEASURES = ['survivalEarly', 'survival', 'energy', 'births', 'descAlive'] as const;
type Measure = (typeof MEASURES)[number];
type HalfResult = Record<Measure, number>;

interface Replicate {
  ablated: { intact: HalfResult; ablated: HalfResult };
  sham: { intact: HalfResult; ablated: HalfResult };
}

interface SeedResult {
  seed: number;
  status: 'ok' | 'extinct' | 'no-acquired' | 'cohort-too-small';
  population: number;
  withAcquiredUnits: number;
  cohort: number;
  half: number;
  genomeLength?: { mean: number; sd: number };
  topology?: {
    meanAcquiredUnits: number;
    meanAcquiredConnections: number;
    meanConnections: number;
    /** Acquired units across the cohort: evaluated (have inputs), kept constant, folded into the output bias. */
    liveUnits: number;
    constantUnits: number;
    foldedUnits: number;
    /** Genes removed by the 'all' strip, mean per cohort member. */
    meanGenesRemoved: number;
  };
  /** Cohort members whose stripped genome failed the consistency checks (should be 0). */
  inconsistent: number;
  replicates: Replicate[];
  arena: { intactBirths: number; ablatedBirths: number; intactAlive: number; ablatedAlive: number }[];
  minutes: number;
}

// --------------------------------------------------------------------------- B2 arena (as scripts/census.ts)

const ARENA: Partial<SimulationConfig> = {
  gridWidth: 24,
  gridHeight: 24,
  initialOrganisms: 0,
  initialFoodPatches: 12,
  maxFoodPatches: 16,
  foodRegionCount: 2,
  foodRegionRadius: 6,
  seasonLength: 0,
  windfallsEnabled: false,
  immigrationEnabled: false,
  brainMutationRate: 0,
  tagMutationRate: 0,
  traitMutationRate: 0,
  abilityMutationRate: 0,
  dnaInsertionRate: 0,
  dnaDeletionRate: 0,
  dnaDuplicationRate: 0,
  dnaKeyFlipFraction: 0,
};

function arenaRun(template: Organism, body: Partial<Organism>, config: SimulationConfig, arenaSeed: number, window: number) {
  const world = new World({ ...config, ...ARENA, seed: arenaSeed });
  let x = 12;
  const y = 12;
  while (world.obstacles.has(`${x},${y}`)) x++;
  const id = 'subject';
  const organism: Organism = {
    ...template,
    ...body,
    id,
    x,
    y,
    energy: config.initialEnergy,
    memory: newMemory(x, y),
    kills: 0,
    lineage: { id: 'lineage-subject', parentId: null, generation: 1, birthTick: 0 },
    age: 0,
    offspringCount: 0,
    foodEatenCount: 0,
    carriedFood: 0,
    foodGiven: 0,
    foodReceived: 0,
    signalTick: -1,
    recentHistory: [],
  };
  world.organisms.set(id, organism);
  let lived = window;
  for (let t = 1; t <= window; t++) {
    world.step();
    if (!world.organisms.has(id)) {
      lived = t;
      break;
    }
  }
  return { births: world.birthsTotal, lived: lived / window };
}

function arenaScore(template: Organism, body: Partial<Organism>, config: SimulationConfig, opts: Options) {
  let births = 0;
  let alive = 0;
  for (let a = 0; a < opts.arenas; a++) {
    const r = arenaRun(template, body, config, 7000 + a, opts.arenaWindow);
    births += r.births;
    alive += r.lived;
  }
  return { births: births / opts.arenas, alive: alive / opts.arenas };
}

// --------------------------------------------------------------------------- B1 in situ

const plain = (_key: string, value: unknown) => (ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value);

function runHalves(saved: string, ablateIds: readonly string[], intactIds: readonly string[], ablate: boolean, stream: number, config: SimulationConfig, opts: Options) {
  const window = opts.window;
  const loaded = JSON.parse(saved) as WorldState;
  const toAblate = new Set(ablateIds);
  const state: WorldState = {
    ...loaded,
    organisms: ablate
      ? loaded.organisms.map((o) => (toAblate.has(o.id) && o.genome ? { ...o, genome: Array.from(stripAcquiredTopology(o.genome, config, opts.level)) } : o))
      : loaded.organisms,
    prng: { seed: stream, state: stream >>> 0 || 1 },
  };
  const world = World.fromState(state);
  if (ablate) {
    for (const id of ablateIds) {
      const c = world.organisms.get(id)?.circuit;
      if (!c || c.acquiredConnections !== 0 || c.acquiredUnits !== 0) throw new Error(`ablated ${id} still has acquired topology after load`);
    }
  }
  const halves = [ablateIds, intactIds].map((ids) => ({
    members: new Set(ids),
    line: new Set(ids),
    births: 0,
    energySum: 0,
    aliveEarly: 0,
  }));
  const seen = new Set(world.organisms.keys());
  for (let t = 0; t < window; t++) {
    world.step();
    for (const o of world.organisms.values()) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      const p = o.lineage.parentId;
      const m = o.lineage.mateId;
      for (const h of halves) {
        if ((p && h.members.has(p)) || (m && h.members.has(m))) h.births++;
        if ((p && h.line.has(p)) || (m && h.line.has(m))) h.line.add(o.id);
      }
    }
    for (const h of halves) {
      let e = 0;
      for (const id of h.members) e += world.organisms.get(id)?.energy ?? 0;
      h.energySum += e / h.members.size;
      if (t + 1 === Math.min(opts.early, window)) for (const id of h.members) if (world.organisms.has(id)) h.aliveEarly++;
    }
  }
  const result = halves.map((h): HalfResult => {
    let alive = 0;
    let desc = 0;
    for (const id of h.line) {
      if (!world.organisms.has(id)) continue;
      if (h.members.has(id)) alive++;
      else desc++;
    }
    return { survivalEarly: h.aliveEarly / h.members.size, survival: alive / h.members.size, energy: h.energySum / window, births: h.births, descAlive: desc };
  });
  return { ablated: result[0], intact: result[1] };
}

function runSeed(opts: Options): SeedResult {
  const started = Date.now();
  const config = new World({ seed: opts.seed, ...opts.overrides, dnaEnabled: true, dnaVariationEnabled: true, dnaGrowableBrain: true }).config;
  const world = new World(config);
  for (let t = 0; t < opts.ticks && world.organisms.size > 0; t++) world.step();
  const living = Array.from(world.organisms.values());
  const base: SeedResult = {
    seed: opts.seed,
    status: 'ok',
    population: living.length,
    withAcquiredUnits: living.filter((o) => (o.circuit?.acquiredUnits ?? 0) > 0).length,
    cohort: 0,
    half: 0,
    inconsistent: 0,
    replicates: [],
    arena: [],
    minutes: 0,
  };
  const done = (status: SeedResult['status']) => ({ ...base, status, minutes: (Date.now() - started) / 60000 });
  if (living.length === 0) return done('extinct');
  base.genomeLength = (({ meanLength, sdLength }) => ({ mean: meanLength, sd: sdLength }))(genomeStats(living.flatMap((o) => (o.genome ? [o.genome] : [])), config));
  if (base.withAcquiredUnits === 0) return done('no-acquired');
  const cohort = living.filter((o) => o.genome && o.circuit && o.circuit.acquiredConnections > 0);
  base.cohort = cohort.length;
  base.half = Math.floor(cohort.length / 2);

  // Topology of the cohort, and consistency of each stripped genome.
  let units = 0;
  let acq = 0;
  let conns = 0;
  let live = 0;
  let constant = 0;
  let removed = 0;
  for (const o of cohort) {
    const c = o.circuit!;
    units += c.acquiredUnits;
    acq += c.acquiredConnections;
    conns += c.connections;
    for (let u = 0; u < c.unitId.length; u++) {
      if (c.unitId[u] < BRAIN_HIDDEN) continue;
      if (c.unitStart[u + 1] > c.unitStart[u]) live++;
      else constant++;
    }
    const stripped = stripAcquiredTopology(o.genome!, config, opts.level);
    removed += (o.genome!.length - stripped.length) / 3;
    const before = decodeOrganismDNA(o.genome!, config);
    const after = decodeOrganismDNA(stripped, config);
    const { circuit: c0, ...restBefore } = before;
    const { circuit: c1, ...restAfter } = after;
    const ok =
      JSON.stringify(restBefore, plain) === JSON.stringify(restAfter, plain) &&
      JSON.stringify(after.brain, plain) === JSON.stringify(o.brain, plain) &&
      c0 !== undefined &&
      c1 !== undefined &&
      c1.acquiredConnections === 0 &&
      c1.acquiredUnits === 0;
    if (!ok) base.inconsistent++;
  }
  base.topology = {
    meanAcquiredUnits: units / cohort.length,
    meanAcquiredConnections: acq / cohort.length,
    meanConnections: conns / cohort.length,
    liveUnits: live,
    constantUnits: constant,
    foldedUnits: units - live - constant,
    meanGenesRemoved: removed / cohort.length,
  };
  if (base.half < 2) return done('cohort-too-small');

  // B1.
  const saved = JSON.stringify(world.exportState());
  const ids = cohort.map((o) => o.id);
  for (let r = 0; r < opts.replicates; r++) {
    const prng = new PRNG(`ablation-${opts.seed}-${r}`);
    const order = prng.shuffle([...ids]);
    const ablateIds = order.slice(0, base.half);
    const intactIds = order.slice(base.half, 2 * base.half);
    const stream = (opts.seed * 1000 + r + 1) >>> 0;
    base.replicates.push({
      ablated: runHalves(saved, ablateIds, intactIds, true, stream, config, opts),
      sham: runHalves(saved, ablateIds, intactIds, false, stream, config, opts),
    });
  }

  // B2.
  const prng = new PRNG(`ablation-arena-${opts.seed}`);
  const sample = prng.shuffle([...cohort]).slice(0, opts.sample);
  for (const o of sample) {
    const stripped = stripAcquiredTopology(o.genome!, config, opts.level);
    const intact = arenaScore(o, {}, config, opts);
    const ablated = arenaScore(o, { ...decodeOrganismDNA(stripped, config), genome: stripped }, config, opts);
    base.arena.push({ intactBirths: intact.births, ablatedBirths: ablated.births, intactAlive: intact.alive, ablatedAlive: ablated.alive });
  }
  return { ...base, minutes: (Date.now() - started) / 60000 };
}

// --------------------------------------------------------------------------- statistics and report

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: readonly number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Two-sided sign-flip permutation p-value for mean(d) = 0 (exact up to 2^16 flips, else 20000 random). */
function signFlipP(d: readonly number[], prng: PRNG): number {
  const n = d.length;
  if (n === 0) return NaN;
  const obs = Math.abs(d.reduce((a, b) => a + b, 0));
  let extreme = 0;
  let total = 0;
  const test = (signs: (i: number) => number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += signs(i) * d[i];
    total++;
    if (Math.abs(s) >= obs - 1e-12) extreme++;
  };
  if (n <= 16) for (let mask = 0; mask < 1 << n; mask++) test((i) => ((mask >> i) & 1 ? -1 : 1));
  else for (let k = 0; k < 20000; k++) test(() => (prng.next() < 0.5 ? -1 : 1));
  return extreme / total;
}

const f = (x: number, digits = 2) => (Number.isFinite(x) ? x.toFixed(digits) : '-');
const pm = (xs: readonly number[], digits = 2) => `${f(mean(xs), digits)} ± ${f(sd(xs), digits)}`;
const share = (xs: readonly number[]) => `${xs.filter((x) => x > 0).length}/${xs.length}`;
const DIGITS: Record<Measure, number> = { survivalEarly: 3, survival: 3, energy: 2, births: 1, descAlive: 1 };

function report(results: SeedResult[], opts: Omit<Options, 'seed'>, seedSpec: string, minutes: number): string[] {
  const prng = new PRNG('ablation-report');
  const ok = results.filter((r) => r.status === 'ok');
  const lines: string[] = [
    `Ablation assay, DNA Stage 3 (growable brain). Seeds ${seedSpec}; each evolved ${opts.ticks} ticks with dnaEnabled, dnaVariationEnabled, dnaGrowableBrain on${Object.keys(opts.overrides).length ? `, plus ${JSON.stringify(opts.overrides)}` : ''}.`,
    `Ablation: genome -> stripAcquiredTopology(genome, '${opts.level}')${opts.level === 'all' ? ' (genes on units >= 6 and wrapped keys)' : ' (genes on units >= 6 only; wrapped keys kept)'}; dense brain and other traits unchanged; children inherit the stripped genome.`,
    `survivalEarly = share of original half members alive after ${opts.early} ticks; survival = at the end of the window.`,
    `Cohort: living organisms with acquired connections > 0. B1: ${opts.replicates} replicates × ${opts.window} ticks, cohort split in two equal random halves, one ablated; sham = same split and stream, nobody ablated.`,
    `B2: up to ${opts.sample} cohort organisms per seed alone in ${opts.arenas} fixed 24×24 arenas × ${opts.arenaWindow} ticks, mutation off, intact vs ablated.`,
    `Caveat: ablated organisms save dnaUpkeepPerConnection on their acquired connections and dnaUpkeepPerGene on removed genes (a small energy advantage).`,
    '',
    '## Seeds and topology',
    'seed | status | pop | with acquired units | cohort | half | genome length | acq units/member | acq conns/member | conns/member | acquired units live / constant / folded | genes removed/member | inconsistent',
    '--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---',
  ];
  for (const r of results) {
    const t = r.topology;
    lines.push(
      [
        r.seed,
        r.status,
        r.population,
        r.withAcquiredUnits,
        r.cohort,
        r.half,
        r.genomeLength ? `${f(r.genomeLength.mean, 0)}±${f(r.genomeLength.sd, 0)}` : '-',
        t ? f(t.meanAcquiredUnits) : '-',
        t ? f(t.meanAcquiredConnections) : '-',
        t ? f(t.meanConnections, 1) : '-',
        t ? `${t.liveUnits} / ${t.constantUnits} / ${t.foldedUnits}` : '-',
        t ? f(t.meanGenesRemoved, 1) : '-',
        r.inconsistent,
      ].join(' | ')
    );
  }
  lines.push('', '## B1 in situ: intact − ablated half, per seed (mean ± sd over replicates)');
  lines.push('effect = ablation diff − sham diff, paired by replicate; + means ablation hurt the ablated half. p = exact sign-flip test on the paired effects.');
  const pooled = Object.fromEntries(MEASURES.map((m) => [m, [] as number[]])) as Record<Measure, number[]>;
  for (const m of MEASURES) {
    lines.push('', `### ${m}`, 'seed | ablation: intact−ablated | intact>ablated | sham: diff | sham >0 | effect | effect >0 | p', '--- | --- | --- | --- | --- | --- | --- | ---');
    for (const r of ok) {
      const ab = r.replicates.map((x) => x.ablated.intact[m] - x.ablated.ablated[m]);
      const sh = r.replicates.map((x) => x.sham.intact[m] - x.sham.ablated[m]);
      const eff = ab.map((x, i) => x - sh[i]);
      // Normalise per seed by the sham sd (or 1) before pooling, so big worlds don't dominate.
      const scale = sd(sh) || 1;
      pooled[m].push(mean(eff) / scale);
      lines.push([r.seed, pm(ab, DIGITS[m]), share(ab), pm(sh, DIGITS[m]), share(sh), pm(eff, DIGITS[m]), share(eff), f(signFlipP(eff, prng), 3)].join(' | '));
    }
  }
  lines.push('', '### Across seeds', 'measure | seeds with effect > 0 | mean standardized effect (per-seed mean effect / sham sd) | sign-flip p over seeds', '--- | --- | --- | ---');
  for (const m of MEASURES) lines.push([m, share(pooled[m]), f(mean(pooled[m])), f(signFlipP(pooled[m], prng), 3)].join(' | '));

  lines.push('', '### Raw half means (ablation runs, then sham runs)', 'seed | measure | intact | ablated | sham intact | sham ablated', '--- | --- | --- | --- | --- | ---');
  for (const r of ok)
    for (const m of MEASURES)
      lines.push(
        [
          r.seed,
          m,
          f(mean(r.replicates.map((x) => x.ablated.intact[m])), DIGITS[m]),
          f(mean(r.replicates.map((x) => x.ablated.ablated[m])), DIGITS[m]),
          f(mean(r.replicates.map((x) => x.sham.intact[m])), DIGITS[m]),
          f(mean(r.replicates.map((x) => x.sham.ablated[m])), DIGITS[m]),
        ].join(' | ')
      );

  lines.push('', '## B2 standardized arenas: intact − ablated, paired per organism', 'seed | n | intact births | ablated births | diff births | intact>ablated | ablated>intact | p (births) | diff alive share | p (alive)', '--- | --- | --- | --- | --- | --- | --- | --- | --- | ---');
  const allB: number[] = [];
  const allA: number[] = [];
  for (const r of ok) {
    const db = r.arena.map((a) => a.intactBirths - a.ablatedBirths);
    const da = r.arena.map((a) => a.intactAlive - a.ablatedAlive);
    allB.push(...db);
    allA.push(...da);
    lines.push(
      [
        r.seed,
        r.arena.length,
        f(mean(r.arena.map((a) => a.intactBirths))),
        f(mean(r.arena.map((a) => a.ablatedBirths))),
        pm(db),
        share(db),
        share(db.map((x) => -x)),
        f(signFlipP(db, prng), 3),
        pm(da, 3),
        f(signFlipP(da, prng), 3),
      ].join(' | ')
    );
  }
  lines.push(['ALL', allB.length, '', '', pm(allB), share(allB), share(allB.map((x) => -x)), f(signFlipP(allB, prng), 3), pm(allA, 3), f(signFlipP(allA, prng), 3)].join(' | '));
  lines.push('', `Finished in ${minutes.toFixed(1)} min (per seed: ${results.map((r) => `${r.seed}: ${r.minutes.toFixed(1)}`).join(', ')}).`);
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const jobArg = args.indexOf('--job');
  if (jobArg >= 0) {
    console.log(JSON.stringify(runSeed(JSON.parse(args[jobArg + 1]) as Options)));
    return;
  }
  const parseValue = (raw: string): string | number | boolean => (raw === 'true' ? true : raw === 'false' ? false : raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw);
  const overrides: Overrides = {};
  args.forEach((a, i) => {
    if (a === '--set') {
      const [k, v] = args[i + 1].split('=');
      overrides[k] = parseValue(v);
    }
  });
  const seedSpec = get('--seeds', '1-8');
  const seeds = seedSpec.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
  const common = {
    ticks: Number(get('--ticks', '5000')),
    replicates: Number(get('--replicates', '10')),
    window: Number(get('--window', '500')),
    sample: Number(get('--sample', '40')),
    arenas: Number(get('--arenas', '4')),
    arenaWindow: Number(get('--arena-window', '200')),
    early: Number(get('--early', '100')),
    level: (get('--level', 'all') === 'units' ? 'units' : 'all') as Options['level'],
    overrides,
  };
  const workers = Math.max(1, Number(get('--workers', '4')));
  const out = get('--out', 'docs/experiments/dna-stage3-ablation');
  console.log(`Ablation (${common.level}): ${seeds.length} seeds, ${common.ticks} ticks, ${common.replicates} replicates × ${common.window} ticks, ${workers} workers`);
  const started = Date.now();
  const queue = seeds.map((seed): Options => ({ seed, ...common }));
  const results: SeedResult[] = [];
  const runOne = (job: Options) =>
    new Promise<void>((resolve) => {
      const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/ablation.ts', '--', '--job', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buffer = '';
      child.stdout.on('data', (c: Buffer) => (buffer += c.toString()));
      child.on('close', (code) => {
        const line = buffer.split('\n').find((l) => l.startsWith('{'));
        if (code === 0 && line) {
          const r = JSON.parse(line) as SeedResult;
          console.log(`  done: seed ${job.seed} (${r.status}, ${r.minutes.toFixed(1)} min)`);
          results.push(r);
        } else console.log(`  failed: seed ${job.seed} (worker exited ${code})`);
        resolve();
      });
    });
  await Promise.all(
    Array.from({ length: Math.min(workers, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await runOne(job);
    })
  );
  results.sort((a, b) => a.seed - b.seed);
  const lines = report(results, common, seedSpec, (Date.now() - started) / 60000);
  console.log('\n' + lines.join('\n'));
  writeFileSync(`${out}.txt`, lines.join('\n') + '\n');
  writeFileSync(`${out}.json`, JSON.stringify({ seeds, ...common, results }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
