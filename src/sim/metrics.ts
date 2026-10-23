import type {
  Organism,
  PolicyDiversityMetrics,
  WorldMetrics,
} from './types';

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
  deceasedLifespans: readonly number[]
): WorldMetrics {
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
    deceasedLifespans.length > 0
      ? Number(
          (
            deceasedLifespans.reduce((a, b) => a + b, 0) /
            deceasedLifespans.length
          ).toFixed(1)
        )
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
  };
}
