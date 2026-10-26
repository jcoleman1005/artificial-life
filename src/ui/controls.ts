import type { ColorMode, MotionStyle } from '../render/renderer';
import type { FoodLayout, WorldSize } from '../sim/config';
import type { SavedWorldInfo } from './saved-worlds';

export interface PlaybackCallbacks {
  onPlayPause: () => void;
  onStep: () => void;
  onSpeedChange: (speedMultiplier: number) => void;
}

export interface SettingsCallbacks {
  onReset: (seed: string | number) => void;
  onNewSeed: () => void;
  onColorModeChange: (mode: ColorMode) => void;
  onMotionStyleChange: (style: MotionStyle) => void;
  onSharingChange: (enabled: boolean) => void;
  onSignalsChange: (enabled: boolean) => void;
  onDispersalChange: (enabled: boolean) => void;
  onWindfallsChange: (enabled: boolean) => void;
  onImmigrationChange: (enabled: boolean) => void;
  onPlantsChange: (enabled: boolean) => void;
  onMemoryChange: (enabled: boolean) => void;
  onSeasonsChange: (enabled: boolean) => void;
  onControllerChange: (controller: 'dials' | 'brain') => void;
  /** World size and food layout restart the run with the current seed. */
  onWorldSizeChange: (size: WorldSize) => void;
  onFoodLayoutChange: (layout: FoodLayout) => void;
  /** Saved worlds: branch points in this browser, and files. */
  onBranch: () => void;
  onGoToBranch: (key: string) => void;
  onDeleteBranch: (key: string) => void;
  onSaveFile: () => void;
  onLoadFile: (file: File) => void;
}

export interface ExperimentToggles {
  sharingEnabled: boolean;
  signalsEnabled: boolean;
  dispersalEnabled: boolean;
  windfallsEnabled: boolean;
  immigrationEnabled: boolean;
  plantsEnabled: boolean;
  memoryEnabled: boolean;
  seasonsEnabled: boolean;
  controller: 'dials' | 'brain';
  worldSize: WorldSize;
  foodLayout: FoodLayout;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const;
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
const SLOWER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M11.5 7 6.5 12l5 5M17.5 7l-5 5 5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FASTER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12.5 7l5 5-5 5M6.5 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const STEP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6.5v11a1 1 0 0 0 1.55.83l8-5.5a1 1 0 0 0 0-1.66l-8-5.5A1 1 0 0 0 6 6.5z" fill="currentColor"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor"/></svg>';

/** The floating playback pill over the world: play/pause, step, slower / speed / faster, tick. */
export class PlaybackPill {
  private readonly playBtn: HTMLButtonElement;
  private readonly stepBtn: HTMLButtonElement;
  private readonly speedEl: HTMLElement;
  private readonly slowerBtn: HTMLButtonElement;
  private readonly fasterBtn: HTMLButtonElement;
  private readonly onSpeedChange: (speedMultiplier: number) => void;
  private readonly tickEl: HTMLElement;
  private speedIndex = SPEEDS.indexOf(1);

  constructor(container: HTMLElement, callbacks: PlaybackCallbacks) {
    container.innerHTML = `
      <button type="button" class="pill-btn pill-play" aria-label="Play">${PLAY_ICON}</button>
      <button type="button" class="pill-btn pill-step" aria-label="Step one tick">${STEP_ICON}</button>
      <span class="pill-speed-group" role="group" aria-label="Speed">
        <button type="button" class="pill-btn pill-slower" aria-label="Slower">${SLOWER_ICON}</button>
        <span class="pill-speed" aria-live="polite">1×</span>
        <button type="button" class="pill-btn pill-faster" aria-label="Faster">${FASTER_ICON}</button>
      </span>
      <span class="pill-tick" aria-live="off">t 0</span>
    `;
    this.playBtn = container.querySelector('.pill-play')!;
    this.stepBtn = container.querySelector('.pill-step')!;
    this.speedEl = container.querySelector('.pill-speed')!;
    this.slowerBtn = container.querySelector('.pill-slower')!;
    this.fasterBtn = container.querySelector('.pill-faster')!;
    this.tickEl = container.querySelector('.pill-tick')!;
    this.onSpeedChange = callbacks.onSpeedChange;
    this.playBtn.addEventListener('click', () => callbacks.onPlayPause());
    this.stepBtn.addEventListener('click', () => callbacks.onStep());
    this.slowerBtn.addEventListener('click', () => this.changeSpeed(-1));
    this.fasterBtn.addEventListener('click', () => this.changeSpeed(1));
    this.showSpeed();
  }

  /** One speed step slower (-1) or faster (+1), stopping at ¼× and 10×. */
  public changeSpeed(direction: 1 | -1): void {
    const next = Math.max(0, Math.min(SPEEDS.length - 1, this.speedIndex + direction));
    if (next === this.speedIndex) return;
    this.speedIndex = next;
    this.showSpeed();
    this.onSpeedChange(SPEEDS[this.speedIndex]);
  }

