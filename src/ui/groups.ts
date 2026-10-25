/**
 * Colour groups for display: organisms bucketed by tag hue. A neutral,
 * display-only grouping ("groups", not species); it reads the population and
 * changes nothing in the simulation.
 */

/** Twelve 30° hue buckets, centred on 0°, 30°, … with a plain colour name. */
export const GROUP_NAMES = [
  'Reds', 'Oranges', 'Yellows', 'Limes', 'Greens', 'Jades',
  'Cyans', 'Skies', 'Blues', 'Violets', 'Magentas', 'Pinks',
] as const;

const BUCKET = 360 / GROUP_NAMES.length;

export interface ColourGroup {
  readonly name: string;
  /** Circular mean hue of the members, for drawing. */
  readonly hue: number;
  readonly count: number;
}

export function groupIndexOf(hue: number): number {
  const h = ((hue % 360) + 360) % 360;
  return Math.floor((h + BUCKET / 2) / BUCKET) % GROUP_NAMES.length;
}

/** Groups by tag hue, largest first; empty buckets are left out. */
export function colourGroups(organisms: Iterable<{ readonly tag: number }>): ColourGroup[] {
  const n = GROUP_NAMES.length;
  const counts = new Array<number>(n).fill(0);
  const sx = new Array<number>(n).fill(0);
  const sy = new Array<number>(n).fill(0);
  for (const { tag } of organisms) {
    const i = groupIndexOf(tag);
    counts[i]++;
    const rad = (tag * Math.PI) / 180;
    sx[i] += Math.cos(rad);
    sy[i] += Math.sin(rad);
  }
  const groups: ColourGroup[] = [];
  for (let i = 0; i < n; i++) {
    if (counts[i] === 0) continue;
    const mean = (Math.atan2(sy[i], sx[i]) * 180) / Math.PI;
    groups.push({ name: GROUP_NAMES[i], hue: (mean + 360) % 360, count: counts[i] });
  }
  // Ties broken by bucket order so the strip doesn't flicker.
  return groups.sort((a, b) => b.count - a.count || GROUP_NAMES.indexOf(a.name as never) - GROUP_NAMES.indexOf(b.name as never));
}
