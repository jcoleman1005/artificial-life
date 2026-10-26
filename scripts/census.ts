// Mutation census for DNA Stage 2: how harmful is a single mutation of an evolved genome?
//
//   npm run census -- [--seeds 1-4] [--ticks 4000] [--mutations 10000] [--arenas 4] [--window 200] [--workers 4]
//                     [--set key=value] [--out docs/experiments/dna-stage2-census]
//
// Per seed, a world with the variation operators on is evolved for --ticks. Then --mutations / seeds
// mutations are sampled (kinds in turn: dose step, key-bit flip, insertion, deletion, duplication), each
// applied to a random living organism's genome. The mutant child and its unmutated parent are each
// run alone through the same fixed test: --arenas small worlds (fixed seeds, the same for every
// organism), --window ticks each. A run's score is the births its founder's line produced (descendants are exact copies, mutation off in the arena); the
// founder's survival is recorded too. Mutants are classed against their parent:
//
//   silent      decodes to exactly the parent's phenotype (no need to run it)
//   lethal      dies without ever reproducing in every arena, where the parent scored > 0
//   harmful     scores below the parent by more than the tolerance
//   beneficial  scores above the parent by more than the tolerance
//   neutral     within the tolerance (default ±25% of the parent's births, at least 1 birth)
//
// Parents that score 0 themselves cannot be judged against and are skipped (reported). Raw
// (parent, mutant) scores are saved, so other tolerances can be read off without rerunning.

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { World } from '../src/sim/world';
import { PRNG } from '../src/sim/prng';
import { newMemory } from '../src/sim/memory';
import { decodeOrganismDNA, geneCount, genomeStats, mutateOnce, pointMutationRate, type MutationKind, GENE_WORDS } from '../src/sim/dna';
import type { Organism, SimulationConfig } from '../src/sim/types';

const KINDS: MutationKind[] = ['step', 'keyFlip', 'insert', 'delete', 'duplicate'];

interface Options {
  seed: number;
  ticks: number;
  mutations: number;
  arenas: number;
  window: number;
  overrides: Record<string, string | number | boolean>;
}

interface Record1 {
  kind: MutationKind;
  silent: boolean;
  /** Parent and mutant: mean births, and mean share of the window the founder lived. */
  parentBirths: number;
  parentAlive: number;
  mutantBirths: number;
  mutantAlive: number;
  /** Whether the mutant founder reproduced or survived to the end in at least one arena. */
  mutantEverReproduced: boolean;
}

interface WorkerResult {
  seed: number;
  records: Record1[];
  skippedParents: number;
  genomeLength: { mean: number; sd: number };
  /** Expected mutation events of each kind per birth in this world (for the natural mix). */
  perBirth: Record<MutationKind, number>;
  evolvedPopulation: number;
}

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
  // Descendants are exact copies, so the births of a line measure the founder's genome alone.
  brainMutationRate: 0,
  tagMutationRate: 0,
  traitMutationRate: 0,
  abilityMutationRate: 0,
  dnaInsertionRate: 0,
  dnaDeletionRate: 0,
  dnaDuplicationRate: 0,
  dnaKeyFlipFraction: 0,
};

