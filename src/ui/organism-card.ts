import type { SimulationConfig } from '../sim/types';
import type { EggView, OrganismView } from '../sim/protocol';
import { givenName, organismName } from './names';
import { metabolismHue, reproStrategyHue } from '../render/renderer';

const DIRECTION: Record<string, string> = { NORTH: 'north', SOUTH: 'south', EAST: 'east', WEST: 'west' };

/** Plain-language summary of what an organism did on its latest tick. */
export function describeDoing(org: OrganismView, nameOf: (id: string) => string | null, alive = true): string {
  if (!alive) return 'Died';
  const last = org.recentHistory[0];
  if (!last) return org.age === 0 ? 'Just born' : 'Waiting';
  const { type } = last.chosenAction;
  const ok = last.outcome === 'success';
  const dir = DIRECTION[type.split('_')[1] ?? ''] ?? '';
  if (type.startsWith('MOVE_')) {
    if (ok) return last.chosenAction.swapWithId ? `Squeezing past family, ${dir}` : `Moving ${dir}`;
    if (last.outcome === 'conflict_lost') return `Beaten to a cell (${dir})`;
    if (last.outcome === 'blocked_by_organism') return `Blocked by a neighbour (${dir})`;
    return `Bumped into a ${last.outcome === 'blocked_by_boundary' ? 'wall' : 'rock'} (${dir})`;
  }
  if (type.startsWith('GIVE_')) {
    const to = last.chosenAction.recipientId ? nameOf(last.chosenAction.recipientId) : null;
    return ok ? `Giving food${to ? ` to ${to}` : ''}` : 'Tried to give food';
  }
  if (type.startsWith('REPRODUCE_')) return ok ? 'Had a baby' : 'Tried to have a baby';
  if (type.startsWith('MATE_')) {
    const partner = last.chosenAction.mateId ? nameOf(last.chosenAction.mateId) : 'a neighbour';
    if (ok) return `Had a baby with ${partner}`;
    return last.outcome === 'no_partner' ? `Courting ${partner}` : `Tried to have a baby with ${partner}`;
  }
  if (type.startsWith('ATTACK_')) {
    const prey = last.chosenAction.preyId ? nameOf(last.chosenAction.preyId) : 'a neighbour';
    return ok ? `Killed ${prey}` : `Attacked ${prey} (missed)`;
  }
  switch (type) {
    case 'EAT':
      return ok ? 'Eating' : 'Looking for a meal';
    case 'EAT_CARRION':
      return ok ? 'Eating carrion' : 'Looking for carrion';
    case 'PICK_UP':
      return ok ? 'Picking up food' : 'Reaching for food';
    case 'SIGNAL':
      return 'Signalling';
    default:
      return 'Resting';
  }
}

/** An individual trait adaptation badge on the floating card. */
export interface TraitBadge {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
  readonly category: 'diet' | 'metabolism' | 'breeding' | 'mobility' | 'defense' | 'morphology';
  readonly score: number;
  readonly customHue?: number;
}

