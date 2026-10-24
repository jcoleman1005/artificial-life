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
  public readonly deceasedLifespans: number[] = [];

  public selectedOrganismId: string | null = null;
  public metrics!: WorldMetrics;
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
    this.deceasedLifespans.length = 0;
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
        this.nextOrganismSeq++;
        const id = `org-${this.nextOrganismSeq}`;
        const policy = createRandomPolicy(this.prng);
        const tag = Number(this.prng.nextFloat(0, 360).toFixed(2));

        const organism: Organism = {
          id,
          x,
          y,
          energy: this.config.initialEnergy,
          policy,
          tag,
          lineage: {
            id: `lineage-${this.nextOrganismSeq}`,
            parentId: null,
            generation: 1,
            birthTick: 0,
          },
          age: 0,
          offspringCount: 0,
          foodEatenCount: 0,
          energyGiven: 0,
          energyReceived: 0,
          recentHistory: [],
        };

        this.organisms.set(id, organism);
        placedOrganisms++;
      }
    }

    this.birthsTotal = placedOrganisms;
    this.updateMetrics();
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

    const orgsList: Organism[] = [];
    const organismAt = new Map<string, Organism>();
    for (const org of this.organisms.values()) {
      const copy: Organism = {
        ...org,
        policy: { ...org.policy },
        lineage: { ...org.lineage },
        recentHistory: [...org.recentHistory],
      };
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
    };
  }

  /**
   * Advances the simulation by exactly one discrete tick.
   * Enforces simultaneous decisions, fair seeded tie-breakers, and explicit energy accounting.
   */
  public step(): void {
    if (this.organisms.size === 0) {
      this.updateEnvironment();
      this.tick++;
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
      reproTargetKey?: string;
      approved: boolean;
      outcome: DecisionOutcome;
    }

    const intentions = new Map<string, IntendedActionData>();

    for (const org of sortedLiving) {
      const sensed = senseEnvironment(org, snapshot, this.config);
      const legalActions = getLegalActions(org, snapshot, this.config, sensed);
      const { chosenAction, scores } = evaluatePolicy(
        org,
        legalActions,
        sensed,
        this.config,
        this.prng
      );

      let moveTargetKey: string | undefined;
      let reproTargetKey: string | undefined;

      if (chosenAction.type.startsWith('MOVE_') && chosenAction.target) {
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

    // 3c. Prevent head-on cell swaps (A moves to B, B moves to A)
    for (const itemA of intentions.values()) {
      if (itemA.approved && itemA.moveTargetKey) {
        for (const itemB of intentions.values()) {
          if (itemB !== itemA && itemB.approved && itemB.moveTargetKey) {
            const posA = `${itemA.organism.x},${itemA.organism.y}`;
            const posB = `${itemB.organism.x},${itemB.organism.y}`;
            if (itemA.moveTargetKey === posB && itemB.moveTargetKey === posA) {
              // Mutual swap conflict: neither can pass through
              itemA.approved = false;
              itemA.outcome = 'blocked_by_organism';
              itemB.approved = false;
              itemB.outcome = 'blocked_by_organism';
            }
          }
        }
      }
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
    // Shares are paid by the donor during its action and delivered after all
    // actions, so every organism acts on the same pre-tick energy levels.
    const pendingGifts: { recipientId: string; amount: number }[] = [];

    for (const item of intentions.values()) {
      const { organism, sensed, scores, chosenAction, approved } = item;
      let outcome = item.outcome;
      let energyDelta = -this.config.tickMetabolismCost;

      // Base metabolism deduction
      organism.energy -= this.config.tickMetabolismCost;

      switch (chosenAction.type) {
        case 'EAT': {
          const key = `${organism.x},${organism.y}`;
          const patch = this.foodPatches.get(key);
          if (patch && patch.stock > 0 && organism.energy < this.config.maxEnergy) {
            const energyGain = Math.min(
              this.config.maxEnergy - organism.energy,
              this.config.foodEnergyYield
            );
            organism.energy += energyGain;
            patch.stock -= 1;
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
        case 'MOVE_WEST': {
          if (approved && chosenAction.target) {
            organism.x = chosenAction.target.x;
            organism.y = chosenAction.target.y;
            organism.energy -= this.config.moveCost;
            energyDelta -= this.config.moveCost;
            outcome = 'success';
          }
          // If not approved, no moveCost paid!
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

              const child: Organism = {
                id: childId,
                x: chosenAction.target.x,
                y: chosenAction.target.y,
                energy: childEnergy,
                policy: childPolicy,
                tag: childTag,
                lineage: {
                  id: organism.lineage.id,
                  parentId: organism.id,
                  generation: organism.lineage.generation + 1,
                  birthTick: this.tick,
                },
                age: 0,
                offspringCount: 0,
                foodEatenCount: 0,
                energyGiven: 0,
                energyReceived: 0,
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

        case 'SHARE_NORTH':
        case 'SHARE_SOUTH':
        case 'SHARE_EAST':
        case 'SHARE_WEST': {
          const { shareAmount, shareMultiplier } = this.config;
          if (chosenAction.recipientId && organism.energy > shareAmount) {
            organism.energy -= shareAmount;
            organism.energyGiven += shareAmount;
            energyDelta -= shareAmount;
            pendingGifts.push({
              recipientId: chosenAction.recipientId,
              amount: shareAmount * shareMultiplier,
            });
            this.sharesTotal++;
            if (chosenAction.recipientIsKin) this.kinSharesTotal++;
            outcome = 'success';
          } else {
            outcome = 'energy_too_low';
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

      organism.recentHistory.unshift(decisionRecord);
      if (organism.recentHistory.length > 8) {
        organism.recentHistory.pop();
      }
    }

    // Deliver shared energy (capped at the recipient's capacity; excess is lost)
    for (const gift of pendingGifts) {
      const recipient = this.organisms.get(gift.recipientId);
      if (!recipient) continue;
      const gain = Math.min(this.config.maxEnergy - recipient.energy, gift.amount);
      recipient.energy += gain;
      recipient.energyReceived += gain;
    }

    // Add newborns to population
    for (const child of newBorns) {
      this.organisms.set(child.id, child);
    }

    // Phase 5: Deaths
    for (const [id, org] of Array.from(this.organisms.entries())) {
      if (org.energy <= 0) {
        this.deceasedLifespans.push(org.age);
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

    // 1. Food patch stock regeneration
    if (this.tick > 0 && this.tick % foodRegenInterval === 0) {
      for (const patch of this.foodPatches.values()) {
        if (patch.stock < patch.capacity) {
          patch.stock = Math.min(patch.capacity, patch.stock + foodRegenAmount);
        }
      }
    }

    // 2. Food patch spawning
    if (this.tick > 0 && this.tick % foodSpawnInterval === 0) {
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
  }

  /**
   * Recomputes and caches comprehensive world metrics.
   */
  public updateMetrics(): void {
    let totalFoodStock = 0;
    let activePatchCount = 0;

    for (const patch of this.foodPatches.values()) {
      if (patch.stock > 0) {
        activePatchCount++;
        totalFoodStock += patch.stock;
      }
    }

    const organisms = Array.from(this.organisms.values());
    this.metrics = computeWorldMetrics(
      this.tick,
      organisms,
      totalFoodStock,
      activePatchCount,
      this.birthsTotal,
      this.deathsTotal,
      this.deceasedLifespans,
      this.sharesTotal,
      this.kinSharesTotal,
      this.config
    );
    this.history.record(this.metrics, organisms);
  }

  public getOrganism(id: string): Organism | undefined {
    return this.organisms.get(id);
  }

  public getMetrics(): WorldMetrics {
    return this.metrics;
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
