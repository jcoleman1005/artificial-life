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
import { isKin, shareWeightFor, tagSimilarity } from './tags';

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
    // Social weights start centred on zero and identical for kin and
    // strangers, so any in-group bias has to evolve.
    kinAffinity: Number(prng.nextFloat(-0.5, 0.5).toFixed(3)),
    shareWithKin: Number(prng.nextFloat(-0.75, 0.75).toFixed(3)),
    shareWithStrangers: Number(prng.nextFloat(-0.75, 0.75).toFixed(3)),
    // Parents start out caring; evolution can weaken or strengthen it.
    careForChildren: Number(prng.nextFloat(1.0, 2.0).toFixed(3)),
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
    kinAffinity: mutateWeight(parentPolicy.kinAffinity),
    shareWithKin: mutateWeight(parentPolicy.shareWithKin),
    shareWithStrangers: mutateWeight(parentPolicy.shareWithStrangers),
    careForChildren: mutateWeight(parentPolicy.careForChildren),
  };
}

/**
 * Determines all hard-constraint-legal actions for an organism.
 */
export function getLegalActions(
  organism: Readonly<Organism>,
  snapshot: Readonly<WorldSnapshot>,
  config: Readonly<SimulationConfig>,
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

  // 4. Share actions: give energy to an orthogonally adjacent organism that
  // is below half energy (organisms can see whether a neighbour is hungry).
  // Ordinary sharing needs canShare; feeding one's own child is allowed
  // down to the lower parentalMinEnergyAfter floor.
  if (config.sharingEnabled) {
    const half = config.maxEnergy / 2;
    const canFeedChild =
      organism.energy - config.shareAmount >= config.parentalMinEnergyAfter;
    const candidateShares: { type: LegalAction['type']; dx: number; dy: number }[] = [
      { type: 'SHARE_NORTH', dx: 0, dy: -1 },
      { type: 'SHARE_SOUTH', dx: 0, dy: 1 },
      { type: 'SHARE_EAST', dx: 1, dy: 0 },
      { type: 'SHARE_WEST', dx: -1, dy: 0 },
    ];

    for (const share of candidateShares) {
      const targetX = x + share.dx;
      const targetY = y + share.dy;
      const recipient = snapshot.organismAt.get(`${targetX},${targetY}`);
      if (!recipient) continue;

      if (recipient.energy >= half) continue;
      const isChild = recipient.lineage.parentId === organism.id;
      if (!(isChild ? canFeedChild : sensed.canShare)) continue;

      actions.push({
        type: share.type,
        target: { x: targetX, y: targetY },
        recipientId: recipient.id,
        recipientSimilarity: Number(tagSimilarity(organism.tag, recipient.tag).toFixed(3)),
        recipientIsKin: isKin(organism.tag, recipient.tag, config),
        recipientNeed: Number(((half - recipient.energy) / half).toFixed(3)),
        recipientIsChild: isChild,
      });
    }
  }

  // 5. Rest action (always a fallback option)
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

    case 'SHARE_NORTH':
    case 'SHARE_SOUTH':
    case 'SHARE_EAST':
    case 'SHARE_WEST': {
      // Both kinds of sharing scale with the recipient's hunger. A small
      // fixed cost means sharing needs a positive drive, never a tie-break.
      const need = action.recipientNeed ?? 0;
      if (action.recipientIsChild) {
        const careComponent = policy.careForChildren * need * 2.0 - 0.1;
        components['parentalCare'] = Number(careComponent.toFixed(3));
        totalScore = careComponent;
      } else {
        // The weight is graded by how alike the recipient looks.
        const similarity = action.recipientSimilarity ?? 0;
        const weight = shareWeightFor(policy, similarity, config);
        const shareComponent = weight * need * 2.0 - 0.1;
        components[`share (${Math.round(similarity * 100)}% alike)`] = Number(
          shareComponent.toFixed(3)
        );
        totalScore = shareComponent;
      }
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

      // 4. Kin affinity: toward look-alikes / away from strangers (or the reverse)
      if (sensed.kinPull) {
        const { dx: px, dy: py } = sensed.kinPull;
        const scale = Math.max(1, Math.hypot(px, py));
        const kinComp = (policy.kinAffinity * (dx * px + dy * py)) / scale;
        components['kinPull'] = Number(kinComp.toFixed(3));
        totalScore += kinComp;
      }

      // 5. Explore tendency (seeded stochastic wander preference)
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
