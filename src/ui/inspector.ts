import type { FoodPatch, Organism, PolicyWeights, SimulationConfig } from '../sim/types';
import type { AncestorNode } from '../sim/lineage';
import type { EggView } from '../sim/protocol';
import { PLANT_TRAITS, PLANT_TRAIT_KEYS, plantHue } from '../sim/plants';
import { setHTMLPreservingDetails } from './dom';
import { familyName, givenName, organismName } from './names';
import { carrionYield, plantYield } from '../sim/traits';
import { birthCooldownOf, clutchSizeOf } from '../sim/lifehistory';
import { describeDoing } from './organism-card';
import { renderLineageMap } from './lineage-view';

/** Pills for the life-history genes that are switched on in this world (and torpor / fat state). */
export function lifeHistoryPills(o: Readonly<Organism>, c: Readonly<SimulationConfig>): string {
  const pill = (title: string, value: string) =>
    `<div class="summary-pill"><span class="pill-title">${title}</span><span class="pill-value">${value}</span></div>`;
  const out: string[] = [];
  if (o.reproThreshold !== undefined) out.push(pill('Reproduces at', `${o.reproThreshold.toFixed(0)} energy`));
  if (o.investment !== undefined) out.push(pill('Gives each child', `${Math.round(o.investment * 100)}% of its energy`));
  if (o.fatCapacity !== undefined) out.push(pill('Fat', `${(o.fat ?? 0).toFixed(0)} / ${o.fatCapacity.toFixed(0)}`));
  if (o.torporDepth !== undefined)
    out.push(pill('Torpor', `depth ${Math.round(o.torporDepth * 100)}%${o.rested ? ' · rested last tick' : ''}`));
  const eggVal = o.eggAllocation ?? o.eggRate;
  if (eggVal !== undefined) {
    out.push(pill('Reproduction', eggVal > 0 ? `Lays eggs (${Math.round(eggVal * 100)}% shell)` : 'Direct birth'));
  }
  if (o.metabolicRate !== undefined)
    out.push(pill('Metabolism', `${o.metabolicRate.toFixed(2)}× · ${birthCooldownOf(o, c)} ticks between births`));
  if (o.clutchSize !== undefined) {
    const n = clutchSizeOf(o, c);
    out.push(pill('Clutch', `${n.toFixed(2)} children per mating`));
  }
  if (o.size !== undefined) {
    out.push(pill('Size', `${o.size.toFixed(2)}× (Emax ${(c.maxEnergy * o.size).toFixed(0)})`));
  }
  if (o.sensingRadius !== undefined) {
    out.push(pill('Vision', `${o.sensingRadius.toFixed(1)} cells`));
  }
  if (o.digestiveEfficiency !== undefined) {
    out.push(pill('Digestion', `${Math.round(o.digestiveEfficiency * 100)}%`));
  }
  return out.join('');
}

/** A diet in words, from carnivory (0 plants … 1 meat). */
export function dietLabel(carnivory: number): string {
  return carnivory < 0.25 ? 'Plant eater' : carnivory < 0.5 ? 'Mostly plants' : carnivory < 0.75 ? 'Mostly meat' : 'Meat eater';
}

/** The organism's movement abilities, e.g. "Diagonal, Leap", or "None". */
function abilityList(organism: Readonly<Organism>): string {
  const { diagonal, squeeze, leap } = organism.abilities;
  const names = [diagonal && 'Diagonal', squeeze && 'Squeeze', leap && 'Leap'].filter(Boolean);
  return names.length ? names.join(', ') : 'None';
}

const WEIGHT_ROWS: [keyof PolicyWeights, string][] = [
  ['foodAttraction', 'Food Attraction'],
  ['obstacleAvoidance', 'Obstacle Avoidance'],
  ['crowdingAvoidance', 'Crowd Avoidance'],
  ['exploreTendency', 'Explore Tendency'],
  ['eatDrive', 'Eat Drive'],
  ['reproduceDrive', 'Reproduce Drive'],
  ['kinAffinity', 'Kin Affinity'],
  ['shareWithKin', 'Share With Kin'],
  ['shareWithStrangers', 'Share With Strangers'],
  ['careForChildren', 'Care For Children'],
  ['forageDrive', 'Forage Drive'],
  ['eatPriority', 'Eat Priority'],
  ['hungerUrgency', 'Hunger Urgency'],
  ['followFoodParent', 'Follow Food Parent'],
  ['signalOnFood', 'Signal On Food'],
  ['signalWhenHungry', 'Signal When Hungry'],
  ['followSignal', 'Follow Signals'],
  ['restDrive', 'Rest Drive'],
  ['avoidOccupied', 'Avoid Occupied Cells'],
  ['leapEagerness', 'Leap Eagerness'],
];

