import { GROUP_NAMES } from '../sim/groups';
import type { WorldEvent } from '../sim/events';
import type { FoodRegion, SimulationConfig } from '../sim/types';
import { compass } from './peek-view';

/** Hue at the centre of a colour group's 30° bucket, for its dot. */
const groupHue = (group: number) => (group * 360) / GROUP_NAMES.length;

export interface EventLine {
  readonly text: string;
  /** Colour for the event's dot: a group's hue, or a mood. */
  readonly colour: string;
}

const MOOD = { good: '#86efac', bad: '#f87171', lean: '#d9a050', neutral: '#94a3b8' };

/** Plain-language line for a world event. */
export function describeEvent(e: WorldEvent, regions: readonly FoodRegion[], config: SimulationConfig): EventLine {
  switch (e.kind) {
    case 'season': {
      const where = e.region !== null && regions[e.region] ? ` in the ${compass(regions[e.region], config)}` : '';
      return e.season === 'lean'
        ? { text: `Lean season begins${where}`, colour: MOOD.lean }
        : { text: `Plenty returns${where}`, colour: MOOD.good };
    }
    case 'groupEstablished':
      return { text: `${GROUP_NAMES[e.group]} are on the rise (${e.count})`, colour: `hsl(${groupHue(e.group)}, 80%, 62%)` };
    case 'groupExtinct':
      return { text: `${GROUP_NAMES[e.group]} died out`, colour: `hsl(${groupHue(e.group)}, 80%, 62%)` };
    case 'groupLeads':
      return { text: `${GROUP_NAMES[e.group]} are now the largest group (${e.count})`, colour: `hsl(${groupHue(e.group)}, 80%, 62%)` };
    case 'populationRecord':
      return { text: `Population passes ${e.population} for the first time`, colour: MOOD.good };
    case 'populationCrash':
      return { text: `Population crash: ${e.from} → ${e.to}`, colour: MOOD.bad };
    case 'extinction':
      return { text: 'Everyone has died', colour: MOOD.bad };
    case 'generation':
      return { text: `Generation ${e.generation} is born`, colour: MOOD.neutral };
    case 'firstKill': {
      const killer = e.killerGroup !== null ? GROUP_NAMES[e.killerGroup] : null;
      const prey = e.preyGroup !== null ? GROUP_NAMES[e.preyGroup] : null;
      const text =
        killer && prey
          ? killer === prey
            ? `First kill: one of the ${killer} killed one of its own colour`
            : `First kill: one of the ${killer} killed one of the ${prey}`
          : 'The first kill';
      return { text, colour: MOOD.bad };
    }
    case 'groupDiet':
      return e.diet === 'meat'
        ? { text: `${GROUP_NAMES[e.group]} have turned to meat`, colour: `hsl(${groupHue(e.group)}, 80%, 62%)` }
        : { text: `${GROUP_NAMES[e.group]} have gone back to plants`, colour: `hsl(${groupHue(e.group)}, 80%, 62%)` };
  }
}

const escape = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** The newest event, for the line under the peek strip. */
export function latestEventHTML(events: readonly WorldEvent[], regions: readonly FoodRegion[], config: SimulationConfig): string {
  const e = events[events.length - 1];
  if (!e) return '';
  const line = describeEvent(e, regions, config);
  return `<span class="event-dot" style="background:${line.colour}"></span><span class="event-text">${escape(line.text)}</span><span class="event-tick">t ${e.tick}</span>`;
}

/** The Stats tab's list of recent events, newest first. */
export function eventListHTML(
  events: readonly WorldEvent[],
  regions: readonly FoodRegion[],
  config: SimulationConfig,
  limit = 30
): string {
  if (events.length === 0) return '<p class="muted">Nothing notable yet.</p>';
  const rows = events
    .slice(-limit)
    .reverse()
    .map((e) => {
      const line = describeEvent(e, regions, config);
      return `<li><span class="event-dot" style="background:${line.colour}"></span><span class="event-text">${escape(line.text)}</span><span class="event-tick">t ${e.tick}</span></li>`;
    });
  return `<ul class="event-list">${rows.join('')}</ul>`;
}
