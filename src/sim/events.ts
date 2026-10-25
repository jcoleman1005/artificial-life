import { GROUP_NAMES, groupIndexOf } from './groups';
import { regionSeasonAt } from './seasons';
import type { World } from './world';

/**
 * Notable world events for the feed: seasons turning, colour groups rising
 * and dying out, population records and crashes, generation milestones.
 * Detected by watching the world after each tick; it reads the world only,
 * draws no random numbers, and changes no outcome.
 */
export type WorldEventBody =
  /** A region's season turned (region null: the whole world, when seasons are not staggered). */
  | { readonly kind: 'season'; readonly region: number | null; readonly season: 'plenty' | 'lean' }
  /** A colour group reached GROUP_ESTABLISHED members. */
  | { readonly kind: 'groupEstablished'; readonly group: number; readonly count: number }
  /** An established colour group has no members left. */
  | { readonly kind: 'groupExtinct'; readonly group: number }
  /** A different colour group is now clearly the largest. */
  | { readonly kind: 'groupLeads'; readonly group: number; readonly count: number }
  /** The population passed a new record, in steps of POPULATION_STEP. */
  | { readonly kind: 'populationRecord'; readonly population: number }
  /** The population fell below half of its recent peak. */
  | { readonly kind: 'populationCrash'; readonly from: number; readonly to: number }
  /** No organisms are left. */
  | { readonly kind: 'extinction' }
  /** The deepest lineage reached a milestone generation. */
  | { readonly kind: 'generation'; readonly generation: number }
  /** The first kill of the run (killer and prey colour groups). */
  | { readonly kind: 'firstKill'; readonly killerGroup: number | null; readonly preyGroup: number | null }
  /** An established colour group now eats mostly meat (mean carnivory >= MEAT_GROUP), or went back to plants. */
  | { readonly kind: 'groupDiet'; readonly group: number; readonly diet: 'meat' | 'plants' };

export type WorldEvent = WorldEventBody & { readonly seq: number; readonly tick: number };

export const GROUP_ESTABLISHED = 10;
export const POPULATION_STEP = 100;
export const GENERATION_STEP = 25;
/** A group's mean carnivory at which it counts as meat eaters; it goes back to plants below MEAT_GROUP_EXIT. */
export const MEAT_GROUP = 0.5;
const MEAT_GROUP_EXIT = 0.4;
/** A crash compares the population with its peak over this many ticks. */
export const CRASH_WINDOW = 400;
/** A new leader must be this much larger than the old one, so close races don't flicker. */
const LEAD_MARGIN = 1.1;
/** Events kept for the feed (oldest dropped first). */
export const EVENT_LOG_SIZE = 200;

export class WorldEventDetector {
  private readonly log: WorldEvent[] = [];
  private nextSeq = 1;
  private seasons: (string | null)[] | null = null;
  private readonly established = new Set<number>();
  private leader: number | null = null;
  private populationRecord = 0;
  private generationReached = 1;
  /** Recent (tick, population) pairs for crash detection. */
  private readonly recent: { tick: number; population: number }[] = [];
  private crashed = false;
  private extinct = false;
  private sawKill = false;
  private readonly meatGroups = new Set<number>();

  /**
   * Starts watching a world mid-run (e.g. a resumed save) without
   * reporting what is already true, and keeps its earlier events.
   */
  public resume(world: World, earlier: readonly WorldEvent[]): void {
    this.observe(world, true);
    this.log.length = 0;
    this.log.push(...earlier.slice(-EVENT_LOG_SIZE));
    this.nextSeq = (earlier[earlier.length - 1]?.seq ?? 0) + 1;
  }

