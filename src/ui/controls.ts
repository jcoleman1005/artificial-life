import type { ColorMode } from '../render/renderer';
import type { FoodLayout, WorldSize } from '../sim/config';

export interface ControlCallbacks {
  onPlayPause: () => void;
  onStep: () => void;
  onSpeedChange: (speedMultiplier: number) => void;
  onReset: (seed: string | number) => void;
  onNewSeed: () => void;
  onColorModeChange: (mode: ColorMode) => void;
  onSharingChange: (enabled: boolean) => void;
  onSeasonsChange: (enabled: boolean) => void;
  onControllerChange: (controller: 'dials' | 'brain') => void;
  /** World size and food layout restart the run with the current seed. */
  onWorldSizeChange: (size: WorldSize) => void;
  onFoodLayoutChange: (layout: FoodLayout) => void;
}

export interface ExperimentToggles {
  sharingEnabled: boolean;
  seasonsEnabled: boolean;
  controller: 'dials' | 'brain';
  worldSize: WorldSize;
  foodLayout: FoodLayout;
}

export class ControlsView {
  private readonly container: HTMLElement;
  private isRunning = false;
  private hasStarted = false;
  private currentSpeed = 1;
  private currentSeed: string | number = 42;
  private callbacks: ControlCallbacks;
  private readonly toggles: ExperimentToggles;

  constructor(
    container: HTMLElement,
    initialSeed: string | number,
    toggles: ExperimentToggles,
    callbacks: ControlCallbacks
  ) {
    this.container = container;
    this.currentSeed = initialSeed;
    this.toggles = toggles;
    this.callbacks = callbacks;
    this.render();
  }

  public setRunning(running: boolean): void {
    this.isRunning = running;
    if (running) {
      this.hasStarted = true;
    }
    const playBtn = this.container.querySelector<HTMLButtonElement>('#btn-play-pause');
    if (playBtn) {
      const label = this.isRunning
        ? '<span class="icon">⏸</span><span>Pause</span>'
        : this.hasStarted
        ? '<span class="icon">▶</span><span>Resume</span>'
        : '<span class="icon">▶</span><span>Start</span>';
      playBtn.innerHTML = label;
      playBtn.classList.toggle('btn-active', this.isRunning);
    }
    const stepBtn = this.container.querySelector<HTMLButtonElement>('#btn-step');
    if (stepBtn) {
      stepBtn.disabled = this.isRunning;
    }
  }

  public resetState(): void {
    this.isRunning = false;
    this.hasStarted = false;
    this.setRunning(false);
  }

  public setSeed(seed: string | number): void {
    this.currentSeed = seed;
    const seedInput = this.container.querySelector<HTMLInputElement>('#input-seed');
    if (seedInput) {
      seedInput.value = String(seed);
    }
  }

  /** Debug readout under the buttons: tick, run state, measured speed. */
  public setStatus(text: string): void {
    const status = this.container.querySelector<HTMLElement>('#sim-status');
    if (status && status.textContent !== text) {
      status.textContent = text;
    }
  }

  public getSpeed(): number {
    return this.currentSpeed;
  }

