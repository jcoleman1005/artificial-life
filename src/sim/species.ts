/**
 * Species detection (docs/specs/species.md). An OBSERVER: it reads the
 * living organisms, draws no random numbers and changes nothing in the
 * world, so it cannot move `stateHash()` or `npm run fingerprint`.
 *
 * A species is a cluster of organisms close in genome, with a stable id and
 * name. Every `speciesInterval` ticks the tracker:
 *   1. assigns each organism to the nearest stored species representative
 *      within `speciesThreshold`;
 *   2. clusters the leftovers greedily (leader clustering in organism-id
 *      order, no PRNG) into candidates; a candidate with >= `speciesMinSize`
 *      members that has stayed distinct for `speciesPersistTicks` becomes a
 *      new species, recording the nearest living species as its parent (a
 *      split). With no living species at all, candidates are promoted at
 *      once as founder species (no parent, no event);
 *   3. retires species that have had no members for `speciesExtinctTicks`;
 *   4. moves each representative to a (sampled) medoid of its members, only
 *      if that is >= MEDOID_HYSTERESIS closer, so ids do not flicker.
 *
 * DISTANCE (`genomeDistance`, in [0, 1]) is a weighted sum of three parts,
 * each itself in [0, 1]:
 *   body  (weight 1 - speciesBrainWeight - speciesTagWeight): the mean of
 *         per-trait |difference| / range over the traits both organisms
 *         have (a trait missing on either, because its gene switch is off,
 *         is skipped). Traits and normalisers (range from config):
 *           carnivory, herbivory            0..1
 *           size                            sizeMin..sizeMax
 *           sensingRadius                   sensingMin..sensingMax
 *           metabolicRate                   metabolismMin..metabolismMax
 *           digestiveEfficiency             digestiveMin..digestiveMax
 *           clutchSize                      clutchMin..clutchMax
 *           dispersal                       1..maxDispersal
 *           carryCapacity                   0..maxCarryCapacity
 *           memorySpan                      0..maxMemorySpan
 *           abilities diagonal/squeeze/leap 0..1
 *           reproThreshold                  thresholdMin..thresholdMax
 *           investment                      investmentMin..investmentMax
 *           fatCapacity                     0..maxFat
 *           torporDepth, eggAllocation      0..1
 *         These are the decoded body of the organism, so with DNA on they
 *         are the genome's expressed traits, and without DNA the legacy
 *         fields: the same terms either way.
 *   tag   (weight speciesTagWeight): circular hue difference / 180.
 *   brain (weight speciesBrainWeight): root-mean-square difference of the
 *         brain weight vector (skip, hidden, biases, out) divided by
 *         BRAIN_RMS_SCALE and capped at 1; under the dials controller, of
 *         the policy weights divided by DIAL_RMS_SCALE. Because the part is
 *         capped at 1, the brain can never contribute more than its weight.
 *
 * Performance: features are written once per organism per run into one flat
 * Float32Array (no per-pair allocation); pair distance is a typed-array loop.
 * Medoids use at most MEDOID_CANDIDATES candidates against at most
 * MEDOID_SAMPLE members (evenly spaced in id order) to bound the cost.
 */
import type { Organism, SimulationConfig } from './types';
import type { WorldEventBody } from './events';

// ---- Tunables that are not config (documented here, not behavioural) ----
/** Brain weight RMS difference at which the brain part saturates at 1. */
export const BRAIN_RMS_SCALE = 1;
/** Policy weight RMS difference at which the dial part saturates at 1 (weights span [-2, 2]). */
export const DIAL_RMS_SCALE = 2;
/** A representative moves only if the new medoid is this much closer (mean distance to the members). */
export const MEDOID_HYSTERESIS = 0.02;
const MEDOID_CANDIDATES = 24;
const MEDOID_SAMPLE = 48;
/** Samples kept for the stacked chart (one per run). */
export const SPECIES_HISTORY_SIZE = 600;
/** Pool clusters tracked at once. */
const MAX_CANDIDATES = 16;
/** Extinct records kept (oldest dropped first). */
const MAX_EXTINCT_RECORDS = 300;

