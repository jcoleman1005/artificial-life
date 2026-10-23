import type {
  ActionScore,
  LegalAction,
  Organism,
  PolicyWeights,
  SensedInputs,
  SimulationConfig,
  WorldSnapshot,
} from './types';
import { PRNG } from './prng';

export const WEIGHT_MIN = -2.0;
export const WEIGHT_MAX = 2.0;

/**
 * Creates a randomized initial policy for pioneer organisms.
 */
export function createRandomPolicy(prng: PRNG): PolicyWeights {
  return {
    foodAttraction: Number(prng.nextFloat(0.2, 1.5).toFixed(3)),
    obstacleAvoidance: Number(prng.nextFloat(0.2, 1.2).toFixed(3)),
    crowdingAvoidance: Number(prng.nextFloat(-0.2, 0.8).toFixed(3)),
    exploreTendency: Number(prng.nextFloat(0.1, 0.9).toFixed(3)),
    eatDrive: Number(prng.nextFloat(0.5, 1.5).toFixed(3)),
    reproduceDrive: Number(prng.nextFloat(0.3, 1.2).toFixed(3)),
  };
}

/**
 * Mutates an inherited policy weights object with deterministic Gaussian perturbations.
 */
export function mutatePolicy(
  parentPolicy: Readonly<PolicyWeights>,
  config: Readonly<SimulationConfig>,
  prng: PRNG
): PolicyWeights {
  const clamp = (val: number) =>
    Number(Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, val)).toFixed(3));

  const mutateWeight = (current: number): number => {
    if (prng.next() < config.mutationRate) {
      const delta = prng.nextGaussian(0, config.mutationStdDev);
      return clamp(current + delta);
    }
    return current;
  };

  return {
    foodAttraction: mutateWeight(parentPolicy.foodAttraction),
    obstacleAvoidance: mutateWeight(parentPolicy.obstacleAvoidance),
    crowdingAvoidance: mutateWeight(parentPolicy.crowdingAvoidance),
    exploreTendency: mutateWeight(parentPolicy.exploreTendency),
    eatDrive: mutateWeight(parentPolicy.eatDrive),
    reproduceDrive: mutateWeight(parentPolicy.reproduceDrive),
  };
}

/**
 * Determines all hard-constraint-legal actions for an organism.
 */
export function getLegalActions(
  organism: Readonly<Organism>,
  snapshot: Readonly<WorldSnapshot>,
  _config: Readonly<SimulationConfig>,
  sensed: Readonly<SensedInputs>
): LegalAction[] {
  const actions: LegalAction[] = [];
  const { x, y } = organism;

  // 1. Move actions (Orthogonal)
  const candidateMoves: { type: LegalAction['type']; dx: number; dy: number }[] = [
    { type: 'MOVE_NORTH', dx: 0, dy: -1 },
    { type: 'MOVE_SOUTH', dx: 0, dy: 1 },
    { type: 'MOVE_EAST', dx: 1, dy: 0 },
    { type: 'MOVE_WEST', dx: -1, dy: 0 },
  ];

  for (const move of candidateMoves) {
    const targetX = x + move.dx;
    const targetY = y + move.dy;

    // Boundary check
    if (
      targetX < 0 ||
      targetX >= snapshot.gridWidth ||
      targetY < 0 ||
      targetY >= snapshot.gridHeight
    ) {
      continue;
    }

    // Obstacle check
    if (snapshot.obstacles.has(`${targetX},${targetY}`)) {
      continue;
    }

    actions.push({
      type: move.type,
      target: { x: targetX, y: targetY },
    });
  }

  // 2. Eat action
  if (sensed.canEat) {
    actions.push({
      type: 'EAT',
      target: { x, y },
    });
  }

  // 3. Reproduce actions
  if (sensed.canReproduce) {
    const candidateRepros: { type: LegalAction['type']; dx: number; dy: number }[] = [
      { type: 'REPRODUCE_NORTH', dx: 0, dy: -1 },
      { type: 'REPRODUCE_SOUTH', dx: 0, dy: 1 },
      { type: 'REPRODUCE_EAST', dx: 1, dy: 0 },
      { type: 'REPRODUCE_WEST', dx: -1, dy: 0 },
    ];

    for (const repro of candidateRepros) {
      const targetX = x + repro.dx;
      const targetY = y + repro.dy;

      // Cannot place child outside world bounds
      if (
        targetX < 0 ||
        targetX >= snapshot.gridWidth ||
        targetY < 0 ||
        targetY >= snapshot.gridHeight
      ) {
        continue;
      }

      // Cannot place child on obstacle
      if (snapshot.obstacles.has(`${targetX},${targetY}`)) {
        continue;
      }

      actions.push({
        type: repro.type,
        target: { x: targetX, y: targetY },
      });
    }
  }

  // 4. Rest action (always a fallback option)
  actions.push({
    type: 'REST',
    target: { x, y },
  });

  return actions;
}

/**
 * Scores an individual legal action using the organism's inherited policy and local senses.
 */
