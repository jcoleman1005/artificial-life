import { crossBrains, type Brain } from './brain';
import type { PRNG } from './prng';
import type { Abilities, Organism, PolicyWeights } from './types';

/**
 * Everything a child's body and brain inherit, before mutation, as phenotype
 * values. Used when DNA is off; with DNA on, the parents' genomes are
 * crossed instead (crossGenomes in dna.ts). The policy dials are in neither:
 * they are mixed by mixPolicies.
 */
export interface Heritable {
  readonly tag: number;
  readonly carryCapacity: number;
  readonly abilities: Abilities;
  readonly dispersal: number;
  readonly memorySpan: number;
  readonly memoryWeights: readonly number[];
  readonly brain: Brain;
  readonly carnivory: number;
}

export function heritableOf(o: Readonly<Organism>): Heritable {
  return {
    tag: o.tag,
    carryCapacity: o.carryCapacity,
    abilities: o.abilities,
    dispersal: o.dispersal,
    memorySpan: o.memorySpan,
    memoryWeights: o.memoryWeights,
    brain: o.brain,
    carnivory: o.carnivory,
  };
}

/**
 * A child of two parents (DNA off): every gene comes whole from one parent or
 * the other, picked at random (a hidden unit of the brain counts as one gene,
 * so its connections stay together). Mutation is applied afterwards, as for
 * clones. The picks are drawn in genome order (tag, carry capacity, brain,
 * abilities, dispersal, memory span, register weights, diet), the order in
 * which crossGenomes draws for two Stage 1 genomes, so a world with DNA on
 * (Stage 2 off) still runs bit-identically to one with it off.
 */
export function recombine(a: Heritable, b: Heritable, prng: PRNG): Heritable {
  const pick = <T>(x: T, y: T): T => (prng.next() < 0.5 ? x : y);
  const tag = pick(a.tag, b.tag);
  const carryCapacity = pick(a.carryCapacity, b.carryCapacity);
  const brain = crossBrains(a.brain, b.brain, prng);
  const abilities = {
    diagonal: pick(a.abilities.diagonal, b.abilities.diagonal),
    squeeze: pick(a.abilities.squeeze, b.abilities.squeeze),
    leap: pick(a.abilities.leap, b.abilities.leap),
  };
  const dispersal = pick(a.dispersal, b.dispersal);
  const memorySpan = pick(a.memorySpan, b.memorySpan);
  const memoryWeights = a.memoryWeights.map((w, i) => pick(w, b.memoryWeights[i] ?? w));
  const carnivory = pick(a.carnivory, b.carnivory);
  return { tag, carryCapacity, abilities, dispersal, memorySpan, memoryWeights, brain, carnivory };
}

/** The policy dials of a child of two parents: each dial whole from one parent or the other, at random. */
export function mixPolicies(a: PolicyWeights, b: PolicyWeights, prng: PRNG): PolicyWeights {
  return Object.fromEntries(
    (Object.keys(a) as (keyof PolicyWeights)[]).map((k) => [k, prng.next() < 0.5 ? a[k] : b[k]])
  ) as unknown as PolicyWeights;
}