  /** Shows a speed set elsewhere (e.g. by another viewer of a shared world), without reporting it back. */
  public setSpeed(multiplier: number): void {
    let nearest = 0;
    SPEEDS.forEach((s, i) => {
      if (Math.abs(s - multiplier) < Math.abs(SPEEDS[nearest] - multiplier)) nearest = i;
    });
    if (nearest === this.speedIndex) return;
    this.speedIndex = nearest;
    this.showSpeed();
  }

  private showSpeed(): void {
    const label = speedLabel(SPEEDS[this.speedIndex]);
    this.speedEl.textContent = label;
    this.speedEl.setAttribute('aria-label', `Speed ${label}`);
    this.slowerBtn.disabled = this.speedIndex === 0;
    this.fasterBtn.disabled = this.speedIndex === SPEEDS.length - 1;
  }

  public setRunning(running: boolean): void {
    this.playBtn.innerHTML = running ? PAUSE_ICON : PLAY_ICON;
    this.playBtn.setAttribute('aria-label', running ? 'Pause' : 'Play');
    this.playBtn.classList.toggle('running', running);
    this.stepBtn.disabled = running;
  }

  public setTick(tick: number): void {
    const text = `t ${tick}`;
    if (this.tickEl.textContent !== text) this.tickEl.textContent = text;
  }
}

const segmented = (label: string, attr: string, options: [string, string][], active: string) => `
  <div class="setting-row">
    <span class="setting-label">${label}</span>
    <div class="segmented" role="group" aria-label="${label}">
      ${options
        .map(
          ([value, text]) =>
            `<button type="button" data-${attr}="${value}" class="${value === active ? 'active' : ''}" aria-pressed="${value === active}">${text}</button>`
        )
        .join('')}
    </div>
  </div>`;

/** Experiment switches, grouped: World, Behaviour, Display, Run. */
export class SettingsView {
  private readonly container: HTMLElement;
  private readonly callbacks: SettingsCallbacks;

  constructor(container: HTMLElement, initialSeed: string | number, toggles: ExperimentToggles, callbacks: SettingsCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    const onOff: [string, string][] = [
      ['on', 'On'],
      ['off', 'Off'],
    ];
    container.innerHTML = `
      <section class="settings-group">
        <h3>World <small>size, food and plants restart the run</small></h3>
        ${segmented('Size', 'world', [['small', '30×30'], ['large', '60×60']], toggles.worldSize)}
        ${segmented('Food', 'food', [['anywhere', 'Anywhere'], ['regions', 'Regions'], ['shifting', 'Shifting']], toggles.foodLayout)}
        ${segmented('Seasons', 'seasons', onOff, toggles.seasonsEnabled ? 'on' : 'off')}
        ${segmented('Windfalls', 'windfalls', onOff, toggles.windfallsEnabled ? 'on' : 'off')}
        ${segmented('Spontaneous generation', 'immigration', onOff, toggles.immigrationEnabled ? 'on' : 'off')}
        ${segmented('Plants', 'plants', [['off', 'Patches'], ['on', 'Evolving']], toggles.plantsEnabled ? 'on' : 'off')}
      </section>
      <section class="settings-group">
        <h3>Behaviour <small>takes effect next tick</small></h3>
        ${segmented('Sharing', 'sharing', onOff, toggles.sharingEnabled ? 'on' : 'off')}
        ${segmented('Signals', 'signals', onOff, toggles.signalsEnabled ? 'on' : 'off')}
        ${segmented('Dispersal', 'dispersal', onOff, toggles.dispersalEnabled ? 'on' : 'off')}
        ${segmented('Memory', 'memory', onOff, toggles.memoryEnabled ? 'on' : 'off')}
        ${segmented('Controller', 'controller', [['dials', 'Dials'], ['brain', 'Brain']], toggles.controller)}
      </section>
      <section class="settings-group">
        <h3>Display</h3>
        ${segmented('Colour by', 'color', [['tag', 'Tag'], ['lineage', 'Family'], ['diet', 'Diet']], 'tag')}
        ${segmented('Motion', 'motion', [['smooth', 'Smooth'], ['fluid', 'Fluid']], 'fluid')}
      </section>
      <section class="settings-group">
        <h3>Run</h3>
        <div class="setting-row">
          <label class="setting-label" for="input-seed">Seed</label>
          <input type="text" id="input-seed" inputmode="numeric" autocomplete="off" value="${initialSeed}" />
        </div>
        <div class="setting-actions">
          <button type="button" id="btn-reset" class="btn btn-secondary">Reset</button>
          <button type="button" id="btn-new-seed" class="btn btn-secondary">New seed</button>
        </div>
        <p id="sim-status" class="sim-status">Tick 0 · Paused</p>
      </section>
      <section class="settings-group">
        <h3>Saved worlds <small>this browser keeps your world and resumes it</small></h3>
        <div class="setting-actions">
          <button type="button" id="btn-branch" class="btn btn-secondary">Branch here</button>
          <button type="button" id="btn-save-file" class="btn btn-secondary">Save to file</button>
          <label class="btn btn-secondary file-btn">Load file<input type="file" id="input-load-file" accept=".json,application/json" hidden /></label>
        </div>
        <p class="setting-hint">A branch point saves this moment so you can come back and try something different.</p>
        <ul id="branch-list" class="branch-list"></ul>
      </section>
    `;
    this.attachEvents();
  }