// ---- Features ----
type Num = number | undefined;
const unit = (v: Num, lo: number, hi: number): number =>
  v === undefined || !(hi > lo) ? NaN : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));

type Term = (o: Readonly<Organism>, c: Readonly<SimulationConfig>) => number;
const TERMS: readonly Term[] = [
  (o) => unit(o.carnivory, 0, 1),
  (o) => unit(o.herbivory, 0, 1),
  (o, c) => unit(o.size, c.sizeMin, c.sizeMax),
  (o, c) => unit(o.sensingRadius, c.sensingMin, c.sensingMax),
  (o, c) => unit(o.metabolicRate, c.metabolismMin, c.metabolismMax),
  (o, c) => unit(o.digestiveEfficiency, c.digestiveMin, c.digestiveMax),
  (o, c) => unit(o.clutchSize, c.clutchMin, c.clutchMax),
  (o, c) => unit(o.dispersal, 1, c.maxDispersal),
  (o, c) => unit(o.carryCapacity, 0, c.maxCarryCapacity),
  (o, c) => unit(o.memorySpan, 0, c.maxMemorySpan),
  (o) => unit(o.abilities?.diagonal, 0, 1),
  (o) => unit(o.abilities?.squeeze, 0, 1),
  (o) => unit(o.abilities?.leap, 0, 1),
  (o, c) => unit(o.reproThreshold, c.thresholdMin, c.thresholdMax),
  (o, c) => unit(o.investment, c.investmentMin, c.investmentMax),
  (o, c) => unit(o.fatCapacity, 0, c.maxFat),
  (o) => unit(o.torporDepth, 0, 1),
  (o) => unit(o.eggAllocation ?? o.eggRate, 0, 1),
];
/** Body terms per row; the tag follows at index BODY, then the brain vector. */
export const BODY = TERMS.length;
const TAG = BODY;
const HEAD = BODY + 1;

/** Length of the brain (or dial) part for an organism under this controller. */
function brainLength(o: Readonly<Organism>, config: Readonly<SimulationConfig>): number {
  if (config.controller === 'brain') {
    const b = o.brain;
    return b.skip.length + b.hidden.length + b.hiddenBias.length + b.out.length + 1;
  }
  return Object.keys(o.policy).length;
}

/** Writes an organism's feature row (body, tag, brain/dials) into `out` at `off`. `width` is the row length. */
export function writeFeatures(
  o: Readonly<Organism>,
  config: Readonly<SimulationConfig>,
  out: Float32Array,
  off: number,
  width: number
): void {
  for (let i = 0; i < BODY; i++) out[off + i] = TERMS[i](o, config);
  out[off + TAG] = o.tag;
  let k = off + HEAD;
  const end = off + width;
  if (config.controller === 'brain') {
    const b = o.brain;
    for (let i = 0; i < b.skip.length && k < end; i++) out[k++] = b.skip[i];
    for (let i = 0; i < b.hidden.length && k < end; i++) out[k++] = b.hidden[i];
    for (let i = 0; i < b.hiddenBias.length && k < end; i++) out[k++] = b.hiddenBias[i];
    for (let i = 0; i < b.out.length && k < end; i++) out[k++] = b.out[i];
    if (k < end) out[k++] = b.outBias;
  } else {
    const p = o.policy as unknown as Record<string, number>;
    for (const key of Object.keys(p)) {
      if (k >= end) break;
      out[k++] = p[key];
    }
  }
  while (k < end) out[k++] = 0;
}

interface Weights {
  readonly body: number;
  readonly tag: number;
  readonly brain: number;
  readonly brainScale: number;
}

