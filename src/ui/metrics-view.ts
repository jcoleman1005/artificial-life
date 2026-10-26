import type { WorldMetrics } from '../sim/types';
import { setHTMLPreservingDetails } from './dom';

/** Cards for the life-history genes that are switched on: population means, eggs, torpor. */
function lifeCards(metrics: WorldMetrics): string {
  const life = metrics.life;
  if (!life) return '';
  const card = (label: string, value: string) =>
    `<div class="metric-card"><span class="m-label">${label}</span><span class="m-val">${value}</span></div>`;
  const out: string[] = [];
  if (life.reproThreshold !== null || life.investment !== null)
    out.push(
      card(
        'Breeding',
        `${life.reproThreshold !== null ? `at ${life.reproThreshold.toFixed(0)} energy` : ''}${
          life.investment !== null ? ` <small>(${Math.round(life.investment * 100)}% to each child)</small>` : ''
        }`
      )
    );
  if (life.fatCapacity !== null) out.push(card('Fat', `${life.fatCapacity.toFixed(0)} cap <small>(${(life.fat ?? 0).toFixed(1)} held)</small>`));
  if (life.torporDepth !== null)
    out.push(card('Torpor', `${Math.round(life.torporDepth * 100)}% deep <small>(${life.torpid ?? 0} torpid now)</small>`));
  if (life.eggRate !== null)
    out.push(card('Eggs', `${life.eggs ?? 0} waiting <small>(${Math.round(life.eggRate * 100)}% of births; ${life.eggsHatchedTotal} hatched, ${life.eggsDecayedTotal} failed)</small>`));
  if (life.metabolicRate !== null) out.push(card('Metabolism', `${life.metabolicRate.toFixed(2)}×`));
  return out.join('');
}

export class MetricsView {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  public render(metrics: WorldMetrics): void {
    const {
      tick,
      population,
      totalFoodStock,
      activePatchCount,
      birthsTotal,
      deathsTotal,
      maxGeneration,
      averageLifespan,
      activeLineageCount,
      diversity,
    } = metrics;
    const kills = metrics.killsTotal ?? 0;
    const strangerShare = kills > 0 ? Math.round((100 * (metrics.killsOfStrangersTotal ?? 0)) / kills) : 0;
    const kinShare = kills > 0 ? Math.round((100 * (metrics.killsOfKinTotal ?? 0)) / kills) : 0;

    setHTMLPreservingDetails(
      this.container,
      `
      <div class="metrics-bar">
        <div class="metric-card">
          <span class="m-label">Tick</span>
          <span class="m-val">${tick}</span>
        </div>
        <div class="metric-card ${population === 0 ? 'metric-alert' : ''}">
          <span class="m-label">Population</span>
          <span class="m-val">${population}</span>
        </div>
        <div class="metric-card">
          <span class="m-label">Food Stock</span>
          <span class="m-val">${totalFoodStock} <small>(${activePatchCount} patches)</small></span>
        </div>
        <div class="metric-card">
          <span class="m-label">Births / Deaths</span>
          <span class="m-val">${birthsTotal} / ${deathsTotal}</span>
        </div>
        <div class="metric-card">
          <span class="m-label">Max Gen</span>
          <span class="m-val">Gen ${maxGeneration}</span>
        </div>
        <div class="metric-card">
          <span class="m-label">Lineages</span>
          <span class="m-val">${activeLineageCount}</span>
        </div>
        <div class="metric-card">
          <span class="m-label">Kills</span>
          <span class="m-val">${kills}${kills > 0 ? ` <small>(${strangerShare}% different colour, ${kinShare}% alike)</small>` : ''}</span>
        </div>
        <div class="metric-card">
          <span class="m-label">Diet</span>
          <span class="m-val">${Math.round((metrics.averageCarnivory ?? 0) * 100)}% meat <small>(${metrics.meatEaters ?? 0} mostly meat eaters)</small></span>
        </div>
        ${lifeCards(metrics)}
        <div class="metric-card">
          <span class="m-label">Carrion</span>
          <span class="m-val">${metrics.carrionStock ?? 0} energy <small>(${metrics.carrionEatenTotal ?? 0} meals eaten)</small></span>
        </div>
      </div>

      <details class="diversity-collapsible">
        <summary>
          <span><strong>Behavioral Diversity & Survival Metrics</strong></span>
          <span class="diversity-badge">Avg Var: ${diversity.averageDiversity.toFixed(3)}</span>
        </summary>
        <div class="diversity-grid">
          <div class="div-item">
            <span class="div-label">Avg Lifespan</span>
            <span class="div-val">${averageLifespan} ticks</span>
          </div>
          <div class="div-item">
            <span class="div-label">Food Attraction Var</span>
            <span class="div-val">${diversity.foodAttractionVariance.toFixed(3)}</span>
          </div>
          <div class="div-item">
            <span class="div-label">Obstacle Avoidance Var</span>
            <span class="div-val">${diversity.obstacleAvoidanceVariance.toFixed(3)}</span>
          </div>
          <div class="div-item">
            <span class="div-label">Crowd Avoidance Var</span>
            <span class="div-val">${diversity.crowdingAvoidanceVariance.toFixed(3)}</span>
          </div>
          <div class="div-item">
            <span class="div-label">Explore Tendency Var</span>
            <span class="div-val">${diversity.exploreTendencyVariance.toFixed(3)}</span>
          </div>
          <div class="div-item">
            <span class="div-label">Eat Drive Var</span>
            <span class="div-val">${diversity.eatDriveVariance.toFixed(3)}</span>
          </div>
          <div class="div-item">
            <span class="div-label">Reproduce Drive Var</span>
            <span class="div-val">${diversity.reproduceDriveVariance.toFixed(3)}</span>
          </div>
        </div>
      </details>
    `
    );
  }
}
