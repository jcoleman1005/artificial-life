import type { Organism, PolicyWeights, SimulationConfig } from '../sim/types';
import { setHTMLPreservingDetails } from './dom';

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

  public render(organism: Organism | undefined, config: SimulationConfig): void {
    if (!organism) {
      this.container.innerHTML = `
        <div class="inspector-empty">
          <div class="empty-icon">🔬</div>
          <h3>Organism Inspector</h3>
          <p>Tap any organism on the grid to observe its senses, inherited policy weights, scored choices, and decision history.</p>
        </div>
      `;
      return;
    }

    const { energy, policy, lineage, age, offspringCount, foodEatenCount, recentHistory } =
      organism;
    const maxEnergy = config.maxEnergy;
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
            <div class="header-pre">
              <span class="tag-swatch" style="background: hsl(${organism.tag}, 85%, 60%)" aria-hidden="true"></span>
              ${organism.id} · ${lineage.id} · tag ${Math.round(organism.tag)}°${
                lineage.parentId === null && lineage.birthTick > 0 ? ` · immigrant (tick ${lineage.birthTick})` : ''
              }
            </div>
            <h2>Organism Details</h2>
          </div>
          <button type="button" class="btn-close-inspector" aria-label="Close inspector">✕</button>
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
            <span class="pill-title">Can Leap</span>
            <span class="pill-value">${organism.canLeap === 1 ? 'Yes' : 'No'}</span>
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

        <details open class="inspector-section">
          <summary><strong>Inherited Policy Weights</strong>${
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
}