  public setSeed(seed: string | number): void {
    const input = this.container.querySelector<HTMLInputElement>('#input-seed');
    if (input) input.value = String(seed);
  }

  /** Shows the settings of a world that was loaded or reset. */
  public setToggles(t: ExperimentToggles): void {
    const set = (attr: string, value: string) => {
      this.container.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
        const on = b.getAttribute(`data-${attr}`) === value;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
    };
    set('world', t.worldSize);
    set('food', t.foodLayout);
    set('seasons', t.seasonsEnabled ? 'on' : 'off');
    set('sharing', t.sharingEnabled ? 'on' : 'off');
    set('signals', t.signalsEnabled ? 'on' : 'off');
    set('dispersal', t.dispersalEnabled ? 'on' : 'off');
    set('windfalls', t.windfallsEnabled ? 'on' : 'off');
    set('immigration', t.immigrationEnabled ? 'on' : 'off');
    set('plants', t.plantsEnabled ? 'on' : 'off');
    set('memory', t.memoryEnabled ? 'on' : 'off');
    set('controller', t.controller);
  }

  /** The list of branch points, newest first. */
  public setBranches(branches: readonly SavedWorldInfo[]): void {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const list = this.container.querySelector<HTMLElement>('#branch-list')!;
    const when = (iso: string) =>
      new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    list.innerHTML =
      branches.length === 0
        ? '<li class="muted">No branch points yet.</li>'
        : branches
            .map(
              (b) => `
          <li>
            <span class="branch-text"><strong>${esc(b.label)}</strong><small>${when(b.savedAt)} · ${b.population} alive</small></span>
            <button type="button" class="btn btn-secondary btn-small" data-go-branch="${esc(b.key)}">Go</button>
            <button type="button" class="round-btn btn-small-round" data-delete-branch="${esc(b.key)}" aria-label="Delete ${esc(b.label)}">✕</button>
          </li>`
            )
            .join('');
  }

  /** Tick, run state, measured speed. */
  public setStatus(text: string): void {
    const status = this.container.querySelector<HTMLElement>('#sim-status');
    if (status && status.textContent !== text) status.textContent = text;
  }

  private bindSegment(attr: string, handler: (value: string) => void): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`);
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-pressed', String(b === btn));
        });
        handler(btn.getAttribute(`data-${attr}`)!);
      });
    });
  }

  private attachEvents(): void {
    const cb = this.callbacks;
    this.bindSegment('world', (v) => cb.onWorldSizeChange(v as WorldSize));
    this.bindSegment('food', (v) => cb.onFoodLayoutChange(v as FoodLayout));
    this.bindSegment('seasons', (v) => cb.onSeasonsChange(v === 'on'));
    this.bindSegment('sharing', (v) => cb.onSharingChange(v === 'on'));
    this.bindSegment('signals', (v) => cb.onSignalsChange(v === 'on'));
    this.bindSegment('dispersal', (v) => cb.onDispersalChange(v === 'on'));
    this.bindSegment('windfalls', (v) => cb.onWindfallsChange(v === 'on'));
    this.bindSegment('immigration', (v) => cb.onImmigrationChange(v === 'on'));
    this.bindSegment('plants', (v) => cb.onPlantsChange(v === 'on'));
    this.bindSegment('memory', (v) => cb.onMemoryChange(v === 'on'));
    this.bindSegment('controller', (v) => cb.onControllerChange(v === 'brain' ? 'brain' : 'dials'));
    this.bindSegment('color', (v) => cb.onColorModeChange(v as ColorMode));
    this.bindSegment('motion', (v) => cb.onMotionStyleChange(v as MotionStyle));

    const seedInput = this.container.querySelector<HTMLInputElement>('#input-seed')!;
    // A whole number is used as a number, so typing 42 gives the same world as the default seed 42.
    const reset = () => {
      const text = seedInput.value.trim() || '42';
      cb.onReset(/^\d+$/.test(text) ? Number(text) : text);
    };
    this.container.querySelector('#btn-reset')!.addEventListener('click', reset);
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') reset();
    });
    this.container.querySelector('#btn-new-seed')!.addEventListener('click', () => cb.onNewSeed());

    this.container.querySelector('#btn-branch')!.addEventListener('click', () => cb.onBranch());
    this.container.querySelector('#btn-save-file')!.addEventListener('click', () => cb.onSaveFile());
    const fileInput = this.container.querySelector<HTMLInputElement>('#input-load-file')!;
    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) cb.onLoadFile(file);
      fileInput.value = ''; // the same file can be picked again
    });
    this.container.querySelector('#branch-list')!.addEventListener('click', (e) => {
      const target = e.target as Element;
      const go = target.closest<HTMLElement>('[data-go-branch]');
      if (go) cb.onGoToBranch(go.dataset.goBranch!);
      const del = target.closest<HTMLElement>('[data-delete-branch]');
      if (del) cb.onDeleteBranch(del.dataset.deleteBranch!);
    });
  }
}