export class InspectorView {
  private readonly container: HTMLElement;
  private onDeselectCallback?: () => void;

  constructor(container: HTMLElement, onDeselect?: () => void) {
    this.container = container;
    this.onDeselectCallback = onDeselect;
    // One delegated listener on the persistent container: the close button
    // itself is recreated on every render, which can swallow taps mid-press.
    this.container.addEventListener('click', (e) => {
      if ((e.target as Element).closest('.btn-close-inspector')) {
        this.onDeselectCallback?.();
      }
    });
  }

  public render(
    organism: Organism | undefined,
    config: SimulationConfig,
    nameOf: (id: string) => string | null = () => null,
    ancestry: readonly AncestorNode[] = []
  ): void {
    if (!organism) {
      this.container.innerHTML = `
        <div class="inspector-empty">
          <h3>No organism selected</h3>
          <p>Tap an organism in the world to follow it (or tap a plant to see its genome). Its senses, inherited weights, scored choices and recent decisions show up here.</p>
        </div>
      `;
      return;
    }

    const { energy, policy, lineage, age, offspringCount, foodEatenCount, recentHistory } =
      organism;
    const maxEnergy = config.maxEnergy;
    const name = organismName(organism);
    const energyPct = Math.min(100, Math.max(0, (energy / maxEnergy) * 100));
    const lastDecision = recentHistory[0];

    const weightBar = (val: number) => {
      // Scale from [-2, 2] to percentage [0, 100]
      const pct = Math.max(0, Math.min(100, ((val + 2) / 4) * 100));
      const color = val >= 0 ? '#4ade80' : '#f87171';
      return `
        <div class="weight-track">
          <div class="weight-center"></div>
          <div class="weight-fill" style="left: ${Math.min(50, pct)}%; width: ${Math.abs(pct - 50)}%; background-color: ${color};"></div>
        </div>
      `;
    };

    const weightRows = WEIGHT_ROWS.map(
      ([key, label]) => `
            <div class="weight-row">
              <span class="weight-name">${label}</span>
              <span class="weight-num">${policy[key].toFixed(2)}</span>
              ${weightBar(policy[key])}
            </div>`
    ).join('');

    let sensesHtml = '<p class="muted">No decision recorded yet.</p>';
    let actionScoresHtml = '';
    let outcomeBadge = '';

    if (lastDecision) {
      const { sensed, scores, chosenAction, outcome, energyDelta, tick } = lastDecision;

      const outcomeClass =
        outcome === 'success'
          ? 'badge-success'
          : outcome === 'conflict_lost'
          ? 'badge-warning'
          : 'badge-danger';

      outcomeBadge = `<span class="badge ${outcomeClass}">Tick ${tick} · ${outcome.replace(/_/g, ' ')} (${energyDelta >= 0 ? '+' : ''}${energyDelta.toFixed(1)} E)</span>`;

      // Sensed inputs
      const foodSenseStr = sensed.nearestFood
        ? `dx:${sensed.nearestFood.dx}, dy:${sensed.nearestFood.dy} (dist: ${sensed.nearestFood.distance}, stock: ${sensed.nearestFood.value})`
        : 'None in radius';
      const parentSenseStr = sensed.parentWithFood
        ? `dx:${sensed.parentWithFood.dx}, dy:${sensed.parentWithFood.dy} (dist: ${sensed.parentWithFood.distance}, carrying: ${sensed.parentWithFood.value})`
        : 'None';

      const signalSenseStr = sensed.nearestSignal
        ? `dx:${sensed.nearestSignal.dx}, dy:${sensed.nearestSignal.dy} (dist: ${sensed.nearestSignal.distance}, ${Math.round((sensed.nearestSignal.value ?? 0) * 100)}% alike)`
        : 'None';

      const place = (r: { dx: number; dy: number; distance: number; freshness: number } | null) =>
        r ? `dx:${r.dx}, dy:${r.dy} (dist: ${r.distance}, ${Math.round(r.freshness * 100)}% fresh)` : 'Nothing';
      const memoryStr = !config.memoryEnabled
        ? 'Memory is off'
        : organism.memorySpan === 0
          ? 'No memory (span 0)'
          : `Food ${place(sensed.rememberedFood)} · Signal ${place(sensed.rememberedSignal)} · Home ${
              sensed.home ? `dx:${sensed.home.dx}, dy:${sensed.home.dy}` : 'here'
            } · Registers ${sensed.registers.map((r) => r.toFixed(2)).join(' / ')}`;

      const obsSenseStr = sensed.nearestObstacle
        ? `dx:${sensed.nearestObstacle.dx}, dy:${sensed.nearestObstacle.dy} (dist: ${sensed.nearestObstacle.distance})`
        : 'None in radius';

      const orgSenseStr = sensed.nearestOrganism
        ? `dx:${sensed.nearestOrganism.dx}, dy:${sensed.nearestOrganism.dy} (dist: ${sensed.nearestOrganism.distance})`
        : 'None';

      sensesHtml = `
        <div class="senses-grid">
          <div class="sense-item">
            <span class="sense-label">Nearest Food</span>
            <span class="sense-val ${sensed.nearestFood ? 'highlight-food' : ''}">${foodSenseStr}</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Nearest Obstacle</span>
            <span class="sense-val">${obsSenseStr}</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Crowd (Radius ${config.sensingRadius})</span>
            <span class="sense-val">${sensed.surroundingOrganismCount} peers (${orgSenseStr})</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Similar ≥${Math.round(config.kinSimilarity * 100)}% / Different ≤${Math.round(config.strangerSimilarity * 100)}%</span>
            <span class="sense-val">${sensed.nearbyKinCount} / ${sensed.nearbyStrangerCount}</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Parent With Food</span>
            <span class="sense-val">${parentSenseStr}</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Nearest Signal (Radius ${config.signalRadius})</span>
            <span class="sense-val">${signalSenseStr}</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Memory (span ${organism.memorySpan} ticks)</span>
            <span class="sense-val">${memoryStr}</span>
          </div>
          <div class="sense-item">
            <span class="sense-label">Current Cell Food</span>
            <span class="sense-val">${sensed.currentCellFood > 0 ? `${sensed.currentCellFood} available` : '0'}</span>
          </div>
        </div>
      `;

      // Action scores list
      actionScoresHtml = scores
        .map((s) => {
          const isChosen = s.action.type === chosenAction.type;
          const compDetails = Object.entries(s.components)
            .map(([k, v]) => `${k}: ${v >= 0 ? '+' : ''}${Number(v.toFixed(3))}`)
            .join(', ');

          return `
            <div class="action-score-row ${isChosen ? 'chosen-action' : ''}">
              <div class="action-title">
                <span class="action-badge">${s.action.type.replace(/_/g, ' ')}</span>
                <span class="action-score-val">Score: <strong>${s.totalScore.toFixed(3)}</strong></span>
                ${isChosen ? '<span class="tag-chosen">CHOSEN</span>' : ''}
              </div>
              <div class="action-breakdown">${compDetails || 'base'}</div>
            </div>
          `;
        })
        .join('');
    }

    // Recent History Table
    const historyRows = recentHistory
      .slice(0, 5)
      .map(
        (h) => `
        <tr>
          <td>#${h.tick}</td>
          <td>${h.chosenAction.type.replace(/_/g, ' ')}</td>
          <td><span class="badge ${h.outcome === 'success' ? 'badge-success' : 'badge-warning'}">${h.outcome}</span></td>
          <td class="${h.energyDelta >= 0 ? 'text-green' : 'text-amber'}">${h.energyDelta >= 0 ? '+' : ''}${h.energyDelta}</td>
          <td>${h.energyAfter}</td>
        </tr>
      `
      )
      .join('');

    setHTMLPreservingDetails(
      this.container,
      `
      <div class="inspector-card">
        <header class="inspector-header">
          <div>
            <h2><span class="tag-swatch" style="background: hsl(${organism.tag}, 85%, 60%)" aria-hidden="true"></span>${name.full}</h2>
            <div class="header-pre">
              ${energy > 0 ? describeDoing(organism, nameOf) : 'Died'} · ${organism.id} · ${lineage.id} · tag ${Math.round(organism.tag)}°${
                lineage.parentId === null && lineage.birthTick > 0 ? ` · spontaneously generated (tick ${lineage.birthTick})` : ''
              }${lineage.parentId ? ` · child of ${givenName(lineage.parentId)}${lineage.mateId ? ` and ${givenName(lineage.mateId)}` : ''}` : ''}
            </div>
          </div>
          <button type="button" class="btn-close-inspector" aria-label="Deselect">✕</button>
        </header>

        <div class="stat-summary-row">
          <div class="summary-pill">
            <span class="pill-title">Generation</span>
            <span class="pill-value">Gen ${lineage.generation}</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Age</span>
            <span class="pill-value">${age} ticks</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Offspring</span>
            <span class="pill-value">${offspringCount}</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Food Eaten</span>
            <span class="pill-value">${foodEatenCount}</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Carrying</span>
            <span class="pill-value">${organism.carriedFood} / ${organism.carryCapacity}</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Births up to</span>
            <span class="pill-value">${organism.dispersal} ${organism.dispersal === 1 ? 'step' : 'steps'} away</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Abilities</span>
            <span class="pill-value">${abilityList(organism)}</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Diet</span>
            <span class="pill-value">${dietLabel(organism.carnivory)} · ${Math.round(organism.carnivory * 100)}% meat</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Energy per plant / carrion meal</span>
            <span class="pill-value">${plantYield(organism, config).toFixed(0)} / ${carrionYield(organism, config).toFixed(0)}</span>
          </div>
          ${lifeHistoryPills(organism, config)}
          <div class="summary-pill">
            <span class="pill-title">Kills</span>
            <span class="pill-value">${organism.kills ?? 0}</span>
          </div>
          <div class="summary-pill">
            <span class="pill-title">Given / Got</span>
            <span class="pill-value">${organism.foodGiven} / ${organism.foodReceived}</span>
          </div>
        </div>

        <div class="energy-section">
          <div class="energy-labels">
            <span>Energy Reserve</span>
            <span><strong>${energy.toFixed(1)}</strong> / ${maxEnergy}</span>
          </div>
          <div class="energy-track">
            <div class="energy-bar" style="width: ${energyPct}%; background-color: ${energy > 30 ? '#4ade80' : '#f87171'};"></div>
          </div>
        </div>

        <details open class="inspector-section lineage-section" data-key="lineage-map">
          <summary><strong>Genome Lineage Map</strong> <span class="muted">(ancestry & gene flow)</span></summary>
          ${renderLineageMap(organism, ancestry, nameOf)}
        </details>

        <details ${config.controller === 'brain' ? '' : 'open'} class="inspector-section" data-key="dials-${config.controller}">
          <summary><strong>Inherited Dial Weights</strong>${
            config.controller === 'brain' ? ' <span class="muted">(inactive: Brain controller)</span>' : ''
          }</summary>
          <div class="weights-list">
            ${weightRows}
          </div>
        </details>

        <details open class="inspector-section">
          <summary><strong>Local Senses & Decision Evaluation</strong></summary>
          <div class="decision-meta">
            ${outcomeBadge}
          </div>
          ${sensesHtml}
          <div class="action-scores-container">
            <div class="subheading">Action Scoring Breakdown</div>
            ${actionScoresHtml}
          </div>
        </details>

        <details class="inspector-section">
          <summary><strong>Recent Decision Log</strong></summary>
          <div class="table-wrapper">
            <table class="history-table">
              <thead>
                <tr>
                  <th>Tick</th>
                  <th>Action</th>
                  <th>Outcome</th>
                  <th>ΔE</th>
                  <th>Energy</th>
                </tr>
              </thead>
              <tbody>
                ${historyRows || '<tr><td colspan="5">No history yet</td></tr>'}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    `
    );
  }