  /** Call after every step (and once at start). Returns the events found this tick. */
  public observe(world: World, silent = false): WorldEvent[] {
    const found: WorldEventBody[] = [];
    const { tick } = world;

    // Seasons: per region when staggered, otherwise the world's.
    const staggered = world.config.staggeredSeasons && world.foodRegions.length > 0;
    const now = staggered
      ? world.foodRegions.map((r) => regionSeasonAt(tick, r, world.config)?.season ?? null)
      : [world.worldSeason()];
    if (this.seasons && this.seasons.length === now.length) {
      now.forEach((season, i) => {
        if (season && season !== this.seasons![i]) {
          found.push({ kind: 'season', region: staggered ? i : null, season });
        }
      });
    }
    this.seasons = now;

    // Colour groups
    const counts = new Array<number>(GROUP_NAMES.length).fill(0);
    const carnivory = new Array<number>(GROUP_NAMES.length).fill(0);
    let maxGeneration = 1;
    for (const o of world.organisms.values()) {
      counts[groupIndexOf(o.tag)]++;
      carnivory[groupIndexOf(o.tag)] += o.carnivory;
      if (o.lineage.generation > maxGeneration) maxGeneration = o.lineage.generation;
    }
    counts.forEach((count, group) => {
      if (count >= GROUP_ESTABLISHED && !this.established.has(group)) {
        this.established.add(group);
        found.push({ kind: 'groupEstablished', group, count });
      } else if (count === 0 && this.established.has(group)) {
        this.established.delete(group);
        found.push({ kind: 'groupExtinct', group });
      }
    });
    let largest = 0;
    for (let g = 1; g < counts.length; g++) if (counts[g] > counts[largest]) largest = g;
    const leaderCount = this.leader === null ? 0 : counts[this.leader];
    if (
      counts[largest] >= GROUP_ESTABLISHED &&
      largest !== this.leader &&
      counts[largest] >= leaderCount * LEAD_MARGIN
    ) {
      if (this.leader !== null) found.push({ kind: 'groupLeads', group: largest, count: counts[largest] });
      this.leader = largest;
    }

    // Diets: established groups turning to meat (or back to plants)
    counts.forEach((count, group) => {
      const mean = count > 0 ? carnivory[group] / count : 0;
      if (count >= GROUP_ESTABLISHED && mean >= MEAT_GROUP && !this.meatGroups.has(group)) {
        this.meatGroups.add(group);
        found.push({ kind: 'groupDiet', group, diet: 'meat' });
      } else if (this.meatGroups.has(group) && (count === 0 || mean < MEAT_GROUP_EXIT)) {
        this.meatGroups.delete(group);
        if (count > 0) found.push({ kind: 'groupDiet', group, diet: 'plants' });
      }
    });

    // The first kill (a resumed world that already had kills reports none)
    if (!this.sawKill && world.killsTotal > 0) {
      this.sawKill = true;
      const kill = world.lastKill;
      found.push({
        kind: 'firstKill',
        killerGroup: kill ? groupIndexOf(kill.killerTag) : null,
        preyGroup: kill ? groupIndexOf(kill.preyTag) : null,
      });
    }

    // Population: records, crashes and extinction
    const population = world.organisms.size;
    const step = Math.floor(population / POPULATION_STEP) * POPULATION_STEP;
    if (step > this.populationRecord) {
      this.populationRecord = step;
      found.push({ kind: 'populationRecord', population: step });
    }
    this.recent.push({ tick, population });
    while (this.recent.length > 0 && this.recent[0].tick < tick - CRASH_WINDOW) this.recent.shift();
    const peak = this.recent.reduce((m, r) => Math.max(m, r.population), 0);
    if (!this.crashed && peak >= 50 && population < peak / 2) {
      this.crashed = true;
      found.push({ kind: 'populationCrash', from: peak, to: population });
    } else if (this.crashed && population >= peak * 0.75) {
      this.crashed = false;
    }
    if (population === 0 && !this.extinct && tick > 0) {
      this.extinct = true;
      found.push({ kind: 'extinction' });
    } else if (population > 0) {
      this.extinct = false;
    }

    // Generation milestones
    const milestone = Math.floor(maxGeneration / GENERATION_STEP) * GENERATION_STEP;
    if (milestone > this.generationReached && milestone >= GENERATION_STEP) {
      this.generationReached = milestone;
      found.push({ kind: 'generation', generation: milestone });
    }

    if (silent) return [];
    const events = found.map((body): WorldEvent => ({ ...body, seq: this.nextSeq++, tick }));
    this.log.push(...events);
    if (this.log.length > EVENT_LOG_SIZE) this.log.splice(0, this.log.length - EVENT_LOG_SIZE);
    return events;
  }

  /** The most recent events, oldest first. */
  public recentEvents(): readonly WorldEvent[] {
    return this.log;
  }
}
