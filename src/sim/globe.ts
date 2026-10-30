import type { SimulationConfig } from './types';

/**
 * The map as a cylinder (docs/specs/globe.md): with `worldWrapEnabled` the east and west edges join, so a body
 * walking east comes back from the west; the north and south edges stay polar edges. These helpers are the one
 * place that knows how, so the rest of the sim asks "which column is this" and "how far apart are these two".
 * With the switch off they return their input unchanged, so that world is bit-identical to one without wrapping.
 */

/** The column of x on a map `width` wide, wrapped when the world wraps. */
export function wrapX(x: number, width: number, wrap: boolean): number {
  if (!wrap) return x;
  const m = x % width;
  return m < 0 ? m + width : m;
}

/** The signed east-west difference from a to b by the short way round (in -width/2 .. width/2 when wrapped). */
export function wrapDx(dx: number, width: number, wrap: boolean): number {
  if (!wrap) return dx;
  return dx - width * Math.round(dx / width);
}

/** The index of the neighbour of (x, y) at offset (dx, dy), or -1 off the map (only north and south are off the map when wrapped). */
export function neighbourIndex(x: number, y: number, dx: number, dy: number, width: number, height: number, wrap: boolean): number {
  const ny = y + dy;
  if (ny < 0 || ny >= height) return -1;
  const nx = wrap ? wrapX(x + dx, width, true) : x + dx;
  if (nx < 0 || nx >= width) return -1;
  return ny * width + nx;
}

export const wraps = (config: Readonly<Pick<SimulationConfig, 'worldWrapEnabled'>>): boolean => config.worldWrapEnabled === true;