  private render(): void {
    this.container.innerHTML = `
      <div class="controls-wrapper">
        <div class="playback-controls">
          <button type="button" id="btn-play-pause" class="btn btn-primary" title="Start, Pause, or Resume simulation">
            <span class="icon">▶</span><span>Start</span>
          </button>
          <button type="button" id="btn-step" class="btn btn-secondary" title="Advance exactly one tick">
            <span class="icon">⏭</span><span>Step</span>
          </button>
          <div class="speed-selector" role="group" aria-label="Simulation speed">
            <button type="button" class="btn-speed" data-speed="0.25" aria-label="Quarter speed">¼×</button>
            <button type="button" class="btn-speed" data-speed="0.5" aria-label="Half speed">½×</button>
            <button type="button" class="btn-speed active" data-speed="1">1×</button>
            <button type="button" class="btn-speed" data-speed="2">2×</button>
            <button type="button" class="btn-speed" data-speed="5">5×</button>
            <button type="button" class="btn-speed" data-speed="10">10×</button>
          </div>
        </div>

        <div class="seed-controls">
          <div class="seed-input-group">
            <label for="input-seed" class="sr-only">Seed</label>
            <span class="seed-icon">🎲</span>
            <input type="text" id="input-seed" value="${this.currentSeed}" placeholder="Seed" title="Simulation Seed" />
          </div>
          <button type="button" id="btn-reset" class="btn btn-secondary" title="Reset with current seed">Reset</button>
          <button type="button" id="btn-new-seed" class="btn btn-secondary" title="Generate new random seed">New Seed</button>
        </div>

        <div class="experiment-controls">
          <div class="toggle-field">
            <span class="toggle-label">World</span>
            <div class="speed-selector" role="group" aria-label="World size (restarts)">
              <button type="button" class="btn-speed ${this.toggles.worldSize === 'small' ? 'active' : ''}" data-world="small">30×30</button>
              <button type="button" class="btn-speed ${this.toggles.worldSize === 'large' ? 'active' : ''}" data-world="large">60×60</button>
            </div>
          </div>
          <div class="toggle-field">
            <span class="toggle-label">Food</span>
            <div class="speed-selector" role="group" aria-label="Where food grows (restarts)">
              <button type="button" class="btn-speed ${this.toggles.foodLayout === 'anywhere' ? 'active' : ''}" data-food="anywhere">Anywhere</button>
              <button type="button" class="btn-speed ${this.toggles.foodLayout === 'regions' ? 'active' : ''}" data-food="regions">Regions</button>
              <button type="button" class="btn-speed ${this.toggles.foodLayout === 'shifting' ? 'active' : ''}" data-food="shifting" title="Regions whose lean seasons come at different times">Shifting</button>
            </div>
          </div>
          <div class="toggle-field">
            <span class="toggle-label">Colour</span>
            <div class="speed-selector" role="group" aria-label="Colour organisms by">
              <button type="button" class="btn-speed active" data-color="tag">Tribe tag</button>
              <button type="button" class="btn-speed" data-color="lineage">Family</button>
            </div>
          </div>
          <div class="toggle-field">
            <span class="toggle-label">Sharing</span>
            <div class="speed-selector" role="group" aria-label="Sharing">
              <button type="button" class="btn-speed ${this.toggles.sharingEnabled ? 'active' : ''}" data-sharing="on">On</button>
              <button type="button" class="btn-speed ${this.toggles.sharingEnabled ? '' : 'active'}" data-sharing="off">Off</button>
            </div>
          </div>
          <div class="toggle-field">
            <span class="toggle-label">Controller</span>
            <div class="speed-selector" role="group" aria-label="Controller">
              <button type="button" class="btn-speed ${this.toggles.controller === 'dials' ? 'active' : ''}" data-controller="dials">Dials</button>
              <button type="button" class="btn-speed ${this.toggles.controller === 'brain' ? 'active' : ''}" data-controller="brain">Brain</button>
            </div>
          </div>
          <div class="toggle-field">
            <span class="toggle-label">Seasons</span>
            <div class="speed-selector" role="group" aria-label="Lean seasons">
              <button type="button" class="btn-speed ${this.toggles.seasonsEnabled ? 'active' : ''}" data-seasons="on">On</button>
              <button type="button" class="btn-speed ${this.toggles.seasonsEnabled ? '' : 'active'}" data-seasons="off">Off</button>
            </div>
          </div>
        </div>

        <p id="sim-status" class="sim-status">Tick 0 · Paused</p>
      </div>
    `;

    this.attachEvents();
  }

  private attachEvents(): void {
    const playPauseBtn = this.container.querySelector<HTMLButtonElement>('#btn-play-pause');
    if (playPauseBtn) {
      playPauseBtn.addEventListener('click', () => {
        this.callbacks.onPlayPause();
      });
    }

    const stepBtn = this.container.querySelector<HTMLButtonElement>('#btn-step');
    if (stepBtn) {
      stepBtn.addEventListener('click', () => {
        this.callbacks.onStep();
      });
    }

    const speedButtons = this.container.querySelectorAll<HTMLButtonElement>('.btn-speed[data-speed]');
    speedButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        speedButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const speed = Number(btn.getAttribute('data-speed')) || 1;
        this.currentSpeed = speed;
        this.callbacks.onSpeedChange(speed);
      });
    });

    const colorButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-color]');
    colorButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        colorButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.callbacks.onColorModeChange(btn.dataset.color as ColorMode);
      });
    });

    const sharingButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-sharing]');
    sharingButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        sharingButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.callbacks.onSharingChange(btn.dataset.sharing === 'on');
      });
    });

    const controllerButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-controller]');
    controllerButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        controllerButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.callbacks.onControllerChange(btn.dataset.controller === 'brain' ? 'brain' : 'dials');
      });
    });

    const seasonButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-seasons]');
    seasonButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        seasonButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.callbacks.onSeasonsChange(btn.dataset.seasons === 'on');
      });
    });

    const worldButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-world]');
    worldButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        worldButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.callbacks.onWorldSizeChange(btn.dataset.world as WorldSize);
      });
    });

    const foodButtons = this.container.querySelectorAll<HTMLButtonElement>('[data-food]');
    foodButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        foodButtons.forEach((b) => b.classList.toggle('active', b === btn));
        this.callbacks.onFoodLayoutChange(btn.dataset.food as FoodLayout);
      });
    });

    const resetBtn = this.container.querySelector<HTMLButtonElement>('#btn-reset');
    const seedInput = this.container.querySelector<HTMLInputElement>('#input-seed');
    if (resetBtn && seedInput) {
      resetBtn.addEventListener('click', () => {
        const seedVal = seedInput.value.trim() || '42';
        this.currentSeed = seedVal;
        this.callbacks.onReset(seedVal);
      });
    }

    const newSeedBtn = this.container.querySelector<HTMLButtonElement>('#btn-new-seed');
    if (newSeedBtn) {
      newSeedBtn.addEventListener('click', () => {
        this.callbacks.onNewSeed();
      });
    }

    if (seedInput) {
      seedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const seedVal = seedInput.value.trim() || '42';
          this.currentSeed = seedVal;
          this.callbacks.onReset(seedVal);
        }
      });
    }
  }
}
