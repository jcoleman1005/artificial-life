export interface ControlCallbacks {
  onPlayPause: () => void;
  onStep: () => void;
  onSpeedChange: (speedMultiplier: number) => void;
  onReset: (seed: string | number) => void;
  onNewSeed: () => void;
}

export class ControlsView {
  private readonly container: HTMLElement;
  private isRunning = false;
  private hasStarted = false;
  private currentSpeed = 1;
  private currentSeed: string | number = 42;
  private callbacks: ControlCallbacks;

  constructor(container: HTMLElement, initialSeed: string | number, callbacks: ControlCallbacks) {
    this.container = container;
    this.currentSeed = initialSeed;
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

    const speedButtons = this.container.querySelectorAll<HTMLButtonElement>('.btn-speed');
    speedButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        speedButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const speed = Number(btn.getAttribute('data-speed')) || 1;
        this.currentSpeed = speed;
        this.callbacks.onSpeedChange(speed);
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
