import { PRNG } from './prng';
import type {
  ActionScore,
  DecisionOutcome,
  DecisionRecord,
  FoodPatch,
  LegalAction,
  Organism,
  SimulationConfig,
  WorldMetrics,
  WorldSnapshot,
} from './types';
import { createConfig } from './config';
import { senseEnvironment } from './sensors';
import {
  createRandomPolicy,
  evaluatePolicy,
  getLegalActions,
  mutatePolicy,
} from './policy';
import { computeWorldMetrics } from './metrics';
import { MetricsHistory } from './history';
import { inheritTag } from './tags';
import { seasonAt } from './seasons';
import {
  founderCanLeap,
  founderCarryCapacity,
  inheritCanLeap,
  inheritCarryCapacity,
  metabolismCost,
} from './traits';
import { isDiagonalMove, isLeapAction, isMoveAction } from './directions';
import { createHeadStartBrain, evaluateBrain, mutateBrain } from './brain';

export class World {
  public readonly config: SimulationConfig;
  public readonly prng: PRNG;
  public tick = 0;

  public readonly obstacles = new Set<string>(); // "x,y"
  public readonly foodPatches = new Map<string, FoodPatch>(); // "x,y" -> FoodPatch
  public readonly organisms = new Map<string, Organism>(); // id -> Organism

  private nextOrganismSeq = 0;
  public birthsTotal = 0;
  public deathsTotal = 0;
  public sharesTotal = 0;
  public kinSharesTotal = 0;
  public parentalSharesTotal = 0;
  public immigrantsTotal = 0;
  /** Running totals of lifespans at death (a total, not a list, so memory stays flat). */
  public deceasedCount = 0;
  public deceasedLifespanSum = 0;

  public selectedOrganismId: string | null = null;
  private cachedMetrics: WorldMetrics | null = null;
  /** Sampled metrics over the whole run, for trend charts and export. */
  public readonly history = new MetricsHistory();

  constructor(configOverrides?: Partial<SimulationConfig>) {
    this.config = createConfig(configOverrides);
    this.prng = new PRNG(this.config.seed);
    this.init();
  }