/** Runs one organism body alone through one arena; returns births and the share of the window the founder lived. */
function arenaRun(template: Organism, body: Partial<Organism>, config: SimulationConfig, arenaSeed: number, window: number) {
  const world = new World({ ...config, ...ARENA, seed: arenaSeed });
  // The first free cell nearest the centre, the same for every organism.
  let x = 12;
  let y = 12;
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

function score(template: Organism, body: Partial<Organism>, config: SimulationConfig, opts: Options) {
  let births = 0;
  let alive = 0;
  let reproducedSomewhere = false;
  for (let a = 0; a < opts.arenas; a++) {
    const r = arenaRun(template, body, config, 7000 + a, opts.window);
    births += r.births;
    alive += r.lived;
    if (r.births > 0 || r.lived >= 1) reproducedSomewhere = true;
  }
  return { births: births / opts.arenas, alive: alive / opts.arenas, ever: reproducedSomewhere };
}

const samePhenotype = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

function runSeed(opts: Options): WorkerResult {
  const config = new World({ seed: opts.seed, ...opts.overrides, dnaEnabled: true, dnaVariationEnabled: true }).config;
  const world = new World(config);
  for (let t = 0; t < opts.ticks && world.organisms.size > 0; t++) world.step();
  const parents = Array.from(world.organisms.values()).filter((o) => o.genome);
  if (parents.length === 0) throw new Error(`seed ${opts.seed}: the world died out before the census`);
  const prng = new PRNG(`census-${opts.seed}`);
  const parentScores = new Map<string, ReturnType<typeof score>>();
  const records: Record1[] = [];
  let skipped = 0;
  const skippedIds = new Set<string>();
  for (let i = 0; records.length < opts.mutations; i++) {
    if (i > opts.mutations * 20) break; // nothing but unusable parents
    const kind = KINDS[i % KINDS.length];
    const parent = prng.choice(parents);
    if (skippedIds.has(parent.id)) continue;
    let base = parentScores.get(parent.id);
    if (!base) {
      base = score(parent, {}, config, opts);
      parentScores.set(parent.id, base);
      if (base.births <= 0) {
        skippedIds.add(parent.id);
        skipped++;
        continue;
      }
    }
    const genome = mutateOnce(parent.genome!, kind, config, prng);
    const phenotype = decodeOrganismDNA(genome, config);
    const silent = samePhenotype(phenotype, decodeOrganismDNA(parent.genome!, config));
    const mutant = silent ? base : score(parent, { ...phenotype, genome }, config, opts);
    records.push({
      kind,
      silent,
      parentBirths: base.births,
      parentAlive: base.alive,
      mutantBirths: mutant.births,
      mutantAlive: mutant.alive,
      mutantEverReproduced: mutant.ever,
    });
  }
  const stats = genomeStats(parents.map((o) => o.genome!), config);
  const n = stats.meanLength;
  let pointRate = 0;
  const sample = parents[0].genome!;
  for (let g = 0; g < geneCount(sample); g++) pointRate += pointMutationRate(sample[g * GENE_WORDS], config);
  return {
    seed: opts.seed,
    records,
    skippedParents: skipped,
    genomeLength: { mean: stats.meanLength, sd: stats.sdLength },
    perBirth: {
      step: pointRate * (1 - config.dnaKeyFlipFraction),
      keyFlip: pointRate * config.dnaKeyFlipFraction,
      insert: config.dnaInsertionRate * n,
      delete: config.dnaDeletionRate * n,
      duplicate: config.dnaDuplicationRate * n,
    },
    evolvedPopulation: parents.length,
  };
}

type Verdict = 'silent' | 'lethal' | 'harmful' | 'neutral' | 'beneficial';
const VERDICTS: Verdict[] = ['silent', 'lethal', 'harmful', 'neutral', 'beneficial'];

function classify(r: Record1, tolerance: number): Verdict {
  if (r.silent) return 'silent';
  if (!r.mutantEverReproduced && r.mutantBirths === 0 && r.mutantAlive < 1) return 'lethal';
  const band = Math.max(1, tolerance * r.parentBirths);
  const d = r.mutantBirths - r.parentBirths;
  return d < -band ? 'harmful' : d > band ? 'beneficial' : 'neutral';
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function table(records: Record1[], tolerance: number, weights?: Record<MutationKind, number>): string[] {
  const lines = ['kind | n | ' + VERDICTS.join(' | '), ['---', '---', ...VERDICTS.map(() => '---')].join(' | ')];
  const share = (rs: Record1[]) => VERDICTS.map((v) => rs.filter((r) => classify(r, tolerance) === v).length / Math.max(1, rs.length));
  for (const kind of KINDS) {
    const rs = records.filter((r) => r.kind === kind);
    lines.push([kind, rs.length, ...share(rs).map(pct)].join(' | '));
  }
  lines.push(['ALL (equal quota per kind)', records.length, ...share(records).map(pct)].join(' | '));
  if (weights) {
    // Weighted by how often each kind happens per birth.
    const total = KINDS.reduce((a, k) => a + weights[k], 0);
    const mix = VERDICTS.map((v) =>
      KINDS.reduce((a, k) => {
        const rs = records.filter((r) => r.kind === k);
        return a + (weights[k] / total) * (rs.filter((r) => classify(r, tolerance) === v).length / Math.max(1, rs.length));
      }, 0)
    );
    lines.push(['NATURAL MIX (by events per birth)', '', ...mix.map(pct)].join(' | '));
  }
  return lines;
}

async function main() {
  const args = process.argv.slice(2);
  const get = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const parseValue = (raw: string): string | number | boolean => (raw === 'true' ? true : raw === 'false' ? false : raw.trim() !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw);
  const overrides: Options['overrides'] = {};
  args.forEach((a, i) => {
    if (a === '--set') {
      const [k, v] = args[i + 1].split('=');
      overrides[k] = parseValue(v);
    }
  });
  const jobArg = args.indexOf('--job');
  if (jobArg >= 0) {
    console.log(JSON.stringify(runSeed(JSON.parse(args[jobArg + 1]) as Options)));
    return;
  }
  const seedSpec = get('--seeds', '1-4');
  const seeds = seedSpec.split(',').flatMap((part) => {
    const [a, b] = part.split('-').map(Number);
    return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
  const mutations = Number(get('--mutations', '10000'));
  const ticks = Number(get('--ticks', '4000'));
  const arenas = Number(get('--arenas', '4'));
  const window = Number(get('--window', '200'));
  const tolerance = Number(get('--tolerance', '0.25'));
  const out = get('--out', 'docs/experiments/dna-stage2-census');
  const jobs: Options[] = seeds.map((seed, i) => ({
    seed,
    ticks,
    arenas,
    window,
    overrides,
    mutations: Math.floor(mutations / seeds.length) + (i < mutations % seeds.length ? 1 : 0),
  }));
  console.log(`${mutations} mutations over ${seeds.length} evolved worlds (${ticks} ticks), ${arenas} arenas × ${window} ticks per test`);
  const started = Date.now();
  const results = await Promise.all(
    jobs.map(
      (job) =>
        new Promise<WorkerResult>((resolve, reject) => {
          const child = spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', 'scripts/census.ts', '--', '--job', JSON.stringify(job)], { stdio: ['ignore', 'pipe', 'inherit'] });
          let buffer = '';
          child.stdout.on('data', (c: Buffer) => (buffer += c.toString()));
          child.on('close', (code) => {
            const line = buffer.split('\n').find((l) => l.startsWith('{'));
            if (code === 0 && line) {
              console.log(`  done: seed ${job.seed}`);
              resolve(JSON.parse(line) as WorkerResult);
            } else reject(new Error(`seed ${job.seed}: worker exited ${code}`));
          });
        })
    )
  );
  const records = results.flatMap((r) => r.records);
  const weights = Object.fromEntries(KINDS.map((k) => [k, results.reduce((a, r) => a + r.perBirth[k], 0) / results.length])) as Record<MutationKind, number>;
  const lines = [
    `Mutation census: ${records.length} mutations of evolved genomes, ${seeds.length} worlds (seeds ${seedSpec}), evolved ${ticks} ticks with the variation operators on.`,
    `Test: ${arenas} fixed 24×24 arenas × ${window} ticks, mutant child alone; score = births of its line. Tolerance ±${pct(tolerance)} of the parent's births (min 1).`,
    `Parents skipped (scored 0 themselves): ${results.reduce((a, r) => a + r.skippedParents, 0)}. Evolved genome length: ${results.map((r) => `${r.genomeLength.mean.toFixed(0)}±${r.genomeLength.sd.toFixed(0)}`).join(', ')}.`,
    `Events per birth (natural mix weights): ${KINDS.map((k) => `${k} ${weights[k].toFixed(3)}`).join(', ')}.`,
    '',
    ...table(records, tolerance, weights),
    '',
    'Sensitivity to the tolerance (natural mix):',
    ['tolerance', ...VERDICTS].join(' | '),
    ['---', ...VERDICTS.map(() => '---')].join(' | '),
    ...[0.1, 0.25, 0.5].map((tol) => {
      const total = KINDS.reduce((a, k) => a + weights[k], 0);
      const cells = VERDICTS.map((v) =>
        KINDS.reduce((a, k) => {
          const rs = records.filter((r) => r.kind === k);
          return a + (weights[k] / total) * (rs.filter((r) => classify(r, tol) === v).length / Math.max(1, rs.length));
        }, 0)
      );
      return [pct(tol), ...cells.map(pct)].join(' | ');
    }),
    '',
    `Finished in ${((Date.now() - started) / 60000).toFixed(1)} min.`,
  ];
  console.log('\n' + lines.join('\n'));
  writeFileSync(`${out}.txt`, lines.join('\n') + '\n');
  writeFileSync(`${out}.json`, JSON.stringify({ seeds, ticks, arenas, window, tolerance, overrides, weights, results }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