function weightsOf(config: Readonly<SimulationConfig>): Weights {
  let brain = Math.max(0, config.speciesBrainWeight);
  let tag = Math.max(0, config.speciesTagWeight);
  const extra = brain + tag;
  if (extra > 1) {
    brain /= extra;
    tag /= extra;
  }
  return { body: 1 - brain - tag, tag, brain, brainScale: config.controller === 'brain' ? BRAIN_RMS_SCALE : DIAL_RMS_SCALE };
}

/** Distance between row `ia` of `a` and row `ib` of `b` (rows `width` long). In [0, 1]. */
function rowDistance(a: Float32Array, ia: number, b: Float32Array, ib: number, width: number, w: Weights): number {
  const oa = ia * width;
  const ob = ib * width;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < BODY; i++) {
    const x = a[oa + i];
    const y = b[ob + i];
    if (x !== x || y !== y) continue; // NaN: trait absent on one side
    sum += Math.abs(x - y);
    n++;
  }
  const body = n > 0 ? sum / n : 0;
  let dh = Math.abs(a[oa + TAG] - b[ob + TAG]) % 360;
  if (dh > 180) dh = 360 - dh;
  const tag = dh / 180;
  let brain = 0;
  const bl = width - HEAD;
  if (bl > 0 && w.brain > 0) {
    let sq = 0;
    for (let i = 0; i < bl; i++) {
      const d = a[oa + HEAD + i] - b[ob + HEAD + i];
      sq += d * d;
    }
    brain = Math.min(1, Math.sqrt(sq / bl) / w.brainScale);
  }
  return w.body * body + w.tag * tag + w.brain * brain;
}

let scratch = new Float32Array(0);
/**
 * Genome distance between two organisms, in [0, 1]: 0 for identical bodies,
 * tags and brains. Symmetric and pure (no PRNG). Uses a module scratch
 * buffer, so repeated calls do not allocate.
 */
export function genomeDistance(a: Readonly<Organism>, b: Readonly<Organism>, config: Readonly<SimulationConfig>): number {
  const width = HEAD + Math.max(brainLength(a, config), brainLength(b, config));
  if (scratch.length < width * 2) scratch = new Float32Array(width * 2);
  writeFeatures(a, config, scratch, 0, width);
  writeFeatures(b, config, scratch, width, width);
  // Row 0 is a (offset 0), row 1 is b (offset `width`).
  return rowDistance(scratch, 0, scratch, 1, width, weightsOf(config));
}

