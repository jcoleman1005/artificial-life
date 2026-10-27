import type { Abilities, Organism } from './types';

export interface TraitSnapshot {
  readonly tag: number;
  readonly size: number;
  readonly carnivory: number;
  readonly herbivory?: number;
  readonly carryCapacity: number;
  readonly dispersal: number;
  readonly memorySpan: number;
  readonly abilities: Abilities;
  readonly reproThreshold?: number;
  readonly investment?: number;
  readonly metabolicRate?: number;
  readonly sensingRadius?: number;
  readonly digestiveEfficiency?: number;
  readonly clutchSize?: number;
  readonly eggAllocation?: number;
}

export interface CrossoverInfo {
  readonly parentShare: number;
  readonly mateShare: number;
  readonly mateTraits: readonly string[];
}

export interface AncestorNode {
  readonly id: string;
  readonly lineageId: string;
  readonly tag: number;
  readonly generation: number;
  readonly parentId: string | null;
  readonly mateId?: string | null;
  readonly birthTick: number;
  readonly traits: TraitSnapshot;
  readonly mutations: readonly string[];
  readonly crossover?: CrossoverInfo;
}

/** Extracts an immutable trait snapshot from an organism. */
export function snapshotTraits(org: Readonly<Organism>): TraitSnapshot {
  return {
    tag: org.tag,
    size: org.size ?? 1.0,
    carnivory: org.carnivory,
    ...(org.herbivory !== undefined ? { herbivory: org.herbivory } : {}),
    carryCapacity: org.carryCapacity,
    dispersal: org.dispersal,
    memorySpan: org.memorySpan,
    abilities: { ...org.abilities },
    ...(org.reproThreshold !== undefined ? { reproThreshold: org.reproThreshold } : {}),
    ...(org.investment !== undefined ? { investment: org.investment } : {}),
    ...(org.metabolicRate !== undefined ? { metabolicRate: org.metabolicRate } : {}),
    ...(org.sensingRadius !== undefined ? { sensingRadius: org.sensingRadius } : {}),
    ...(org.digestiveEfficiency !== undefined ? { digestiveEfficiency: org.digestiveEfficiency } : {}),
    ...(org.clutchSize !== undefined ? { clutchSize: org.clutchSize } : {}),
    ...(org.eggAllocation !== undefined ? { eggAllocation: org.eggAllocation } : {}),
  };
}

/** Computes circular difference between two hues in degrees [-180, 180]. */
function hueDelta(a: number, b: number): number {
  let diff = (a - b) % 360;
  if (diff < -180) diff += 360;
  if (diff > 180) diff -= 360;
  return diff;
}

/**
 * Computes human-readable mutation badges and crossover attribution for a newborn
 * relative to its parent (and mate, if born of sexual reproduction).
 */
