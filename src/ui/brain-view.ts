/**
 * The Inspector's collapsible "Brain" section (docs/specs/brain-viewer.md):
 * inputs -> hidden units -> action scores for the selected organism, from a
 * BrainTrace. Display only: it asks for a trace (a read-only request) and
 * draws it. While the section is closed, or nothing is selected, it asks for
 * nothing.
 */
import type { BrainTrace, TraceAction } from '../sim/brain-trace';

export type SenseFamily = 'food' | 'kin' | 'signals' | 'memory' | 'weather' | 'body' | 'movement' | 'hunting';

export const FAMILY_LABEL: Record<SenseFamily, string> = {
  food: 'Food',
  kin: 'Kin & mates',
  signals: 'Signals',
  memory: 'Memory',
  weather: 'Weather',
  body: 'Body',
  movement: 'Movement',
  hunting: 'Carrion & prey',
};

const FAMILY_ORDER: readonly SenseFamily[] = ['food', 'kin', 'signals', 'memory', 'weather', 'body', 'movement', 'hunting'];

/** Which sense family an input belongs to (pure). Unknown or future inputs fall back to Body, or Weather by name. */
export function inputFamily(name: string): SenseFamily {
  if (/^(weather|temperature|moisture|wind|malaise|lastBite|detox)/i.test(name)) return 'weather';
  if (/signal/i.test(name)) return 'signals';
  if (/remembered|^moveHome$|^register\d/i.test(name)) return 'memory';
  if (/carrion|attack|prey/i.test(name)) return 'hunting';
  if (/mate|kin|alike|family|give|child|parent/i.test(name)) return 'kin';
  if (/food|eat|pickUp|carried|pushedByEating/i.test(name)) return 'food';
  if (/^(isMove|moveObstacle|moveCrowd|moveNoise|moveOccupied|isLeap|isDiagonal)$/.test(name)) return 'movement';
  return 'body';
}

/** Input indices to draw: the top contributors plus every input of an expanded family, grouped by family then index (pure). */
export function shownInputs(trace: Pick<BrainTrace, 'topInputs' | 'inputNames'>, expanded: ReadonlySet<SenseFamily>): number[] {
  const set = new Set<number>(trace.topInputs.map((t) => t.index));
  trace.inputNames.forEach((name, i) => {
    if (expanded.has(inputFamily(name))) set.add(i);
  });
  const rank = (i: number) => FAMILY_ORDER.indexOf(inputFamily(trace.inputNames[i]));
  return [...set].sort((a, b) => rank(a) - rank(b) || a - b);
}

/** Inputs per family, for the "N more" chips (pure). Counts all inputs, shown or not. */
export function familyCounts(inputNames: readonly string[]): { family: SenseFamily; total: number }[] {
  const counts = new Map<SenseFamily, number>();
  for (const name of inputNames) counts.set(inputFamily(name), (counts.get(inputFamily(name)) ?? 0) + 1);
  return FAMILY_ORDER.filter((f) => counts.has(f)).map((family) => ({ family, total: counts.get(family) ?? 0 }));
}

const POS = '#4ade80';
const NEG = '#f87171';
const ACCENT = '#60a5fa';
const RIBBON_LENGTH = 60;
const MAX_ACTION_ROWS = 9;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const prettyAction = (a: Pick<TraceAction, 'type'>) => a.type.replace(/_/g, ' ').toLowerCase();
const ribbonColour = (type: string): string => {
  const kind = type.split('_')[0];
  const colours: Record<string, string> = {
    MOVE: '#64748b', LEAP: '#a78bfa', EAT: POS, PICK: '#84cc16', REPRODUCE: '#f472b6', MATE: '#fb7185',
    GIVE: '#38bdf8', SIGNAL: '#fbbf24', ATTACK: NEG, REST: '#334155',
  };
  return colours[kind] ?? '#94a3b8';
};

export interface BrainSource {
  inspectBrain(organismId: string): Promise<BrainTrace | null>;
}