/** Computes prioritized core and dynamic standout adaptation badges for an organism. */
export function computeOrganismBadges(org: OrganismView, config: SimulationConfig): TraitBadge[] {
  const core: TraitBadge[] = [];
  const standouts: TraitBadge[] = [];

  // 1. Core: Diet
  const meatPct = Math.round(org.carnivory * 100);
  if (org.carnivory <= 0.2) {
    core.push({
      icon: '🌱',
      label: 'Herbivore',
      value: `${100 - meatPct}%`,
      category: 'diet',
      score: 100,
      customHue: 125,
    });
  } else if (org.carnivory >= 0.8) {
    core.push({
      icon: '🥩',
      label: 'Carnivore',
      value: `${meatPct}%`,
      category: 'diet',
      score: 100,
      customHue: 0,
    });
  } else {
    core.push({
      icon: '🌾',
      label: 'Omnivore',
      value: `${meatPct}% meat`,
      category: 'diet',
      score: 100,
      customHue: 40,
    });
  }

  // 2. Core: Metabolic Rate / Pace
  if (config.metabolismGeneEnabled && org.metabolicRate !== undefined) {
    core.push({
      icon: '⚡',
      label: 'Metabolism',
      value: `${org.metabolicRate.toFixed(2)}×`,
      category: 'metabolism',
      score: 90,
      customHue: Math.round(metabolismHue(org, config)),
    });
  }

  // 3. Core: Breeding Strategy
  if (config.clutchGeneEnabled && org.clutchSize !== undefined && org.clutchSize > 1.05) {
    core.push({
      icon: '🥚',
      label: 'Clutch',
      value: org.clutchSize.toFixed(1),
      category: 'breeding',
      score: 80,
      customHue: Math.round(reproStrategyHue(org, config)),
    });
  } else if (config.investmentGeneEnabled && org.investment !== undefined && Math.abs(org.investment - 0.25) > 0.05) {
    core.push({
      icon: '🐣',
      label: 'Child Care',
      value: `${Math.round(org.investment * 100)}%`,
      category: 'breeding',
      score: 75,
      customHue: Math.round(reproStrategyHue(org, config)),
    });
  }

  // Dynamic Standout Traits:
  // Mobility abilities
  if (config.leapEnabled && (org.abilities?.leap ?? 0) > 0.05) {
    standouts.push({
      icon: '🦘',
      label: 'Leaper',
      value: '',
      category: 'mobility',
      score: 60 + (org.abilities?.leap ?? 0) * 10,
    });
  }
  if (config.squeezeEnabled && (org.abilities?.squeeze ?? 0) > 0.05) {
    standouts.push({
      icon: '〰️',
      label: 'Squeezer',
      value: '',
      category: 'mobility',
      score: 55 + (org.abilities?.squeeze ?? 0) * 10,
    });
  }
  if (config.diagonalMoves && (org.abilities?.diagonal ?? 0) > 0.05) {
    standouts.push({
      icon: '↗️',
      label: 'Diagonal',
      value: '',
      category: 'mobility',
      score: 50 + (org.abilities?.diagonal ?? 0) * 10,
    });
  }

  // Growth pace (growth gene): standout only when well away from the founders' 100 ticks.
  if (config.growthEnabled && config.growthGeneEnabled && org.growthDuration !== undefined) {
    const d = org.growthDuration;
    const fast = d <= config.growthDurationFounder * 0.6;
    const slow = d >= config.growthDurationFounder * 1.6;
    if (fast || slow) {
      standouts.push({
        icon: fast ? '🐇' : '🐢',
        label: fast ? 'Fast grower' : 'Slow grower',
        value: `${Math.round(d)}`,
        category: 'morphology',
        score: 44 + Math.min(10, Math.abs(Math.log2(d / config.growthDurationFounder)) * 4),
      });
    }
  }

  // Hatch maturity (hatch gene): precocial young are born well developed, altricial ones small and helpless.
  if (config.growthEnabled && config.hatchMaturityGeneEnabled && org.hatchMaturity !== undefined) {
    const h = org.hatchMaturity;
    const precocial = h >= config.hatchMaturity + 0.25;
    const altricial = h <= config.hatchMaturity - 0.1;
    if (precocial || altricial) {
      standouts.push({
        icon: precocial ? '🦆' : '🐣',
        label: precocial ? 'Precocial' : 'Altricial',
        value: `${Math.round(h * 100)}%`,
        category: 'morphology',
        score: 44 + Math.min(10, Math.abs(h - config.hatchMaturity) * 20),
      });
    }
  }

  // Chemical Defense & Sensory
  if (config.detoxGeneEnabled && (org.detox ?? 0) >= 0.15) {
    standouts.push({
      icon: '🛡️',
      label: 'Detox',
      value: `${Math.round(org.detox! * 100)}%`,
      category: 'defense',
      score: 58 + org.detox! * 20,
    });
  }
  if (config.toughnessGeneEnabled && (org.toughness ?? 0) >= 0.15) {
    standouts.push({
      icon: '🥋',
      label: 'Armor',
      value: `${Math.round(org.toughness! * 100)}%`,
      category: 'defense',
      score: 59 + org.toughness! * 20,
    });
  }
  if (config.stealthGeneEnabled && (org.stealth ?? 0) >= 0.15) {
    standouts.push({
      icon: '🥷',
      label: 'Stealth',
      value: `${Math.round(org.stealth! * 100)}%`,
      category: 'defense',
      score: 59 + org.stealth! * 20,
    });
  }
  const senseR = config.sensingGeneEnabled ? (org.sensingRadius ?? config.sensingRadius) : config.sensingRadius;
  if (senseR > 2.2) {
    standouts.push({
      icon: '👁️',
      label: 'Vision',
      value: `${senseR.toFixed(1)}`,
      category: 'defense',
      score: 45 + (senseR - 2) * 10,
    });
  }

  // Morphology & Energetics
  if (config.sizeGeneEnabled && org.size !== undefined && Math.abs(org.size - 1.0) >= 0.18) {
    standouts.push({
      icon: org.size >= 1.0 ? '🦣' : '🐁',
      label: org.size >= 1.0 ? 'Heavy' : 'Dwarf',
      value: `${org.size.toFixed(1)}×`,
      category: 'morphology',
      score: 48 + Math.abs(org.size - 1.0) * 20,
    });
  }
  if (config.fatEnabled && (org.fatCapacity ?? 0) >= 15) {
    standouts.push({
      icon: '🔋',
      label: 'Fat Cap',
      value: `${Math.round(org.fatCapacity!)}`,
      category: 'morphology',
      score: 42 + (org.fatCapacity! / 50) * 10,
    });
  }
  if (config.carnivoreGeneEnabled && org.carnivoreEfficiency !== undefined && Math.abs(org.carnivoreEfficiency - 0.5) >= 0.2) {
    standouts.push({
      icon: '🦴',
      label: 'Scavenge',
      value: `${org.carnivoreEfficiency.toFixed(1)}×`,
      category: 'morphology',
      score: 40 + Math.abs(org.carnivoreEfficiency - 0.5) * 20,
    });
  }
  if (config.digestiveGeneEnabled && org.digestiveEfficiency !== undefined && Math.abs(org.digestiveEfficiency - 1.0) >= 0.2) {
    standouts.push({
      icon: '🍃',
      label: 'Gut',
      value: `${org.digestiveEfficiency.toFixed(1)}×`,
      category: 'morphology',
      score: 38 + Math.abs(org.digestiveEfficiency - 1.0) * 20,
    });
  }
  if ((org.acquiredBrainUnits ?? 0) > 0) {
    standouts.push({
      icon: '🧠',
      label: 'Brain',
      value: `+${org.acquiredBrainUnits}`,
      category: 'morphology',
      score: 46 + org.acquiredBrainUnits! * 5,
    });
  }

  standouts.sort((a, b) => b.score - a.score);
  // Cap total badges at 5 to wrap cleanly on 2 lines on mobile screens
  const maxBadges = 5;
  const neededStandouts = Math.max(0, maxBadges - core.length);
  return [...core, ...standouts.slice(0, neededStandouts)];
}