export function attributeGenomeChanges(
  child: Readonly<Organism>,
  parent?: Readonly<Organism> | TraitSnapshot | null,
  mate?: Readonly<Organism> | TraitSnapshot | null
): { mutations: string[]; crossover?: CrossoverInfo } {
  if (!parent) {
    return { mutations: ['Founder ancestor'] };
  }

  const mutations: string[] = [];

  if (!mate) {
    // Asexual reproduction (cloning): all differences are mutations
    const tagDiff = hueDelta(child.tag, parent.tag);
    if (Math.abs(tagDiff) >= 1) {
      mutations.push(`Tag ${tagDiff > 0 ? '+' : ''}${Math.round(tagDiff)}°`);
    }

    const cSize = child.size ?? 1.0;
    const pSize = parent.size ?? 1.0;
    if (Math.abs(cSize - pSize) >= 0.02) {
      mutations.push(`Size ${cSize > pSize ? '+' : ''}${Math.round((cSize - pSize) * 100)}% (${cSize.toFixed(2)}×)`);
    }

    if (Math.abs((child.carnivory ?? 0) - (parent.carnivory ?? 0)) >= 0.02) {
      const cCarn = child.carnivory ?? 0;
      const pCarn = parent.carnivory ?? 0;
      mutations.push(`Diet ${cCarn > pCarn ? '+' : ''}${Math.round((cCarn - pCarn) * 100)}% meat`);
    }

    const cCarry = child.carryCapacity ?? 0;
    const pCarry = parent.carryCapacity ?? 0;
    if (cCarry !== pCarry) {
      mutations.push(`Carry ${pCarry} → ${cCarry}`);
    }

    const cDisp = child.dispersal ?? 1;
    const pDisp = parent.dispersal ?? 1;
    if (cDisp !== pDisp) {
      mutations.push(`Dispersal ${pDisp} → ${cDisp}`);
    }

    const cMem = child.memorySpan ?? 0;
    const pMem = parent.memorySpan ?? 0;
    if (cMem !== pMem) {
      mutations.push(`Memory ${pMem} → ${cMem}t`);
    }

    // Abilities
    const pAbilities = parent.abilities ?? { diagonal: false, squeeze: false, leap: false };
    const cAbilities = child.abilities ?? { diagonal: false, squeeze: false, leap: false };
    if (Boolean(cAbilities.diagonal) !== Boolean(pAbilities.diagonal)) {
      mutations.push(cAbilities.diagonal ? '+Diagonal' : '-Diagonal');
    }
    if (Boolean(cAbilities.squeeze) !== Boolean(pAbilities.squeeze)) {
      mutations.push(cAbilities.squeeze ? '+Squeeze' : '-Squeeze');
    }
    if (Boolean(cAbilities.leap) !== Boolean(pAbilities.leap)) {
      mutations.push(cAbilities.leap ? '+Leap' : '-Leap');
    }

    // Life history genes
    if (child.reproThreshold !== undefined && parent.reproThreshold !== undefined && Math.abs(child.reproThreshold - parent.reproThreshold) >= 1) {
      mutations.push(`Threshold ${Math.round(parent.reproThreshold)} → ${Math.round(child.reproThreshold)}E`);
    }
    if (child.investment !== undefined && parent.investment !== undefined && Math.abs(child.investment - parent.investment) >= 0.02) {
      mutations.push(`Investment ${Math.round(parent.investment * 100)}% → ${Math.round(child.investment * 100)}%`);
    }
    if (child.metabolicRate !== undefined && parent.metabolicRate !== undefined && Math.abs(child.metabolicRate - parent.metabolicRate) >= 0.02) {
      mutations.push(`Metabolism ${parent.metabolicRate.toFixed(2)}× → ${child.metabolicRate.toFixed(2)}×`);
    }
    if (child.sensingRadius !== undefined && parent.sensingRadius !== undefined && Math.abs(child.sensingRadius - parent.sensingRadius) >= 0.1) {
      mutations.push(`Vision ${parent.sensingRadius.toFixed(1)} → ${child.sensingRadius.toFixed(1)} cells`);
    }
    if (child.digestiveEfficiency !== undefined && parent.digestiveEfficiency !== undefined && Math.abs(child.digestiveEfficiency - parent.digestiveEfficiency) >= 0.02) {
      mutations.push(`Digestion ${Math.round(parent.digestiveEfficiency * 100)}% → ${Math.round(child.digestiveEfficiency * 100)}%`);
    }

    return { mutations: mutations.length ? mutations : ['Identical clone'] };
  }

  // Sexual reproduction (mating): analyze crossover contributions and residual mutations
  const mateTraits: string[] = [];
  let mateScore = 0;
  let parentScore = 0;

  const pAbilities = parent.abilities ?? { diagonal: false, squeeze: false, leap: false };
  const mAbilities = mate.abilities ?? { diagonal: false, squeeze: false, leap: false };
  const cAbilities = child.abilities ?? { diagonal: false, squeeze: false, leap: false };

  // Abilities
  if (Boolean(cAbilities.leap) === Boolean(mAbilities.leap) && Boolean(cAbilities.leap) !== Boolean(pAbilities.leap)) {
    mateTraits.push(cAbilities.leap ? 'Leap' : 'No Leap');
    mateScore++;
  } else {
    parentScore++;
  }

  if (Boolean(cAbilities.squeeze) === Boolean(mAbilities.squeeze) && Boolean(cAbilities.squeeze) !== Boolean(pAbilities.squeeze)) {
    mateTraits.push(cAbilities.squeeze ? 'Squeeze' : 'No Squeeze');
    mateScore++;
  } else {
    parentScore++;
  }

  if (Boolean(cAbilities.diagonal) === Boolean(mAbilities.diagonal) && Boolean(cAbilities.diagonal) !== Boolean(pAbilities.diagonal)) {
    mateTraits.push(cAbilities.diagonal ? 'Diagonal' : 'No Diagonal');
    mateScore++;
  } else {
    parentScore++;
  }

  // Continuous traits: compare distance
  const checkCloserToMate = (c: number, p: number, m: number, name: string) => {
    const distP = Math.abs(c - p);
    const distM = Math.abs(c - m);
    if (distM < distP && Math.abs(p - m) > 0.01) {
      mateTraits.push(name);
      mateScore++;
    } else {
      parentScore++;
    }
  };

  checkCloserToMate(child.carnivory ?? 0, parent.carnivory ?? 0, mate.carnivory ?? 0, 'Diet');
  checkCloserToMate(child.dispersal ?? 1, parent.dispersal ?? 1, mate.dispersal ?? 1, 'Dispersal');
  checkCloserToMate(child.carryCapacity ?? 0, parent.carryCapacity ?? 0, mate.carryCapacity ?? 0, 'Carry');
  checkCloserToMate(child.size ?? 1.0, parent.size ?? 1.0, mate.size ?? 1.0, 'Size');
  checkCloserToMate(child.metabolicRate ?? 1.0, parent.metabolicRate ?? 1.0, mate.metabolicRate ?? 1.0, 'Metabolism');

  const total = Math.max(1, parentScore + mateScore);
  const mateShare = Math.round((mateScore / total) * 100) / 100;
  const parentShare = Math.round((1 - mateShare) * 100) / 100;

  // Detect distinct mutations outside both parents' ranges
  const minSize = Math.min(parent.size ?? 1.0, mate.size ?? 1.0);
  const maxSize = Math.max(parent.size ?? 1.0, mate.size ?? 1.0);
  const cSize = child.size ?? 1.0;
  if (cSize > maxSize + 0.02 || cSize < minSize - 0.02) {
    mutations.push(`Size ${cSize > maxSize ? '+' : ''}${Math.round((cSize - (cSize > maxSize ? maxSize : minSize)) * 100)}% novel`);
  }

  const minCarn = Math.min(parent.carnivory ?? 0, mate.carnivory ?? 0);
  const maxCarn = Math.max(parent.carnivory ?? 0, mate.carnivory ?? 0);
  const cCarn = child.carnivory ?? 0;
  if (cCarn > maxCarn + 0.02 || cCarn < minCarn - 0.02) {
    mutations.push(`Diet ${cCarn > maxCarn ? '+' : ''}${Math.round((cCarn - (cCarn > maxCarn ? maxCarn : minCarn)) * 100)}% novel`);
  }

  const tagFromP = Math.abs(hueDelta(child.tag, parent.tag));
  const tagFromM = Math.abs(hueDelta(child.tag, mate.tag));
  if (tagFromM < tagFromP && Math.abs(hueDelta(parent.tag, mate.tag)) > 5) {
    mateTraits.push('Tag');
  } else if (tagFromP > 5 && tagFromM > 5) {
    mutations.push(`Tag drift`);
  }

  return {
    mutations: mutations.length ? mutations : ['Mating crossover'],
    crossover: {
      parentShare,
      mateShare,
      mateTraits,
    },
  };
}