export class BrainView {
  /** The persistent section; the Inspector re-attaches it after each of its own re-renders. */
  public readonly element: HTMLDetailsElement;
  private readonly body: HTMLElement;
  private readonly expanded = new Set<SenseFamily>();
  private targetId: string | null = null;
  private inFlight = false;
  private lastRequestedTick = -1;
  private trace: BrainTrace | null = null;
  private ribbon: { tick: number; type: string }[] = [];

  constructor(private readonly source: BrainSource) {
    this.element = document.createElement('details');
    this.element.className = 'inspector-section';
    this.element.dataset.key = 'brain-view';
    this.element.innerHTML = '<summary><strong>Brain</strong> <span class="muted">(live: how it would decide now)</span></summary><div class="brain-view"></div>';
    this.body = this.element.querySelector('.brain-view') as HTMLElement;
    this.element.addEventListener('toggle', () => {
      if (this.element.open) this.lastRequestedTick = -1;
    });
    this.body.addEventListener('click', (e) => {
      const button = (e.target as Element).closest('button[data-family]') as HTMLElement | null;
      if (!button) return;
      const family = button.dataset.family as SenseFamily;
      if (this.expanded.has(family)) this.expanded.delete(family);
      else this.expanded.add(family);
      this.draw();
    });
  }

  /** Called with every panel refresh. Asks for a trace only if the section is open and the tick moved. */
  public update(organismId: string | null, tick: number): void {
    if (organismId !== this.targetId) {
      this.targetId = organismId;
      this.trace = null;
      this.ribbon = [];
      this.lastRequestedTick = -1;
      this.body.innerHTML = '';
    }
    if (!organismId || !this.element.open || this.inFlight || tick === this.lastRequestedTick) return;
    this.inFlight = true;
    this.lastRequestedTick = tick;
    this.source
      .inspectBrain(organismId)
      .then((trace) => {
        if (organismId !== this.targetId) return;
        this.trace = trace;
        const last = trace?.lastAction;
        if (last && this.ribbon[this.ribbon.length - 1]?.tick !== last.tick) {
          this.ribbon.push({ tick: last.tick, type: last.type });
          if (this.ribbon.length > RIBBON_LENGTH) this.ribbon.shift();
        }
        this.draw();
      })
      .finally(() => {
        this.inFlight = false;
      });
  }

  private draw(): void {
    const t = this.trace;
    if (!t) {
      this.body.innerHTML = '<p class="muted">This organism is no longer alive.</p>';
      return;
    }
    this.body.innerHTML = t.controller === 'dials' ? this.dialsHTML(t) : this.networkHTML(t);
  }

  private ribbonHTML(): string {
    if (this.ribbon.length === 0) return '';
    const cells = this.ribbon
      .map((r) => `<span style="background:${ribbonColour(r.type)}" title="tick ${r.tick}: ${esc(prettyAction({ type: r.type }))}"></span>`)
      .join('');
    return `<div><div class="muted" style="font-size:0.75rem">Last ${this.ribbon.length} real decisions</div><div class="brain-ribbon" role="img" aria-label="Recent chosen actions">${cells}</div></div>`;
  }

  private dialsHTML(t: BrainTrace): string {
    const rows = [...t.actions]
      .map((a, i) => ({ a, i }))
      .sort((x, y) => y.a.score - x.a.score)
      .slice(0, MAX_ACTION_ROWS);
    const max = Math.max(1e-6, ...rows.map((r) => Math.abs(r.a.score)));
    const bars = rows
      .map(({ a, i }) => {
        const pct = (Math.abs(a.score) / max) * 100;
        const chosen = i === t.chosenIndex;
        return `<div class="weight-row"><span class="weight-name">${chosen ? '▶ ' : ''}${esc(prettyAction(a))}</span><span class="weight-num">${a.score.toFixed(2)}</span><div class="weight-track"><div class="weight-fill" style="left:${a.score >= 0 ? 50 : 50 - pct / 2}%;width:${pct / 2}%;background:${chosen ? ACCENT : a.score >= 0 ? POS : NEG}"></div></div></div>`;
      })
      .join('');
    const dials = Object.entries(t.dials)
      .map(([k, v]) => `<span class="muted">${esc(k)} ${Number(v).toFixed(2)}</span>`)
      .join(' · ');
    return `<div class="brain-dials"><p class="muted">Dials controller: weighted score per legal action.</p>${bars}<p style="font-size:0.75rem">${dials}</p></div>${this.ribbonHTML()}`;
  }