  /** A plant: its genome against each trait's range, its mass, and its line. `tick` is the world's tick (for age). */
  public renderPlant(patch: FoodPatch, tick: number, alive: boolean): void {
    const plant = patch.plant;
    if (!plant) return;
    const g = plant.genome;
    const traitLabels: Record<string, string> = {
      growthRate: 'Growth rate',
      maxBiomass: 'Maximum size',
      seedSize: 'Seed size',
      seedThreshold: 'Seeds from (of max size)',
      dispersal: 'Seed dispersal (cells)',
      rootShare: 'Root share',
      leanDormancy: 'Lean dormancy',
    };
    const rows = PLANT_TRAIT_KEYS.map((key) => {
      const r = PLANT_TRAITS[key];
      const pct = ((g[key] - r.min) / (r.max - r.min)) * 100;
      return `
            <div class="weight-row">
              <span class="weight-name">${traitLabels[key]}</span>
              <span class="weight-num">${g[key].toFixed(2)}</span>
              <div class="weight-track">
                <div class="weight-fill" style="left: 0; width: ${pct.toFixed(1)}%; background-color: #4ade80;"></div>
              </div>
            </div>`;
    }).join('');
    const status = !alive ? 'Died' : plant.dormant ? 'Dormant (lean season)' : plant.biomass < 1 ? 'Seedling' : 'Growing';
    setHTMLPreservingDetails(
      this.container,
      `
      <div class="inspector-card">
        <header class="inspector-header">
          <div>
            <h2><span class="tag-swatch" style="background: hsl(${plantHue(g)}, 55%, 45%)" aria-hidden="true"></span>Plant ${plant.id.replace('plant-', '#')}</h2>
            <div class="header-pre">
              ${status} · at ${patch.x},${patch.y} · ${plant.lineageId}${plant.parentId ? ` · seed of ${plant.parentId}` : ' · founder or seed rain'}
            </div>
          </div>
          <button type="button" class="btn-close-inspector" aria-label="Deselect">✕</button>
        </header>
        <div class="stat-summary-row">
          <div class="summary-pill"><span class="pill-title">Generation</span><span class="pill-value">Gen ${plant.generation}</span></div>
          <div class="summary-pill"><span class="pill-title">Age</span><span class="pill-value">${tick - plant.birthTick} ticks</span></div>
          <div class="summary-pill"><span class="pill-title">Edible</span><span class="pill-value">${plant.biomass.toFixed(2)} (${patch.stock} ${patch.stock === 1 ? 'unit' : 'units'})</span></div>
          <div class="summary-pill"><span class="pill-title">Roots</span><span class="pill-value">${plant.roots.toFixed(2)}</span></div>
          <div class="summary-pill"><span class="pill-title">Seeds released</span><span class="pill-value">${plant.seedsReleased}</span></div>
          <div class="summary-pill"><span class="pill-title">Last grazed</span><span class="pill-value">${plant.lastGrazedTick < 0 ? 'Never' : `tick ${plant.lastGrazedTick}`}</span></div>
        </div>
        <details open class="inspector-section">
          <summary><strong>Genome</strong> <span class="muted">(bar = place in the trait's range)</span></summary>
          <div class="weights-list">
            ${rows}
          </div>
        </details>
      </div>
    `
    );
  }

