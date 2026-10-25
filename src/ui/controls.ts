import type { ColorMode } from '../render/renderer';
import type { FoodLayout, WorldSize } from '../sim/config';

export interface PlaybackCallbacks {
  onPlayPause: () => void;
  onStep: () => void;
  onSpeedChange: (speedMultiplier: number) => void;
}

export interface SettingsCallbacks {
  onReset: (seed: string | number) => void;
  onNewSeed: () => void;
  onColorModeChange: (mode: ColorMode) => void;
  onSharingChange: (enabled: boolean) => void;
  onSignalsChange: (enabled: boolean) => void;
  onSeasonsChange: (enabled: boolean) => void;
  onControllerChange: (controller: 'dials' | 'brain') => void;
  /** World size and food layout restart the run with the current seed. */
  onWorldSizeChange: (size: WorldSize) => void;
  onFoodLayoutChange: (layout: FoodLayout) => void;
}

export interface ExperimentToggles {
  sharingEnabled: boolean;
  signalsEnabled: boolean;
  seasonsEnabled: boolean;
  controller: 'dials' | 'brain';
  worldSize: WorldSize;
  foodLayout: FoodLayout;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 5, 10] as const;
const speedLabel = (s: number) => (s === 0.25 ? '¼×' : s === 0.5 ? '½×' : `${s}×`);

const PLAY_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor"/></svg>';
const STEP_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6.5v11a1 1 0 0 0 1.55.83l8-5.5a1 1 0 0 0 0-1.66l-8-5.5A1 1 0 0 0 6 6.5z" fill="currentColor"/><rect x="16.5" y="5.5" width="2.5" height="13" rx="1" fill="currentColor"/></svg>';

/** The floating playback pill over the world: play/pause, step, speed, tick. */
export class PlaybackPill {
  private readonly playBtn: HTMLButtonElement;
  private readonly stepBtn: HTMLButtonElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly tickEl: HTMLElement;
  private speedIndex = SPEEDS.indexOf(1);

  constructor(container: HTMLElement, callbacks: PlaybackCallbacks) {
    container.innerHTML = `
      <button type="button" class="pill-btn pill-play" aria-label="Play">${PLAY_ICON}</button>
      <button type="button" class="pill-btn pill-step" aria-label="Step one tick">${STEP_ICON}</button>
      <button type="button" class="pill-btn pill-speed" aria-label="Speed 1×, tap to change">1×</button>
      <span class="pill-tick" aria-live="off">t 0</span>
    `;
    this.playBtn = container.querySelector('.pill-play')!;
    this.stepBtn = container.querySelector('.pill-step')!;
    this.speedBtn = container.querySelector('.pill-speed')!;
    this.tickEl = container.querySelector('.pill-tick')!;
    this.playBtn.addEventListener('click', () => callbacks.onPlayPause());
    this.stepBtn.addEventListener('click', () => callbacks.onStep());
    this.speedBtn.addEventListener('click', () => {
      this.speedIndex = (this.speedIndex + 1) % SPEEDS.length;
      this.showSpeed();
      callbacks.onSpeedChange(SPEEDS[this.speedIndex]);
    });
  }

  private showSpeed(): void {
    const label = speedLabel(SPEEDS[this.speedIndex]);
    this.speedBtn.textContent = label;
    this.speedBtn.setAttribute('aria-label', `Speed ${label}, tap to change`);
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
        <h3>World <small>size and food restart the run</small></h3>
        ${segmented('Size', 'world', [['small', '30×30'], ['large', '60×60']], toggles.worldSize)}
        ${segmented('Food', 'food', [['anywhere', 'Anywhere'], ['regions', 'Regions'], ['shifting', 'Shifting']], toggles.foodLayout)}
        ${segmented('Seasons', 'seasons', onOff, toggles.seasonsEnabled ? 'on' : 'off')}
      </section>
      <section class="settings-group">
        <h3>Behaviour <small>takes effect next tick</small></h3>
        ${segmented('Sharing', 'sharing', onOff, toggles.sharingEnabled ? 'on' : 'off')}
        ${segmented('Signals', 'signals', onOff, toggles.signalsEnabled ? 'on' : 'off')}
        ${segmented('Controller', 'controller', [['dials', 'Dials'], ['brain', 'Brain']], toggles.controller)}
      </section>
      <section class="settings-group">
        <h3>Display</h3>
        ${segmented('Colour by', 'color', [['tag', 'Tag'], ['lineage', 'Family']], 'tag')}
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
    `;
    this.attachEvents();
  }

  public setSeed(seed: string | number): void {
    const input = this.container.querySelector<HTMLInputElement>('#input-seed');
    if (input) input.value = String(seed);
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
    this.bindSegment('controller', (v) => cb.onControllerChange(v === 'brain' ? 'brain' : 'dials'));
    this.bindSegment('color', (v) => cb.onColorModeChange(v as ColorMode));

    const seedInput = this.container.querySelector<HTMLInputElement>('#input-seed')!;
    const reset = () => cb.onReset(seedInput.value.trim() || '42');
    this.container.querySelector('#btn-reset')!.addEventListener('click', reset);
    seedInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') reset();
    });
    this.container.querySelector('#btn-new-seed')!.addEventListener('click', () => cb.onNewSeed());
  }
}
