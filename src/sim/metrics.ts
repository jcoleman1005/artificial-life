import type {
  Organism,
  PolicyDiversityMetrics,
  SimulationConfig,
  TribeMetrics,
  WorldMetrics,
} from './types';
import { isKin, tagSimilarity } from './tags';

/** Smallest group of nearby look-alikes that counts as a tribe. */
export const MIN_TRIBE_SIZE = 5;
/** Look-alikes within this many cells (in both x and y) are linked into one group. */
export const TRIBE_LINK_RADIUS = 2;

/**
 * Finds tribes: connected groups of look-alikes, where two organisms are linked
 * if their tags count as kin and they live within TRIBE_LINK_RADIUS cells.
 * Also measures clustering: how often neighbours are kin, versus chance.
 */
export function computeTribeMetrics(
  organisms: readonly Organism[],
  config: Readonly<SimulationConfig>
): TribeMetrics {
  const n = organisms.length;
  if (n === 0) {
    return { tribeCount: 0, largestTribe: 0, inTribeFraction: 0, localKinFraction: 0, globalKinFraction: 0 };
  }

  const indexAt = new Map<string, number>();
  organisms.forEach((o, i) => indexAt.set(`${o.x},${o.y}`, i));

  // Union-find over kin links.
  const parent = organisms.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };

  let localKinSum = 0;
  let withNeighbours = 0;
  const r = TRIBE_LINK_RADIUS;
  organisms.forEach((o, i) => {
    let neighbours = 0;
    let kin = 0;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dy === 0) continue;
        const j = indexAt.get(`${o.x + dx},${o.y + dy}`);
        if (j === undefined) continue;
        neighbours++;
        if (isKin(o.tag, organisms[j].tag, config)) {
          kin++;
          parent[find(i)] = find(j);
        }
      }
    }
    if (neighbours > 0) {
      localKinSum += kin / neighbours;
      withNeighbours++;
    }
  });

  const groupSizes = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    groupSizes.set(root, (groupSizes.get(root) ?? 0) + 1);
  }
  let tribeCount = 0;
  let largestTribe = 0;
  let inTribe = 0;
  for (const size of groupSizes.values()) {
    if (size >= MIN_TRIBE_SIZE) {
      tribeCount++;
      inTribe += size;
      largestTribe = Math.max(largestTribe, size);
    }
  }

  // Chance baseline: fraction of all pairs that are kin. Tags are bucketed to
  // whole degrees so this stays cheap for large populations.
  const buckets = new Array<number>(360).fill(0);
  for (const o of organisms) buckets[Math.floor(o.tag) % 360]++;
  let kinPairs = 0;
  for (let a = 0; a < 360; a++) {
    if (buckets[a] === 0) continue;
    kinPairs += (buckets[a] * (buckets[a] - 1)) / 2;
    for (let b = a + 1; b < 360; b++) {
      if (buckets[b] > 0 && tagSimilarity(a, b) >= config.kinSimilarity) {
        kinPairs += buckets[a] * buckets[b];
      }
    }
  }
  const totalPairs = (n * (n - 1)) / 2;

  return {
    tribeCount,
    largestTribe,
    inTribeFraction: Number((inTribe / n).toFixed(3)),
    localKinFraction: withNeighbours > 0 ? Number((localKinSum / withNeighbours).toFixed(3)) : 0,
    globalKinFraction: totalPairs > 0 ? Number((kinPairs / totalPairs).toFixed(3)) : 0,
  };
}

/**
 * Calculates statistical variance of an array of numbers.
 */
function calculateVariance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const squareDiffs = values.map((v) => {
    const diff = v - mean;
    return diff * diff;
  });
  const avgSquareDiff = squareDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  return Number(avgSquareDiff.toFixed(4));
}

export function computePolicyDiversity(organisms: readonly Organism[]): PolicyDiversityMetrics {
  if (organisms.length === 0) {
    return {
      foodAttractionVariance: 0,
      obstacleAvoidanceVariance: 0,
      crowdingAvoidanceVariance: 0,
      exploreTendencyVariance: 0,
      eatDriveVariance: 0,
      reproduceDriveVariance: 0,
      averageDiversity: 0,
    };
  }

  const foodAttractionVariance = calculateVariance(
    organisms.map((o) => o.policy.foodAttraction)
  );
  const obstacleAvoidanceVariance = calculateVariance(
    organisms.map((o) => o.policy.obstacleAvoidance)
  );
  const crowdingAvoidanceVariance = calculateVariance(
    organisms.map((o) => o.policy.crowdingAvoidance)
  );
  const exploreTendencyVariance = calculateVariance(
    organisms.map((o) => o.policy.exploreTendency)
  );
  const eatDriveVariance = calculateVariance(
    organisms.map((o) => o.policy.eatDrive)
  );
  const reproduceDriveVariance = calculateVariance(
    organisms.map((o) => o.policy.reproduceDrive)
  );

  const averageDiversity = Number(
    (
      (foodAttractionVariance +
        obstacleAvoidanceVariance +
        crowdingAvoidanceVariance +
        exploreTendencyVariance +
        eatDriveVariance +
        reproduceDriveVariance) /
      6
    ).toFixed(4)
  );

  return {
    foodAttractionVariance,
    obstacleAvoidanceVariance,
    crowdingAvoidanceVariance,
    exploreTendencyVariance,
    eatDriveVariance,
    reproduceDriveVariance,
    averageDiversity,
  };
}

export function computeWorldMetrics(
  tick: number,
  organisms: readonly Organism[],
  totalFoodStock: number,
  activePatchCount: number,
  birthsTotal: number,
  deathsTotal: number,
  deceased: { readonly count: number; readonly lifespanSum: number },
  sharesTotal: number,
  kinSharesTotal: number,
  parentalSharesTotal: number,
  immigrantsTotal: number,
  config: Readonly<SimulationConfig>
): Omit<WorldMetrics, 'season' | 'signalsTotal' | 'signalsOnFoodTotal' | 'plants'> {
  const population = organisms.length;

  let maxGeneration = 1;
  const lineageSet = new Set<string>();
  let totalOffspringCount = 0;

  for (const o of organisms) {
    if (o.lineage.generation > maxGeneration) {
      maxGeneration = o.lineage.generation;
    }
    lineageSet.add(o.lineage.id);
    totalOffspringCount += o.offspringCount;
  }

  const averageLifespan =
    deceased.count > 0
      ? Number((deceased.lifespanSum / deceased.count).toFixed(1))
      : population > 0
      ? Number(
          (organisms.reduce((a, b) => a + b.age, 0) / population).toFixed(1)
        )
      : 0;

  const averageOffspringPerParent =
    population > 0 ? Number((totalOffspringCount / population).toFixed(2)) : 0;

  const diversity = computePolicyDiversity(organisms);

  return {
    tick,
    population,
    totalFoodStock,
    activePatchCount,
    birthsTotal,
    deathsTotal,
    maxGeneration,
    averageLifespan,
    averageOffspringPerParent,
    activeLineageCount: lineageSet.size,
    diversity,
    tribes: computeTribeMetrics(organisms, config),
    sharesTotal,
    kinSharesTotal,
    parentalSharesTotal,
    immigrantsTotal,
  };
}
