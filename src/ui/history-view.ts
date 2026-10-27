import {
  DIST_BIN_COUNT,
  POLICY_WEIGHT_KEYS,
  type DistTrait,
  type HistorySample,
  type PolicyWeightKey,
} from '../sim/history';
import type { LifeField } from '../sim/lifehistory';
import { WEIGHT_MAX, WEIGHT_MIN } from '../sim/policy';
import { PLANT_TRAITS, PLANT_TRAIT_KEYS } from '../sim/plants';
import type { PlantTrait } from '../sim/types';

// Chart ink. The series blue is validated against the card surface
// (#141d26) for lightness, chroma, and >= 3:1 contrast.
const SERIES = '#3987e5';
const SERIES_BAND = 'rgba(57, 135, 229, 0.18)';
const GRID = '#263645';
const AXIS_TEXT = '#94a3b8';
const CROSSHAIR = '#94a3b8';
const SURFACE = '#141d26';

const WEIGHT_LABELS: Record<PolicyWeightKey, string> = {
  foodAttraction: 'Food attraction',
  obstacleAvoidance: 'Obstacle avoidance',
  crowdingAvoidance: 'Crowd avoidance',
  exploreTendency: 'Explore tendency',
  eatDrive: 'Eat drive',
  reproduceDrive: 'Reproduce drive',
  kinAffinity: 'Kin affinity',
  shareWithKin: 'Share with kin',
  shareWithStrangers: 'Share with strangers',
  careForChildren: 'Care for children',
  forageDrive: 'Forage drive',
  eatPriority: 'Eat priority',
  hungerUrgency: 'Hunger urgency',
  followFoodParent: 'Follow food parent',
  signalOnFood: 'Signal on food',
  signalWhenHungry: 'Signal when hungry',
  followSignal: 'Follow signals',
  restDrive: 'Rest drive',
  avoidOccupied: 'Avoid occupied cells',
  leapEagerness: 'Leap eagerness',
};

const PLANT_TRAIT_LABELS: Record<PlantTrait, string> = {
  growthRate: 'Growth rate',
  maxBiomass: 'Maximum size',
  seedSize: 'Seed size',
  seedThreshold: 'Seeding threshold',
  dispersal: 'Seed dispersal',
  rootShare: 'Root share',
  leanDormancy: 'Lean dormancy',
};

const PLANT_SECTION = 'Plants (when Food = Plants)';

// The genome sections, in the order they appear (see SECTION_ORDER).
const LIFE_SECTION = 'Genome · Life history & energetics';
const MORPH_SECTION = 'Genome · Morphology & abilities';
const NICHE_SECTION = 'Genome · Trophic & dietary niche';
const NEURAL_SECTION = 'Genome · Neural topology';
const DIST_SECTION = 'Genome · Population distributions';

/** Top-to-bottom order of the sections; panels keep their order within one. */
const SECTION_ORDER = [
  'Population & food',
  LIFE_SECTION,
  MORPH_SECTION,
  NICHE_SECTION,
  NEURAL_SECTION,
  DIST_SECTION,
  'Reproduction',
  'Look-alike groups & sharing',
  'Signals',
  PLANT_SECTION,
];

/** Trend section for the dial weights, collapsed while the brain is in charge. */
const DIAL_SECTION = 'Inherited weights (dials)';

interface DistPanel {
  readonly trait: DistTrait;
  readonly label: string;
  /** What the bottom and top of the range mean. */
  readonly low: string;
  readonly high: string;
  canvas?: HTMLCanvasElement;
  valueEl?: HTMLElement;
}

const DIST_PANELS: readonly DistPanel[] = [
  { trait: 'carnivory', label: 'Diet spread', low: 'plants', high: 'meat' },
  { trait: 'reproThreshold', label: 'Breeding threshold spread', low: 'early', high: 'late' },
  { trait: 'clutchSize', label: 'Clutch size spread', low: 'small', high: 'large' },
  { trait: 'metabolicRate', label: 'Metabolic rate spread', low: 'slow', high: 'fast' },
];

/** Bin counts as fractions of their total (all zero when empty). */
function binFractions(counts: readonly number[] | undefined): number[] {
  const total = counts ? counts.reduce((a, c) => a + c, 0) : 0;
  return Array.from({ length: DIST_BIN_COUNT }, (_, b) => (total > 0 ? counts![b] / total : 0));
}

/**
 * Whether a distribution has two separate humps: two bins that are each local peaks holding at least 20% of
 * the population, with a trough between them under half the lower peak. A reading aid; it changes nothing.
 */
