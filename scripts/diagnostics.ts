// The standard diagnostics of WORLD_RULES.md, measured from outside the
// simulation (they change no outcome). Call observe() after every world tick;
// rates are summed only while `counting` is true (the experiment uses the last
// 20% of a run), the trackers behind them always run.

import type { World } from '../src/sim/world';

interface Stay {
  /** Where the organism's current stay began, and how many of its ticks were within 2 cells of there. */
  x: number;
  y: number;
  near: number;
  /** The cell it has stood on, for how many ticks, and the most food that cell's patch could hold. */
  cell: number;
  cellTicks: number;
  cellMax: number;
}

export class Diagnostics {
  private readonly stays = new Map<string, Stay>();
  private readonly birth = new Map<string, { x: number; y: number }>();
  private attempted = 0;
  private blocked = 0;
  private stayTicks = 0;
  private stayCount = 0;
  private departureLevel = 0;
  private departures = 0;
  private giniSum = 0;
  private giniSamples = 0;
  private scoutSum = 0;
  private scoutSamples = 0;

  public observe(world: World, counting: boolean): void {
    const w = world.config.gridWidth;
    const alive = new Set<string>();
    const perCell = new Map<number, number>();
    for (const o of world.organisms.values()) {
      alive.add(o.id);
      const cell = o.y * w + o.x;
      perCell.set(cell, (perCell.get(cell) ?? 0) + 1);
      if (!this.birth.has(o.id)) this.birth.set(o.id, { x: o.x, y: o.y });

      const d = o.recentHistory[0];
      if (counting && d && d.tick === world.tick - 1 && /^(MOVE|LEAP)_/.test(d.chosenAction.type)) {
        this.attempted++;
        if (d.outcome === 'blocked_by_organism' || d.outcome === 'conflict_lost' || d.outcome === 'blocked_by_obstacle') this.blocked++;
      }

      let stay = this.stays.get(o.id);
      if (!stay) {
        stay = { x: o.x, y: o.y, near: 0, cell, cellTicks: 0, cellMax: 0 };
        this.stays.set(o.id, stay);
      }
      // Dwell: ticks within 2 cells of the spot, counted when the organism finally goes more than 5 cells away.
      const away = Math.hypot(o.x - stay.x, o.y - stay.y);
      if (away <= 2) stay.near++;
      else if (away > 5) {
        if (counting) {
          this.stayTicks += stay.near;
          this.stayCount++;
        }
        stay.x = o.x;
        stay.y = o.y;
        stay.near = 1;
      }
      // Departure: the food left behind on a cell stood on for 10+ ticks.
      if (cell === stay.cell) {
        stay.cellTicks++;
        stay.cellMax = Math.max(stay.cellMax, world.foodPatches.get(`${o.x},${o.y}`)?.capacity ?? 0);
      } else {
        if (counting && stay.cellTicks >= 10 && stay.cellMax > 0) {
          const left = world.foodPatches.get(`${stay.cell % w},${Math.floor(stay.cell / w)}`);
          this.departureLevel += (left?.stock ?? 0) / stay.cellMax;
          this.departures++;
        }
        stay.cell = cell;
        stay.cellTicks = 1;
        stay.cellMax = world.foodPatches.get(`${o.x},${o.y}`)?.capacity ?? 0;
      }
    }
    for (const id of this.stays.keys()) {
      if (!alive.has(id)) {
        this.stays.delete(id);
        this.birth.delete(id);
      }
    }

    // Sampled every 50 ticks: how unevenly organisms fill the cells, and how many are far from where they were born.
    if (counting && world.tick % 50 === 0 && world.organisms.size > 0) {
      const cells = w * world.config.gridHeight - world.obstacles.size;
      const counts = [...perCell.values(), ...new Array<number>(Math.max(0, cells - perCell.size)).fill(0)].sort((a, b) => a - b);
      const total = counts.reduce((a, v) => a + v, 0);
      let weighted = 0;
      counts.forEach((v, i) => (weighted += (i + 1) * v));
      this.giniSum += (2 * weighted) / (counts.length * total) - (counts.length + 1) / counts.length;
      this.giniSamples++;
      let scouts = 0;
      for (const o of world.organisms.values()) {
        const b = this.birth.get(o.id)!;
        if (Math.hypot(o.x - b.x, o.y - b.y) > 8) scouts++;
      }
      this.scoutSum += scouts / world.organisms.size;
      this.scoutSamples++;
    }
  }

  public results(): Record<string, number> {
    return {
      blockedMoveFrac: this.blocked / Math.max(1, this.attempted),
      timeInPatch: this.stayTicks / Math.max(1, this.stayCount),
      departureFoodLevel: this.departureLevel / Math.max(1, this.departures),
      occupancyGini: this.giniSum / Math.max(1, this.giniSamples),
      scoutFraction: this.scoutSum / Math.max(1, this.scoutSamples),
    };
  }
}
