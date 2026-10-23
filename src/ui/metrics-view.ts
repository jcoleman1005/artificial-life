import type { WorldMetrics } from '../sim/types';
import { setHTMLPreservingDetails } from './dom';

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
