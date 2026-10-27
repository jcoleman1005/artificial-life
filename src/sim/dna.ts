import type { PRNG } from './prng';
import { BRAIN_HIDDEN, BRAIN_INPUT_COUNT, HEAD_START_SKIP, WEIGHT_LIMIT, mutateWeight, type Brain } from './brain';
import { MEMORY_WEIGHT_COUNT, inheritMemorySpan } from './memory';
import { inheritTag } from './tags';
import { lifeOf, LIFE_GENES, LIFE_TRAIT_BASE, LIFE_TRAIT_COUNT, clampLife, geneForTrait, inheritLifeValue, type LifeValues } from './lifehistory';
import {
  continuousAbilities,
  inheritAbilityEfficiency,
  inheritCarnivory,
  inheritCarryCapacity,
  inheritDispersal,
  splitDiets,
} from './traits';
import type { Abilities, Organism, SimulationConfig } from './types';

/**
 * DNA (`dnaEnabled`; spec in `docs/specs/dna.md`). Stage 1: an organism's
 * inherited body and brain are written as a genome, a list of genes, and
 * its phenotype is decoded from it. Behaviour-neutral by construction:
 *
 * - Fixed topology: one gene per trait and per weight, in a fixed order.
 * - Each gene carries a dose (a float64). A trait's value is built from the
 *   sum of its genes' doses (the circular mean for the tag), so a present
 *   gene at dose 0 gives exactly the absent-gene value.
 * - Mutation applies the legacy operator to each gene, in the order the
 *   legacy birth code draws from the PRNG, so a world with DNA on runs
 *   bit-identically to one with it off (tested).
 *
 * The policy dials stay outside the genome for now.
 *
 * A gene is three uint32 words: [key, low, high], where key is
 * (geneClass << 16) | index and low/high are the little-endian words of the
 * dose's float64 bits, so every value round-trips exactly.
 */

export const GENE_WORDS = 3;

export const GeneClass = {
  trait: 0,
  brainSkip: 1,
  /** Index: (hidden unit << 8) | input, so appending brain inputs keeps every gene's meaning. */
  brainHidden: 2,
  brainHiddenBias: 3,
  brainOut: 4,
  brainOutBias: 5,
} as const;
export type GeneClass = (typeof GeneClass)[keyof typeof GeneClass];

/** Trait ids (GeneClass.trait). 9 is reserved; 10–39 are the memory register weights; 40–46 are the life-history genes (lifehistory.ts). */
export const TraitId = {
  tag: 0,
  carryCapacity: 1,
  dispersal: 2,
  memorySpan: 3,
  carnivory: 4,
  diagonal: 5,
  squeeze: 6,
  leap: 7,
  /** Split diets only (Stage 1b.2). */
  herbivory: 8,
  memoryWeight0: 10,
} as const;

/** The phenotype a genome decodes to: every inherited trait except the policy dials. */
export interface Phenotype extends LifeValues {
  readonly tag: number;
  readonly carryCapacity: number;
  readonly dispersal: number;
  readonly memorySpan: number;
  readonly memoryWeights: readonly number[];
  readonly carnivory: number;
  /** Split diets only. */
  readonly herbivory?: number;
  readonly abilities: Abilities;
  readonly brain: Brain;
}

/** Trait values when a trait has no gene at all. Brain and register weights default to 0 (no connection). */
export const ABSENT_DEFAULTS = {
  tag: 0,
  carryCapacity: 0,
  dispersal: 1,
  memorySpan: 0,
  carnivory: 0,
  herbivory: 0,
  abilities: { diagonal: 0, squeeze: 0, leap: 0 },
} as const;

const scratch = new DataView(new ArrayBuffer(8));

export function geneKey(geneClass: GeneClass, index: number): number {
  return ((geneClass << 16) | index) >>> 0;
}
export const geneClassOf = (key: number): number => key >>> 16;
export const geneIndexOf = (key: number): number => key & 0xffff;

function writeGene(out: Uint32Array, at: number, key: number, dose: number): void {
  scratch.setFloat64(0, dose, true);
  out[at] = key;
  out[at + 1] = scratch.getUint32(0, true);
  out[at + 2] = scratch.getUint32(4, true);
}

export function geneDose(dna: ArrayLike<number>, at: number): number {
  scratch.setUint32(0, dna[at + 1], true);
  scratch.setUint32(4, dna[at + 2], true);
  return scratch.getFloat64(0, true);
}

export const geneCount = (dna: ArrayLike<number>): number => Math.floor(dna.length / GENE_WORDS);

/**
 * The genome for a phenotype. Gene order is the legacy birth code's PRNG
 * draw order (tag, carry capacity, brain, abilities, dispersal, memory span,
 * register weights, carnivory), which mutateGenome relies on.
 */