export function isSplit(fractions: readonly number[]): boolean {
  const peaks: number[] = [];
  for (let b = 0; b < fractions.length; b++) {
    const f = fractions[b];
    if (f >= 0.2 && (b === 0 || f >= fractions[b - 1]) && (b === fractions.length - 1 || f >= fractions[b + 1])) peaks.push(b);
  }
  for (let i = 0; i < peaks.length; i++) {
    for (let j = i + 1; j < peaks.length; j++) {
      if (peaks[j] - peaks[i] < 2) continue;
      const trough = Math.min(...fractions.slice(peaks[i] + 1, peaks[j]));
      if (trough < 0.5 * Math.min(fractions[peaks[i]], fractions[peaks[j]])) return true;
    }
  }
  return false;
}

const BAR_HUES = 'rgba(57, 135, 229,';
/** Share of a distribution chart's width taken by its strip over time; the rest holds the current bars. */
const DIST_STRIP = 0.74;
/** Shortest gap between redraws of the charts while data streams in. */
const DRAW_MIN_MS = 400;

/** A life-history gene's chart: mean ± SD over the living; "off" while its switch is off. */
function lifePanel(
  field: LifeField | 'fat',
  label: string,
  range: readonly [number, number] | null,
  fmt: (v: number) => string,
  extra?: Partial<Panel>
): Panel {
  const stat = (s: HistorySample) => s.life?.[field];
  return {
    section: LIFE_SECTION,
    label,
    fixedRange: range,
    value: (s) => stat(s)?.mean ?? 0,
    spread: (s) => stat(s)?.sd ?? 0,
    format: (s) => {
      const st = stat(s);
      return st ? `${fmt(st.mean)} ± ${fmt(st.sd)}` : 'off';
    },
    ...extra,
  };
}

const REFERENCE = '#64748b';
const LEAN_WASH = 'rgba(251, 191, 36, 0.09)';

interface Panel {
  readonly section: string;
  readonly label: string;
  /** Fixed y-range, or null to scale from 0 to a rounded maximum. */
  readonly fixedRange: readonly [number, number] | null;
  /** `prev` is the previous sample, for per-tick rates. */
  readonly value: (s: HistorySample, prev?: HistorySample) => number;
  readonly spread?: (s: HistorySample) => number;
  /** A muted comparison line, e.g. what a value would be by chance. */
  readonly reference?: (s: HistorySample) => number;
  readonly format: (s: HistorySample, prev?: HistorySample) => string;
  readonly axisLabel?: (v: number) => string;
  canvas?: HTMLCanvasElement;
  valueEl?: HTMLElement;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Per-100-tick rate of a cumulative counter between two samples. */
function ratePer100(total: (s: HistorySample) => number) {
  return (s: HistorySample, prev?: HistorySample): number =>
    !prev || s.tick === prev.tick ? 0 : ((total(s) - total(prev)) / (s.tick - prev.tick)) * 100;
}

// Ordinary gifts exclude parent-to-child care, which has its own chart.
const sharesPer100Ticks = ratePer100((s) => s.sharesTotal - s.parentalSharesTotal);
const parentalSharesPer100Ticks = ratePer100((s) => s.parentalSharesTotal);
const signalsPer100Ticks = ratePer100((s) => s.signalsTotal);
const killsPer100Ticks = ratePer100((s) => s.killsTotal ?? 0);

/** Share of kills, between two samples, where the prey looked like a stranger (a different colour). */
function strangerKillShare(s: HistorySample, prev?: HistorySample): number {
  if (!prev) return 0;
  const kills = (s.killsTotal ?? 0) - (prev.killsTotal ?? 0);
  return kills > 0 ? ((s.killsOfStrangersTotal ?? 0) - (prev.killsOfStrangersTotal ?? 0)) / kills : 0;
}
/** Between two samples: the share of births that came from mating, and of matings between look-alikes. */
function sexualBirthShare(s: HistorySample, prev?: HistorySample): number {
  if (!prev) return 0;
  const births = s.birthsTotal - prev.birthsTotal;
  // Samples from before clutches counted one child per mating.
  const children = (x: HistorySample) => x.matingChildrenTotal ?? x.matingsTotal ?? 0;
  return births > 0 ? (children(s) - children(prev)) / births : 0;
}
function alikeMatingShare(s: HistorySample, prev?: HistorySample): number {
  if (!prev) return 0;
  const matings = (s.matingsTotal ?? 0) - (prev.matingsTotal ?? 0);
  return matings > 0 ? ((s.matingsAlikeTotal ?? 0) - (prev.matingsAlikeTotal ?? 0)) / matings : 0;
}
const carrionMealsPer100Ticks = ratePer100((s) => s.carrionEatenTotal ?? 0);
const plantsGrazedOutPer100Ticks = ratePer100((s) => s.plants?.deathsGrazed ?? 0);
const plantsLostLeanPer100Ticks = ratePer100((s) => s.plants?.deathsLean ?? 0);
const plantsStarvedPer100Ticks = ratePer100((s) => (s.plants?.deathsShaded ?? 0) + (s.plants?.deathsStarved ?? 0));

/** Share of signals sent while standing on food, between two samples. */
function signalsOnFoodShare(s: HistorySample, prev?: HistorySample): number {
  if (!prev) return 0;
  const sent = s.signalsTotal - prev.signalsTotal;
  return sent > 0 ? (s.signalsOnFoodTotal - prev.signalsOnFoodTotal) / sent : 0;
}

function inGroupBias(s: HistorySample): number {
  return s.weights.shareWithKin.mean - s.weights.shareWithStrangers.mean;
}

/** Rounds up to a clean axis maximum, e.g. 213 -> 250, 48 -> 50. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * pow) return m * pow;
  }
  return 10 * pow;
}

/**
 * Small-multiple trend charts: population and food, tribe formation and
 * sharing, and the mean ± 1 SD of each inherited policy weight over the run.
 * Press and drag to read any tick.
 */
export class HistoryView {
  private readonly panels: Panel[];
  private readonly readout: HTMLElement;
  private readonly container: HTMLElement;
  private samples: readonly HistorySample[] = [];
  private hoverIndex: number | null = null;
  /** What the charts last showed (sample count, latest tick, scrub position), so an unchanged feed draws nothing. */
  private drawnKey = '';
  /** Charts currently on screen: the rest are not drawn (a phone shows a handful of ~60). Null until the observer reports. */
  private readonly onScreen = new Set<HTMLCanvasElement>();
  private readonly observer: IntersectionObserver | null;
  private lastDrawAt = 0;
  private pendingDraw: ReturnType<typeof setTimeout> | null = null;

