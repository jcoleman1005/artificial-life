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

  // 2. Core: Metabolic Burn
  if (config.metabolismGeneEnabled && org.metabolicRate !== undefined) {
    core.push({
      icon: '⚡',
      label: 'Burn',
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
      label: 'Invest',
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
      label: 'Neural',
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
 * The floating card for the selected organism. Tap it to open the
 * inspector. Built once and updated in place, so a tap is never lost to a
 * re-render mid-press.
 */
export class OrganismCard {
  private readonly el: HTMLElement;
  private readonly orb: HTMLElement;
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
      <span class="card-orb" aria-hidden="true"></span>
      <span class="card-text">
        <span class="card-name"><span class="card-given"></span> <span class="card-family"></span></span>
        <span class="card-doing"></span>
        <span class="card-energy" role="img"><span class="card-energy-fill"></span></span>
        <span class="card-traits"></span>
      </span>
      <span class="card-more" aria-hidden="true">›</span>
      <button type="button" class="card-close" aria-label="Deselect">✕</button>
    `;
    this.orb = el.querySelector('.card-orb')!;
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
    this.orb.style.setProperty('--hue', String(Math.round(hue)));
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
    this.orb.style.setProperty('--hue', String(Math.round(egg.tag)));
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
      { icon: '📏', label: 'Size', value: `${(egg.size || 1).toFixed(1)}×`, category: 'morphology', score: 80 },
      { icon: '⚡', label: 'Energy', value: `${Math.round(egg.energy)}`, category: 'metabolism', score: 70 },
    ];
    this.renderBadges(badges.map(renderBadgeHtml).join(''));
  }
}