function renderBadgeHtml(b: TraitBadge): string {
  const style = b.customHue !== undefined ? `style="--badge-hue: ${b.customHue}"` : '';
  const val = b.value ? `<span class="badge-value">${b.value}</span>` : '';
  return `<span class="adaptation-badge badge-${b.category}" ${style}><span class="badge-icon">${b.icon}</span><span class="badge-label">${b.label}</span>${val}</span>`;
}

/**
 * Renders a high-fidelity visual miniature of an organism matching the world canvas renderer
 * (including body size, squeeze elongation, fat plumpness, carnivore mandibles, leaper fin,
 * diagonal setae, torpor frost rim, adipose ring, sensory aperture, and glowing brain nodes).
 */
export function drawOrganismBlob(
  ctx: CanvasRenderingContext2D,
  org: OrganismView,
  hue: number,
  config: SimulationConfig,
  w: number,
  h: number,
  alive = true
): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const TAU = Math.PI * 2;

  const maxEnergy = config.maxEnergy * (config.sizeGeneEnabled ? (org.size ?? 1) : 1);
  const energyRatio = alive ? Math.max(0, Math.min(1, org.energy / maxEnergy)) : 0;
  const sizeScale = config.sizeGeneEnabled ? Math.max(0.65, Math.min(1.35, Math.sqrt(org.size ?? 1))) : 1;
  const r = Math.min(w, h) * 0.28 * (0.68 + 0.32 * energyRatio) * sizeScale;

  // Phenotype traits
  const squeeze = config.squeezeEnabled ? (org.abilities?.squeeze ?? 0) : 0;
  const leap = config.leapEnabled ? (org.abilities?.leap ?? 0) : 0;
  const diagonal = config.diagonalMoves ? (org.abilities?.diagonal ?? 0) : 0;
  const fatCap = config.fatEnabled ? (org.fatCapacity ?? 0) : 0;
  const fatHeld = config.fatEnabled ? (org.fat ?? 0) : 0;
  const fatRatio = fatCap > 0 ? Math.min(1, fatHeld / Math.max(10, fatCap)) : 0;
  const torpor = config.torporEnabled && org.rested ? (org.torporDepth ?? 0) : 0;
  const carnivory = org.carnivory * (config.carnivoreGeneEnabled ? (org.carnivoreEfficiency ?? 1) : 1);

  // Upright orientation (heading towards top of canvas)
  const heading = -Math.PI / 2;
  const fx = 0;
  const fy = -1;
  const rx = 1;
  const ry = 0;
  const a = r * (1 + 0.2 * squeeze - 0.05 * fatRatio);
  const b = r * (1 - 0.13 * squeeze + 0.22 * fatRatio);

  const sat = alive ? (torpor > 0.1 ? Math.round(82 - 35 * torpor) : 82) : 0;
  const baseLight = alive ? Math.round(40 + 18 * energyRatio) : 32;

  // 1. Ambient lineage aura
  if (alive) {
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.16)`;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.55, 0, TAU);
    ctx.fill();
  }

  // 2. Rear propulsion fin for leapers
  if (leap > 0.05 && alive) {
    const finLen = r * (0.32 + 0.22 * leap);
    const finSpread = b * 0.52;
    const bx = cx - fx * (a * 0.85);
    const by = cy - fy * (a * 0.85);
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, 72%, 0.85)`;
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(bx + rx * finSpread - fx * finLen, by + ry * finSpread - fy * finLen);
    ctx.lineTo(bx - fx * (finLen * 0.25), by - fy * (finLen * 0.25));
    ctx.lineTo(bx - rx * finSpread - fx * finLen, by - ry * finSpread - fy * finLen);
    ctx.stroke();
  }

  // 3. Diagonal mover setae / notches
  if (diagonal > 0.05 && alive) {
    ctx.strokeStyle = `hsla(${hue}, ${sat}%, 76%, 0.75)`;
    ctx.lineWidth = Math.max(1.2, r * 0.13);
    ctx.beginPath();
    const c45 = 0.7071;
    for (const sx of [-1, 1] as const) {
      for (const sy of [-1, 1] as const) {
        const dx = (fx * sx * a + rx * sy * b) * c45;
        const dy = (fy * sx * a + ry * sy * b) * c45;
        ctx.moveTo(cx + dx * 0.88, cy + dy * 0.88);
        ctx.lineTo(cx + dx * (1.18 + 0.12 * diagonal), cy + dy * (1.18 + 0.12 * diagonal));
      }
    }
    ctx.stroke();
  }

  // 4. Layered pebble body fill
  ctx.fillStyle = alive ? `hsl(${hue}, ${sat}%, ${baseLight}%)` : '#3a4454';
  ctx.beginPath();
  ctx.ellipse(cx, cy, a, b, heading, 0, TAU);
  ctx.fill();

  // 5. Specular top highlight + gut tint
  if (alive) {
    const gutBoost = config.digestiveGeneEnabled ? Math.max(0, Math.min(1, (org.digestiveEfficiency ?? 1) - 0.5)) : 0.5;
    ctx.fillStyle = `hsla(${hue}, 90%, 78%, ${(0.32 + 0.22 * gutBoost).toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.18, cy - r * 0.18, a * 0.62, b * 0.58, heading, 0, TAU);
    ctx.fill();
  }

  // 6. Adipose fat reserve inner ring
  if (fatHeld > 1 && alive) {
    const fatAlpha = Math.min(0.9, 0.35 + 0.55 * fatRatio);
    ctx.strokeStyle = `hsla(42, 95%, 62%, ${fatAlpha.toFixed(2)})`;
    ctx.lineWidth = Math.max(1.4, r * (0.12 + 0.18 * fatRatio));
    ctx.beginPath();
    ctx.ellipse(cx, cy, a * 0.84, b * 0.84, heading, 0, TAU);
    ctx.stroke();
  }

  // 7. Torpor frosted outer rim
  if (torpor > 0.1 && alive) {
    ctx.strokeStyle = `hsla(200, 45%, 82%, ${(0.35 + 0.5 * torpor).toFixed(2)})`;
    ctx.lineWidth = Math.max(1.4, r * 0.16);
    ctx.beginPath();
    ctx.ellipse(cx, cy, a + 1.4, b + 1.4, heading, 0, TAU);
    ctx.stroke();
  }

  // 7b. Toughness / armor carapace outer rim
  const toughness = config.toughnessGeneEnabled ? (org.toughness ?? 0) : 0;
  if (toughness > 0.1 && alive) {
    ctx.strokeStyle = `hsla(38, 70%, 75%, ${(0.4 + 0.45 * toughness).toFixed(2)})`;
    ctx.lineWidth = Math.max(1.4, r * (0.12 + 0.14 * toughness));
    ctx.setLineDash([Math.max(2.5, r * 0.28), Math.max(1.5, r * 0.16)]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, a + Math.max(1.2, r * 0.12), b + Math.max(1.2, r * 0.12), heading, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 7c. Stealth / camouflage cloaking rim
  const stealth = config.stealthGeneEnabled ? (org.stealth ?? 0) : 0;
  if (stealth > 0.1 && alive) {
    ctx.strokeStyle = `hsla(160, 45%, 65%, ${(0.35 + 0.45 * stealth).toFixed(2)})`;
    ctx.lineWidth = Math.max(1.2, r * (0.08 + 0.1 * stealth));
    ctx.setLineDash([Math.max(1.5, r * 0.15), Math.max(2, r * 0.25)]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, a + Math.max(0.8, r * 0.08), b + Math.max(0.8, r * 0.08), heading, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 8. Carnivore mandibles / predator teeth at forward leading edge
  if (carnivory >= 0.22 && alive) {
    const strength = Math.min(1, (carnivory - 0.2) / 0.65);
    const tipX = cx + fx * (a * (1.02 + 0.18 * strength));
    const tipY = cy + fy * (a * (1.02 + 0.18 * strength));
    const baseX = cx + fx * (a * 0.68);
    const baseY = cy + fy * (a * 0.68);
    const jawSpread = b * (0.35 + 0.22 * strength);
    ctx.strokeStyle = `hsla(${hue}, 95%, 88%, 0.95)`;
    ctx.fillStyle = `hsl(${hue}, 80%, ${Math.min(90, baseLight + 25)}%)`;
    ctx.lineWidth = Math.max(1.2, r * 0.14);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX + rx * jawSpread, baseY + ry * jawSpread);
    ctx.lineTo(baseX - rx * jawSpread, baseY - ry * jawSpread);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // 9. Sensory aperture crescent at the front
  const senseR = config.sensingGeneEnabled ? (org.sensingRadius ?? config.sensingRadius) : config.sensingRadius;
  if (senseR > 2.2 && alive) {
    const span = (0.22 + 0.14 * Math.max(0, Math.min(1, (senseR - 2) / 4))) * Math.PI;
    ctx.strokeStyle = `hsla(190, 90%, 82%, 0.7)`;
    ctx.lineWidth = Math.max(1.2, r * 0.12);
    ctx.beginPath();
    ctx.ellipse(cx, cy, a + Math.max(1.6, r * 0.22), b + Math.max(1.6, r * 0.22), heading, -span, span);
    ctx.stroke();
  }

  // 10. Neural core nodes (brain nodes)
  const memSpan = config.memoryEnabled ? (org.memorySpan ?? 0) : 0;
  const brainExtra = org.acquiredBrainUnits ?? 0;
  const nodeCount = Math.min(3, (memSpan >= 8 ? 1 : 0) + (memSpan >= 24 ? 1 : 0) + (brainExtra > 0 ? 1 : 0));
  if (nodeCount > 0 && alive) {
    const nodeR = Math.max(1.2, r * 0.11);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.beginPath();
    for (let i = 0; i < nodeCount; i++) {
      const offsetLat = (i - (nodeCount - 1) / 2) * (b * 0.38);
      const nx = cx + fx * (a * 0.45) + rx * offsetLat;
      const ny = cy + fy * (a * 0.45) + ry * offsetLat;
      ctx.moveTo(nx + nodeR, ny);
      ctx.arc(nx, ny, nodeR, 0, TAU);
    }
    ctx.fill();
  }
}

/**
 * Renders an egg preview blob matching the canvas renderer.
 */
export function drawEggBlob(
  ctx: CanvasRenderingContext2D,
  egg: EggView,
  w: number,
  h: number,
  alive = true
): void {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const TAU = Math.PI * 2;
  const sizeScale = Math.max(0.7, Math.min(1.4, Math.sqrt(egg.size || 1)));
  const rx = Math.min(w, h) * 0.28 * sizeScale;
  const ry = Math.min(w, h) * 0.38 * sizeScale;
  const tagHue = Math.round(egg.tag ?? 45);
  const shellStrength = Math.max(0, Math.min(1, egg.shell ?? 0.5));

  // Soft glow
  if (alive) {
    ctx.fillStyle = `hsla(${tagHue}, 90%, 65%, 0.18)`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 1.3, ry * 1.3, 0, 0, TAU);
    ctx.fill();
  }

  // Shell body
  ctx.fillStyle = alive ? `hsl(${tagHue}, 38%, 86%)` : '#5a6270';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.fill();

  // Embryo yolk core
  if (alive) {
    const energyNorm = Math.max(0.3, Math.min(1, (egg.energy || 25) / 60));
    ctx.fillStyle = `hsla(${tagHue}, 78%, 56%, 0.7)`;
    ctx.beginPath();
    ctx.arc(cx, cy + ry * 0.1, rx * 0.52 * energyNorm, 0, TAU);
    ctx.fill();

    // Specular highlight
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.25, cy - ry * 0.25, rx * 0.4, ry * 0.35, -Math.PI / 6, 0, TAU);
    ctx.fill();
  }

  // Calcified shell rim
  ctx.strokeStyle = alive ? `rgba(55, 42, 24, ${(0.4 + 0.55 * shellStrength).toFixed(2)})` : '#222832';
  ctx.lineWidth = Math.max(1.2, Math.min(w, h) * (0.04 + 0.05 * shellStrength));
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  ctx.stroke();
}

/**
 * The floating card for the selected organism. Tap it to open the
 * inspector. Built once and updated in place, so a tap is never lost to a
 * re-render mid-press.
 */
export class OrganismCard {
  private readonly el: HTMLElement;
  private readonly orbCanvas: HTMLCanvasElement;
  private readonly orbCtx: CanvasRenderingContext2D | null;
  private readonly given: HTMLElement;
  private readonly family: HTMLElement;
  private readonly doing: HTMLElement;
  private readonly energy: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly traitsContainer: HTMLElement;
  private lastBadgesHtml = '';

  constructor(el: HTMLElement, onOpen: () => void, onClose: () => void) {
    this.el = el;
    el.innerHTML = `
      <canvas class="card-orb" width="72" height="72" aria-hidden="true"></canvas>
      <span class="card-text">
        <span class="card-name"><span class="card-given"></span> <span class="card-family"></span></span>
        <span class="card-doing"></span>
        <span class="card-energy" role="img"><span class="card-energy-fill"></span></span>
        <span class="card-traits"></span>
      </span>
      <span class="card-more" aria-hidden="true">›</span>
      <button type="button" class="card-close" aria-label="Deselect">✕</button>
    `;
    this.orbCanvas = el.querySelector<HTMLCanvasElement>('.card-orb')!;
    this.orbCtx = this.orbCanvas.getContext('2d');
    this.given = el.querySelector('.card-given')!;
    this.family = el.querySelector('.card-family')!;
    this.doing = el.querySelector('.card-doing')!;
    this.energy = el.querySelector('.card-energy')!;
    this.fill = el.querySelector('.card-energy-fill')!;
    this.traitsContainer = el.querySelector('.card-traits')!;

    el.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.card-close')) onClose();
      else onOpen();
    });
    el.addEventListener('keydown', (e) => {
      if (e.target === el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        onOpen();
      }
    });
  }

  public hide(): void {
    this.el.hidden = true;
  }

  private renderBadges(html: string): void {
    if (this.lastBadgesHtml !== html) {
      this.lastBadgesHtml = html;
      this.traitsContainer.innerHTML = html;
    }
  }

  public render(
    org: OrganismView,
    hue: number,
    config: SimulationConfig,
    nameOf: (id: string) => string | null,
    alive: boolean
  ): void {
    const name = organismName(org);
    const energy = alive ? org.energy : 0;
    const maxEnergy = config.maxEnergy * (config.sizeGeneEnabled ? (org.size ?? 1) : 1);
    const pct = Math.max(0, Math.min(100, (energy / maxEnergy) * 100));
    const carrying = alive && org.carriedFood > 0 ? ` · carrying ${org.carriedFood}` : '';
    const set = (node: HTMLElement, text: string) => {
      if (node.textContent !== text) node.textContent = text;
    };
    this.el.hidden = false;
    this.el.classList.toggle('dead', !alive);
    this.orbCanvas.style.setProperty('--hue', String(Math.round(hue)));
    if (this.orbCtx) {
      drawOrganismBlob(this.orbCtx, org, hue, config, this.orbCanvas.width, this.orbCanvas.height, alive);
    }
    set(this.given, name.given);
    set(this.family, name.family);

    const doingText = alive
      ? `Gen ${org.lineage.generation} · Age ${org.age} · ${describeDoing(org, nameOf, alive)}${carrying}`
      : `Gen ${org.lineage.generation} · Died at age ${org.age}`;
    set(this.doing, doingText);

    this.energy.setAttribute('aria-label', `Energy ${Math.round(energy)} of ${Math.round(maxEnergy)}`);
    this.fill.style.width = `${pct}%`;
    this.fill.classList.toggle('low', energy < maxEnergy * 0.25);

    const badges = computeOrganismBadges(org, config);
    this.renderBadges(badges.map(renderBadgeHtml).join(''));
  }

  public renderEgg(
    egg: EggView,
    config: SimulationConfig,
    nameOf: (id: string) => string | null,
    alive = true
  ): void {
    const given = givenName(egg.id);
    const parent = egg.parentId ? (nameOf(egg.parentId) ?? givenName(egg.parentId)) : null;
    const energy = alive ? egg.energy : 0;
    const maxEnergy = config.maxEnergy * (config.sizeGeneEnabled ? (egg.size ?? 1) : 1);
    const pct = Math.max(0, Math.min(100, (energy / maxEnergy) * 100));
    const set = (node: HTMLElement, text: string) => {
      if (node.textContent !== text) node.textContent = text;
    };
    this.el.hidden = false;
    this.el.classList.toggle('dead', !alive);
    this.orbCanvas.style.setProperty('--hue', String(Math.round(egg.tag)));
    if (this.orbCtx) {
      drawEggBlob(this.orbCtx, egg, this.orbCanvas.width, this.orbCanvas.height, alive);
    }
    set(this.given, `Egg · ${given}`);
    set(this.family, `Gen ${egg.generation}`);
    set(
      this.doing,
      alive
        ? `Gen ${egg.generation} · Incubating at ${egg.x},${egg.y}${parent ? ` · child of ${parent}` : ''}`
        : `Gen ${egg.generation} · Egg decayed`
    );
    this.energy.setAttribute('aria-label', `Egg Energy ${Math.round(energy)} of ${Math.round(maxEnergy)}`);
    this.fill.style.width = `${pct}%`;
    this.fill.classList.toggle('low', energy < maxEnergy * 0.25);

    const badges: TraitBadge[] = [
      { icon: '🥚', label: 'Egg', value: '', category: 'breeding', score: 100 },
      { icon: '🛡️', label: 'Shell', value: egg.shell.toFixed(2), category: 'defense', score: 90 },
      ...(egg.toxicity && egg.toxicity > 0
        ? [{ icon: '☠️', label: 'Toxic', value: `${(egg.toxicity * 100).toFixed(0)}%`, category: 'defense' as const, score: 85 }]
        : []),
      { icon: '📏', label: 'Size', value: `${(egg.size || 1).toFixed(1)}×`, category: 'morphology', score: 80 },
      { icon: '⚡', label: 'Energy', value: `${Math.round(egg.energy)}`, category: 'metabolism', score: 70 },
    ];
    this.renderBadges(badges.map(renderBadgeHtml).join(''));
  }
}
