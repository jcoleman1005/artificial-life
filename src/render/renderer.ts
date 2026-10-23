import type { FoodPatch, Organism } from '../sim/types';
import type { World } from '../sim/world';

export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private world: World;
  private cellSize = 12;
  private canvasSize = 360;

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

  public resize(): void {
    const parent = this.canvas.parentElement;
    const containerWidth = parent ? parent.clientWidth : window.innerWidth;
    // Keep it square and responsive, bounded to parent width (mobile safe)
    const displaySize = Math.max(280, Math.min(containerWidth, 600));
    this.canvasSize = displaySize;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.width = Math.floor(displaySize * dpr);
    this.canvas.height = Math.floor(displaySize * dpr);
    this.canvas.style.width = `${displaySize}px`;
    this.canvas.style.height = `${displaySize}px`;

    this.ctx.scale(dpr, dpr);
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

    // 1. Background
    ctx.fillStyle = '#0f171e';
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

    // Determine hue based on lineage id or foodAttraction weight
    // Lineage hash ensures relatives share family color
    const hue = this.getLineageHue(org.lineage.id);
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

    // Outer energy ring
    ctx.strokeStyle = `hsla(${hue}, 80%, ${lightness}%, 0.35)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    ctx.stroke();

    // Organism body (radius proportional to energy)
    const bodyRadius = Math.max(2.5, baseRadius * (0.4 + energyRatio * 0.55));
    ctx.fillStyle = `hsl(${hue}, 85%, ${lightness}%)`;
    ctx.beginPath();
    ctx.arc(cx, cy, bodyRadius, 0, Math.PI * 2);
    ctx.fill();

    // Heading indicator if last action was movement
    const lastDecision = org.recentHistory[0];
    if (lastDecision && lastDecision.chosenAction.type.startsWith('MOVE_')) {
      let hx = 0;
      let hy = 0;
      if (lastDecision.chosenAction.type === 'MOVE_NORTH') hy = -1;
      if (lastDecision.chosenAction.type === 'MOVE_SOUTH') hy = 1;
      if (lastDecision.chosenAction.type === 'MOVE_EAST') hx = 1;
      if (lastDecision.chosenAction.type === 'MOVE_WEST') hx = -1;

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx + hx * (bodyRadius * 0.6), cy + hy * (bodyRadius * 0.6), 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Resting/eating core
      ctx.fillStyle = '#0f171e';
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, bodyRadius * 0.3), 0, Math.PI * 2);
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