  /** An egg: its incubation progress, shell integrity, and the child waiting to hatch. */
  public renderEgg(
    egg: EggView,
    detail: Organism | null,
    config: SimulationConfig,
    nameOf: (id: string) => string | null = () => null,
    ancestry: readonly AncestorNode[] = [],
    alive = true,
    tick = 0
  ): void {
    const given = givenName(egg.id);
    const family = familyName(detail?.lineage?.id ?? egg.parentId ?? egg.id);
    const parentName = egg.parentId ? (nameOf(egg.parentId) ?? givenName(egg.parentId)) : null;
    const status = !alive ? 'Decayed' : 'Incubating';

    // Weights if child is available
    const weightBar = (val: number) => {
      const pct = Math.max(0, Math.min(100, ((val + 2) / 4) * 100));
      const color = val >= 0 ? '#4ade80' : '#f87171';
      return `
        <div class="weight-track">
          <div class="weight-center"></div>
          <div class="weight-fill" style="left: ${Math.min(50, pct)}%; width: ${Math.abs(pct - 50)}%; background-color: ${color};"></div>
        </div>
      `;
    };

    const weightRows = detail
      ? WEIGHT_ROWS.map(
          ([key, label]) => `
            <div class="weight-row">
              <span class="weight-name">${label}</span>
              <span class="weight-num">${detail.policy[key].toFixed(2)}</span>
              ${weightBar(detail.policy[key])}
            </div>`
        ).join('')
      : '';

    const lineageHtml = detail && ancestry.length > 0 ? renderLineageMap(detail, ancestry, nameOf) : '';

    setHTMLPreservingDetails(
      this.container,
      `
      <div class="inspector-card">
        <header class="inspector-header">
          <div>
            <h2>
              <span class="tag-swatch egg-swatch" style="background: hsl(${egg.tag}, 65%, 50%)" aria-hidden="true">🥚</span>
              Egg · ${given} <small>${egg.id}</small>
            </h2>
            <div class="header-pre">
              ${status} · at ${egg.x},${egg.y} · ${family} · Gen ${egg.generation}${parentName ? ` · laid by ${parentName}` : ''}
            </div>
          </div>
          <button type="button" class="btn-close-inspector" aria-label="Deselect">✕</button>
        </header>

        <div class="stat-summary-row">
          <div class="summary-pill"><span class="pill-title">Status</span><span class="pill-value">${status} 🥚</span></div>
          <div class="summary-pill"><span class="pill-title">Incubation</span><span class="pill-value">${Math.max(0, tick - egg.laidTick)} ticks</span></div>
          <div class="summary-pill"><span class="pill-title">Egg Energy</span><span class="pill-value">${Math.round(egg.energy)} / ${config.maxEnergy}</span></div>
          <div class="summary-pill"><span class="pill-title">Shell Buffer</span><span class="pill-value">${egg.shell} buffer</span></div>
          <div class="summary-pill"><span class="pill-title">Hatch Proximity</span><span class="pill-value">≤ ${config.eggHatchRadius} cells</span></div>
          <div class="summary-pill"><span class="pill-title">Hatch Yield</span><span class="pill-value">~${Math.floor(egg.energy * config.eggHatchEfficiency)} E</span></div>
          <div class="summary-pill"><span class="pill-title">Generation</span><span class="pill-value">Gen ${egg.generation}</span></div>
          <div class="summary-pill"><span class="pill-title">Body Size</span><span class="pill-value">${(detail?.size ?? egg.size ?? 1).toFixed(2)}×</span></div>
          <div class="summary-pill"><span class="pill-title">Diet</span><span class="pill-value">${detail ? dietLabel(detail.carnivory) : 'Herbivore'}</span></div>
          <div class="summary-pill"><span class="pill-title">Abilities</span><span class="pill-value">${detail ? abilityList(detail) : 'None'}</span></div>
        </div>

        <details open class="inspector-section" data-key="egg-mechanics">
          <summary><strong>Incubation & Hatch Conditions</strong></summary>
          <div class="decision-meta">
            <p style="margin: 0 0 6px; font-size: var(--text-xs); line-height: 1.4; color: var(--text-main);">
              This egg is waiting inert in cell <strong>(${egg.x}, ${egg.y})</strong> until conditions favor hatching.
            </p>
            <ul style="margin: 0; padding-left: 18px; font-size: var(--text-2xs); color: var(--text-muted); line-height: 1.55;">
              <li><strong>Food Proximity:</strong> Hatches when food is within <strong>${config.eggHatchRadius} cells</strong> and cell (${egg.x}, ${egg.y}) is unoccupied.</li>
              <li><strong>Protective Shell Buffer:</strong> Currently <strong>${egg.shell}</strong> remaining. When a decay tick strikes (${(config.eggDecayChance * 100).toFixed(1)}%/tick), the shell absorbs damage before the egg can rot.</li>
              <li><strong>Hatching Energy:</strong> The hatchling emerges with <strong>${Math.round(config.eggHatchEfficiency * 100)}%</strong> of the egg's energy payload (~${Math.floor(egg.energy * config.eggHatchEfficiency)} E).</li>
            </ul>
          </div>
        </details>

        ${
          weightRows
            ? `
        <details class="inspector-section" data-key="egg-weights">
          <summary><strong>Inherited Policy Weights</strong> <span class="muted">(controller tendencies upon emergence)</span></summary>
          <div class="weights-list">
            ${weightRows}
          </div>
        </details>`
            : ''
        }

        ${
          lineageHtml
            ? `
        <details open class="inspector-section lineage-section" data-key="egg-lineage">
          <summary><strong>Genome Lineage Map</strong> <span class="muted">(ancestry & crossover attribution)</span></summary>
          ${lineageHtml}
        </details>`
            : ''
        }
      </div>
    `
    );
  }
}