  private networkHTML(t: BrainTrace): string {
    const shown = shownInputs(t, this.expanded);
    const chosen = t.chosenIndex >= 0 ? t.actions[t.chosenIndex] : null;
    const hidden = t.hiddenUnits;
    const actionRows = pickActionRows(t);

    const rowH = 22;
    const nIn = Math.max(1, shown.length);
    const nHid = Math.max(1, hidden.length);
    const height = Math.max(nIn, nHid, actionRows.length) * rowH + 24;
    const xIn = 118;
    const xHid = 196;
    const xAct = 232;
    const inY = (k: number) => 14 + (k + 0.5) * ((height - 24) / nIn);
    const hidY = (k: number) => 14 + (k + 0.5) * ((height - 24) / nHid);
    const actY = (k: number) => 14 + (k + 0.5) * ((height - 24) / Math.max(1, actionRows.length));
    const shownPos = new Map(shown.map((idx, k) => [idx, k]));

    const edges: string[] = [];
    const edge = (x1: number, y1: number, x2: number, y2: number, value: number, scale: number) => {
      const w = Math.min(4, 0.4 + (Math.abs(value) / scale) * 3.6);
      edges.push(`<line x1="${x1}" y1="${y1.toFixed(1)}" x2="${x2}" y2="${y2.toFixed(1)}" stroke="${value >= 0 ? POS : NEG}" stroke-width="${w.toFixed(2)}" stroke-opacity="0.7"/>`);
    };
    // Scale edge width by the largest contribution drawn.
    let scale = 1e-6;
    for (const idx of shown) scale = Math.max(scale, Math.abs(chosen?.direct[idx] ?? 0));
    for (const u of hidden) scale = Math.max(scale, Math.abs(u.out * u.activation));
    // Input -> hidden (weight × input), and the direct (skip) route straight to the chosen action.
    hidden.forEach((u, h) => {
      for (const [idx, w] of u.weights) {
        const k = shownPos.get(idx);
        if (k !== undefined) edge(xIn + 6, inY(k), xHid - 8, hidY(h), w * t.inputs[idx], scale);
      }
    });
    const ck = t.chosenIndex >= 0 ? actionRows.findIndex((r) => r.index === t.chosenIndex) : -1;
    if (chosen && ck >= 0) {
      shown.forEach((idx, k) => {
        const d = chosen.direct[idx] ?? 0;
        if (d !== 0) edge(xIn + 6, inY(k), xAct, actY(ck), d, scale);
      });
      hidden.forEach((u, h) => edge(xHid + 8, hidY(h), xAct, actY(ck), u.out * u.activation, scale));
    }

    const inputNodes = shown
      .map((idx, k) => {
        const v = t.inputs[idx];
        const top = t.topInputs.find((ti) => ti.index === idx);
        const fill = `rgba(96,165,250,${Math.min(1, Math.abs(v)).toFixed(2)})`;
        return `<text x="${xIn - 8}" y="${(inY(k) + 4).toFixed(1)}" text-anchor="end">${esc(t.inputNames[idx])}</text><circle cx="${xIn}" cy="${inY(k).toFixed(1)}" r="6" fill="${fill}" stroke="${top ? ACCENT : '#64748b'}"/><title>${esc(t.inputNames[idx])} = ${v.toFixed(3)}${top ? `, contribution ${top.contribution.toFixed(2)}` : ''}</title>`;
      })
      .join('');
    const hiddenNodes = hidden
      .map((u, h) => {
        const fill = u.activation >= 0 ? `rgba(74,222,128,${Math.abs(u.activation).toFixed(2)})` : `rgba(248,113,113,${Math.abs(u.activation).toFixed(2)})`;
        return `<circle cx="${xHid}" cy="${hidY(h).toFixed(1)}" r="7" fill="${fill}" stroke="${u.acquired ? '#fbbf24' : '#64748b'}" stroke-width="${u.acquired ? 2 : 1}"/><title>hidden ${u.id}${u.acquired ? ' (acquired)' : ''}: activation ${u.activation.toFixed(2)}, out weight ${u.out.toFixed(2)}</title>`;
      })
      .join('');
    const maxScore = Math.max(1e-6, ...actionRows.map((r) => Math.abs(t.actions[r.index].score)));
    const actionNodes = actionRows
      .map((r, k) => {
        const a = t.actions[r.index];
        const isChosen = r.index === t.chosenIndex;
        const len = (Math.abs(a.score) / maxScore) * 50;
        const y = actY(k);
        return `<rect x="${xAct + 4}" y="${(y - 6).toFixed(1)}" width="${len.toFixed(1)}" height="12" rx="2" fill="${isChosen ? ACCENT : a.score >= 0 ? '#4b8f6a' : '#a05555'}"/><text class="${isChosen ? 'bv-chosen' : ''}" x="${xAct + 8 + len}" y="${(y + 4).toFixed(1)}">${isChosen ? '▶ ' : ''}${esc(prettyAction(a))} ${a.score.toFixed(1)}</text>`;
      })
      .join('');

    const counts = familyCounts(t.inputNames);
    const chips = counts
      .map(({ family, total }) => {
        const on = this.expanded.has(family);
        const shownCount = shown.filter((i) => inputFamily(t.inputNames[i]) === family).length;
        const more = total - shownCount;
        return `<button type="button" data-family="${family}" aria-pressed="${on}">${FAMILY_LABEL[family]}${more > 0 ? ` +${more} more` : on ? ' (all)' : ''}</button>`;
      })
      .join('');
    const hiddenNote = t.growable
      ? `${hidden.filter((u) => u.acquired).length} acquired of ${hidden.length} live hidden units (amber ring = acquired)`
      : `${hidden.length} hidden units`;
    const hiddenRows = actionRows.length < t.actions.length ? ` · ${t.actions.length - actionRows.length} lower-scoring actions not drawn` : '';
    const summary = chosen
      ? `Chose <strong>${esc(prettyAction(chosen))}</strong>${t.runnerUpIndex >= 0 ? `, runner-up ${esc(prettyAction(t.actions[t.runnerUpIndex]))} (${(chosen.score - t.actions[t.runnerUpIndex].score).toFixed(2)} behind)` : ''}`
      : 'No legal action';
    return `
      <p style="margin:0">${summary}</p>
      <svg viewBox="0 0 340 ${height}" role="img" aria-label="Brain: inputs, hidden units and action scores">${edges.join('')}${inputNodes}${hiddenNodes}${actionNodes}</svg>
      <div class="muted" style="font-size:0.75rem">Green edges push the chosen action up, red push it down; width is this tick's size. Circle fill = activation. ${hiddenNote}${hiddenRows}.</div>
      <div class="brain-families" role="group" aria-label="Show inputs by sense">${chips}</div>
      ${this.ribbonHTML()}`;
  }
}

/** Which actions to draw: the best few by score, always including the chosen one. Pure. */
export function pickActionRows(t: Pick<BrainTrace, 'actions' | 'chosenIndex'>, max = MAX_ACTION_ROWS): { index: number }[] {
  const order = t.actions.map((a, index) => ({ index, score: a.score })).sort((a, b) => b.score - a.score || a.index - b.index);
  const rows = order.slice(0, max);
  if (t.chosenIndex >= 0 && !rows.some((r) => r.index === t.chosenIndex)) rows[rows.length - 1] = { index: t.chosenIndex, score: 0 };
  return rows.map((r) => ({ index: r.index }));
}