// ---- Names and colours (deterministic from the id, display only) ----
const ONSETS = ['b', 'd', 'f', 'g', 'h', 'k', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'z', 'sh'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o'];
const EPITHETS = ['ensis', 'ia', 'ii', 'oides', 'ella', 'ata', 'inus', 'ula', 'aris', 'ora', 'ides', 'ica'];

function mix(n: number): number {
  let h = (Math.imul(n + 1, 0x9e3779b1) ^ 0x51ed270b) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A pronounceable two-part name, e.g. "Tavelo ensis", fixed by the species id. */
export function speciesName(id: number): string {
  let h = mix(id);
  const pick = <T>(list: readonly T[]): T => {
    const item = list[h % list.length];
    h = Math.floor(h / list.length);
    return item;
  };
  const genus = pick(ONSETS) + pick(VOWELS) + pick(ONSETS) + pick(VOWELS) + pick(['', 'n', 'l', 'x', 'r']);
  return `${genus.charAt(0).toUpperCase()}${genus.slice(1)} ${pick(ONSETS)}${pick(VOWELS)}${pick(['', 'n', 'k', 't'])}${pick(EPITHETS)}`;
}

/** The species swatch hue: the golden angle apart, so consecutive ids look different. */
export function speciesHue(id: number): number {
  return (id * 137.508) % 360;
}

// ---- Public data shapes ----
export interface SpeciesInfo {
  readonly id: number;
  readonly name: string;
  readonly parentId: number | null;
  readonly count: number;
  /** Circular mean of the members' tag hue (the last one seen if none are alive). */
  readonly meanHue: number;
  /** Swatch hue, fixed by the id (see speciesHue). */
  readonly hue: number;
  readonly born: number;
  readonly extinct: number | null;
  readonly peak: number;
}

export interface SpeciesSample {
  readonly tick: number;
  /** [speciesId, count] for each species alive at that run. */
  readonly counts: readonly (readonly [number, number])[];
}

export interface SpeciesSnapshot {
  readonly tick: number;
  /** Living species by size, then the most recent extinct ones. */
  readonly species: readonly SpeciesInfo[];
  /** Counts at each run, oldest first; only when asked for (the Trends tab). */
  readonly history?: readonly SpeciesSample[];
}

/** One species record in a save. Representatives are plain arrays so they survive JSON. */
interface SavedSpecies {
  id: number;
  parentId: number | null;
  born: number;
  extinct: number | null;
  peak: number;
  count: number;
  lastSeen: number;
  meanHue: number;
  rep: (number | null)[]; // null: a trait this organism lacked (NaN does not survive JSON)
}
interface SavedCandidate {
  firstSeen: number;
  count: number;
  rep: (number | null)[];
}
/** The tracker's saved state (an optional field of SavedWorld; older saves lack it and rebuild). */
export interface SpeciesState {
  readonly version: 1;
  readonly nextId: number;
  readonly lastRun: number | null;
  readonly width: number;
  readonly species: readonly SavedSpecies[];
  readonly candidates: readonly SavedCandidate[];
  readonly history: readonly SpeciesSample[];
}

interface Species {
  id: number;
  parentId: number | null;
  born: number;
  extinct: number | null;
  peak: number;
  count: number;
  lastSeen: number;
  meanHue: number;
  rep: Float32Array;
}
interface Candidate {
  firstSeen: number;
  count: number;
  rep: Float32Array;
}

type WorldLike = { readonly organisms: ReadonlyMap<string, Readonly<Organism>>; readonly tick: number; readonly config: Readonly<SimulationConfig> };

const toSaved = (rep: Float32Array): (number | null)[] => Array.from(rep, (v) => (Number.isNaN(v) ? null : v));
const fromSaved = (rep: readonly (number | null)[]): Float32Array => Float32Array.from(rep, (v) => (v === null ? NaN : v));

export class SpeciesTracker {
  private species: Species[] = [];
  private candidates: Candidate[] = [];
  private nextId = 1;
  private lastRun = -Infinity;
  private width = 0;
  private history: SpeciesSample[] = [];
  /** organism id -> species id (0: none) as of the last run, plus births assigned lazily since. */
  private assignment = new Map<string, number>();
  private rows = new Float32Array(0);

  /**
   * Call after every world step (and once at start). Does the clustering
   * every `speciesInterval` ticks; returns the world events found (empty
   * between runs). Disabled by `speciesEnabled: false`.
   */
  public observe(world: WorldLike): WorldEventBody[] {
    const config = world.config;
    if (!config.speciesEnabled) return [];
    const interval = Math.max(1, config.speciesInterval);
    if (world.tick - this.lastRun < interval && this.lastRun <= world.tick) return [];
    return this.run(world);
  }

  /** Drops every species (a reset). */
  public clear(): void {
    this.species = [];
    this.candidates = [];
    this.nextId = 1;
    this.lastRun = -Infinity;
    this.history = [];
    this.assignment = new Map();
  }

  private run(world: WorldLike): WorldEventBody[] {
    const { config, tick } = world;
    const events: WorldEventBody[] = [];
    this.lastRun = tick;
    const orgs = Array.from(world.organisms.values()).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const n = orgs.length;

    let blen = 0;
    for (const o of orgs) blen = Math.max(blen, brainLength(o, config));
    // With nobody alive keep the old layout, so an empty world does not wipe the species list.
    const width = n > 0 ? HEAD + blen : this.width || HEAD;
    if (width !== this.width) {
      // The feature layout changed (controller switched): stored representatives no longer compare. Start over.
      this.species = this.species.filter((s) => s.extinct !== null);
      for (const s of this.species) s.rep = new Float32Array(0);
      this.candidates = [];
      this.width = width;
    }
    if (this.rows.length < n * width) this.rows = new Float32Array(Math.max(n * width, this.rows.length * 2));
    const rows = this.rows;
    for (let i = 0; i < n; i++) writeFeatures(orgs[i], config, rows, i * width, width);
    const w = weightsOf(config);
    const threshold = config.speciesThreshold;

    const living = this.species.filter((s) => s.extinct === null && s.rep.length === width);
    const livingBefore = living.length;

    const assigned = new Int32Array(n).fill(-1); // index into `living`
    const pool: number[] = [];
    for (let i = 0; i < n; i++) {
      let best = -1;
      let bestD = Infinity;
      for (let s = 0; s < living.length; s++) {
        const d = rowDistance(rows, i, living[s].rep, 0, width, w);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      if (best >= 0 && bestD <= threshold) assigned[i] = best;
      else pool.push(i);
    }

    // Pool: match stored candidates first (they keep their first-seen tick), then lead new ones in id order.
    const cands: Candidate[] = this.candidates.map((c) => ({ firstSeen: c.firstSeen, count: 0, rep: c.rep }));
    const candOf = new Int32Array(n).fill(-1);
    for (const i of pool) {
      let best = -1;
      let bestD = Infinity;
      for (let c = 0; c < cands.length; c++) {
        const d = rowDistance(rows, i, cands[c].rep, 0, width, w);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (best >= 0 && bestD <= threshold) {
        candOf[i] = best;
        cands[best].count++;
      } else if (cands.length < MAX_CANDIDATES * 4) {
        cands.push({ firstSeen: tick, count: 1, rep: rows.slice(i * width, (i + 1) * width) });
        candOf[i] = cands.length - 1;
      }
    }

    // Promote persistent candidates to species.
    const bootstrap = livingBefore === 0;
    const promoted = new Map<number, Species>(); // candidate index -> species
    const fresh = new Set<Species>();
    cands.forEach((c, ci) => {
      if (c.count < config.speciesMinSize) return;
      if (!bootstrap && tick - c.firstSeen < config.speciesPersistTicks) return;
      let parent: Species | null = null;
      if (!bootstrap) {
        let bestD = Infinity;
        for (const s of living) {
          const d = this.repDistance(c.rep, s.rep, width, w);
          if (d < bestD) {
            bestD = d;
            parent = s;
          }
        }
      }
      const sp: Species = {
        id: this.nextId++,
        parentId: parent ? parent.id : null,
        born: tick,
        extinct: null,
        peak: 0,
        count: 0,
        lastSeen: tick,
        meanHue: 0,
        rep: c.rep.slice(),
      };
      this.species.push(sp);
      promoted.set(ci, sp);
      fresh.add(sp);
      if (parent) {
        events.push({ kind: 'speciation', speciesId: sp.id, name: speciesName(sp.id), parentId: parent.id, parentName: speciesName(parent.id) });
      }
    });

    // Final membership.
    const members = new Map<Species, number[]>();
    const assignment = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      let sp: Species | undefined;
      if (assigned[i] >= 0) sp = living[assigned[i]];
      else if (candOf[i] >= 0) sp = promoted.get(candOf[i]);
      assignment.set(orgs[i].id, sp ? sp.id : 0);
      if (!sp) continue;
      let list = members.get(sp);
      if (!list) members.set(sp, (list = []));
      list.push(i);
    }
    this.assignment = assignment;

    // Candidates that stay (not promoted, still seen): keep for the persistence clock.
    this.candidates = cands
      .map((c, ci) => ({ c, ci }))
      .filter(({ c, ci }) => c.count > 0 && !promoted.has(ci))
      .sort((a, b) => b.c.count - a.c.count)
      .slice(0, MAX_CANDIDATES)
      .map(({ c }) => c);

    // Species statistics, medoids (hysteresis), extinction.
    for (const sp of this.species) {
      if (sp.extinct !== null) continue;
      const list = members.get(sp) ?? [];
      sp.count = list.length;
      if (list.length > 0) {
        sp.lastSeen = tick;
        if (list.length > sp.peak) sp.peak = list.length;
        let sx = 0;
        let sy = 0;
        for (const i of list) {
          const rad = (orgs[i].tag * Math.PI) / 180;
          sx += Math.cos(rad);
          sy += Math.sin(rad);
        }
        sp.meanHue = (((Math.atan2(sy, sx) * 180) / Math.PI) + 360) % 360;
        if (!fresh.has(sp)) this.updateMedoid(sp, list, rows, width, w);
      } else if (tick - sp.lastSeen >= config.speciesExtinctTicks) {
        sp.extinct = tick;
        events.push({ kind: 'speciesExtinct', speciesId: sp.id, name: speciesName(sp.id) });
      }
    }
    this.dropOldExtinct();

    this.history.push({
      tick,
      counts: this.species.filter((s) => s.extinct === null && s.count > 0).map((s) => [s.id, s.count] as const),
    });
    if (this.history.length > SPECIES_HISTORY_SIZE) this.history.splice(0, this.history.length - SPECIES_HISTORY_SIZE);
    return events;
  }

  /** Distance between two stored feature rows. */
  private repDistance(a: Float32Array, b: Float32Array, width: number, w: Weights): number {
    const buf = this.tmpPair(width);
    buf.set(a, 0);
    buf.set(b, width);
    return rowDistance(buf, 0, buf, 1, width, w);
  }

  /**
   * Moves a representative to the member (among an evenly spaced sample)
   * with the lowest mean distance to a sample of the members, but only when
   * that beats the current representative by MEDOID_HYSTERESIS.
   */
  private updateMedoid(sp: Species, list: readonly number[], rows: Float32Array, width: number, w: Weights): void {
    const stride = (len: number, cap: number) => Math.max(1, Math.ceil(len / cap));
    const cs = stride(list.length, MEDOID_CANDIDATES);
    const ms = stride(list.length, MEDOID_SAMPLE);
    const sample: number[] = [];
    for (let k = 0; k < list.length; k += ms) sample.push(list[k]);
    const meanTo = (cand: Float32Array, ci: number): number => {
      // Distance of row ci (or the stored rep, ci = -1) to the sample.
      let sum = 0;
      for (const j of sample) {
        if (ci >= 0 && list[ci] === j) continue;
        if (ci >= 0) sum += rowDistance(rows, list[ci], rows, j, width, w);
        else {
          const buf = this.tmpPair(width);
          buf.set(cand, 0);
          buf.set(rows.subarray(j * width, (j + 1) * width), width);
          sum += rowDistance(buf, 0, buf, 1, width, w);
        }
      }
      return sum / Math.max(1, sample.length);
    };
    const current = meanTo(sp.rep, -1);
    let bestScore = Infinity;
    let best = -1;
    for (let k = 0; k < list.length; k += cs) {
      const score = meanTo(sp.rep, k);
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    if (best >= 0 && bestScore <= current - MEDOID_HYSTERESIS) {
      sp.rep = rows.slice(list[best] * width, (list[best] + 1) * width);
    }
  }

  private pair = new Float32Array(0);
  private tmpPair(width: number): Float32Array {
    if (this.pair.length < width * 2) this.pair = new Float32Array(width * 2);
    return this.pair;
  }

  private dropOldExtinct(): void {
    const extinct = this.species.filter((s) => s.extinct !== null);
    if (extinct.length <= MAX_EXTINCT_RECORDS) return;
    const drop = new Set(extinct.slice(0, extinct.length - MAX_EXTINCT_RECORDS));
    this.species = this.species.filter((s) => !drop.has(s));
  }

  /**
   * The species an organism belongs to now (0: none). Uses the last run's
   * assignment; an organism born since is placed by nearest representative
   * within the threshold (display only; the next run assigns it for real).
   */
  public speciesIdOf(o: Readonly<Organism>, config: Readonly<SimulationConfig>): number {
    const known = this.assignment.get(o.id);
    if (known !== undefined) return known;
    const { species, distance } = this.nearest(o, config);
    const id = species && distance <= config.speciesThreshold ? species.id : 0;
    this.assignment.set(o.id, id);
    return id;
  }

  /** The organism's species and its distance to that species' representative (null if it has none). */
  public distanceToRepresentative(o: Readonly<Organism>, config: Readonly<SimulationConfig>): { speciesId: number; distance: number } | null {
    const id = this.speciesIdOf(o, config);
    const sp = this.species.find((s) => s.id === id && s.extinct === null);
    if (!sp || sp.rep.length !== this.width) return null;
    return { speciesId: id, distance: this.distanceTo(o, sp, config) };
  }

  private distanceTo(o: Readonly<Organism>, sp: Species, config: Readonly<SimulationConfig>): number {
    const width = this.width;
    const buf = this.tmpPair(width);
    writeFeatures(o, config, buf, 0, width);
    buf.set(sp.rep, width);
    return rowDistance(buf, 0, buf, 1, width, weightsOf(config));
  }

  private nearest(o: Readonly<Organism>, config: Readonly<SimulationConfig>): { species: Species | null; distance: number } {
    if (this.width === 0) return { species: null, distance: Infinity };
    let species: Species | null = null;
    let distance = Infinity;
    for (const s of this.species) {
      if (s.extinct !== null || s.rep.length !== this.width) continue;
      const d = this.distanceTo(o, s, config);
      if (d < distance) {
        distance = d;
        species = s;
      }
    }
    return { species, distance };
  }

  /** The species list (and, if asked, the count history) for the page. */
  public snapshot(tick: number, withHistory: boolean): SpeciesSnapshot {
    const info = (s: Species): SpeciesInfo => ({
      id: s.id,
      name: speciesName(s.id),
      parentId: s.parentId,
      count: s.extinct === null ? s.count : 0,
      meanHue: s.meanHue,
      hue: speciesHue(s.id),
      born: s.born,
      extinct: s.extinct,
      peak: s.peak,
    });
    const alive = this.species.filter((s) => s.extinct === null).sort((a, b) => b.count - a.count || a.id - b.id);
    const gone = this.species.filter((s) => s.extinct !== null).sort((a, b) => (b.extinct as number) - (a.extinct as number)).slice(0, 50);
    return { tick, species: [...alive, ...gone].map(info), ...(withHistory ? { history: this.history } : {}) };
  }

  public exportState(): SpeciesState {
    return {
      version: 1,
      nextId: this.nextId,
      lastRun: Number.isFinite(this.lastRun) ? this.lastRun : null,
      width: this.width,
      species: this.species.map((s) => ({
        id: s.id,
        parentId: s.parentId,
        born: s.born,
        extinct: s.extinct,
        peak: s.peak,
        count: s.count,
        lastSeen: s.lastSeen,
        meanHue: s.meanHue,
        rep: toSaved(s.rep),
      })),
      candidates: this.candidates.map((c) => ({ firstSeen: c.firstSeen, count: c.count, rep: toSaved(c.rep) })),
      history: this.history.map((h) => ({ tick: h.tick, counts: h.counts.map(([a, b]) => [a, b] as const) })),
    };
  }

  /** Restores a saved state; an unknown or missing one leaves an empty tracker that rebuilds on the next run. */
  public restore(state: SpeciesState | undefined): void {
    this.clear();
    if (!state || state.version !== 1) return;
    this.nextId = state.nextId;
    this.lastRun = state.lastRun ?? -Infinity;
    this.width = state.width;
    this.species = state.species.map((s) => ({ ...s, rep: fromSaved(s.rep) }));
    this.candidates = state.candidates.map((c) => ({ firstSeen: c.firstSeen, count: c.count, rep: fromSaved(c.rep) }));
    this.history = state.history.map((h) => ({ tick: h.tick, counts: h.counts.map(([a, b]) => [a, b] as const) }));
  }
}