  /**
   * Initializes the world state deterministically using the configured PRNG seed.
   */
  public init(): void {
    this.tick = 0;
    this.birthsTotal = 0;
    this.deathsTotal = 0;
    this.sharesTotal = 0;
    this.kinSharesTotal = 0;
    this.parentalSharesTotal = 0;
    this.immigrantsTotal = 0;
    this.deceasedCount = 0;
    this.deceasedLifespanSum = 0;
    this.nextOrganismSeq = 0;
    this.obstacles.clear();
    this.foodPatches.clear();
    this.organisms.clear();
    this.selectedOrganismId = null;
    this.history.clear();

    this.prng.reset();

    // 1. Generate obstacles (terrain barriers)
    const { gridWidth, gridHeight, obstacleDensity } = this.config;
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        // Keep a clear border to prevent instant edge entrapment
        if (x > 1 && x < gridWidth - 2 && y > 1 && y < gridHeight - 2) {
          if (this.prng.next() < obstacleDensity) {
            this.obstacles.add(`${x},${y}`);
          }
        }
      }
    }

    // 2. Generate initial food patches at valid free locations
    let placedPatches = 0;
    let patchAttempts = 0;
    while (
      placedPatches < this.config.initialFoodPatches &&
      patchAttempts < gridWidth * gridHeight * 3
    ) {
      patchAttempts++;
      const x = this.prng.nextInt(0, gridWidth - 1);
      const y = this.prng.nextInt(0, gridHeight - 1);
      const key = `${x},${y}`;

      if (!this.obstacles.has(key) && !this.foodPatches.has(key)) {
        this.foodPatches.set(key, {
          x,
          y,
          stock: this.config.foodPatchInitialStock,
          capacity: this.config.foodPatchCapacity,
        });
        placedPatches++;
      }
    }

    // 3. Generate initial pioneer organisms at valid free locations
    let placedOrganisms = 0;
    let orgAttempts = 0;
    const occupiedCells = new Set<string>();

    while (
      placedOrganisms < this.config.initialOrganisms &&
      orgAttempts < gridWidth * gridHeight * 3
    ) {
      orgAttempts++;
      const x = this.prng.nextInt(0, gridWidth - 1);
      const y = this.prng.nextInt(0, gridHeight - 1);
      const key = `${x},${y}`;

      if (!this.obstacles.has(key) && !occupiedCells.has(key)) {
        occupiedCells.add(key);
        const organism = this.createFounder(x, y);
        this.organisms.set(organism.id, organism);
        placedOrganisms++;
      }
    }

    this.birthsTotal = placedOrganisms;
    this.updateMetrics();
  }

  /**
   * A founder of a new lineage with a random policy and tag: the initial
   * pioneers, and later immigrants.
   */
  private createFounder(x: number, y: number): Organism {
    this.nextOrganismSeq++;
    const policy = createRandomPolicy(this.prng);
    const tag = Number(this.prng.nextFloat(0, 360).toFixed(2));
    const carryCapacity = founderCarryCapacity(this.config, this.prng);
    const brain = createHeadStartBrain(this.prng);
    const canLeap = founderCanLeap(this.config, this.prng);
    return {
      id: `org-${this.nextOrganismSeq}`,
      x,
      y,
      energy: this.config.initialEnergy,
      policy,
      tag,
      carryCapacity,
      canLeap,
      brain,
      lineage: {
        id: `lineage-${this.nextOrganismSeq}`,
        parentId: null,
        generation: 1,
        birthTick: this.tick,
      },
      age: 0,
      offspringCount: 0,
      foodEatenCount: 0,
      carriedFood: 0,
      foodGiven: 0,
      foodReceived: 0,
      recentHistory: [],
    };
  }

  /**
   * Resets the simulation to tick 0. Optionally with a new seed.
   */
  public reset(newSeed?: number | string): void {
    if (newSeed !== undefined) {
      this.config.seed = newSeed;
      this.prng.setSeed(newSeed);
    }
    this.init();
  }

  /**
   * Captures an immutable pre-tick snapshot of the world for simultaneous decisions.
   */
  public getSnapshot(): WorldSnapshot {
    const foodCopy = new Map<string, FoodPatch>();
    for (const [k, v] of this.foodPatches) {
      foodCopy.set(k, { ...v });
    }

    const { gridWidth, gridHeight } = this.config;
    const obstacleGrid = new Uint8Array(gridWidth * gridHeight);
    const foodGrid = new Int32Array(gridWidth * gridHeight);
    const organismGrid = new Int32Array(gridWidth * gridHeight).fill(-1);
    for (const key of this.obstacles) {
      const [ox, oy] = key.split(',').map(Number);
      obstacleGrid[oy * gridWidth + ox] = 1;
    }
    for (const patch of this.foodPatches.values()) {
      foodGrid[patch.y * gridWidth + patch.x] = patch.stock;
    }

    const orgsList: Organism[] = [];
    const organismAt = new Map<string, Organism>();
    for (const org of this.organisms.values()) {
      const copy: Organism = {
        ...org,
        policy: { ...org.policy },
        lineage: { ...org.lineage },
        recentHistory: [...org.recentHistory],
      };
      organismGrid[org.y * gridWidth + org.x] = orgsList.length;
      orgsList.push(copy);
      organismAt.set(`${org.x},${org.y}`, copy);
    }

    return {
      tick: this.tick,
      gridWidth: this.config.gridWidth,
      gridHeight: this.config.gridHeight,
      obstacles: new Set(this.obstacles),
      foodPatches: foodCopy,
      organisms: orgsList,
      organismAt,
      obstacleGrid,
      foodGrid,
      organismGrid,
    };
  }

  /**
   * Advances the simulation by exactly one discrete tick.
   * Enforces simultaneous decisions, fair seeded tie-breakers, and explicit energy accounting.
   */
  public step(): void {
    if (this.organisms.size === 0) {
      // Same order as a populated tick: advance, then update the environment.
      this.tick++;
      this.updateEnvironment();
      this.updateMetrics();
      return;
    }

    // Phase 1: Pre-tick snapshot
    const snapshot = this.getSnapshot();

    // Phase 2: Simultaneous decision evaluation
    // Sort organisms by ID for strictly deterministic order of iteration
    const sortedLiving = Array.from(this.organisms.values()).sort((a, b) =>
      a.id.localeCompare(b.id)
    );

    interface IntendedActionData {
      organism: Organism;
      sensed: ReturnType<typeof senseEnvironment>;
      scores: ActionScore[];
      chosenAction: LegalAction;
      moveTargetKey?: string;
      /** A move that trades places with this child or parent instead. */
      swapWithId?: string;
      reproTargetKey?: string;
      approved: boolean;
      outcome: DecisionOutcome;
    }

    const intentions = new Map<string, IntendedActionData>();

    for (const org of sortedLiving) {
      const sensed = senseEnvironment(org, snapshot, this.config);
      const legalActions = getLegalActions(org, snapshot, this.config, sensed);
      const choose = this.config.controller === 'brain' ? evaluateBrain : evaluatePolicy;
      const { chosenAction, scores } = choose(org, legalActions, sensed, this.config, this.prng);

      let moveTargetKey: string | undefined;
      let swapWithId: string | undefined;
      let reproTargetKey: string | undefined;

      if (isMoveAction(chosenAction.type) && chosenAction.swapWithId) {
        // A swap keeps both cells occupied, so it stays out of the ordinary
        // move resolution below and the parent's cell remains reserved.
        swapWithId = chosenAction.swapWithId;
      } else if (
        (isMoveAction(chosenAction.type) || isLeapAction(chosenAction.type)) &&
        chosenAction.target
      ) {
        // Leaps resolve like moves to their landing cell.
        moveTargetKey = `${chosenAction.target.x},${chosenAction.target.y}`;
      } else if (chosenAction.type.startsWith('REPRODUCE_') && chosenAction.target) {
        reproTargetKey = `${chosenAction.target.x},${chosenAction.target.y}`;
      }

      intentions.set(org.id, {
        organism: org,
        sensed,
        scores,
        chosenAction,
        moveTargetKey,
        swapWithId,
        reproTargetKey,
        approved: true,
        outcome: 'success',
      });
    }

    // Phase 3: Conflict Resolution
    // 3a. Resolve multiple organisms moving to the SAME target cell
    const cellToMoveContenders = new Map<string, IntendedActionData[]>();
    for (const item of intentions.values()) {
      if (item.moveTargetKey) {
        const list = cellToMoveContenders.get(item.moveTargetKey) ?? [];
        list.push(item);
        cellToMoveContenders.set(item.moveTargetKey, list);
      }
    }

    for (const contenders of cellToMoveContenders.values()) {
      if (contenders.length > 1) {
        // Pick one winner using seeded PRNG
        const winner = this.prng.choice(contenders);
        for (const c of contenders) {
          if (c !== winner) {
            c.approved = false;
            c.outcome = 'conflict_lost';
          }
        }
      }
    }

    // 3b. Resolve moves into cells that remain occupied by stationary organisms
    // An organism is stationary if it is eating, resting, reproducing, or had its move rejected.
    let changed = true;
    while (changed) {
      changed = false;
      // Recompute which cells will be occupied by stationary organisms
      const stationaryPositions = new Set<string>();
      for (const item of intentions.values()) {
        if (!item.moveTargetKey || !item.approved) {
          stationaryPositions.add(`${item.organism.x},${item.organism.y}`);
        }
      }

      for (const item of intentions.values()) {
        if (item.approved && item.moveTargetKey) {
          if (stationaryPositions.has(item.moveTargetKey)) {
            item.approved = false;
            item.outcome = 'blocked_by_organism';
            changed = true;
          }
        }
      }
    }

    // 3c. Prevent head-on cell swaps (A moves to B, B moves to A). Each mover
    // has one target, so only the organism standing there can be its partner.
    const intentionAt = new Map<string, IntendedActionData>();
    for (const item of intentions.values()) {
      intentionAt.set(`${item.organism.x},${item.organism.y}`, item);
    }
    for (const itemA of intentions.values()) {
      if (!itemA.approved || !itemA.moveTargetKey) continue;
      const itemB = intentionAt.get(itemA.moveTargetKey);
      if (!itemB || itemB === itemA || !itemB.approved || !itemB.moveTargetKey) continue;
      if (itemB.moveTargetKey === `${itemA.organism.x},${itemA.organism.y}`) {
        // Mutual swap conflict: neither can pass through
        itemA.approved = false;
        itemA.outcome = 'blocked_by_organism';
        itemB.approved = false;
        itemB.outcome = 'blocked_by_organism';
      }
    }

    // 3c'. Family swaps. Two family members swapping into each other make one
    // trade. Otherwise a swap needs its target to stay in its cell this tick
    // (not moving away, not swapping elsewhere), and only one swapper per
    // target can take its cell: a seeded random pick among contenders.
    const swapsByTarget = new Map<string, IntendedActionData[]>();
    for (const item of intentions.values()) {
      if (!item.swapWithId) continue;
      const list = swapsByTarget.get(item.swapWithId) ?? [];
      list.push(item);
      swapsByTarget.set(item.swapWithId, list);
    }
    const rejectSwap = (item: IntendedActionData) => {
      item.approved = false;
      item.outcome = 'blocked_by_organism';
    };
    for (const [targetId, swappers] of swapsByTarget) {
      const target = intentions.get(targetId);
      const mutual = swappers.find((s) => target?.swapWithId === s.organism.id);
      if (mutual) {
        for (const s of swappers) if (s !== mutual) rejectSwap(s);
        continue;
      }
      const targetStays =
        target !== undefined && !(target.moveTargetKey && target.approved) && !target.swapWithId;
      if (!targetStays) {
        swappers.forEach(rejectSwap);
        continue;
      }
      const winner = swappers.length === 1 ? swappers[0] : this.prng.choice(swappers);
      for (const s of swappers) if (s !== winner) rejectSwap(s);
    }

    // 3d. Resolve reproduction collisions
    // Reproduction requires the target cell to be completely empty after moves are finalized
    const finalOccupiedCells = new Set<string>();
    for (const item of intentions.values()) {
      if (item.approved && item.moveTargetKey && item.chosenAction.target) {
        finalOccupiedCells.add(`${item.chosenAction.target.x},${item.chosenAction.target.y}`);
      } else {
        finalOccupiedCells.add(`${item.organism.x},${item.organism.y}`);
      }
    }

    const reproContenders = new Map<string, IntendedActionData[]>();
    for (const item of intentions.values()) {
      if (item.reproTargetKey) {
        if (finalOccupiedCells.has(item.reproTargetKey)) {
          item.approved = false;
          item.outcome = 'blocked_by_organism';
        } else {
          const list = reproContenders.get(item.reproTargetKey) ?? [];
          list.push(item);
          reproContenders.set(item.reproTargetKey, list);
        }
      }
    }

    for (const contenders of reproContenders.values()) {
      if (contenders.length > 1) {
        const winner = this.prng.choice(contenders);
        for (const c of contenders) {
          if (c !== winner) {
            c.approved = false;
            c.outcome = 'conflict_lost';
          }
        }
      }
    }

    // Phase 4: Action Execution & Energy Accounting
    const newBorns: Organism[] = [];
    // Food gifts leave the donor during its action and are eaten by the
    // recipient after all actions, so every organism acts on the same
    // pre-tick state.
    const pendingGifts: { recipientId: string }[] = [];
    // Family swaps also happen after all actions, so the one being passed acts
    // from the cell it stood in. Keyed by the pair, so a mutual swap (both
    // moving into each other) trades places once.
    const pendingSwaps = new Map<string, { mover: Organism; otherId: string }>();

    for (const item of intentions.values()) {
      const { organism, sensed, scores, chosenAction, approved } = item;
      let outcome = item.outcome;
      // Base metabolism, plus the upkeep of carry capacity
      const metabolism = metabolismCost(organism, this.config);
      let energyDelta = -metabolism;
      organism.energy -= metabolism;

      switch (chosenAction.type) {
        case 'EAT': {
          const key = `${organism.x},${organism.y}`;
          const patch = this.foodPatches.get(key);
          // Eat from the patch underfoot if there is one, otherwise from carried food.
          const fromPatch = patch !== undefined && patch.stock > 0;
          if ((fromPatch || organism.carriedFood > 0) && organism.energy < this.config.maxEnergy) {
            const energyGain = Math.min(
              this.config.maxEnergy - organism.energy,
              this.config.foodEnergyYield
            );
            organism.energy += energyGain;
            if (fromPatch) patch.stock -= 1;
            else organism.carriedFood -= 1;
            organism.foodEatenCount++;
            energyDelta += energyGain;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
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
          // Diagonals cost more (longer step); squeezing past a stranger and
          // leaping cost more again. Nothing is paid for a move that fails.
          const { moveCost } = this.config;
          const cost = isLeapAction(chosenAction.type)
            ? moveCost * this.config.leapCostMultiplier
            : moveCost *
              (isDiagonalMove(chosenAction.type) ? this.config.diagonalMoveCost : 1) *
              (chosenAction.swapRelation === 'squeeze' ? this.config.squeezeCostMultiplier : 1);
          if (approved && item.swapWithId) {
            // Trade places with the other organism after all actions (see below).
            organism.energy -= cost;
            energyDelta -= cost;
            pendingSwaps.set([organism.id, item.swapWithId].sort().join('|'), {
              mover: organism,
              otherId: item.swapWithId,
            });
            outcome = 'success';
          } else if (approved && chosenAction.target) {
            organism.x = chosenAction.target.x;
            organism.y = chosenAction.target.y;
            organism.energy -= cost;
            energyDelta -= cost;
            outcome = 'success';
          }
          // If not approved, no move cost is paid.
          break;
        }

        case 'REPRODUCE_NORTH':
        case 'REPRODUCE_SOUTH':
        case 'REPRODUCE_EAST':
        case 'REPRODUCE_WEST': {
          if (approved && chosenAction.target) {
            const childEnergy = Math.floor(
              organism.energy * this.config.reproductionEnergyFraction
            );
            const totalReproCost = childEnergy + this.config.reproductionMetabolismTax;

            if (organism.energy > totalReproCost && childEnergy > 0) {
              organism.energy -= totalReproCost;
              organism.offspringCount++;
              energyDelta -= totalReproCost;

              this.nextOrganismSeq++;
              const childId = `org-${this.nextOrganismSeq}`;
              const childPolicy = mutatePolicy(
                organism.policy,
                this.config,
                this.prng
              );
              const childTag = inheritTag(organism.tag, this.config, this.prng);
              const childCapacity = inheritCarryCapacity(
                organism.carryCapacity,
                this.config,
                this.prng
              );
              const childBrain = mutateBrain(organism.brain, this.config, this.prng);
              const childCanLeap = inheritCanLeap(organism.canLeap, this.config, this.prng);

              const child: Organism = {
                id: childId,
                x: chosenAction.target.x,
                y: chosenAction.target.y,
                energy: childEnergy,
                policy: childPolicy,
                tag: childTag,
                carryCapacity: childCapacity,
                canLeap: childCanLeap,
                brain: childBrain,
                lineage: {
                  id: organism.lineage.id,
                  parentId: organism.id,
                  generation: organism.lineage.generation + 1,
                  birthTick: this.tick,
                },
                age: 0,
                offspringCount: 0,
                foodEatenCount: 0,
                carriedFood: 0,
                foodGiven: 0,
                foodReceived: 0,
                recentHistory: [],
              };

              newBorns.push(child);
              this.birthsTotal++;
              outcome = 'success';
            } else {
              outcome = 'energy_too_low';
            }
          }
          break;
        }

        case 'PICK_UP': {
          const patch = this.foodPatches.get(`${organism.x},${organism.y}`);
          if (patch && patch.stock > 0 && organism.carriedFood < organism.carryCapacity) {
            patch.stock -= 1;
            organism.carriedFood += 1;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'GIVE_NORTH':
        case 'GIVE_SOUTH':
        case 'GIVE_EAST':
        case 'GIVE_WEST': {
          if (chosenAction.recipientId && organism.carriedFood > 0) {
            organism.carriedFood -= 1;
            organism.foodGiven += 1;
            pendingGifts.push({ recipientId: chosenAction.recipientId });
            this.sharesTotal++;
            if (chosenAction.recipientIsKin) this.kinSharesTotal++;
            if (chosenAction.recipientIsChild) this.parentalSharesTotal++;
            outcome = 'success';
          } else {
            outcome = 'no_food';
          }
          break;
        }

        case 'REST': {
          outcome = 'rested';
          break;
        }
      }

      // Clamp energy [0, maxEnergy]
      organism.energy = Math.max(0, Math.min(this.config.maxEnergy, organism.energy));
      organism.age++;

      // Record decision history
      const decisionRecord: DecisionRecord = {
        tick: this.tick,
        sensed,
        scores,
        chosenAction,
        outcome,
        energyDelta: Number(energyDelta.toFixed(2)),
        energyAfter: Number(organism.energy.toFixed(2)),
      };

      // Only the latest decision keeps its full scoring breakdown (the
      // inspector shows it); older entries keep the summary, saving memory.
      const previous = organism.recentHistory[0];
      if (previous && previous.scores.length > 0) {
        organism.recentHistory[0] = { ...previous, scores: [] };
      }
      organism.recentHistory.unshift(decisionRecord);
      if (organism.recentHistory.length > 8) {
        organism.recentHistory.pop();
      }
    }

    // Family members trade places (only the mover pays the move cost)
    for (const { mover, otherId } of pendingSwaps.values()) {
      const other = this.organisms.get(otherId);
      if (!other) continue;
      const [mx, my] = [mover.x, mover.y];
      mover.x = other.x;
      mover.y = other.y;
      other.x = mx;
      other.y = my;
    }

    // Deliver food gifts: the recipient eats each one (energy capped at the
    // maximum; any excess from that unit is lost).
    for (const gift of pendingGifts) {
      const recipient = this.organisms.get(gift.recipientId);
      if (!recipient) continue;
      const gain = Math.min(this.config.maxEnergy - recipient.energy, this.config.foodEnergyYield);
      recipient.energy += gain;
      recipient.foodReceived += 1;
      recipient.foodEatenCount++;
    }

    // Add newborns to population
    for (const child of newBorns) {
      this.organisms.set(child.id, child);
    }

    // Phase 5: Deaths
    for (const [id, org] of Array.from(this.organisms.entries())) {
      if (org.energy <= 0) {
        this.deceasedCount++;
        this.deceasedLifespanSum += org.age;
        this.deathsTotal++;
        this.organisms.delete(id);
      }
    }

    // Increment simulation tick
    this.tick++;

    // Phase 6: Food regeneration and spawning
    this.updateEnvironment();

    // Recompute world metrics
    this.updateMetrics();
  }

  /**
   * Regenerates existing food patches and periodically spawns new ones.
   */
  private updateEnvironment(): void {
    const {
      foodRegenInterval,
      foodRegenAmount,
      foodSpawnInterval,
      foodSpawnCount,
      maxFoodPatches,
      gridWidth,
      gridHeight,
    } = this.config;

    // Lean times: food regrows more slowly and no new patches appear.
    const lean = seasonAt(this.tick, this.config)?.season === 'lean';
    const regenInterval = lean
      ? foodRegenInterval * Math.max(1, this.config.leanSlowdown)
      : foodRegenInterval;

    // 1. Food patch stock regeneration
    if (this.tick > 0 && this.tick % regenInterval === 0) {
      for (const patch of this.foodPatches.values()) {
        if (patch.stock < patch.capacity) {
          patch.stock = Math.min(patch.capacity, patch.stock + foodRegenAmount);
        }
      }
    }

    // 2. Food patch spawning
    if (!lean && this.tick > 0 && this.tick % foodSpawnInterval === 0) {
      let spawned = 0;
      let attempts = 0;
      while (
        spawned < foodSpawnCount &&
        this.foodPatches.size < maxFoodPatches &&
        attempts < 50
      ) {
        attempts++;
        const x = this.prng.nextInt(0, gridWidth - 1);
        const y = this.prng.nextInt(0, gridHeight - 1);
        const key = `${x},${y}`;

        if (!this.obstacles.has(key) && !this.foodPatches.has(key)) {
          this.foodPatches.set(key, {
            x,
            y,
            stock: this.config.foodPatchInitialStock,
            capacity: this.config.foodPatchCapacity,
          });
          spawned++;
        }
      }
    }

    // 3. Immigration: newcomers with random tags and policies arrive in
    // random free cells, so look-alike groups are not just families.
    const { immigrationInterval, immigrationCount } = this.config;
    if (immigrationInterval > 0 && this.tick > 0 && this.tick % immigrationInterval === 0) {
      const occupied = new Set<string>();
      for (const o of this.organisms.values()) occupied.add(`${o.x},${o.y}`);
      let arrived = 0;
      let attempts = 0;
      while (arrived < immigrationCount && attempts < 50) {
        attempts++;
        const x = this.prng.nextInt(0, gridWidth - 1);
        const y = this.prng.nextInt(0, gridHeight - 1);
        const key = `${x},${y}`;
        if (this.obstacles.has(key) || occupied.has(key)) continue;
        const immigrant = this.createFounder(x, y);
        this.organisms.set(immigrant.id, immigrant);
        occupied.add(key);
        this.immigrantsTotal++;
        arrived++;
      }
    }
  }

  /**
   * Called at the end of every tick. Metrics are computed lazily (they never
   * affect the simulation), so this only invalidates the cache and computes
   * them when the history wants a sample this tick.
   */
  public updateMetrics(): void {
    this.cachedMetrics = null;
    if (this.history.wantsSample(this.tick)) {
      this.history.record(this.getMetrics(), Array.from(this.organisms.values()));
    }
  }

  private computeMetrics(): WorldMetrics {
    let totalFoodStock = 0;
    let activePatchCount = 0;

    for (const patch of this.foodPatches.values()) {
      if (patch.stock > 0) {
        activePatchCount++;
        totalFoodStock += patch.stock;
      }
    }

    const organisms = Array.from(this.organisms.values());
    return {
      ...computeWorldMetrics(
        this.tick,
        organisms,
        totalFoodStock,
        activePatchCount,
        this.birthsTotal,
        this.deathsTotal,
        { count: this.deceasedCount, lifespanSum: this.deceasedLifespanSum },
        this.sharesTotal,
        this.kinSharesTotal,
        this.parentalSharesTotal,
        this.immigrantsTotal,
        this.config
      ),
      season: seasonAt(this.tick, this.config)?.season ?? null,
    };
  }

  public getOrganism(id: string): Organism | undefined {
    return this.organisms.get(id);
  }

  /** Same as getMetrics(). */
  public get metrics(): WorldMetrics {
    return this.getMetrics();
  }

  public getMetrics(): WorldMetrics {
    this.cachedMetrics ??= this.computeMetrics();
    return this.cachedMetrics;
  }

  public getOrganismAt(x: number, y: number): Organism | undefined {
    for (const org of this.organisms.values()) {
      if (org.x === x && org.y === y) {
        return org;
      }
    }
    return undefined;
  }

  public selectOrganism(id: string | null): void {
    this.selectedOrganismId = id;
  }

  public getSelectedOrganism(): Organism | undefined {
    if (!this.selectedOrganismId) return undefined;
    return this.organisms.get(this.selectedOrganismId);
  }
}
