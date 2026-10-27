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

const NEARBY: number[] = [];

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

  // Organisms in the window, as indices into snapshot.organisms (scratch, reused across calls)
  const nearbyIndices = NEARBY;
  nearbyIndices.length = 0;

  const { gridHeight, organismGrid, obstacleGrid, foodGrid, carrionGrid } = snapshot;

  // Nearest of each kind, kept as numbers and turned into entities once at the end. Ties
  // go to the first cell in scan order (rows top to bottom, left to right), as strict `<` did.
  let obsDx = 0, obsDy = 0;
  let foodDx = 0, foodDy = 0, foodValue = 0;
  let carrDx = 0, carrDy = 0, carrValue = 0;

  // Scan local window [x - radius, x + radius] x [y - radius, y + radius]. The out-of-bounds
  // cells count as obstacles, but only the nearest one on each side of a row can be the nearest
  // overall, so the rest are skipped.
  const xLo = Math.max(0, x - radius);
  const xHi = Math.min(width - 1, x + radius);
  for (let dy = -radius; dy <= radius; dy++) {
    const targetY = y + dy;
    const absDy = dy < 0 ? -dy : dy;
    if (targetY < 0 || targetY >= gridHeight) {
      // A whole row outside: its nearest cell is straight above or below.
      if (absDy < minObstacleDist) {
        minObstacleDist = absDy;
        obsDx = 0;
        obsDy = dy;
      }
      continue;
    }
    if (x - radius < 0) {
      const dx = -x - 1; // the nearest cell off the left edge
      const dist = -dx + absDy;
      if (dist < minObstacleDist) {
        minObstacleDist = dist;
        obsDx = dx;
        obsDy = dy;
      }
    }
    const rowBase = targetY * width;
    for (let targetX = xLo; targetX <= xHi; targetX++) {
      const dx = targetX - x;
      if (dx === 0 && dy === 0) continue;
      const manhattanDist = (dx < 0 ? -dx : dx) + absDy;
      const cell = rowBase + targetX;

      const occupant = organismGrid[cell];
      if (occupant >= 0) nearbyIndices.push(occupant);

      if (obstacleGrid[cell] === 1 && manhattanDist < minObstacleDist) {
        minObstacleDist = manhattanDist;
        obsDx = dx;
        obsDy = dy;
      }

      const stock = foodGrid[cell];
      if (stock > 0 && manhattanDist < minFoodDist) {
        minFoodDist = manhattanDist;
        foodDx = dx;
        foodDy = dy;
        foodValue = stock;
      }

      const carrion = carrionGrid[cell];
      if (carrion > 0 && manhattanDist < minCarrionDist) {
        minCarrionDist = manhattanDist;
        carrDx = dx;
        carrDy = dy;
        carrValue = carrion;
      }
    }
    if (x + radius >= width) {
      const dx = width - x; // the nearest cell off the right edge
      const dist = dx + absDy;
      if (dist < minObstacleDist) {
        minObstacleDist = dist;
        obsDx = dx;
        obsDy = dy;
      }
    }
  }
  if (minObstacleDist < Infinity) {
    nearestObstacle = { x: x + obsDx, y: y + obsDy, distance: minObstacleDist, dx: obsDx, dy: obsDy };
  }
  if (minFoodDist < Infinity) {
    nearestFood = { x: x + foodDx, y: y + foodDy, distance: minFoodDist, dx: foodDx, dy: foodDy, value: foodValue };
  }
  if (minCarrionDist < Infinity) {
    nearestCarrion = { x: x + carrDx, y: y + carrDy, distance: minCarrionDist, dx: carrDx, dy: carrDy, value: carrValue };
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
    const open = (nx: number, ny: number) =>
      nx >= 0 && nx < snapshot.gridWidth && ny >= 0 && ny < snapshot.gridHeight && snapshot.obstacleGrid[ny * width + nx] === 0;
    const hasValidCell = open(x, y - 1) || open(x, y + 1) || open(x + 1, y) || open(x - 1, y);
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
