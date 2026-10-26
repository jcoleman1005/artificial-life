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
import { isLeapAction, unitDirectionOf } from './directions';
import { carrionYield, killChance } from './traits';
import { isParentOf, isParentOrChild } from './family';

export const WEIGHT_MIN = -2.0;
export const WEIGHT_MAX = 2.0;

/**
 * Scales for the evolved "head start" weights. With their starting values
 * (about 1.5-2) they reproduce the old fixed rules: food first, hunger steers
 * toward food over every other pull, and young children seek a food-carrying
 * parent. Evolution can weaken, drop, or reverse each of them.
 */
// Must exceed the largest movement score (hunger urgency up to 20 plus the
// other pulls), or a hungry organism walks off food it could be eating.
export const EAT_PRIORITY_SCALE = 20;
export const HUNGER_URGENCY_SCALE = 10;
export const PARENT_PULL_SCALE = 3;
/** Rest preference: at full weight, about a full-strength food pull. */
export const REST_SCALE = 1;
/** Signal weights: about as strong as the food pull at full weight. */
export const SIGNAL_SCALE = 1.5;
/** Penalty per unit of avoidOccupied for moving into a cell held by a non-family organism. */
export const OCCUPIED_SCALE = 1.5;

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
    forageDrive: Number(prng.nextFloat(-0.5, 1.0).toFixed(3)),
    // Head starts that reproduce the old fixed rules; free to evolve.
    eatPriority: Number(prng.nextFloat(1.5, 2.0).toFixed(3)),
    hungerUrgency: Number(prng.nextFloat(1.5, 2.0).toFixed(3)),
    followFoodParent: Number(prng.nextFloat(0.5, 1.5).toFixed(3)),
    // Signals start with no meaning: when to signal and how to respond are
    // centred on zero, so any use of them has to evolve.
    signalOnFood: Number(prng.nextFloat(-0.5, 0.5).toFixed(3)),
    signalWhenHungry: Number(prng.nextFloat(-0.5, 0.5).toFixed(3)),
    followSignal: Number(prng.nextFloat(-0.5, 0.5).toFixed(3)),
    // Resting starts close to its old fixed score of 0, so any preference
    // for resting (or against it) has to evolve.
    restDrive: Number(prng.nextFloat(-0.25, 0.25).toFixed(3)),
    // Head start: prefer free cells to occupied ones; evolution can change it.
    avoidOccupied: Number(prng.nextFloat(1.0, 2.0).toFixed(3)),
    leapEagerness: Number(prng.nextFloat(-0.5, 0.5).toFixed(3)),
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
    forageDrive: mutateWeight(parentPolicy.forageDrive),
    eatPriority: mutateWeight(parentPolicy.eatPriority),
    hungerUrgency: mutateWeight(parentPolicy.hungerUrgency),
    followFoodParent: mutateWeight(parentPolicy.followFoodParent),
    signalOnFood: mutateWeight(parentPolicy.signalOnFood),
    signalWhenHungry: mutateWeight(parentPolicy.signalWhenHungry),
    followSignal: mutateWeight(parentPolicy.followSignal),
    restDrive: mutateWeight(parentPolicy.restDrive),
    avoidOccupied: mutateWeight(parentPolicy.avoidOccupied),
    leapEagerness: mutateWeight(parentPolicy.leapEagerness),
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

  const width = snapshot.gridWidth;
  const inBounds = (cx: number, cy: number) =>
    cx >= 0 && cx < width && cy >= 0 && cy < snapshot.gridHeight;
  const isWall = (cx: number, cy: number) =>
    !inBounds(cx, cy) || snapshot.obstacleGrid[cy * width + cx] === 1;
  const occupantAt = (cx: number, cy: number) => {
    if (!inBounds(cx, cy)) return undefined;
    const index = snapshot.organismGrid[cy * width + cx];
    return index >= 0 ? snapshot.organisms[index] : undefined;
  };

  // 1. Move actions: orthogonal, plus diagonal when enabled
  const candidateMoves: { type: LegalAction['type']; dx: number; dy: number }[] = [
    { type: 'MOVE_NORTH', dx: 0, dy: -1 },
    { type: 'MOVE_SOUTH', dx: 0, dy: 1 },
    { type: 'MOVE_EAST', dx: 1, dy: 0 },
    { type: 'MOVE_WEST', dx: -1, dy: 0 },
  ];
  if (config.diagonalMoves && organism.abilities.diagonal === 1) {
    candidateMoves.push(
      { type: 'MOVE_NORTHEAST', dx: 1, dy: -1 },
      { type: 'MOVE_NORTHWEST', dx: -1, dy: -1 },
      { type: 'MOVE_SOUTHEAST', dx: 1, dy: 1 },
      { type: 'MOVE_SOUTHWEST', dx: -1, dy: 1 }
    );
  }

  for (const move of candidateMoves) {
    const targetX = x + move.dx;
    const targetY = y + move.dy;
    if (isWall(targetX, targetY)) continue;

    // No cutting a corner: a diagonal needs at least one of its two side cells open.
    if (move.dx !== 0 && move.dy !== 0 && isWall(x + move.dx, y) && isWall(x, y + move.dy)) {
      continue;
    }

    // Into an occupied cell: family trade places at the normal cost; anyone
    // else can be squeezed past (at extra cost) by an organism with that ability.
    const occupant = occupantAt(targetX, targetY);
    const swapRelation =
      occupant && isParentOf(organism, occupant)
        ? 'child'
        : occupant && isParentOf(occupant, organism)
          ? 'parent'
          : occupant && config.squeezeEnabled && organism.abilities.squeeze === 1
            ? 'squeeze'
            : undefined;

    actions.push({
      type: move.type,
      target: { x: targetX, y: targetY },
      swapWithId: swapRelation ? occupant!.id : undefined,
      swapRelation,
      targetOccupied: occupant !== undefined && swapRelation !== 'child' && swapRelation !== 'parent',
    });
  }

  // 1b. Leaps: an organism with the leap ability can jump over an adjacent
  // organism (orthogonally) into the free cell beyond it.
  if (config.leapEnabled && organism.abilities.leap === 1) {
    const candidateLeaps: { type: LegalAction['type']; dx: number; dy: number }[] = [
      { type: 'LEAP_NORTH', dx: 0, dy: -1 },
      { type: 'LEAP_SOUTH', dx: 0, dy: 1 },
      { type: 'LEAP_EAST', dx: 1, dy: 0 },
      { type: 'LEAP_WEST', dx: -1, dy: 0 },
    ];
    for (const leap of candidateLeaps) {
      const landX = x + 2 * leap.dx;
      const landY = y + 2 * leap.dy;
      if (!occupantAt(x + leap.dx, y + leap.dy)) continue; // only over an organism
      if (isWall(landX, landY) || occupantAt(landX, landY)) continue;
      actions.push({ type: leap.type, target: { x: landX, y: landY } });
    }
  }

  // 2. Eat action
  if (sensed.canEat) {
    actions.push({
      type: 'EAT',
      target: { x, y },
    });
  }

  // 3. Pick up food to carry
  if (sensed.canPickUp) {
    actions.push({
      type: 'PICK_UP',
      target: { x, y },
    });
  }

  // 4. Reproduce actions
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
      if (snapshot.obstacleGrid[targetY * snapshot.gridWidth + targetX] === 1) {
        continue;
      }

      actions.push({
        type: repro.type,
        target: { x: targetX, y: targetY },
      });
    }
  }

  // 5. Give actions: hand one carried food unit to an orthogonally adjacent
  // organism that is below half energy (organisms can see whether a
  // neighbour is hungry). The recipient eats it; energy is never transferred.
  if (sensed.canGive) {
    const half = config.maxEnergy / 2;
    const candidateGives: { type: LegalAction['type']; dx: number; dy: number }[] = [
      { type: 'GIVE_NORTH', dx: 0, dy: -1 },
      { type: 'GIVE_SOUTH', dx: 0, dy: 1 },
      { type: 'GIVE_EAST', dx: 1, dy: 0 },
      { type: 'GIVE_WEST', dx: -1, dy: 0 },
    ];

    for (const give of candidateGives) {
      const targetX = x + give.dx;
      const targetY = y + give.dy;
      const recipientIndex =
        targetX >= 0 && targetX < snapshot.gridWidth && targetY >= 0 && targetY < snapshot.gridHeight
          ? snapshot.organismGrid[targetY * snapshot.gridWidth + targetX]
          : -1;
      const recipient = recipientIndex >= 0 ? snapshot.organisms[recipientIndex] : undefined;
      if (!recipient || recipient.energy >= half) continue;

      actions.push({
        type: give.type,
        target: { x: targetX, y: targetY },
        recipientId: recipient.id,
        recipientSimilarity: Number(tagSimilarity(organism.tag, recipient.tag).toFixed(3)),
        recipientIsKin: isKin(organism.tag, recipient.tag, config),
        recipientNeed: Number(((half - recipient.energy) / half).toFixed(3)),
        recipientIsChild: isParentOf(organism, recipient),
      });
    }
  }

  // 5b. Eat carrion underfoot (only worth anything to a diet with some meat in it)
  if (sensed.canEatCarrion) {
    actions.push({ type: 'EAT_CARRION', target: { x, y } });
  }

  // 5c. Attack an orthogonally adjacent organism (brain only: the dials have
  // no weight for it and stay the no-predation reference). A kill leaves the
  // prey as carrion; the attacker still has to eat it.
  if (config.predationEnabled && config.controller === 'brain') {
    const candidateAttacks: { type: LegalAction['type']; dx: number; dy: number }[] = [
      { type: 'ATTACK_NORTH', dx: 0, dy: -1 },
      { type: 'ATTACK_SOUTH', dx: 0, dy: 1 },
      { type: 'ATTACK_EAST', dx: 1, dy: 0 },
      { type: 'ATTACK_WEST', dx: -1, dy: 0 },
    ];
    for (const attack of candidateAttacks) {
      const prey = occupantAt(x + attack.dx, y + attack.dy);
      if (!prey) continue;
      actions.push({
        type: attack.type,
        target: { x: prey.x, y: prey.y },
        preyId: prey.id,
        preySimilarity: Number(tagSimilarity(organism.tag, prey.tag).toFixed(3)),
        preyKillChance: Number(killChance(organism, prey, config).toFixed(3)),
        preyIsFamily: isParentOrChild(organism, prey),
      });
    }
  }

  // 5d. Ask an orthogonally adjacent organism to mate (brain only, like
  // attacks). It only makes a child if that one asks back this same tick;
  // whether to ask, and whom, is the brain's to evolve.
  if (config.sexEnabled && config.controller === 'brain' && organism.energy >= config.reproductionThreshold) {
    const candidateMates: { type: LegalAction['type']; dx: number; dy: number }[] = [
      { type: 'MATE_NORTH', dx: 0, dy: -1 },
      { type: 'MATE_SOUTH', dx: 0, dy: 1 },
      { type: 'MATE_EAST', dx: 1, dy: 0 },
      { type: 'MATE_WEST', dx: -1, dy: 0 },
    ];
    for (const ask of candidateMates) {
      const partner = occupantAt(x + ask.dx, y + ask.dy);
      if (!partner) continue;
      actions.push({
        type: ask.type,
        target: { x: partner.x, y: partner.y },
        mateId: partner.id,
        mateSimilarity: Number(tagSimilarity(organism.tag, partner.tag).toFixed(3)),
        mateIsFamily: isParentOrChild(organism, partner),
        mateReady: partner.energy >= config.reproductionThreshold,
      });
    }
  }

  // 6. Signal: stay put and be noticed by others within signalRadius next tick
  if (sensed.canSignal) {
    actions.push({ type: 'SIGNAL', target: { x, y } });
  }

  // 7. Rest action (always a fallback option)
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

    case 'EAT_CARRION': {
      // Like eating, scaled by how much this diet gets from carrion compared with plants.
      const hunger = 1.0 - sensed.energyRatio;
      const worth = carrionYield(organism, config) / config.foodEnergyYield;
      const eatComponent = (policy.eatDrive * hunger * 3.0 + 0.5) * worth;
      components['carrionDrive'] = Number(eatComponent.toFixed(3));
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

    case 'PICK_UP': {
      // Stocking up is driven by forageDrive and how much room is left.
      const room = 1 - sensed.carriedFood / Math.max(1, organism.carryCapacity);
      const forageComponent = policy.forageDrive * room * 1.5 - 0.1;
      components['forage'] = Number(forageComponent.toFixed(3));
      totalScore = forageComponent;
      break;
    }

    case 'GIVE_NORTH':
    case 'GIVE_SOUTH':
    case 'GIVE_EAST':
    case 'GIVE_WEST': {
      // Giving scales with the recipient's hunger. It competes with eating
      // the same food oneself. A small fixed cost means giving needs a
      // positive drive, never a tie-break.
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
        components[`give (${Math.round(similarity * 100)}% alike)`] = Number(
          shareComponent.toFixed(3)
        );
        totalScore = shareComponent;
      }
      break;
    }

    case 'SIGNAL': {
      // When to signal is evolved, from two contexts: standing on food and
      // being hungry. A small fixed cost means signalling needs a positive
      // drive, never a tie-break.
      const onFood = sensed.currentCellFood > 0 ? 1 : 0;
      const hunger = 1.0 - sensed.energyRatio;
      const foodComponent = policy.signalOnFood * onFood * SIGNAL_SCALE;
      const hungerComponent = policy.signalWhenHungry * hunger * SIGNAL_SCALE;
      components['signalOnFood'] = Number(foodComponent.toFixed(3));
      components['signalHungry'] = Number(hungerComponent.toFixed(3));
      components['cost'] = -0.1;
      totalScore = foodComponent + hungerComponent - 0.1;
      break;
    }

    case 'REST': {
      // Resting scores the evolved restDrive, so dials can evolve "rest
      // more, move less" as brains do (it used to be fixed at 0).
      const restComponent = policy.restDrive * REST_SCALE;
      components['restDrive'] = Number(restComponent.toFixed(3));
      totalScore = restComponent;
      break;
    }

    case 'MOVE_NORTH':
    case 'MOVE_SOUTH':
    case 'MOVE_EAST':
    case 'MOVE_WEST':
    case 'MOVE_NORTHEAST':
    case 'MOVE_NORTHWEST':
    case 'MOVE_SOUTHEAST':
    case 'MOVE_SOUTHWEST':
    case 'LEAP_NORTH':
    case 'LEAP_SOUTH':
    case 'LEAP_EAST':
    case 'LEAP_WEST': {
      // Unit direction, so diagonals and leaps score on the same scale as steps.
      const [dx, dy] = unitDirectionOf(action.type);

      // 1. Food attraction component
      if (sensed.nearestFood) {
        const { dx: foodDx, dy: foodDy, distance } = sensed.nearestFood;
        const norm = Math.sqrt(foodDx * foodDx + foodDy * foodDy) || 1;
        const dotProduct = (dx * (foodDx / norm) + dy * (foodDy / norm));
        const distanceFactor = 1 / (1 + 0.25 * distance);
        const foodComp = policy.foodAttraction * dotProduct * distanceFactor * 1.5;
        components['foodPull'] = Number(foodComp.toFixed(3));
        totalScore += foodComp;

        // Hungry: an evolved urge to head for food, strong enough at its
        // starting value to outweigh every other movement pull.
        if (sensed.energyRatio < 0.5) {
          const hungerComp = policy.hungerUrgency * HUNGER_URGENCY_SCALE * dotProduct;
          components['hungerUrgency'] = Number(hungerComp.toFixed(3));
          totalScore += hungerComp;
        }
      }

      // In childhood: pull toward a parent that is carrying food
      if (sensed.parentWithFood) {
        const { dx: pdx, dy: pdy } = sensed.parentWithFood;
        const norm = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
        const dot = dx * (pdx / norm) + dy * (pdy / norm);
        const parentComp = policy.followFoodParent * PARENT_PULL_SCALE * dot;
        components['parentPull'] = Number(parentComp.toFixed(3));
        totalScore += parentComp;
      }

      // Toward (or away from) the nearest signal, weaker with distance
      if (sensed.nearestSignal) {
        const { dx: sdx, dy: sdy, distance } = sensed.nearestSignal;
        const norm = Math.sqrt(sdx * sdx + sdy * sdy) || 1;
        const dot = dx * (sdx / norm) + dy * (sdy / norm);
        const signalComp = (policy.followSignal * SIGNAL_SCALE * dot) / (1 + 0.15 * distance);
        components['signalPull'] = Number(signalComp.toFixed(3));
        totalScore += signalComp;
      }

      // 2. Obstacle avoidance component
      if (sensed.nearestObstacle) {
        const { dx: obsDx, dy: obsDy, distance } = sensed.nearestObstacle;
        const norm = Math.sqrt(obsDx * obsDx + obsDy * obsDy) || 1;
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
        const norm = Math.sqrt(orgDx * orgDx + orgDy * orgDy) || 1;
        const dotAway = (dx * (-orgDx / norm) + dy * (-orgDy / norm));
        const distanceFactor = 1 / (1 + 0.3 * distance);
        const crowdComp = policy.crowdingAvoidance * dotAway * distanceFactor;
        components['crowdPush'] = Number(crowdComp.toFixed(3));
        totalScore += crowdComp;
      }

      // 4. Kin affinity: toward look-alikes / away from strangers (or the reverse)
      if (sensed.kinPull) {
        const { dx: px, dy: py } = sensed.kinPull;
        const scale = Math.max(1, Math.sqrt(px * px + py * py));
        const kinComp = (policy.kinAffinity * (dx * px + dy * py)) / scale;
        components['kinPull'] = Number(kinComp.toFixed(3));
        totalScore += kinComp;
      }

      if (action.swapRelation) {
        // Not a score term: marks that this move trades places with another organism.
        const marker = { child: 'passesChild', parent: 'passesParent', squeeze: 'squeezesPast' } as const;
        components[marker[action.swapRelation]] = 0;
      }

      // Sensing occupied cells: an evolved reluctance to push into strangers
      if (action.targetOccupied) {
        const occupiedComp = -policy.avoidOccupied * OCCUPIED_SCALE;
        components['occupied'] = Number(occupiedComp.toFixed(3));
        totalScore += occupiedComp;
      }

      if (isLeapAction(action.type)) {
        const leapComp = policy.leapEagerness;
        components['leapEagerness'] = Number(leapComp.toFixed(3));
        totalScore += leapComp;
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

  const rawScores = legalActions.map((action) =>
    scoreAction(action, organism, sensed, config, prng)
  );

  // Eat priority: when eating is possible, every other action except feeding
  // one's own hungry child is pushed down by the evolved eatPriority weight.
  // At its starting value this makes food come first; evolution can change it.
  const canEatNow = rawScores.some((s) => s.action.type === 'EAT');
  const eatPush = organism.policy.eatPriority * EAT_PRIORITY_SCALE;
  const scores = rawScores.map((s): ActionScore => {
    if (!canEatNow || s.action.type === 'EAT' || s.action.recipientIsChild) return s;
    return {
      ...s,
      totalScore: Number((s.totalScore - eatPush).toFixed(3)),
      components: { ...s.components, eatPriority: Number((-eatPush).toFixed(3)) },
    };
  });

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
