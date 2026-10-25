import type { SimulationConfig } from '../sim/types';
import type { OrganismView } from '../sim/protocol';
import { organismName } from './names';

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

/**
 * The small floating card for the selected organism. Tap it to open the
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

  constructor(el: HTMLElement, onOpen: () => void, onClose: () => void) {
    this.el = el;
    el.innerHTML = `
      <span class="card-orb" aria-hidden="true"></span>
      <span class="card-text">
        <span class="card-name"><span class="card-given"></span> <span class="card-family"></span></span>
        <span class="card-doing"></span>
        <span class="card-energy" role="img"><span class="card-energy-fill"></span></span>
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

  public render(
    org: OrganismView,
    hue: number,
    config: SimulationConfig,
    nameOf: (id: string) => string | null,
    alive: boolean
  ): void {
    const name = organismName(org);
    const energy = alive ? org.energy : 0;
    const pct = Math.max(0, Math.min(100, (energy / config.maxEnergy) * 100));
    const carrying = alive && org.carriedFood > 0 ? ` · carrying ${org.carriedFood}` : '';
    const set = (node: HTMLElement, text: string) => {
      if (node.textContent !== text) node.textContent = text;
    };
    this.el.hidden = false;
    this.el.classList.toggle('dead', !alive);
    this.orb.style.setProperty('--hue', String(Math.round(hue)));
    set(this.given, name.given);
    set(this.family, name.family);
    set(this.doing, describeDoing(org, nameOf, alive) + carrying);
    this.energy.setAttribute('aria-label', `Energy ${Math.round(energy)} of ${config.maxEnergy}`);
    this.fill.style.width = `${pct}%`;
    this.fill.classList.toggle('low', energy < config.maxEnergy * 0.25);
  }
}
