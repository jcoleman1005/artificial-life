import type { PRNG } from './prng';
import { BRAIN_HIDDEN, BRAIN_INPUT_COUNT, HEAD_START_SKIP, mutateWeight, type Brain } from './brain';
import { MEMORY_WEIGHT_COUNT, inheritMemorySpan } from './memory';
import { inheritTag } from './tags';
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

/** Trait ids (GeneClass.trait). 9 is reserved; 10–39 are the memory register weights. */
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
export interface Phenotype {
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
  const traits = new Slots(TraitId.memoryWeight0 + MEMORY_WEIGHT_COUNT);
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
  if (id >= TraitId.memoryWeight0) return mutateWeight(dose, config, prng);
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

/** The phenotype fields of an organism (what encodeOrganismDNA reads). */
export function phenotypeOf(o: Readonly<Organism>): Phenotype {
  const { tag, carryCapacity, dispersal, memorySpan, memoryWeights, carnivory, abilities, brain, herbivory } = o;
  return {
    tag, carryCapacity, dispersal, memorySpan, memoryWeights, carnivory, abilities, brain,
    ...(herbivory === undefined ? {} : { herbivory }),
  };
}

/**
 * A genome from a save made before the newest brain inputs existed: adds a
 * direct-connection gene with the head start for each input it lacks (new
 * hidden connections are absent, i.e. 0), as upgradeBrain does for brains.
 */
export function upgradeGenome(dna: ArrayLike<number>): Uint32Array {
  const present = new Set<number>();
  for (let g = 0, n = geneCount(dna); g < n; g++) {
    const key = dna[g * GENE_WORDS];
    if (geneClassOf(key) === GeneClass.brainSkip) present.add(geneIndexOf(key));
  }
  const missing = HEAD_START_SKIP.map((_, i) => i).filter((i) => !present.has(i));
  const out = new Uint32Array((geneCount(dna) + missing.length) * GENE_WORDS);
  out.set(Array.from(dna).slice(0, geneCount(dna) * GENE_WORDS));
  missing.forEach((i, k) => writeGene(out, (geneCount(dna) + k) * GENE_WORDS, geneKey(GeneClass.brainSkip, i), HEAD_START_SKIP[i]));
  return out;
}
