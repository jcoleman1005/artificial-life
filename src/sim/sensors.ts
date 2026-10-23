import type {
  Organism,
  SensedInputs,
  SensedEntity,
  SimulationConfig,
  WorldSnapshot,
} from './types';

/**
 * Computes an organism's sensory perceptions based strictly on the pre-tick world snapshot.
 * Limited to sensingRadius cells. No global map knowledge is leaked.
 */
export function senseEnvironment(
  organism: Readonly<Organism>,
  snapshot: Readonly<WorldSnapshot>,
  config: Readonly<SimulationConfig>
): SensedInputs {
  const { x, y, energy } = organism;
  const radius = config.sensingRadius;
  const currentKey = `${x},${y}`;

  // Current cell food
  const currentPatch = snapshot.foodPatches.get(currentKey);
  const currentCellFood = currentPatch ? currentPatch.stock : 0;

  let nearestFood: SensedEntity | null = null;
  let minFoodDist = Infinity;

  let nearestObstacle: SensedEntity | null = null;
  let minObstacleDist = Infinity;

  let nearestOrganism: SensedEntity | null = null;
  let minOrganismDist = Infinity;
  let surroundingOrganismCount = 0;

  // Scan local window [x - radius, x + radius] x [y - radius, y + radius]
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;

      const targetX = x + dx;
      const targetY = y + dy;
      const manhattanDist = Math.abs(dx) + Math.abs(dy);
      const key = `${targetX},${targetY}`;

      // Check boundary as an obstacle
      const isOutOfBounds =
        targetX < 0 ||
        targetX >= snapshot.gridWidth ||
        targetY < 0 ||
        targetY >= snapshot.gridHeight;

      if (isOutOfBounds) {
        if (manhattanDist < minObstacleDist) {
          minObstacleDist = manhattanDist;
          nearestObstacle = {
            x: targetX,
            y: targetY,
            distance: manhattanDist,
            dx,
            dy,
          };
        }
        continue;
      }

      // Check terrain obstacles
      if (snapshot.obstacles.has(key)) {
        if (manhattanDist < minObstacleDist) {
          minObstacleDist = manhattanDist;
          nearestObstacle = {
            x: targetX,
            y: targetY,
            distance: manhattanDist,
            dx,
            dy,
          };
        }
      }

      // Check food patches
      const patch = snapshot.foodPatches.get(key);
      if (patch && patch.stock > 0) {
        if (manhattanDist < minFoodDist) {
          minFoodDist = manhattanDist;
          nearestFood = {
            x: targetX,
            y: targetY,
            distance: manhattanDist,
            dx,
            dy,
            value: patch.stock,
          };
        }
      }
    }
  }

  // Sense other organisms within local radius
  for (const other of snapshot.organisms) {
    if (other.id === organism.id) continue;
    const dx = other.x - x;
    const dy = other.y - y;
    if (Math.abs(dx) <= radius && Math.abs(dy) <= radius) {
      surroundingOrganismCount++;
      const manhattanDist = Math.abs(dx) + Math.abs(dy);
      if (manhattanDist < minOrganismDist) {
        minOrganismDist = manhattanDist;
        nearestOrganism = {
          x: other.x,
          y: other.y,
          distance: manhattanDist,
          dx,
          dy,
        };
      }
    }
  }

  // Check action preconditions
  const canEat = currentCellFood > 0 && energy < config.maxEnergy;

  // Can reproduce if energy threshold met and at least one orthogonal cell is inside bounds and not an obstacle
  let canReproduce = energy >= config.reproductionThreshold;
  if (canReproduce) {
    let hasValidCell = false;
    const neighbors = [
      { x: x, y: y - 1 },
      { x: x, y: y + 1 },
      { x: x + 1, y: y },
      { x: x - 1, y: y },
    ];
    for (const nb of neighbors) {
      if (
        nb.x >= 0 &&
        nb.x < snapshot.gridWidth &&
        nb.y >= 0 &&
        nb.y < snapshot.gridHeight &&
        !snapshot.obstacles.has(`${nb.x},${nb.y}`)
      ) {
        hasValidCell = true;
        break;
      }
    }
    canReproduce = hasValidCell;
  }

  return {
    currentEnergy: energy,
    energyRatio: Math.min(1, Math.max(0, energy / config.maxEnergy)),
    currentCellFood,
    nearestFood,
    nearestObstacle,
    nearestOrganism,
    surroundingOrganismCount,
    canEat,
    canReproduce,
  };
}
