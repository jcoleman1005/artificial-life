import type { FoodPatch, Organism, PolicyWeights, SimulationConfig } from '../sim/types';
import type { AncestorNode } from '../sim/lineage';
import type { EggView } from '../sim/protocol';
import { PLANT_TRAITS, PLANT_TRAIT_KEYS, plantHue } from '../sim/plants';
import { setHTMLPreservingDetails } from './dom';
import { familyName, givenName, organismName } from './names';
import { carrionYield, plantYield } from '../sim/traits';
import { LIFE_GENES, birthCooldownOf, clutchSizeOf } from '../sim/lifehistory';
import { GENE_WORDS, GeneClass, TraitId, genomeStats, geneClassOf, geneCount, geneIndexOf, isExpressed } from '../sim/dna';
import { describeDoing } from './organism-card';
import { renderLineageMap } from './lineage-view';
import { lifeStageOf, maturityOf } from '../sim/growth';

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
  if (o.carnivoreEfficiency !== undefined) {
    out.push(pill('Meat digestion', `${Math.round(o.carnivoreEfficiency * 100)}%`));
  }
  if (c.detoxGeneEnabled && o.detox !== undefined) {
    out.push(pill('Detox', `${Math.round(o.detox * 100)}%`));
  }
  if (c.growthEnabled || c.ageingEnabled) {
    const stage = lifeStageOf(o, c);
    const grown = c.growthEnabled ? ` · ${Math.round(maturityOf(o, c) * 100)}% grown` : '';
    out.push(pill('Life stage', `${stage[0].toUpperCase()}${stage.slice(1)}${grown}`));
    out.push(pill('Age', c.ageingEnabled ? `${o.age} of ${c.maxAge} ticks` : `${o.age} ticks`));
  }
  if (o.growthDuration !== undefined) out.push(pill('Growth', `${o.growthDuration.toFixed(0)} fed ticks to adult`));
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

/** One decoded trait against its range, with how many genes code for it. */
export interface GenomeTraitRow {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  /** Genes in the genome for this trait; null when the organism carries no genome. */
  readonly copies: number | null;
  /** The gene exists but this world does not read it (its switch is off). */
  readonly silent: boolean;
  readonly decimals: number;
}

/**
 * Every decoded trait of an organism as a place in its range, with gene dosage (copies of the trait's gene).
 * Read-only. Life-history rows appear when the gene is switched on or the genome still carries it (then silent).
 */
export function genomeTraitRows(o: Readonly<Organism>, c: Readonly<SimulationConfig>): GenomeTraitRow[] {
  const copies = new Map<number, number>();
  if (o.genome) {
    for (let g = 0, n = geneCount(o.genome); g < n; g++) {
      const key = o.genome[g * GENE_WORDS];
      if (geneClassOf(key) === GeneClass.trait) copies.set(geneIndexOf(key), (copies.get(geneIndexOf(key)) ?? 0) + 1);
    }
  }
  const rows: GenomeTraitRow[] = [];
  const add = (label: string, traitId: number, value: number | undefined, min: number, max: number, decimals: number) => {
    const n = o.genome ? (copies.get(traitId) ?? 0) : null;
    if (value === undefined) {
      // Not decoded in this world: show it only when the genome carries the gene (it is silent DNA).
      if (n) rows.push({ label, value: 0, min, max, copies: n, silent: true, decimals });
      return;
    }
    const silent = o.genome ? n! > 0 && !isExpressed(((GeneClass.trait << 16) | traitId) >>> 0, c) : false;
    rows.push({ label, value, min, max, copies: n, silent, decimals });
  };
  add('Tag (hue)', TraitId.tag, o.tag, 0, 360, 0);
  add('Carry capacity', TraitId.carryCapacity, o.carryCapacity, 0, c.maxCarryCapacity, 0);
  add('Dispersal', TraitId.dispersal, o.dispersal, 1, c.maxDispersal, 0);
  add('Memory span', TraitId.memorySpan, o.memorySpan, 0, c.maxMemorySpan, 0);
  add('Meat eating', TraitId.carnivory, o.carnivory, 0, 1, 2);
  add('Plant eating', TraitId.herbivory, o.herbivory, 0, 1, 2);
  add('Diagonal', TraitId.diagonal, o.abilities.diagonal, 0, 1, 2);
  add('Squeeze', TraitId.squeeze, o.abilities.squeeze, 0, 1, 2);
  add('Leap', TraitId.leap, o.abilities.leap, 0, 1, 2);
  const lifeLabels: Record<string, string> = {
    reproThreshold: 'Breeding threshold',
    investment: 'Investment per child',
    fatCapacity: 'Fat capacity',
    torporDepth: 'Rest efficiency',
    eggRate: 'Egg share',
    metabolicRate: 'Metabolic rate',
    clutchSize: 'Clutch size',
    size: 'Size',
    sensingRadius: 'Vision',
    digestiveEfficiency: 'Digestion',
    carnivoreEfficiency: 'Meat digestion',
    detox: 'Detoxification',
    growthDuration: 'Growth duration',
  };
  for (const g of LIFE_GENES) {
    add(lifeLabels[g.field] ?? g.field, g.traitId, o[g.field], g.min(c), g.max(c), g.field === 'reproThreshold' || g.field === 'fatCapacity' ? 0 : 2);
  }
  return rows;
}

