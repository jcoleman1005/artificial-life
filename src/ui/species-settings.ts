import type { SimulationConfig } from '../sim/types';

/**
 * The Settings section for species detection. These are observer settings:
 * changing any of them cannot change the world, only what is reported.
 */

type SpeciesKey =
  | 'speciesInterval'
  | 'speciesThreshold'
  | 'speciesMinSize'
  | 'speciesPersistTicks'
  | 'speciesExtinctTicks'
  | 'speciesBrainWeight'
  | 'speciesTagWeight';

const ADVANCED: readonly (readonly [SpeciesKey, string, number, number])[] = [
  ['speciesThreshold', 'Distance threshold (0 to 1)', 0.01, 1],
  ['speciesMinSize', 'Minimum members', 1, 1000],
  ['speciesPersistTicks', 'Ticks distinct before a split', 0, 100000],
  ['speciesExtinctTicks', 'Ticks empty before extinct', 0, 100000],
  ['speciesInterval', 'Ticks between runs', 1, 10000],
  ['speciesBrainWeight', 'Brain share of distance (0 to 1)', 0, 1],
  ['speciesTagWeight', 'Hue-tag share of distance (0 to 1)', 0, 1],
];

export class SpeciesSettings {
  private readonly container: HTMLElement;

  constructor(
    parent: HTMLElement,
    config: SimulationConfig,
    private readonly onChange: (patch: Partial<SimulationConfig>) => void
  ) {
    this.container = document.createElement('section');
    this.container.className = 'settings-group';
    parent.appendChild(this.container);
    this.container.innerHTML = `
      <h3>Species <small>watches only; never changes the world</small></h3>
      <div class="setting-row">
        <span class="setting-label">Species detection</span>
        <div class="segmented" role="group" aria-label="Species detection">
          <button type="button" data-species-enabled="on">On</button>
          <button type="button" data-species-enabled="off">Off</button>
        </div>
      </div>
      <details class="settings-advanced">
        <summary>Advanced</summary>
        ${ADVANCED.map(
          ([key, label, min, max]) => `
        <div class="setting-row">
          <label class="setting-label" for="input-${key}">${label}</label>
          <input type="number" id="input-${key}" data-species-key="${key}" min="${min}" max="${max}" step="any" inputmode="decimal" />
        </div>`
        ).join('')}
      </details>`;
    this.container.querySelectorAll<HTMLButtonElement>('[data-species-enabled]').forEach((btn) =>
      btn.addEventListener('click', () => this.onChange({ speciesEnabled: btn.dataset.speciesEnabled === 'on' }))
    );
    this.container.querySelectorAll<HTMLInputElement>('[data-species-key]').forEach((input) =>
      input.addEventListener('change', () => {
        const key = input.dataset.speciesKey as SpeciesKey;
        const value = Number(input.value);
        const spec = ADVANCED.find(([k]) => k === key)!;
        if (!Number.isFinite(value)) return;
        this.onChange({ [key]: Math.min(spec[3], Math.max(spec[2], value)) } as Partial<SimulationConfig>);
      })
    );
    this.sync(config);
  }

  /** Shows the config's values (after a reset, a load or another viewer's change). */
  public sync(config: SimulationConfig): void {
    const on = config.speciesEnabled ?? true;
    this.container.querySelectorAll<HTMLButtonElement>('[data-species-enabled]').forEach((btn) => {
      const active = (btn.dataset.speciesEnabled === 'on') === on;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    this.container.querySelectorAll<HTMLInputElement>('[data-species-key]').forEach((input) => {
      if (document.activeElement === input) return;
      const value = config[input.dataset.speciesKey as SpeciesKey];
      if (value !== undefined) input.value = String(value);
    });
  }
}
