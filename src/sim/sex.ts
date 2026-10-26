import { crossBrains, type Brain } from './brain';
import type { PRNG } from './prng';
import type { Abilities, Organism, PolicyWeights } from './types';

/** Everything a child inherits, before mutation. */
export interface Genome {
  readonly policy: PolicyWeights;
  readonly tag: number;
  readonly carryCapacity: number;
  readonly abilities: Abilities;
  readonly dispersal: number;
  readonly memorySpan: number;
  readonly memoryWeights: readonly number[];
  readonly brain: Brain;
  readonly carnivory: number;
}

export function genomeOf(o: Readonly<Organism>): Genome {
  return {
    policy: o.policy,
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
 * A child of two parents: every gene comes whole from one parent or the other,
 * picked at random (a hidden unit of the brain counts as one gene, so its
 * connections stay together). Mutation is applied afterwards, as for clones.
 */
export function recombine(a: Genome, b: Genome, prng: PRNG): Genome {
  const pick = <T>(x: T, y: T): T => (prng.next() < 0.5 ? x : y);
  const policy = Object.fromEntries(
    (Object.keys(a.policy) as (keyof PolicyWeights)[]).map((k) => [k, pick(a.policy[k], b.policy[k])])
  ) as unknown as PolicyWeights;
  return {
    policy,
    tag: pick(a.tag, b.tag),
    carryCapacity: pick(a.carryCapacity, b.carryCapacity),
    abilities: {
      diagonal: pick(a.abilities.diagonal, b.abilities.diagonal),
      squeeze: pick(a.abilities.squeeze, b.abilities.squeeze),
      leap: pick(a.abilities.leap, b.abilities.leap),
    },
    dispersal: pick(a.dispersal, b.dispersal),
    memorySpan: pick(a.memorySpan, b.memorySpan),
    memoryWeights: a.memoryWeights.map((w, i) => pick(w, b.memoryWeights[i] ?? w)),
    brain: crossBrains(a.brain, b.brain, prng),
    carnivory: pick(a.carnivory, b.carnivory),
  };
}