/** The compact dosage bars for an organism's traits: bar = place in the trait's range, badge = gene dosage. */
export function genomeBarsHtml(o: Readonly<Organism>, c: Readonly<SimulationConfig>): string {
  const rows = genomeTraitRows(o, c)
    .map((r) => {
      const pct = r.max > r.min ? Math.max(0, Math.min(100, ((r.value - r.min) / (r.max - r.min)) * 100)) : 0;
      const badge =
        r.silent
          ? '<span class="dose-badge dose-silent">silent</span>'
          : r.copies !== null && r.copies > 1
            ? `<span class="dose-badge dose-dup">×${r.copies} dosage</span>`
            : r.copies === 0
              ? '<span class="dose-badge">no gene · default</span>'
              : '';
      const range = `${Number(r.min.toFixed(2))}–${Number(r.max.toFixed(2))}`;
      return `
            <div class="weight-row genome-row${r.silent ? ' genome-silent' : ''}" title="range ${range}">
              <span class="weight-name">${r.label}${badge}</span>
              <span class="weight-num">${r.silent ? '–' : r.value.toFixed(r.decimals)}</span>
              <div class="weight-track">
                <div class="weight-fill${r.copies !== null && r.copies > 1 ? ' dup' : ''}" style="left: 0; width: ${r.silent ? 0 : pct.toFixed(1)}%;"></div>
              </div>
            </div>`;
    })
    .join('');
  let summary = '<span class="muted">No genome (DNA is off): traits are inherited directly.</span>';
  if (o.genome) {
    const g = genomeStats([o.genome], c);
    const t = g.meanByType;
    summary = `<span class="muted">${g.minLength} genes · ${t.body + t.register} body &amp; register · ${t.brainSkip + t.brainHidden} brain connections · ${t.silent} silent${
      g.multiCopySlots > 0 ? ` · ${g.multiCopySlots} duplicated slots` : ''
    }</span>`;
  }
  return `
        <details open class="inspector-section" data-key="genome-bars">
          <summary><strong>Genome &amp; Traits</strong> <span class="muted">(bar = place in the trait's range)</span></summary>
          <div class="genome-summary">${summary}</div>
          <div class="weights-list">${rows}
          </div>
        </details>`;
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
  /** The persistent Brain section (src/ui/brain-view.ts), re-attached after each render. */
  private brainElement?: HTMLElement;

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

  public setBrainElement(element: HTMLElement): void {
    this.brainElement = element;
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

      const kinPullHtml = sensed.kinPull
        ? `
          <div class="sense-item" title="Kin attraction / stranger repulsion vector">
            <span class="sense-label">Kin Pull</span>
            <span class="sense-val">dx: ${sensed.kinPull.dx.toFixed(2)}, dy: ${sensed.kinPull.dy.toFixed(2)}</span>
          </div>`
        : '';

      const carrionSenseHtml =
        sensed.canEatCarrion || sensed.currentCellCarrion > 0 || sensed.nearestCarrion
          ? `
          <div class="sense-item">
            <span class="sense-label">Scavenging / Carrion</span>
            <span class="sense-val ${sensed.canEatCarrion ? 'highlight-food' : ''}">${
              sensed.currentCellCarrion > 0
                ? `${sensed.currentCellCarrion} available${sensed.canEatCarrion ? ' (can eat)' : ''}`
                : '0 available'
            } · nearest: ${
              sensed.nearestCarrion
                ? `dist ${sensed.nearestCarrion.distance} (dx:${sensed.nearestCarrion.dx}, dy:${sensed.nearestCarrion.dy})`
                : 'none in radius'
            }</span>
          </div>`
          : '';

      let weatherSenseHtml = '';
      if (sensed.weatherTemp !== undefined || sensed.weatherRain !== undefined) {
        let weatherStr = `temp: ${(sensed.weatherTemp ?? 0) >= 0 ? '+' : ''}${(sensed.weatherTemp ?? 0).toFixed(2)}, rain: ${Math.round((sensed.weatherRain ?? 0) * 100)}%`;
        if (sensed.weatherWind) {
          weatherStr += `, wind: ${sensed.weatherWind.wx.toFixed(2)}, ${sensed.weatherWind.wy.toFixed(2)}`;
        }
        weatherSenseHtml = `
          <div class="sense-item">
            <span class="sense-label">Micro-climate</span>
            <span class="sense-val">${weatherStr}</span>
          </div>`;
      }

      const lastBiteHtml =
        organism.lastBiteYield !== undefined
          ? `
          <div class="sense-item" title="Last bite nutritional efficiency">
            <span class="sense-label">Last Bite Yield</span>
            <span class="sense-val">${Math.round(organism.lastBiteYield * 100)}%</span>
          </div>`
          : '';

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
          ${kinPullHtml}
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
          ${carrionSenseHtml}
          ${weatherSenseHtml}
          ${lastBiteHtml}
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

        ${genomeBarsHtml(organism, config)}

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

        <div class="brain-slot"></div>

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
    const slot = this.container.querySelector('.brain-slot');
    if (slot && this.brainElement) slot.replaceWith(this.brainElement);
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
      defense: 'Defense (chemical/thorns)',
    };
    const rows = PLANT_TRAIT_KEYS.map((key) => {
      const r = PLANT_TRAITS[key];
      const val = g[key] ?? 0;
      const pct = ((val - r.min) / (r.max - r.min)) * 100;
      return `
            <div class="weight-row">
              <span class="weight-name">${traitLabels[key]}</span>
              <span class="weight-num">${val.toFixed(2)}</span>
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
