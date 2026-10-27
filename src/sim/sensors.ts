import type {
  Organism,
  SensedInputs,
  SensedEntity,
  SimulationConfig,
  WorldSnapshot,
} from './types';
import { tagSimilarity } from './tags';
import { isParentOf } from './family';
import { recall } from './memory';
import { carrionYield, plantYield } from './traits';
import { fatRoom, maxEnergyOf, sensingRadiusOf, thresholdOf } from './lifehistory';

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
  const radius = Math.round(sensingRadiusOf(organism, config));
  const width = snapshot.gridWidth;

  // Current cell food (grids are indexed y * width + x)
  const currentCellFood = snapshot.foodGrid[y * width + x];
  const currentCellCarrion = snapshot.carrionGrid[y * width + x];

  let nearestFood: SensedEntity | null = null;
  let minFoodDist = Infinity;
  let nearestCarrion: SensedEntity | null = null;
  let minCarrionDist = Infinity;

  let nearestObstacle: SensedEntity | null = null;
  let minObstacleDist = Infinity;

  let nearestOrganism: SensedEntity | null = null;
  let minOrganismDist = Infinity;
  let surroundingOrganismCount = 0;
  let nearbyKinCount = 0;
  let nearbyStrangerCount = 0;
  let parentWithFood: SensedEntity | null = null;
  let kinPullX = 0;
  let kinPullY = 0;

  // Organisms in the window, as indices into snapshot.organisms
  const nearbyIndices: number[] = [];

  // Scan local window [x - radius, x + radius] x [y - radius, y + radius]
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;

      const targetX = x + dx;
      const targetY = y + dy;
      const manhattanDist = Math.abs(dx) + Math.abs(dy);

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

      const cell = targetY * width + targetX;
      const occupant = snapshot.organismGrid[cell];
      if (occupant >= 0) nearbyIndices.push(occupant);

      // Check terrain obstacles
      if (snapshot.obstacleGrid[cell] === 1) {
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
      const stock = snapshot.foodGrid[cell];
      if (stock > 0) {
        if (manhattanDist < minFoodDist) {
          minFoodDist = manhattanDist;
          nearestFood = {
            x: targetX,
            y: targetY,
            distance: manhattanDist,
            dx,
            dy,
            value: stock,
          };
        }
      }

      const carrion = snapshot.carrionGrid[cell];
      if (carrion > 0 && manhattanDist < minCarrionDist) {
        minCarrionDist = manhattanDist;
        nearestCarrion = { x: targetX, y: targetY, distance: manhattanDist, dx, dy, value: carrion };
      }
    }
  }

  // Sense other organisms within local radius, in snapshot order (the sums
  // and nearest-neighbour tie-breaks below depend on that order)
  nearbyIndices.sort((a, b) => a - b);
  for (const index of nearbyIndices) {
    const other = snapshot.organisms[index];
    if (other.id === organism.id) continue;
    const dx = other.x - x;
    const dy = other.y - y;
    {
      surroundingOrganismCount++;
      const manhattanDist = Math.abs(dx) + Math.abs(dy);

      // Similar organisms pull, dissimilar ones push, graded from +1
      // (identical tag) to -1 (opposite tag); nearer ones count more.
      const similarity = tagSimilarity(organism.tag, other.tag);
      if (similarity >= config.kinSimilarity) nearbyKinCount++;
      if (similarity <= config.strangerSimilarity) nearbyStrangerCount++;
      const sign = similarity * 2 - 1;
      const norm = Math.sqrt(dx * dx + dy * dy);
      const weight = 1 / (1 + 0.3 * manhattanDist);
      kinPullX += (sign * weight * dx) / norm;
      kinPullY += (sign * weight * dy) / norm;

      // In childhood, notice one's parent (the nearer, if both parents) when it is carrying food.
      if (
        isParentOf(other, organism) &&
        organism.age < config.childhoodTicks &&
        other.carriedFood > 0 &&
        (!parentWithFood || manhattanDist < parentWithFood.distance)
      ) {
        parentWithFood = {
          x: other.x,
          y: other.y,
          distance: manhattanDist,
          dx,
          dy,
          value: other.carriedFood,
        };
      }

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

  // Signals carry farther than sight: the nearest organism that signalled
  // last tick within signalRadius (ties go to the earlier in the snapshot).
  let nearestSignal: SensedEntity | null = null;
  for (const index of snapshot.signallers) {
    const other = snapshot.organisms[index];
    if (other.id === organism.id) continue;
    const dx = other.x - x;
    const dy = other.y - y;
    const distance = Math.abs(dx) + Math.abs(dy);
    if (distance > config.signalRadius) continue;
    if (!nearestSignal || distance < nearestSignal.distance) {
      nearestSignal = {
        x: other.x,
        y: other.y,
        distance,
        dx,
        dy,
        value: Number(tagSimilarity(organism.tag, other.tag).toFixed(3)),
      };
    }
  }

  // Check action preconditions
  const { carriedFood } = organism;
  // Eating needs food here or in hand, and room for a full meal, so a
  // Nearly full organism never spends a whole food unit on a few points.
  const maxEnergy = maxEnergyOf(organism, config);
  const canEat =
    (currentCellFood > 0 || carriedFood > 0) &&
    (energy <= maxEnergy - plantYield(organism, config) || fatRoom(organism, config) >= 1);
  // The same for carrion, for a diet that gets at least one energy point from it.
  const meatYield = carrionYield(organism, config);
  const canEatCarrion =
    currentCellCarrion > 0 && meatYield >= 1 && (energy <= maxEnergy - meatYield || fatRoom(organism, config) >= 1);
  const canPickUp = currentCellFood > 0 && carriedFood < organism.carryCapacity;

  // Can reproduce if energy threshold met and at least one orthogonal cell is inside bounds and not an obstacle
  let canReproduce = energy >= thresholdOf(organism, config) && snapshot.tick >= (organism.nextBirthTick ?? 0);
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
        snapshot.obstacleGrid[nb.y * width + nb.x] === 0
      ) {
        hasValidCell = true;
        break;
      }
    }
    canReproduce = hasValidCell;
  }

  const canGive = config.sharingEnabled && carriedFood > 0;

  const remembered = recall(organism.memory, organism.memorySpan, x, y, snapshot.tick, config);

  return {
    currentEnergy: energy,
    energyRatio: Math.min(1, Math.max(0, energy / maxEnergy)),
    currentCellFood,
    carriedFood,
    nearestFood,
    nearestObstacle,
    nearestOrganism,
    surroundingOrganismCount,
    nearbyKinCount,
    nearbyStrangerCount,
    kinPull:
      surroundingOrganismCount > 0
        ? { dx: Number(kinPullX.toFixed(3)), dy: Number(kinPullY.toFixed(3)) }
        : null,
    parentWithFood,
    nearestSignal,
    currentCellCarrion,
    nearestCarrion,
    canEatCarrion,
    canEat,
    canPickUp,
    canReproduce,
    canGive,
    canSignal: config.signalsEnabled,
    rememberedFood: remembered.food,
    rememberedSignal: remembered.signal,
    home: remembered.home,
    registers: remembered.registers,
  };
}
