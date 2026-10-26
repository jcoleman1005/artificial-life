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
    const kills = metrics.killsTotal ?? 0;
    const strangerShare = kills > 0 ? Math.round((100 * (metrics.killsOfStrangersTotal ?? 0)) / kills) : 0;
    const kinShare = kills > 0 ? Math.round((100 * (metrics.killsOfKinTotal ?? 0)) / kills) : 0;
    const matings = metrics.matingsTotal ?? 0;
    const matingAlikeShare = matings > 0 ? Math.round((100 * (metrics.matingsAlikeTotal ?? 0)) / matings) : 0;

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
          <span class="m-label">Matings</span>
          <span class="m-val">${matings}${matings > 0 ? ` <small>(${Math.round((100 * matings) / Math.max(1, birthsTotal))}% of births; ${matingAlikeShare}% alike pairs)</small>` : ''}</span>
        </div>
        <div class="metric-card">
          <span class="m-label">Diet</span>
          <span class="m-val">${Math.round((metrics.averageCarnivory ?? 0) * 100)}% meat <small>(${metrics.meatEaters ?? 0} mostly meat eaters)</small></span>
        </div>
        ${
          metrics.genomeLength
            ? `<div class="metric-card">
          <span class="m-label">Genome</span>
          <span class="m-val">${metrics.genomeLength.mean} genes <small>(±${metrics.genomeLength.sd}, longest ${metrics.genomeLength.max})</small></span>
        </div>`
            : ''
        }
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