/**
 * Tracks genealogical descent and genome inheritance for all organisms.
 * Prunes dead lineages that leave no living descendants to maintain bounded memory.
 */
export class LineageTracker {
  private readonly nodes = new Map<string, AncestorNode>();

  /** Records a birth event with trait snapshot and change attribution. */
  public recordBirth(
    child: Readonly<Organism>,
    parent: Readonly<Organism> | null,
    mate: Readonly<Organism> | null,
    birthTick: number
  ): AncestorNode {
    const { mutations, crossover } = attributeGenomeChanges(child, parent, mate);
    const node: AncestorNode = {
      id: child.id,
      lineageId: child.lineage.id,
      tag: child.tag,
      generation: child.lineage.generation,
      parentId: parent ? parent.id : null,
      mateId: mate ? mate.id : null,
      birthTick,
      traits: snapshotTraits(child),
      mutations,
      ...(crossover ? { crossover } : {}),
    };
    this.nodes.set(child.id, node);
    return node;
  }

  /**
   * Retrieves the ancestry DAG for an organism up to founders or a maximum generation depth.
   * Returns nodes in ascending generational order (founders first, child last).
   */
  public getAncestry(organismId: string, maxGenerations = 12): readonly AncestorNode[] {
    const target = this.nodes.get(organismId);
    if (!target) return [];

    const result = new Map<string, AncestorNode>();
    const queue: { id: string; depth: number }[] = [{ id: organismId, depth: 0 }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      result.set(id, node);
      if (depth >= maxGenerations) continue;

      if (node.parentId && this.nodes.has(node.parentId)) {
        queue.push({ id: node.parentId, depth: depth + 1 });
      }
      if (node.mateId && this.nodes.has(node.mateId)) {
        queue.push({ id: node.mateId, depth: depth + 1 });
      }
    }

    // Sort by generation ascending so founders come first
    return Array.from(result.values()).sort((a, b) => a.generation - b.generation || a.birthTick - b.birthTick);
  }

  /**
   * Prunes nodes that are not reachable from any of the provided active organism IDs.
   * Keeps memory bounded (< 200 KB) even in multi-hundred-thousand-tick runs.
   */
  public prune(activeOrganismIds: Iterable<string>): void {
    const reachable = new Set<string>();
    const queue: string[] = Array.from(activeOrganismIds);

    while (queue.length > 0) {
      const id = queue.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);

      const node = this.nodes.get(id);
      if (!node) continue;

      if (node.parentId && !reachable.has(node.parentId) && this.nodes.has(node.parentId)) {
        queue.push(node.parentId);
      }
      if (node.mateId && !reachable.has(node.mateId) && this.nodes.has(node.mateId)) {
        queue.push(node.mateId);
      }
    }

    for (const id of Array.from(this.nodes.keys())) {
      if (!reachable.has(id)) {
        this.nodes.delete(id);
      }
    }
  }

  public get size(): number {
    return this.nodes.size;
  }

  public exportState(): AncestorNode[] {
    return Array.from(this.nodes.values());
  }

  public fromState(nodes: readonly AncestorNode[]): void {
    this.nodes.clear();
    for (const node of nodes) {
      this.nodes.set(node.id, node);
    }
  }

  public static fromState(nodes: readonly AncestorNode[]): LineageTracker {
    const tracker = new LineageTracker();
    tracker.fromState(nodes);
    return tracker;
  }
}