export function encodeOrganismDNA(p: Readonly<Phenotype>): Uint32Array {
  const genes: [number, number][] = [];
  const add = (geneClass: GeneClass, index: number, dose: number) => genes.push([geneKey(geneClass, index), dose]);
  add(GeneClass.trait, TraitId.tag, p.tag);
  add(GeneClass.trait, TraitId.carryCapacity, p.carryCapacity);
  p.brain.skip.forEach((w, i) => add(GeneClass.brainSkip, i, w));
  const inputs = p.brain.skip.length;
  p.brain.hidden.forEach((w, k) => add(GeneClass.brainHidden, (Math.floor(k / inputs) << 8) | k % inputs, w));
  p.brain.hiddenBias.forEach((w, h) => add(GeneClass.brainHiddenBias, h, w));
  p.brain.out.forEach((w, h) => add(GeneClass.brainOut, h, w));
  add(GeneClass.brainOutBias, 0, p.brain.outBias);
  add(GeneClass.trait, TraitId.diagonal, p.abilities.diagonal);
  add(GeneClass.trait, TraitId.squeeze, p.abilities.squeeze);
  add(GeneClass.trait, TraitId.leap, p.abilities.leap);
  add(GeneClass.trait, TraitId.dispersal, p.dispersal - 1); // dose 0 = adjacent birth
  add(GeneClass.trait, TraitId.memorySpan, p.memorySpan);
  p.memoryWeights.forEach((w, i) => add(GeneClass.trait, TraitId.memoryWeight0 + i, w));
  add(GeneClass.trait, TraitId.carnivory, p.carnivory);
  if (p.herbivory !== undefined) add(GeneClass.trait, TraitId.herbivory, p.herbivory);
  for (const g of LIFE_GENES) {
    const v = p[g.field];
    if (v !== undefined) add(GeneClass.trait, g.traitId, v);
  }

  const dna = new Uint32Array(genes.length * GENE_WORDS);
  genes.forEach(([key, dose], g) => writeGene(dna, g * GENE_WORDS, key, dose));
  return dna;
}