export function scoreAction(
  action: LegalAction,
  organism: Readonly<Organism>,
  sensed: Readonly<SensedInputs>,
  config: Readonly<SimulationConfig>,
  prng: PRNG
): ActionScore {
  const { policy } = organism;
  const components: Record<string, number> = {};
  let totalScore = 0;

  switch (action.type) {
    case 'EAT': {
      // Eat score is driven by energy deficit (hunger) and the eatDrive weight
      const hunger = 1.0 - sensed.energyRatio;
      const eatComponent = policy.eatDrive * hunger * 3.0 + 0.5;
      components['hungerDrive'] = Number(eatComponent.toFixed(3));
      totalScore = eatComponent;
      break;
    }

    case 'REPRODUCE_NORTH':
    case 'REPRODUCE_SOUTH':
    case 'REPRODUCE_EAST':
    case 'REPRODUCE_WEST': {
      // Reproduction score increases with energy above reproduction threshold
      const excessEnergy = Math.max(0, organism.energy - config.reproductionThreshold);
      const headroom = Math.max(1, config.maxEnergy - config.reproductionThreshold);
      const fullness = excessEnergy / headroom;
      const reproComponent = policy.reproduceDrive * fullness * 3.5 + 0.2;
      components['surplusDrive'] = Number(reproComponent.toFixed(3));
      totalScore = reproComponent;
      break;
    }

    case 'REST': {
      // Resting has neutral baseline score; organisms act if any constructive action has positive score
      components['baseline'] = 0.0;
      totalScore = 0.0;
      break;
    }

    case 'MOVE_NORTH':
    case 'MOVE_SOUTH':
    case 'MOVE_EAST':
    case 'MOVE_WEST': {
      let dx = 0;
      let dy = 0;
      if (action.type === 'MOVE_NORTH') dy = -1;
      if (action.type === 'MOVE_SOUTH') dy = 1;
      if (action.type === 'MOVE_EAST') dx = 1;
      if (action.type === 'MOVE_WEST') dx = -1;

      // 1. Food attraction component
      if (sensed.nearestFood) {
        const { dx: foodDx, dy: foodDy, distance } = sensed.nearestFood;
        const norm = Math.hypot(foodDx, foodDy) || 1;
        const dotProduct = (dx * (foodDx / norm) + dy * (foodDy / norm));
        const distanceFactor = 1 / (1 + 0.25 * distance);
        const foodComp = policy.foodAttraction * dotProduct * distanceFactor * 1.5;
        components['foodPull'] = Number(foodComp.toFixed(3));
        totalScore += foodComp;
      }

      // 2. Obstacle avoidance component
      if (sensed.nearestObstacle) {
        const { dx: obsDx, dy: obsDy, distance } = sensed.nearestObstacle;
        const norm = Math.hypot(obsDx, obsDy) || 1;
        // Repulsion: dot with vector pointing AWAY from obstacle (-obsDx, -obsDy)
        const dotAway = (dx * (-obsDx / norm) + dy * (-obsDy / norm));
        const distanceFactor = 1 / (1 + 0.5 * distance);
        const obsComp = policy.obstacleAvoidance * dotAway * distanceFactor;
        components['obstaclePush'] = Number(obsComp.toFixed(3));
        totalScore += obsComp;
      }

      // 3. Crowding avoidance component
      if (sensed.nearestOrganism) {
        const { dx: orgDx, dy: orgDy, distance } = sensed.nearestOrganism;
        const norm = Math.hypot(orgDx, orgDy) || 1;
        const dotAway = (dx * (-orgDx / norm) + dy * (-orgDy / norm));
        const distanceFactor = 1 / (1 + 0.3 * distance);
        const crowdComp = policy.crowdingAvoidance * dotAway * distanceFactor;
        components['crowdPush'] = Number(crowdComp.toFixed(3));
        totalScore += crowdComp;
      }

      // 4. Explore tendency (seeded stochastic wander preference)
      const exploreValue = prng.nextFloat(-0.8, 0.8);
      const exploreComp = policy.exploreTendency * exploreValue;
      components['explore'] = Number(exploreComp.toFixed(3));
      totalScore += exploreComp;

      break;
    }
  }

  return {
    action,
    totalScore: Number(totalScore.toFixed(3)),
    components,
  };
}

/**
 * Evaluates all legal actions and selects the highest scoring action.
 * Seeded PRNG breaks exact ties deterministically.
 */
export function evaluatePolicy(
  organism: Readonly<Organism>,
  legalActions: readonly LegalAction[],
  sensed: Readonly<SensedInputs>,
  config: Readonly<SimulationConfig>,
  prng: PRNG
): { chosenAction: LegalAction; scores: ActionScore[] } {
  if (legalActions.length === 0) {
    const fallback: LegalAction = { type: 'REST', target: { x: organism.x, y: organism.y } };
    return {
      chosenAction: fallback,
      scores: [
        {
          action: fallback,
          totalScore: 0,
          components: { fallback: 0 },
        },
      ],
    };
  }

  const scores = legalActions.map((action) =>
    scoreAction(action, organism, sensed, config, prng)
  );

  let bestScore = -Infinity;
  let bestCandidates: ActionScore[] = [];

  for (const s of scores) {
    if (s.totalScore > bestScore + 1e-6) {
      bestScore = s.totalScore;
      bestCandidates = [s];
    } else if (Math.abs(s.totalScore - bestScore) <= 1e-6) {
      bestCandidates.push(s);
    }
  }

  const winner =
    bestCandidates.length === 1 ? bestCandidates[0] : prng.choice(bestCandidates);

  return {
    chosenAction: winner.action,
    scores,
  };
}