  constructor(container: HTMLElement, onDownloadCSV: () => void) {
    this.container = container;
    this.panels = [
      {
        section: 'Population & food',
        label: 'Population',
        fixedRange: null,
        value: (s) => s.population,
        format: (s) => String(s.population),
      },
      {
        section: 'Population & food',
        label: 'Food stock',
        fixedRange: null,
        value: (s) => s.foodStock,
        format: (s) => String(s.foodStock),
      },
      {
        section: 'Look-alike groups & sharing',
        label: 'Look-alike groups (5+)',
        fixedRange: null,
        value: (s) => s.tribeCount,
        format: (s) => `${s.tribeCount} · largest ${s.largestTribe}`,
      },
      {
        section: 'Look-alike groups & sharing',
        label: 'Neighbours who look alike',
        fixedRange: [0, 1],
        value: (s) => s.localKinFraction,
        reference: (s) => s.globalKinFraction,
        format: (s) => `${pct(s.localKinFraction)} · chance ${pct(s.globalKinFraction)}`,
        axisLabel: pct,
      },
      {
        section: 'Look-alike groups & sharing',
        label: 'Gifts to others',
        fixedRange: null,
        value: sharesPer100Ticks,
        format: (s, prev) => `${sharesPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: 'Look-alike groups & sharing',
        label: 'Gifts to own children',
        fixedRange: null,
        value: parentalSharesPer100Ticks,
        format: (s, prev) => `${parentalSharesPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: 'Look-alike groups & sharing',
        label: 'Spontaneously generated (total)',
        fixedRange: null,
        value: (s) => s.immigrantsTotal,
        format: (s) => String(s.immigrantsTotal),
      },
      {
        section: 'Look-alike groups & sharing',
        label: 'In-group bias',
        fixedRange: [WEIGHT_MIN, WEIGHT_MAX],
        value: inGroupBias,
        format: (s) => `${inGroupBias(s) >= 0 ? '+' : ''}${inGroupBias(s).toFixed(2)}`,
      },
      {
        section: 'Signals',
        label: 'Signals sent',
        fixedRange: null,
        value: signalsPer100Ticks,
        format: (s, prev) => `${signalsPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: 'Signals',
        label: 'Signals sent on food',
        fixedRange: [0, 1],
        value: signalsOnFoodShare,
        format: (s, prev) => pct(signalsOnFoodShare(s, prev)),
        axisLabel: pct,
      },
      {
        section: NICHE_SECTION,
        label: 'Meat in the diet',
        fixedRange: [0, 1],
        value: (s) => s.carnivory?.mean ?? 0,
        spread: (s) => s.carnivory?.sd ?? 0,
        format: (s) => `${pct(s.carnivory?.mean ?? 0)} ± ${pct(s.carnivory?.sd ?? 0)}`,
        axisLabel: pct,
      },
      {
        section: NICHE_SECTION,
        label: 'Kills',
        fixedRange: null,
        value: killsPer100Ticks,
        format: (s, prev) => `${killsPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: NICHE_SECTION,
        label: 'Kills of a different colour',
        fixedRange: [0, 1],
        value: strangerKillShare,
        format: (s, prev) => pct(strangerKillShare(s, prev)),
        axisLabel: pct,
      },
      {
        section: 'Reproduction',
        label: 'Births from mating',
        fixedRange: [0, 1],
        value: sexualBirthShare,
        format: (s, prev) => pct(sexualBirthShare(s, prev)),
        axisLabel: pct,
      },
      {
        section: 'Reproduction',
        label: 'Matings between look-alikes',
        fixedRange: [0, 1],
        value: alikeMatingShare,
        format: (s, prev) => pct(alikeMatingShare(s, prev)),
        axisLabel: pct,
      },
      {
        section: MORPH_SECTION,
        label: 'Carry capacity',
        fixedRange: [0, 6],
        value: (s) => s.carryCapacity.mean,
        spread: (s) => s.carryCapacity.sd,
        format: (s) => `${s.carryCapacity.mean.toFixed(2)} ± ${s.carryCapacity.sd.toFixed(2)} units`,
      },
      {
        section: MORPH_SECTION,
        label: 'Dispersal distance',
        fixedRange: [0, 8],
        value: (s) => s.dispersal.mean,
        spread: (s) => s.dispersal.sd,
        format: (s) => `${s.dispersal.mean.toFixed(2)} ± ${s.dispersal.sd.toFixed(2)} steps`,
      },
      {
        section: MORPH_SECTION,
        label: 'Memory span',
        fixedRange: [0, 100],
        value: (s) => s.memorySpan.mean,
        spread: (s) => s.memorySpan.sd,
        format: (s) => `${s.memorySpan.mean.toFixed(1)} ± ${s.memorySpan.sd.toFixed(1)} ticks`,
      },
      {
        section: MORPH_SECTION,
        label: 'Diagonal movers',
        fixedRange: [0, 1],
        value: (s) => s.abilities.diagonal,
        format: (s) => pct(s.abilities.diagonal),
        axisLabel: pct,
      },
      {
        section: MORPH_SECTION,
        label: 'Squeezers',
        fixedRange: [0, 1],
        value: (s) => s.abilities.squeeze,
        format: (s) => pct(s.abilities.squeeze),
        axisLabel: pct,
      },
      {
        section: MORPH_SECTION,
        label: 'Leapers',
        fixedRange: [0, 1],
        value: (s) => s.abilities.leap,
        format: (s) => pct(s.abilities.leap),
        axisLabel: pct,
      },
      {
        section: MORPH_SECTION,
        label: 'No movement ability',
        fixedRange: [0, 1],
        value: (s) => s.abilities.none,
        format: (s) => pct(s.abilities.none),
        axisLabel: pct,
      },
      {
        section: NEURAL_SECTION,
        label: 'Drift from head start',
        fixedRange: null,
        value: (s) => s.brainDrift.mean,
        spread: (s) => s.brainDrift.sd,
        format: (s) => `${s.brainDrift.mean.toFixed(2)} ± ${s.brainDrift.sd.toFixed(2)}`,
      },
      {
        section: NEURAL_SECTION,
        label: 'Hidden layer strength',
        fixedRange: null,
        value: (s) => s.hiddenStrength.mean,
        spread: (s) => s.hiddenStrength.sd,
        format: (s) => `${s.hiddenStrength.mean.toFixed(2)} ± ${s.hiddenStrength.sd.toFixed(2)}`,
      },
      {
        section: PLANT_SECTION,
        label: 'Plants',
        fixedRange: null,
        value: (s) => s.plants?.count ?? 0,
        format: (s) => (s.plants ? `${s.plants.count} · ${s.plants.dormant} dormant` : 'off'),
      },
      {
        section: PLANT_SECTION,
        label: 'Edible biomass (grey = roots)',
        fixedRange: null,
        value: (s) => s.plants?.edibleBiomass ?? 0,
        reference: (s) => s.plants?.roots ?? 0,
        format: (s) => (s.plants ? `${Math.round(s.plants.edibleBiomass)} · roots ${Math.round(s.plants.roots)}` : 'off'),
      },
      {
        section: PLANT_SECTION,
        label: 'Plants grazed out',
        fixedRange: null,
        value: plantsGrazedOutPer100Ticks,
        format: (s, prev) => `${plantsGrazedOutPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: PLANT_SECTION,
        label: 'Plants lost in lean seasons',
        fixedRange: null,
        value: plantsLostLeanPer100Ticks,
        format: (s, prev) => `${plantsLostLeanPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: PLANT_SECTION,
        label: 'Plants shaded out or starved',
        fixedRange: null,
        value: plantsStarvedPer100Ticks,
        format: (s, prev) => `${plantsStarvedPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      lifePanel('reproThreshold', 'Breeding threshold (energy)', null, (v) => v.toFixed(0)),
      lifePanel('investment', 'Investment per child', [0, 1], pct, { axisLabel: pct }),
      lifePanel('metabolicRate', 'Metabolic rate (× base burn)', null, (v) => v.toFixed(2)),
      lifePanel('fatCapacity', 'Fat capacity (grey = fat held)', null, (v) => v.toFixed(0), {
        reference: (s) => s.life?.fat?.mean ?? 0,
      }),
      lifePanel('clutchSize', 'Clutch size (per mating)', null, (v) => v.toFixed(1)),
      lifePanel('torporDepth', 'Rest efficiency', [0, 1], pct, { axisLabel: pct }),
      lifePanel('eggRate', 'Births laid as eggs', [0, 1], pct, { axisLabel: pct }),
      {
        section: NICHE_SECTION,
        label: 'Plant-eating efficiency',
        fixedRange: [0, 1],
        value: (s) => s.herbivory?.mean ?? 0,
        spread: (s) => s.herbivory?.sd ?? 0,
        format: (s) => (s.herbivory ? `${pct(s.herbivory.mean)} ± ${pct(s.herbivory.sd)}` : 'off (split diets)'),
        axisLabel: pct,
      },
      {
        section: NICHE_SECTION,
        label: 'Energy per plant meal',
        fixedRange: null,
        value: (s) => s.yields?.plant.mean ?? 0,
        spread: (s) => s.yields?.plant.sd ?? 0,
        format: (s) => (s.yields ? `${s.yields.plant.mean.toFixed(1)} ± ${s.yields.plant.sd.toFixed(1)}` : '–'),
      },
      {
        section: NICHE_SECTION,
        label: 'Energy per carrion meal',
        fixedRange: null,
        value: (s) => s.yields?.carrion.mean ?? 0,
        spread: (s) => s.yields?.carrion.sd ?? 0,
        format: (s) => (s.yields ? `${s.yields.carrion.mean.toFixed(1)} ± ${s.yields.carrion.sd.toFixed(1)}` : '–'),
      },
      {
        section: NICHE_SECTION,
        label: 'Carrion meals eaten',
        fixedRange: null,
        value: carrionMealsPer100Ticks,
        format: (s, prev) => `${carrionMealsPer100Ticks(s, prev).toFixed(1)} per 100 ticks`,
      },
      {
        section: NEURAL_SECTION,
        label: 'Active connections',
        fixedRange: null,
        value: (s) => s.topology?.connections.mean ?? 0,
        spread: (s) => s.topology?.connections.sd ?? 0,
        format: (s) => (s.topology ? `${s.topology.connections.mean.toFixed(1)} ± ${s.topology.connections.sd.toFixed(1)}` : '–'),
      },
      {
        section: NEURAL_SECTION,
        label: 'Recruited hidden units',
        fixedRange: [0, 6],
        value: (s) => s.topology?.hiddenUnits.mean ?? 0,
        spread: (s) => s.topology?.hiddenUnits.sd ?? 0,
        format: (s) => (s.topology ? `${s.topology.hiddenUnits.mean.toFixed(2)} ± ${s.topology.hiddenUnits.sd.toFixed(2)}` : '–'),
      },
      {
        section: NEURAL_SECTION,
        label: 'Genome length (genes)',
        fixedRange: null,
        value: (s) => s.genome?.length.mean ?? 0,
        spread: (s) => s.genome?.length.sd ?? 0,
        format: (s) => (s.genome ? `${s.genome.length.mean.toFixed(1)} ± ${s.genome.length.sd.toFixed(1)}` : 'off (no DNA)'),
      },
      {
        section: NEURAL_SECTION,
        label: 'Silent genes',
        fixedRange: null,
        value: (s) => s.genome?.silent ?? 0,
        format: (s) => (s.genome ? s.genome.silent.toFixed(2) : 'off (no DNA)'),
      },
      {
        section: NEURAL_SECTION,
        label: 'Duplicated gene slots',
        fixedRange: null,
        value: (s) => s.genome?.duplicatedSlots ?? 0,
        format: (s) => (s.genome ? s.genome.duplicatedSlots.toFixed(2) : 'off (no DNA)'),
      },
      {
        section: NEURAL_SECTION,
        label: 'Duplicates still identical',
        fixedRange: [0, 1],
        value: (s) => s.genome?.identicalShare ?? 0,
        format: (s) => (s.genome ? pct(s.genome.identicalShare) : 'off (no DNA)'),
        axisLabel: pct,
      },
      ...PLANT_TRAIT_KEYS.map(
        (key): Panel => ({
          section: PLANT_SECTION,
          label: PLANT_TRAIT_LABELS[key],
          fixedRange: [PLANT_TRAITS[key].min, PLANT_TRAITS[key].max],
          value: (s) => s.plants?.traits[key].mean ?? 0,
          spread: (s) => s.plants?.traits[key].sd ?? 0,
          format: (s) =>
            s.plants ? `${s.plants.traits[key].mean.toFixed(2)} ± ${s.plants.traits[key].sd.toFixed(2)}` : 'off',
        })
      ),
      ...POLICY_WEIGHT_KEYS.map(
        (key): Panel => ({
          section: DIAL_SECTION,
          label: WEIGHT_LABELS[key],
          fixedRange: [WEIGHT_MIN, WEIGHT_MAX],
          value: (s) => s.weights[key].mean,
          spread: (s) => s.weights[key].sd,
          format: (s) => `${s.weights[key].mean.toFixed(2)} ± ${s.weights[key].sd.toFixed(2)}`,
        })
      ),
    ];
    // Group by section (array.sort is stable, so each section keeps its order).
    const rank = (p: Panel) => {
      const i = SECTION_ORDER.indexOf(p.section);
      return i < 0 ? SECTION_ORDER.length : i;
    };
    this.panels.sort((a, b) => rank(a) - rank(b));

    const sections = [...new Set([...this.panels.map((p) => p.section), DIST_SECTION])].sort((a, b) => {
      const ra = SECTION_ORDER.indexOf(a);
      const rb = SECTION_ORDER.indexOf(b);
      return (ra < 0 ? SECTION_ORDER.length : ra) - (rb < 0 ? SECTION_ORDER.length : rb);
    });

    container.innerHTML = `
      <details open class="trends-card">
        <summary class="trends-summary">
          <strong>Trends</strong>
          <span class="trends-hint">Shaded = lean season · band = ±1 SD · grey = chance or reference · bias = kin − stranger giving</span>
        </summary>
        <div class="trends-body">
          <div class="trends-toolbar">
            <span class="trends-readout"></span>
            <button type="button" class="btn btn-secondary btn-small btn-csv">Download CSV</button>
          </div>
          ${sections
            .map((section) =>
              section === DIST_SECTION
                ? `
          <details class="trends-sec" open>
          <summary class="trends-section">${section}<span class="trends-dials-note"> · bright = more of the living in that fifth</span></summary>
          <div class="trends-grid">${this.distFigures()}</div>
          </details>`
                : `
          <details class="trends-sec${section === DIAL_SECTION ? ' trends-dials' : ''}" open>
          <summary class="trends-section">${section}${
            section === DIAL_SECTION ? '<span class="trends-dials-note"> · inactive under the Brain controller</span>' : ''
          }</summary>
          <div class="trends-grid">${this.panelFigures(section)}</div>
          </details>`
            )
            .join('')}
        </div>
      </details>
    `;

    this.readout = container.querySelector<HTMLElement>('.trends-readout')!;
    const figures = container.querySelectorAll<HTMLElement>('.trend-panel');
    this.panels.forEach((p, i) => {
      p.canvas = figures[i].querySelector('canvas')!;
      p.valueEl = figures[i].querySelector<HTMLElement>('.trend-value')!;
    });

    const distFigures = container.querySelectorAll<HTMLElement>('.dist-panel');
    DIST_PANELS.forEach((d, i) => {
      d.canvas = distFigures[i].querySelector('canvas')!;
      d.valueEl = distFigures[i].querySelector<HTMLElement>('.trend-value')!;
    });

    container.querySelector('.btn-csv')!.addEventListener('click', onDownloadCSV);
    // Collapsed charts are skipped when drawing; draw them once opened. `toggle` does not bubble, so listen while it descends.
    container.addEventListener('toggle', () => this.draw(true), true);

    // Press-and-drag scrubbing. Horizontal drags scrub; vertical swipes
    // still scroll the page (touch-action: pan-y in CSS).
    const grid = container.querySelector<HTMLElement>('.trends-body')!;
    const scrub = (e: PointerEvent) => {
      const figure = (e.target as Element).closest('.trend-panel, .dist-panel');
      const canvas = figure?.querySelector('canvas');
      if (!figure || !canvas || this.samples.length === 0) return;
      const rect = canvas.getBoundingClientRect();
      // A distribution chart keeps its time strip in the left part; the bars beside it are not a time axis.
      const span = figure.classList.contains('dist-panel') ? rect.width * DIST_STRIP : rect.width;
      const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / span));
      this.hoverIndex = Math.round(frac * (this.samples.length - 1));
      this.draw();
    };
    const clear = () => {
      this.hoverIndex = null;
      this.draw();
    };
    grid.addEventListener('pointerdown', scrub);
    grid.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || e.buttons > 0) scrub(e);
    });
    grid.addEventListener('pointerleave', clear);
    grid.addEventListener('pointercancel', clear);
    grid.addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') clear();
    });

    new ResizeObserver(() => this.draw(true)).observe(grid);

    // Draw only the charts in view; one that scrolls into view is drawn then.
    this.observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const e of entries) {
                if (e.isIntersecting) this.onScreen.add(e.target as HTMLCanvasElement);
                else this.onScreen.delete(e.target as HTMLCanvasElement);
              }
              this.draw(true);
            },
            { rootMargin: '120px 0px' }
          );
    for (const canvas of container.querySelectorAll('canvas')) this.observer?.observe(canvas);
  }

  private shouldDraw(canvas: HTMLCanvasElement): boolean {
    return this.observer === null || this.onScreen.has(canvas);
  }

  private panelFigures(section: string): string {
    return this.panels
      .filter((p) => p.section === section)
      .map(
        (p) => `
              <figure class="trend-panel">
                <figcaption><span class="trend-label">${p.label}</span><span class="trend-value"></span></figcaption>
                <canvas></canvas>
              </figure>`
      )
      .join('');
  }

  private distFigures(): string {
    return DIST_PANELS.map(
      (d) => `
              <figure class="dist-panel">
                <figcaption><span class="trend-label">${d.label} <span class="dist-axis">(${d.low} → ${d.high})</span></span><span class="trend-value"></span></figcaption>
                <canvas></canvas>
              </figure>`
    ).join('');
  }

  /**
   * Dial weights steer nothing under the brain (they only drift), so their
   * charts start collapsed then, with a note; open under the dials.
   */
  public setController(controller: 'dials' | 'brain'): void {
    const dials = this.container.querySelector<HTMLDetailsElement>('.trends-dials');
    if (!dials) return;
    dials.open = controller === 'dials';
    dials.querySelector<HTMLElement>('.trends-dials-note')!.hidden = controller === 'dials';
  }

  public render(samples: readonly HistorySample[]): void {
    this.samples = samples;
    if (this.hoverIndex !== null && this.hoverIndex >= samples.length) {
      this.hoverIndex = null;
    }
    // Charts move slowly: at most a few redraws a second, with the last one always delivered.
    const wait = DRAW_MIN_MS - (performance.now() - this.lastDrawAt);
    if (wait <= 0) this.draw();
    else if (this.pendingDraw === null) {
      this.pendingDraw = setTimeout(() => {
        this.pendingDraw = null;
        this.draw();
      }, wait);
    }
  }

  /** Redraws the charts; skipped when nothing they show has changed since the last draw, unless `force`. */
  private draw(force = false): void {
    const n = this.samples.length;
    const key = `${n}:${n > 0 ? this.samples[n - 1].tick : -1}:${this.hoverIndex}`;
    if (!force && key === this.drawnKey) return;
    this.drawnKey = key;
    this.lastDrawAt = performance.now();
    const shownIndex = this.hoverIndex ?? n - 1;
    const shown = n === 0 ? null : this.samples[shownIndex];
    const shownPrev = shownIndex > 0 ? this.samples[shownIndex - 1] : undefined;

    if (shown) {
      const first = this.samples[0].tick;
      this.readout.textContent =
        this.hoverIndex === null
          ? `Ticks ${first}–${shown.tick} · drag a chart to inspect`
          : `At tick ${shown.tick}`;
    } else {
      this.readout.textContent = 'No data yet';
    }

    for (const panel of this.panels) {
      if (!this.shouldDraw(panel.canvas!)) continue;
      panel.valueEl!.textContent = shown ? panel.format(shown, shownPrev) : '–';
      this.drawPanel(panel);
    }
    for (const dist of DIST_PANELS) this.drawDist(dist, shown, shownIndex);
  }

  /** A trait's distribution: a strip of colour over time (one row per fifth of the range) beside the shown tick's bars. */
  private drawDist(dist: DistPanel, shown: HistorySample | null, shownIndex: number): void {
    const canvas = dist.canvas!;
    if (!this.shouldDraw(canvas)) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, width, height);

    const samples = this.samples;
    const n = samples.length;
    const current = shown ? binFractions(shown.bins?.[dist.trait]) : binFractions(undefined);
    const exists = samples.some((s) => s.bins?.[dist.trait]);
    if (!exists) {
      ctx.fillStyle = AXIS_TEXT;
      ctx.font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(n === 0 ? 'No data yet' : 'off in this world', 8, height / 2);
      if (dist.valueEl) dist.valueEl.textContent = 'off';
      return;
    }

    const rowH = (height - 4) / DIST_BIN_COUNT;
    const stripRight = Math.round(width * DIST_STRIP);
    const barsLeft = stripRight + 8;
    const cellW = n > 0 ? (stripRight - 2) / n : 0;
    // The top row is the highest fifth of the range.
    for (let i = 0; i < n; i++) {
      const fr = binFractions(samples[i].bins?.[dist.trait]);
      for (let b = 0; b < DIST_BIN_COUNT; b++) {
        if (fr[b] <= 0) continue;
        ctx.fillStyle = `${BAR_HUES} ${Math.min(1, 0.08 + 0.92 * Math.sqrt(fr[b])).toFixed(3)})`;
        ctx.fillRect(1 + i * cellW, 2 + (DIST_BIN_COUNT - 1 - b) * rowH, Math.ceil(cellW) + 0.5, rowH - 1);
      }
    }
    if (this.hoverIndex !== null && n > 0) {
      ctx.strokeStyle = CROSSHAIR;
      ctx.lineWidth = 1;
      const cx = Math.round(1 + (shownIndex + 0.5) * cellW) + 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, height);
      ctx.stroke();
    }

    // The shown tick's histogram, lowest fifth at the bottom, scaled to the largest bin.
    const peak = Math.max(0.0001, ...current);
    for (let b = 0; b < DIST_BIN_COUNT; b++) {
      const len = (current[b] / peak) * (width - barsLeft - 2);
      ctx.fillStyle = SERIES;
      ctx.fillRect(barsLeft, 2 + (DIST_BIN_COUNT - 1 - b) * rowH + 1, Math.max(current[b] > 0 ? 2 : 0, len), rowH - 3);
    }
    if (dist.valueEl) {
      dist.valueEl.textContent = `${current.map((f) => Math.round(f * 100)).join(' · ')} %${isSplit(current) ? ' · split' : ''}`;
    }
  }

  private drawPanel(panel: Panel): void {
    const canvas = panel.canvas!;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return; // collapsed or not laid out

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, width, height);

    const samples = this.samples;
    const n = samples.length;

    let [yMin, yMax] = panel.fixedRange ?? [0, 1];
    if (!panel.fixedRange) {
      let max = 0;
      samples.forEach((s, i) => {
        max = Math.max(max, panel.value(s, samples[i - 1]) + (panel.spread ? panel.spread(s) : 0), panel.reference ? panel.reference(s) : 0);
      });
      yMax = niceMax(max);
    }

    // Gridlines: top, bottom, and zero for signed ranges.
    const gridValues = yMin < 0 ? [yMax, 0, yMin] : [yMax, yMin];
    const formatTick = (v: number) =>
      panel.axisLabel ? panel.axisLabel(v) : v > 0 && yMin < 0 ? `+${v}` : String(v);
    ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
    const gutter = Math.max(...gridValues.map((v) => ctx.measureText(formatTick(v)).width));

    // Plot area, leaving a left gutter for the y labels and room for the end dot.
    const left = Math.ceil(gutter) + 6;
    const right = width - 6;
    const top = 6;
    const bottom = height - 6;
    const x = (i: number) => (n <= 1 ? right : left + (i / (n - 1)) * (right - left));
    const y = (v: number) => {
      const clamped = Math.min(yMax, Math.max(yMin, v));
      return bottom - ((clamped - yMin) / (yMax - yMin)) * (bottom - top);
    };
    const valueAt = (i: number) => panel.value(samples[i], samples[i - 1]);

    // Lean seasons: a faint wash behind everything else.
    if (n > 1) {
      ctx.fillStyle = LEAN_WASH;
      const half = (right - left) / (n - 1) / 2;
      samples.forEach((s, i) => {
        if (s.lean) ctx.fillRect(x(i) - half, top, half * 2, bottom - top);
      });
    }

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.fillStyle = AXIS_TEXT;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of gridValues) {
      const gy = Math.round(y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, gy);
      ctx.lineTo(right, gy);
      ctx.stroke();
      ctx.fillText(formatTick(v), left - 4, Math.min(Math.max(gy, top + 4), bottom - 4));
    }

    if (n === 0) return;

    // ±1 SD band.
    if (panel.spread) {
      ctx.fillStyle = SERIES_BAND;
      ctx.beginPath();
      samples.forEach((s, i) => {
        const py = y(valueAt(i) + panel.spread!(s));
        if (i === 0) ctx.moveTo(x(i), py);
        else ctx.lineTo(x(i), py);
      });
      for (let i = n - 1; i >= 0; i--) {
        ctx.lineTo(x(i), y(valueAt(i) - panel.spread(samples[i])));
      }
      ctx.closePath();
      ctx.fill();
    }

    // Reference (chance) line, drawn under the series.
    if (panel.reference) {
      ctx.strokeStyle = REFERENCE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      samples.forEach((s, i) => {
        if (i === 0) ctx.moveTo(x(i), y(panel.reference!(s)));
        else ctx.lineTo(x(i), y(panel.reference!(s)));
      });
      ctx.stroke();
    }

    // Series line.
    ctx.strokeStyle = SERIES;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    samples.forEach((_, i) => {
      if (i === 0) ctx.moveTo(x(i), y(valueAt(i)));
      else ctx.lineTo(x(i), y(valueAt(i)));
    });
    ctx.stroke();

    // Crosshair when scrubbing; otherwise mark the latest value.
    const markIndex = this.hoverIndex ?? n - 1;
    if (this.hoverIndex !== null) {
      ctx.strokeStyle = CROSSHAIR;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(Math.round(x(markIndex)) + 0.5, top);
      ctx.lineTo(Math.round(x(markIndex)) + 0.5, bottom);
      ctx.stroke();
    }
    const mx = x(markIndex);
    const my = y(valueAt(markIndex));
    ctx.fillStyle = SURFACE;
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SERIES;
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}