/** Sums doses into a slot; the first gene is taken as is, so a single gene decodes to exactly its dose (even -0). */
class Slots {
  readonly values: number[];
  private readonly seen: boolean[];
  constructor(size: number) {
    this.values = new Array<number>(size).fill(0);
    this.seen = new Array<boolean>(size).fill(false);
  }
  add(i: number, dose: number): void {
    if (i >= this.values.length) return; // a gene for a slot this build doesn't have
    this.values[i] = this.seen[i] ? this.values[i] + dose : dose;
    this.seen[i] = true;
  }
  has(i: number): boolean {
    return this.seen[i];
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** An angle in [0, 360), left exactly as is when already there. */
const wrapHue = (a: number) => (a >= 0 && a < 360 ? a : ((a % 360) + 360) % 360);

/**
 * The circular mean of hue angles, in [0, 360). One gene decodes to exactly
 * its angle; copies of one hue reinforce it. A zero-length mean vector
 * (exact antipodes) decodes to 0.
 */
export function circularMeanHue(angles: readonly number[]): number {
  if (angles.length === 0) return ABSENT_DEFAULTS.tag;
  if (angles.length === 1) return wrapHue(angles[0]);
  let s = 0;
  let c = 0;
  for (const a of angles) {
    s += Math.sin((a * Math.PI) / 180);
    c += Math.cos((a * Math.PI) / 180);
  }
  if (Math.hypot(s, c) < 1e-9 * angles.length) return 0;
  const mean = Number(((Math.atan2(s, c) * 180) / Math.PI).toFixed(2)); // tags carry 2 decimals
  return wrapHue(mean === 360 ? 0 : mean + 0); // + 0 turns -0 into 0
}

/**
 * The phenotype a genome builds: a pure function of the genome and the
 * world's bounds. Missing genes fall back to ABSENT_DEFAULTS (weights to 0);
 * non-finite doses count as 0, so decoding never throws or yields NaN.
 */
export function decodeOrganismDNA(dna: ArrayLike<number>, config: Readonly<SimulationConfig>): Phenotype {
  const traits = new Slots(LIFE_TRAIT_BASE + LIFE_TRAIT_COUNT);
  const tags: number[] = [];
  const skip = new Slots(BRAIN_INPUT_COUNT);
  const hidden = new Slots(BRAIN_HIDDEN * BRAIN_INPUT_COUNT);
  const hiddenBias = new Slots(BRAIN_HIDDEN);
  const out = new Slots(BRAIN_HIDDEN);
  const outBias = new Slots(1);

  for (let g = 0, n = geneCount(dna); g < n; g++) {
    const at = g * GENE_WORDS;
    const key = dna[at];
    const index = geneIndexOf(key);
    const raw = geneDose(dna, at);
    const dose = Number.isFinite(raw) ? raw : 0;
    switch (geneClassOf(key)) {
      case GeneClass.trait:
        if (index === TraitId.tag) tags.push(dose);
        else traits.add(index, dose);
        break;
      case GeneClass.brainSkip:
        skip.add(index, dose);
        break;
      case GeneClass.brainHidden: {
        const h = index >>> 8;
        const i = index & 0xff;
        if (h < BRAIN_HIDDEN && i < BRAIN_INPUT_COUNT) hidden.add(h * BRAIN_INPUT_COUNT + i, dose);
        break;
      }
      case GeneClass.brainHiddenBias:
        hiddenBias.add(index, dose);
        break;
      case GeneClass.brainOut:
        out.add(index, dose);
        break;
      case GeneClass.brainOutBias:
        outBias.add(index, dose);
        break;
      default:
        break; // an unknown gene class is silent DNA
    }
  }

  const trait = (id: number, absent: number) => (traits.has(id) ? traits.values[id] : absent);
  // Binary: 0 or 1. Continuous (Stage 1b.1): the efficiency itself, in [0, 1].
  const ability = continuousAbilities(config)
    ? (id: number) => clamp(trait(id, 0), 0, 1)
    : (id: number) => (clamp(Math.round(trait(id, 0)), 0, 1) === 1 ? 1 : 0);
  return {
    tag: circularMeanHue(tags),
    carryCapacity: clamp(Math.round(trait(TraitId.carryCapacity, ABSENT_DEFAULTS.carryCapacity)), 0, config.maxCarryCapacity),
    dispersal: 1 + clamp(Math.round(trait(TraitId.dispersal, 0)), 0, Math.max(0, config.maxDispersal - 1)),
    memorySpan: clamp(Math.round(trait(TraitId.memorySpan, ABSENT_DEFAULTS.memorySpan)), 0, config.maxMemorySpan),
    memoryWeights: traits.values.slice(TraitId.memoryWeight0, TraitId.memoryWeight0 + MEMORY_WEIGHT_COUNT),
    carnivory: clamp(trait(TraitId.carnivory, ABSENT_DEFAULTS.carnivory), 0, 1),
    ...(splitDiets(config) ? { herbivory: clamp(trait(TraitId.herbivory, ABSENT_DEFAULTS.herbivory), 0, 1) } : {}),
    // A life-history gene that is switched on but missing from the genome decodes to its starting value.
    ...Object.fromEntries(
      LIFE_GENES.filter((g) => g.enabled(config)).map((g) => [g.field, clampLife(g, trait(g.traitId, g.founder(config)), config)])
    ),
    abilities: { diagonal: ability(TraitId.diagonal), squeeze: ability(TraitId.squeeze), leap: ability(TraitId.leap) },
    brain: {
      skip: skip.values,
      hidden: hidden.values,
      hiddenBias: hiddenBias.values,
      out: out.values,
      outBias: outBias.values[0],
    },
  };
}

/**
 * A child's genome: each gene copied with its trait's legacy mutation
 * operator, gene by gene in genome order. On a genome from
 * encodeOrganismDNA this draws from the PRNG exactly as the legacy birth
 * code does, so the decoded child is the legacy child.
 */
export function mutateGenome(parent: ArrayLike<number>, config: Readonly<SimulationConfig>, prng: PRNG): Uint32Array {
  const child = new Uint32Array(geneCount(parent) * GENE_WORDS);
  for (let g = 0, n = geneCount(parent); g < n; g++) {
    const at = g * GENE_WORDS;
    const key = parent[at];
    const dose = geneDose(parent, at);
    writeGene(child, at, key, mutateDose(key, dose, config, prng));
  }
  return child;
}

function mutateDose(key: number, dose: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (geneClassOf(key) !== GeneClass.trait) return mutateWeight(dose, config, prng);
  const id = geneIndexOf(key);
  const life = geneForTrait(id);
  if (life) return inheritLifeValue(dose, life, config, prng);
  if (id >= TraitId.memoryWeight0 && id < TraitId.memoryWeight0 + MEMORY_WEIGHT_COUNT) return mutateWeight(dose, config, prng);
  switch (id) {
    case TraitId.tag:
      return inheritTag(dose, config, prng);
    case TraitId.carryCapacity:
      return inheritCarryCapacity(dose, config, prng);
    case TraitId.dispersal:
      return inheritDispersal(dose + 1, config, prng) - 1;
    case TraitId.memorySpan:
      return inheritMemorySpan(dose, config, prng);
    case TraitId.carnivory:
    case TraitId.herbivory:
      return inheritCarnivory(dose, config, prng);
    case TraitId.diagonal:
    case TraitId.squeeze:
    case TraitId.leap:
      if (continuousAbilities(config)) return inheritAbilityEfficiency(dose, config, prng);
      return prng.next() < config.abilityMutationRate ? 1 - dose : dose;
    default:
      return dose; // reserved ids are copied unchanged
  }
}

// ---------------------------------------------------------------------------
// Sexual reproduction: crossing two genomes by key
// ---------------------------------------------------------------------------

/**
 * The unit a gene is inherited in. A hidden brain unit's genes (all its
 * incoming weights, its bias and its output weight) travel together, so the
 * group is the unit; every other gene's group is its own key.
 */
function crossGroup(key: number): number {
  switch (geneClassOf(key)) {
    case GeneClass.brainHidden:
      return -1 - (geneIndexOf(key) >>> 8);
    case GeneClass.brainHiddenBias:
    case GeneClass.brainOut:
      return -1 - geneIndexOf(key);
    default:
      return key; // keys are >= 0, hidden-unit groups < 0
  }
}

/**
 * A child genome from two parents, before mutation. For each gene group
 * present in either parent (a key, or a whole hidden brain unit), one parent
 * is picked at random (one PRNG draw per group, in order of first
 * appearance in `a`, then in `b`), and the child takes all of that parent's
 * genes in the group: every copy of a duplicated key travels together, and
 * if the picked parent lacks the key, the child lacks it too.
 *
 * Layout: the child follows `a`'s gene order. A group picked from `a` keeps
 * its genes where `a` has them; a key picked from `b` puts all of `b`'s
 * copies where `a` first has that key; keys only `b` has (picked from `b`)
 * follow at the end in `b`'s order. Two Stage 1 genomes share one layout,
 * so the child has that layout with each gene's dose from one parent.
 */
export function crossGenomes(a: ArrayLike<number>, b: ArrayLike<number>, prng: PRNG): Uint32Array {
  const fromA = new Map<number, boolean>();
  const pickFor = (key: number) => {
    const group = crossGroup(key);
    if (!fromA.has(group)) fromA.set(group, prng.next() < 0.5);
  };
  const na = geneCount(a);
  const nb = geneCount(b);
  for (let g = 0; g < na; g++) pickFor(a[g * GENE_WORDS]);
  for (let g = 0; g < nb; g++) pickFor(b[g * GENE_WORDS]);

  // b's genes by key, in b's order.
  const bByKey = new Map<number, number[]>();
  for (let g = 0; g < nb; g++) {
    const key = b[g * GENE_WORDS];
    const list = bByKey.get(key);
    if (list) list.push(g);
    else bByKey.set(key, [g]);
  }

  const words: number[] = [];
  const copy = (src: ArrayLike<number>, g: number) => {
    const at = g * GENE_WORDS;
    words.push(src[at], src[at + 1], src[at + 2]);
  };
  const keysInA = new Set<number>();
  for (let g = 0; g < na; g++) {
    const key = a[g * GENE_WORDS];
    const first = !keysInA.has(key);
    keysInA.add(key);
    if (fromA.get(crossGroup(key))) copy(a, g);
    else if (first) for (const gb of bByKey.get(key) ?? []) copy(b, gb);
  }
  for (let g = 0; g < nb; g++) {
    const key = b[g * GENE_WORDS];
    if (!keysInA.has(key) && !fromA.get(crossGroup(key))) copy(b, g);
  }
  return Uint32Array.from(words);
}

/** A genome cut to at most `maxGenes` genes (the genes past the cap are dropped). */
export function capGenome(dna: Uint32Array, maxGenes: number): Uint32Array {
  return geneCount(dna) > maxGenes ? dna.slice(0, Math.max(0, maxGenes) * GENE_WORDS) : dna;
}

/** The phenotype fields of an organism (what encodeOrganismDNA reads). */
export function phenotypeOf(o: Readonly<Organism>): Phenotype {
  const { tag, carryCapacity, dispersal, memorySpan, memoryWeights, carnivory, abilities, brain, herbivory } = o;
  return {
    tag, carryCapacity, dispersal, memorySpan, memoryWeights, carnivory, abilities, brain,
    ...(herbivory === undefined ? {} : { herbivory }),
    ...lifeOf(o),
  };
}

/**
 * A genome from a save made before the newest brain inputs existed: adds a
 * direct-connection gene with the head start for each input the save lacked
 * (new hidden connections are absent, i.e. 0), as upgradeBrain does for
 * brains. `savedInputs` is how many brain inputs the save had (its brain's
 * skip length); only inputs past it are added, so a gene that Stage 2
 * deleted is not brought back.
 */
export function upgradeGenome(dna: ArrayLike<number>, savedInputs: number): Uint32Array {
  const missing = HEAD_START_SKIP.map((_, i) => i).filter((i) => i >= savedInputs);
  const out = new Uint32Array((geneCount(dna) + missing.length) * GENE_WORDS);
  out.set(Array.from(dna).slice(0, geneCount(dna) * GENE_WORDS));
  missing.forEach((i, k) => writeGene(out, (geneCount(dna) + k) * GENE_WORDS, geneKey(GeneClass.brainSkip, i), HEAD_START_SKIP[i]));
  return out;
}

// ---------------------------------------------------------------------------
// Stage 2: variation operators (`dnaVariationEnabled`)
// ---------------------------------------------------------------------------

/**
 * Stage 2 changes how a child's genome is made. The number of point
 * mutations is drawn from a Poisson distribution (not one die per gene), and
 * three structural operators can change the gene count: insertion of a new
 * random gene, deletion of a gene, duplication of a segment of 1 to
 * `dnaDuplicationMaxLength` genes. Every gene costs `dnaUpkeepPerGene` energy
 * per tick (see metabolismCost), so length is under selection.
 *
 * Each gene keeps its legacy per-gene mutation rate (brain and register
 * weights `brainMutationRate`, the tag `tagMutationRate`, body traits
 * `traitMutationRate`, binary abilities `abilityMutationRate`), so with the
 * structural rates at 0 the point process matches Stage 1's in distribution.
 *
 * A point mutation steps a gene's dose (its legacy step) or, with probability
 * `dnaKeyFlipFraction`, flips one bit of the gene's index field, which
 * retargets it to another slot (or to none: silent DNA).
 */

const LAST_BODY_TRAIT = TraitId.leap;
const REGISTER_END = TraitId.memoryWeight0 + MEMORY_WEIGHT_COUNT;

/** The per-gene point-mutation rate of a gene: the rate of the legacy operator for its trait. */
export function pointMutationRate(key: number, config: Readonly<SimulationConfig>): number {
  if (geneClassOf(key) !== GeneClass.trait) return config.brainMutationRate;
  const id = geneIndexOf(key);
  if (id >= TraitId.memoryWeight0) return id < REGISTER_END ? config.brainMutationRate : 0;
  switch (id) {
    case TraitId.tag:
      return config.tagMutationRate;
    case TraitId.carryCapacity:
    case TraitId.dispersal:
    case TraitId.memorySpan:
    case TraitId.carnivory:
    case TraitId.herbivory:
      return config.traitMutationRate;
    case TraitId.diagonal:
    case TraitId.squeeze:
    case TraitId.leap:
      return continuousAbilities(config) ? config.traitMutationRate : config.abilityMutationRate;
    default:
      return 0;
  }
}

/** Whether a gene points at a slot this build decodes (otherwise it is silent DNA). */
export function isExpressed(key: number, config: Readonly<SimulationConfig>): boolean {
  const index = geneIndexOf(key);
  switch (geneClassOf(key)) {
    case GeneClass.trait:
      return index <= LAST_BODY_TRAIT || (index === TraitId.herbivory && splitDiets(config)) || (index >= TraitId.memoryWeight0 && index < REGISTER_END);
    case GeneClass.brainSkip:
      return index < BRAIN_INPUT_COUNT;
    case GeneClass.brainHidden:
      return index >>> 8 < BRAIN_HIDDEN && (index & 0xff) < BRAIN_INPUT_COUNT;
    case GeneClass.brainHiddenBias:
    case GeneClass.brainOut:
      return index < BRAIN_HIDDEN;
    case GeneClass.brainOutBias:
      return index < 1;
    default:
      return false;
  }
}

/** Every slot a gene can express, as keys (the pool insertions draw from). */
function slotKeys(config: Readonly<SimulationConfig>): number[] {
  const keys: number[] = [];
  for (let t = 0; t <= LAST_BODY_TRAIT; t++) keys.push(geneKey(GeneClass.trait, t));
  if (splitDiets(config)) keys.push(geneKey(GeneClass.trait, TraitId.herbivory));
  for (let i = 0; i < MEMORY_WEIGHT_COUNT; i++) keys.push(geneKey(GeneClass.trait, TraitId.memoryWeight0 + i));
  for (let i = 0; i < BRAIN_INPUT_COUNT; i++) keys.push(geneKey(GeneClass.brainSkip, i));
  for (let h = 0; h < BRAIN_HIDDEN; h++) {
    for (let i = 0; i < BRAIN_INPUT_COUNT; i++) keys.push(geneKey(GeneClass.brainHidden, (h << 8) | i));
    keys.push(geneKey(GeneClass.brainHiddenBias, h), geneKey(GeneClass.brainOut, h));
  }
  keys.push(geneKey(GeneClass.brainOutBias, 0));
  return keys;
}
let slotCache: { split: boolean; keys: number[] } | null = null;
function slotsFor(config: Readonly<SimulationConfig>): number[] {
  const split = splitDiets(config);
  if (slotCache?.split !== split) slotCache = { split, keys: slotKeys(config) };
  return slotCache.keys;
}

/** The dose of a freshly inserted gene: small for summed traits and weights (so it nudges its slot), a random hue for a tag. */
function randomDose(key: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  if (geneClassOf(key) === GeneClass.trait) {
    switch (geneIndexOf(key)) {
      case TraitId.tag:
        return Number(prng.nextFloat(0, 360).toFixed(2));
      case TraitId.carryCapacity:
      case TraitId.dispersal:
      case TraitId.memorySpan:
        return Number(prng.nextGaussian(0, 1).toFixed(3));
      case TraitId.carnivory:
      case TraitId.herbivory:
        return Number(prng.nextGaussian(0, config.carnivoryMutationStdDev).toFixed(3));
      case TraitId.diagonal:
      case TraitId.squeeze:
      case TraitId.leap:
        return Number(prng.nextGaussian(0, config.abilityMutationStdDev).toFixed(3));
      default:
        break;
    }
  }
  return Number(prng.nextGaussian(0, config.brainMutationStdDev).toFixed(4));
}

/** A dose after its legacy mutation operator has fired (the operators' "did it mutate?" draw already made). */
function stepDose(key: number, dose: number, config: Readonly<SimulationConfig>, prng: PRNG): number {
  const weight = () => {
    const next = dose + prng.nextGaussian(0, config.brainMutationStdDev);
    return Number(Math.max(-WEIGHT_LIMIT, Math.min(WEIGHT_LIMIT, next)).toFixed(4));
  };
  if (geneClassOf(key) !== GeneClass.trait) return weight();
  const id = geneIndexOf(key);
  if (id >= TraitId.memoryWeight0) return weight();
  const sign = () => (prng.next() < 0.5 ? -1 : 1);
  switch (id) {
    case TraitId.tag:
      return Number((((dose + prng.nextGaussian(0, config.tagMutationStdDev)) % 360 + 360) % 360).toFixed(2));
    case TraitId.carryCapacity:
      return Math.max(0, Math.min(config.maxCarryCapacity, dose + sign()));
    case TraitId.dispersal:
      return Math.max(0, Math.min(config.maxDispersal - 1, dose + sign()));
    case TraitId.memorySpan:
      return Math.max(0, Math.min(config.maxMemorySpan, dose + sign() * config.memorySpanStep));
    case TraitId.carnivory:
    case TraitId.herbivory:
      return Number(Math.max(0, Math.min(1, dose + prng.nextGaussian(0, config.carnivoryMutationStdDev))).toFixed(3));
    case TraitId.diagonal:
    case TraitId.squeeze:
    case TraitId.leap:
      if (continuousAbilities(config)) return Number(Math.max(0, Math.min(1, dose + prng.nextGaussian(0, config.abilityMutationStdDev))).toFixed(3));
      return 1 - dose;
    default:
      return dose;
  }
}

/** Point-mutates gene `g` in place: a dose step, or a flip of one bit of its index field. */
function pointMutate(dna: Uint32Array, g: number, config: Readonly<SimulationConfig>, prng: PRNG, flip: boolean): void {
  const at = g * GENE_WORDS;
  if (flip) {
    dna[at] = (dna[at] ^ (1 << prng.nextInt(0, 15))) >>> 0;
    return;
  }
  writeGene(dna, at, dna[at], stepDose(dna[at], geneDose(dna, at), config, prng));
}

/** A uniformly random gene that passes the rate thinning (a gene is picked in proportion to its rate). */
function pickMutable(dna: Uint32Array, config: Readonly<SimulationConfig>, prng: PRNG, maxRate: number): number {
  const n = geneCount(dna);
  for (let tries = 0; tries < 10_000; tries++) {
    const g = prng.nextInt(0, n - 1);
    if (prng.next() * maxRate < pointMutationRate(dna[g * GENE_WORDS], config)) return g;
  }
  return -1; // no gene can mutate
}

const maxPointRate = (config: Readonly<SimulationConfig>): number =>
  Math.max(config.brainMutationRate, config.tagMutationRate, config.traitMutationRate, config.abilityMutationRate);

function deleteAt(dna: Uint32Array, g: number): Uint32Array {
  const out = new Uint32Array(dna.length - GENE_WORDS);
  out.set(dna.subarray(0, g * GENE_WORDS));
  out.set(dna.subarray((g + 1) * GENE_WORDS), g * GENE_WORDS);
  return out;
}

function insertAt(dna: Uint32Array, g: number, genes: Uint32Array): Uint32Array {
  const out = new Uint32Array(dna.length + genes.length);
  out.set(dna.subarray(0, g * GENE_WORDS));
  out.set(genes, g * GENE_WORDS);
  out.set(dna.subarray(g * GENE_WORDS), g * GENE_WORDS + genes.length);
  return out;
}

/** Whether halving a gene's dose when it is duplicated keeps the phenotype (summed traits and weights; not hues or binary abilities). */
function halvesOnDuplication(key: number, config: Readonly<SimulationConfig>): boolean {
  if (geneClassOf(key) !== GeneClass.trait) return true;
  const id = geneIndexOf(key);
  if (id === TraitId.tag) return false;
  if (id === TraitId.diagonal || id === TraitId.squeeze || id === TraitId.leap) return continuousAbilities(config);
  return true;
}

/** Copies genes [start, start + length) and inserts the copy before gene `to` (in the genome without the copy). */
function duplicateSegment(dna: Uint32Array, start: number, length: number, to: number, config: Readonly<SimulationConfig>): Uint32Array {
  const copy = dna.slice(start * GENE_WORDS, (start + length) * GENE_WORDS);
  let out = dna;
  if (config.dnaDosageCompensation) {
    out = dna.slice();
    for (let k = 0; k < length; k++) {
      if (!halvesOnDuplication(copy[k * GENE_WORDS], config)) continue;
      const half = geneDose(copy, k * GENE_WORDS) / 2;
      writeGene(copy, k * GENE_WORDS, copy[k * GENE_WORDS], half);
      writeGene(out, (start + k) * GENE_WORDS, out[(start + k) * GENE_WORDS], half);
    }
  }
  return insertAt(out, to, copy);
}

export type MutationKind = 'step' | 'keyFlip' | 'insert' | 'delete' | 'duplicate';

/** Inserts a new random gene at a random position (does nothing at dnaMaxGenes). */
function insertRandom(dna: Uint32Array, config: Readonly<SimulationConfig>, prng: PRNG): Uint32Array {
  if (geneCount(dna) >= config.dnaMaxGenes) return dna;
  const slots = slotsFor(config);
  const key = slots[prng.nextInt(0, slots.length - 1)];
  const gene = new Uint32Array(GENE_WORDS);
  writeGene(gene, 0, key, randomDose(key, config, prng));
  return insertAt(dna, prng.nextInt(0, geneCount(dna)), gene);
}

function deleteRandom(dna: Uint32Array, prng: PRNG): Uint32Array {
  return geneCount(dna) === 0 ? dna : deleteAt(dna, prng.nextInt(0, geneCount(dna) - 1));
}

function duplicateRandom(dna: Uint32Array, config: Readonly<SimulationConfig>, prng: PRNG): Uint32Array {
  const n = geneCount(dna);
  if (n === 0) return dna;
  const start = prng.nextInt(0, n - 1);
  const length = prng.nextInt(1, Math.max(1, Math.min(config.dnaDuplicationMaxLength, n - start)));
  if (n + length > config.dnaMaxGenes) return dna;
  return duplicateSegment(dna, start, length, prng.nextInt(0, n), config);
}

/**
 * A child's genome under Stage 2: point mutations (a Poisson count over the
 * genome), then deletions, insertions and duplications (each a Poisson count
 * at the per-gene rate times the parent's length).
 */
export function mutateGenomeVariation(parent: Uint32Array, config: Readonly<SimulationConfig>, prng: PRNG): Uint32Array {
  let child = parent.slice();
  const n = geneCount(parent);
  const maxRate = maxPointRate(config);
  // Candidates arrive at the highest rate and each is kept with its own gene's rate over that: an exact
  // sample of independent per-gene rates without a die per gene.
  for (let k = prng.nextPoisson(maxRate * n); k > 0; k--) {
    const g = prng.nextInt(0, n - 1);
    if (prng.next() * maxRate >= pointMutationRate(child[g * GENE_WORDS], config)) continue;
    pointMutate(child, g, config, prng, prng.next() < config.dnaKeyFlipFraction);
  }
  for (let k = prng.nextPoisson(config.dnaDeletionRate * n); k > 0; k--) child = deleteRandom(child, prng);
  for (let k = prng.nextPoisson(config.dnaInsertionRate * n); k > 0; k--) child = insertRandom(child, config, prng);
  for (let k = prng.nextPoisson(config.dnaDuplicationRate * n); k > 0; k--) child = duplicateRandom(child, config, prng);
  return child;
}

/** One mutation event of a given kind applied to a parent genome (for the census); the parent is untouched. */
export function mutateOnce(parent: Uint32Array, kind: MutationKind, config: Readonly<SimulationConfig>, prng: PRNG): Uint32Array {
  switch (kind) {
    case 'insert':
      return insertRandom(parent, config, prng);
    case 'delete':
      return deleteRandom(parent, prng);
    case 'duplicate':
      return duplicateRandom(parent, config, prng);
    default: {
      const child = parent.slice();
      const g = pickMutable(child, config, prng, maxPointRate(config));
      if (g >= 0) pointMutate(child, g, config, prng, kind === 'keyFlip');
      return child;
    }
  }
}

// --- Measurements ---------------------------------------------------------

export const GENE_TYPES = ['body', 'register', 'brainSkip', 'brainHidden', 'brainHiddenBias', 'brainOut', 'brainOutBias', 'silent'] as const;
export type GeneType = (typeof GENE_TYPES)[number];

/** What a gene is: its slot's type, or silent when it points at nothing this build decodes. */
export function geneTypeOf(key: number, config: Readonly<SimulationConfig>): GeneType {
  if (!isExpressed(key, config)) return 'silent';
  switch (geneClassOf(key)) {
    case GeneClass.trait:
      return geneIndexOf(key) >= TraitId.memoryWeight0 ? 'register' : 'body';
    case GeneClass.brainSkip:
      return 'brainSkip';
    case GeneClass.brainHidden:
      return 'brainHidden';
    case GeneClass.brainHiddenBias:
      return 'brainHiddenBias';
    case GeneClass.brainOut:
      return 'brainOut';
    default:
      return 'brainOutBias';
  }
}

export interface GenomeStats {
  readonly count: number;
  readonly meanLength: number;
  readonly sdLength: number;
  readonly minLength: number;
  readonly maxLength: number;
  /** Mean genes of each type per genome. */
  readonly meanByType: Record<GeneType, number>;
  /** Mean number of slots (keys) carried by two or more genes, per genome. */
  readonly multiCopySlots: number;
  /** Of the weight slots carried by two or more genes: the share whose copies all hold one dose. */
  readonly identicalShare: number;
  /** ...and the mean spread (largest − smallest dose) of the others, in brainMutationStdDev. */
  readonly meanSpread: number;
}

/** Length, gene types and duplicate-copy divergence over a set of genomes. */
export function genomeStats(genomes: readonly ArrayLike<number>[], config: Readonly<SimulationConfig>): GenomeStats {
  const byType = Object.fromEntries(GENE_TYPES.map((t) => [t, 0])) as Record<GeneType, number>;
  const lengths = genomes.map(geneCount);
  const mean = lengths.reduce((a, l) => a + l, 0) / Math.max(1, lengths.length);
  const sd = Math.sqrt(lengths.reduce((a, l) => a + (l - mean) ** 2, 0) / Math.max(1, lengths.length));
  let multi = 0;
  let identical = 0;
  let spreadSum = 0;
  let diverged = 0;
  for (const dna of genomes) {
    const doses = new Map<number, number[]>();
    for (let g = 0, n = geneCount(dna); g < n; g++) {
      const key = dna[g * GENE_WORDS];
      byType[geneTypeOf(key, config)]++;
      const list = doses.get(key);
      if (list) list.push(geneDose(dna, g * GENE_WORDS));
      else doses.set(key, [geneDose(dna, g * GENE_WORDS)]);
    }
    for (const [key, list] of doses) {
      if (list.length < 2) continue;
      multi++;
      if (geneClassOf(key) === GeneClass.trait && geneIndexOf(key) < TraitId.memoryWeight0) continue; // hues, counts and flags aren't comparable in std units
      const spread = Math.max(...list) - Math.min(...list);
      if (spread === 0) identical++;
      else {
        diverged++;
        spreadSum += spread / config.brainMutationStdDev;
      }
    }
  }
  const total = Math.max(1, genomes.length);
  for (const t of GENE_TYPES) byType[t] /= total;
  return {
    count: genomes.length,
    meanLength: mean,
    sdLength: sd,
    minLength: lengths.length ? Math.min(...lengths) : 0,
    maxLength: lengths.length ? Math.max(...lengths) : 0,
    meanByType: byType,
    multiCopySlots: multi / total,
    identicalShare: identical + diverged > 0 ? identical / (identical + diverged) : 1,
    meanSpread: diverged > 0 ? spreadSum / diverged : 0,
  };
}
