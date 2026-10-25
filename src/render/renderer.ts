import type { FoodPatch, Organism } from '../sim/types';
import type { World } from '../sim/world';
import { seasonAt } from '../sim/seasons';

/** What an organism's colour shows: its visible tag, or its founding family. */
export type ColorMode = 'tag' | 'lineage';

/** Unit vector for an action that ends in a compass direction. */
function directionOf(type: string): [number, number] {
  if (type.endsWith('_NORTH')) return [0, -1];
  if (type.endsWith('_SOUTH')) return [0, 1];
  if (type.endsWith('_EAST')) return [1, 0];
  if (type.endsWith('_WEST')) return [-1, 0];
  return [0, 0];
}

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private world: World;
  private cellSize = 12;
  private canvasSize = 360;
  private colorMode: ColorMode = 'tag';

  constructor(canvas: HTMLCanvasElement, world: World) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context');
    }
    this.ctx = ctx;
    this.world = world;
    this.resize();
  }

  public setWorld(world: World): void {
    this.world = world;
  }

  public setColorMode(mode: ColorMode): void {
    this.colorMode = mode;
  }

  public resize(): void {
    // CSS owns the on-screen size (a square wrapper that fits the layout);
    // here we only match the drawing buffer to it for crisp high-DPI output.
    // Setting an inline px size would stop the layout column from shrinking.
    const parent = this.canvas.parentElement;
    const displaySize = Math.max(1, parent ? parent.clientWidth : this.canvas.clientWidth);
    this.canvasSize = displaySize;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.floor(displaySize * dpr);
    this.canvas.height = Math.floor(displaySize * dpr);

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cellSize = displaySize / this.world.config.gridWidth;
  }

  /**
   * Converts client touch or pointer coordinates to grid cell coordinates.
   */
  public clientToGrid(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;

    if (px < 0 || px >= this.canvasSize || py < 0 || py >= this.canvasSize) {
      return null;
    }

    const gridX = Math.floor(px / this.cellSize);
    const gridY = Math.floor(py / this.cellSize);

    if (
      gridX >= 0 &&
      gridX < this.world.config.gridWidth &&
      gridY >= 0 &&
      gridY < this.world.config.gridHeight
    ) {
      return { x: gridX, y: gridY };
    }
    return null;
  }

  /**
   * Renders the complete simulation frame.
   */
  public render(): void {
    const { ctx, cellSize, canvasSize } = this;
    const { gridWidth, gridHeight } = this.world.config;
    const selectedOrg = this.world.getSelectedOrganism();

    // 1. Background (warmer and darker in a lean season)
    const lean = seasonAt(this.world.tick, this.world.config)?.season === 'lean';
    ctx.fillStyle = lean ? '#17130c' : '#0f171e';
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // 2. Subtle grid lines
    ctx.strokeStyle = '#1a2732';
    ctx.lineWidth = 1;
    for (let x = 0; x <= gridWidth; x++) {
      ctx.beginPath();
      ctx.moveTo(x * cellSize, 0);
      ctx.lineTo(x * cellSize, gridHeight * cellSize);
      ctx.stroke();
    }
    for (let y = 0; y <= gridHeight; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * cellSize);
      ctx.lineTo(gridWidth * cellSize, y * cellSize);
      ctx.stroke();
    }

    // 3. Render Obstacles
    ctx.fillStyle = '#2d3d4a';
    ctx.strokeStyle = '#3e5263';
    ctx.lineWidth = 1;
    for (const obsKey of this.world.obstacles) {
      const [ox, oy] = obsKey.split(',').map(Number);
      const px = ox * cellSize;
      const py = oy * cellSize;
      ctx.fillRect(px + 1, py + 1, cellSize - 2, cellSize - 2);
      ctx.strokeRect(px + 1.5, py + 1.5, cellSize - 3, cellSize - 3);
    }

    // 4. Render Food Patches
    for (const patch of this.world.foodPatches.values()) {
      if (patch.stock <= 0) continue;
      this.drawFoodPatch(patch);
    }

    // 5. Draw Sensing Radius overlay if an organism is selected
    if (selectedOrg) {
      const radius = this.world.config.sensingRadius;
      const minX = Math.max(0, selectedOrg.x - radius) * cellSize;
      const minY = Math.max(0, selectedOrg.y - radius) * cellSize;
      const maxX = Math.min(gridWidth, selectedOrg.x + radius + 1) * cellSize;
      const maxY = Math.min(gridHeight, selectedOrg.y + radius + 1) * cellSize;

      ctx.fillStyle = 'rgba(74, 222, 128, 0.08)';
      ctx.fillRect(minX, minY, maxX - minX, maxY - minY);
      ctx.strokeStyle = 'rgba(74, 222, 128, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
      ctx.setLineDash([]);
    }

    // 6. Render Organisms
    for (const org of this.world.organisms.values()) {
      const isSelected = selectedOrg ? org.id === selectedOrg.id : false;
      this.drawOrganism(org, isSelected);
    }

    // 7. Interactions that span two cells: food gifts and births
    this.drawInteractions();
  }

  /** Gold arrows from givers to receivers, and thin lines from parents to newborns. */
  private drawInteractions(): void {
    const { ctx, cellSize } = this;
    const centre = (o: { x: number; y: number }) => [(o.x + 0.5) * cellSize, (o.y + 0.5) * cellSize];

    for (const org of this.world.organisms.values()) {
      const last = org.recentHistory[0];
      if (!last || last.outcome !== 'success') continue;
      const type = last.chosenAction.type;

      if (type.startsWith('GIVE_') && last.chosenAction.recipientId) {
        const recipient = this.world.organisms.get(last.chosenAction.recipientId);
        if (!recipient) continue;
        const [x1, y1] = centre(org);
        const [x2, y2] = centre(recipient);
        const len = Math.hypot(x2 - x1, y2 - y1) || 1;
        const [ux, uy] = [(x2 - x1) / len, (y2 - y1) / len];
        const head = Math.max(3, cellSize * 0.28);
        // Shaft and head, stopping at the receiver's edge
        const ex = x2 - ux * cellSize * 0.3;
        const ey = y2 - uy * cellSize * 0.3;
        ctx.strokeStyle = '#fbbf24';
        ctx.fillStyle = '#fbbf24';
        ctx.lineWidth = Math.max(1.5, cellSize * 0.12);
        ctx.beginPath();
        ctx.moveTo(x1 + ux * cellSize * 0.2, y1 + uy * cellSize * 0.2);
        ctx.lineTo(ex - ux * head * 0.6, ey - uy * head * 0.6);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ux * head - uy * head * 0.6, ey - uy * head + ux * head * 0.6);
        ctx.lineTo(ex - ux * head + uy * head * 0.6, ey - uy * head - ux * head * 0.6);
        ctx.closePath();
        ctx.fill();
        // The receiver gets a gold ring
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x2, y2, cellSize * 0.47, 0, Math.PI * 2);
        ctx.stroke();
      } else if (type.startsWith('REPRODUCE_') && last.chosenAction.target) {
        const [x1, y1] = centre(org);
        const [x2, y2] = centre(last.chosenAction.target);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
  }

  private drawFoodPatch(patch: FoodPatch): void {
    const { ctx, cellSize } = this;
    const cx = (patch.x + 0.5) * cellSize;
    const cy = (patch.y + 0.5) * cellSize;
    const ratio = Math.max(0.2, Math.min(1, patch.stock / patch.capacity));
    const radius = (cellSize * 0.42) * (0.4 + ratio * 0.6);

    // Subtle glow
    ctx.fillStyle = 'rgba(34, 197, 94, 0.2)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Food core
    ctx.fillStyle = ratio > 0.6 ? '#4ade80' : '#86efac';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Center seed point
    ctx.fillStyle = '#14532d';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.2, radius * 0.3), 0, Math.PI * 2);
    ctx.fill();
  }

  private drawOrganism(org: Organism, isSelected: boolean): void {
    const { ctx, cellSize } = this;
    const cx = (org.x + 0.5) * cellSize;
    const cy = (org.y + 0.5) * cellSize;
    const maxEnergy = this.world.config.maxEnergy;
    const energyRatio = Math.max(0.1, Math.min(1, org.energy / maxEnergy));
    const baseRadius = cellSize * 0.42;

    // Tag mode shows the hue other organisms see; lineage mode hashes the
    // founding ancestor so every descendant shares a family colour.
    const hue = this.colorMode === 'tag' ? org.tag : this.getLineageHue(org.lineage.id);
    const lightness = 45 + energyRatio * 20;

    // Selection ring
    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.45, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = `hsl(${hue}, 90%, 65%)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * 1.7, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Organism body (radius proportional to energy). Its shape and the dark
    // glyph cut into it show what the organism did last tick.
    // Kept from 60% to 100% of full size so action glyphs stay readable.
    const bodyRadius = Math.max(2.8, baseRadius * (0.6 + energyRatio * 0.4));
    const body = `hsl(${hue}, 85%, ${lightness}%)`;
    const glyph = '#0b1016';
    const last = org.recentHistory[0];
    const type = last?.chosenAction.type ?? 'REST';
    const succeeded = last?.outcome === 'success';

    ctx.fillStyle = body;
    ctx.beginPath();
    if (type === 'EAT' && succeeded) {
      // Eating: a Pac-Man mouth
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, bodyRadius, Math.PI * 0.22, Math.PI * 1.78);
      ctx.closePath();
    } else {
      ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
    }
    ctx.fill();

    if (type.startsWith('MOVE_') && succeeded) {
      // Moving: an arrowhead pointing the way it went
      const [hx, hy] = directionOf(type);
      const tip = bodyRadius * 0.75;
      const back = bodyRadius * 0.35;
      const wing = bodyRadius * 0.5;
      ctx.fillStyle = glyph;
      ctx.beginPath();
      ctx.moveTo(cx + hx * tip, cy + hy * tip);
      ctx.lineTo(cx - hx * back - hy * wing, cy - hy * back + hx * wing);
      ctx.lineTo(cx - hx * back + hy * wing, cy - hy * back - hx * wing);
      ctx.closePath();
      ctx.fill();
    } else if (type === 'PICK_UP' && succeeded) {
      // Harvesting: a pouch
      const half = bodyRadius * 0.38;
      ctx.fillStyle = glyph;
      ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    } else if (type.startsWith('MOVE_')) {
      // Blocked: a dark bar on the side it tried to move toward
      const [hx, hy] = directionOf(type);
      const off = bodyRadius * 0.45;
      const half = bodyRadius * 0.6;
      ctx.strokeStyle = glyph;
      ctx.lineWidth = Math.max(1.5, bodyRadius * 0.35);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx + hx * off - hy * half, cy + hy * off + hx * half);
      ctx.lineTo(cx + hx * off + hy * half, cy + hy * off - hx * half);
      ctx.stroke();
      ctx.lineCap = 'butt';
    } else if (type !== 'EAT' || !succeeded) {
      // Resting or anything else: a small dark core
      ctx.fillStyle = glyph;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, bodyRadius * 0.3), 0, Math.PI * 2);
      ctx.fill();
    }

    // Newborn: a thin white ring for its first few ticks
    if (org.age < 4) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, bodyRadius + 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Starving (below a quarter of max energy): a red dashed ring hugging the body
    if (org.energy < maxEnergy * 0.25) {
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 1;
      ctx.setLineDash([1.5, 1.5]);
      ctx.beginPath();
      ctx.arc(cx, cy, bodyRadius + 1.2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Carried food: one small green pip per unit, centred along the top edge
    const pipSpacing = cellSize * (org.carriedFood > 2 ? 0.2 : 0.36);
    for (let i = 0; i < org.carriedFood; i++) {
      const px = cx + (i - (org.carriedFood - 1) / 2) * pipSpacing;
      ctx.fillStyle = '#0f171e';
      ctx.beginPath();
      ctx.arc(px, cy - cellSize * 0.36, Math.max(1.6, cellSize * 0.1), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(px, cy - cellSize * 0.36, Math.max(1, cellSize * 0.07), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private getLineageHue(lineageId: string): number {
    let hash = 0;
    for (let i = 0; i < lineageId.length; i++) {
      hash = (hash * 31 + lineageId.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }
}
